import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { completeAuthorClaimCoverage } from "./author-claim-coverage-completion.js";
import { completeCvProposalIssues } from "./complete-cv.js";
import {
  completeStructuredFieldClaims,
  containsBoundedField,
  structuredFieldSegments,
} from "./structured-field-completion.js";

type ProposalBlock = AuthorArtifactProposal["sections"][number]["blocks"][number];

const checksum = "a".repeat(64);

function chunk(id: string, text: string, rank = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal: rank,
    lineStart: rank + 1,
    lineEnd: rank + 1,
    checksum,
    text,
    rank,
  };
}

function block(
  text: string,
  claims: readonly { text: string; evidenceChunkIds: string[]; substantive?: boolean }[],
): ProposalBlock {
  return {
    type: "paragraph",
    text,
    claims: claims.map((claim) => ({ substantive: true, ...claim })),
  };
}

function proposal(input: ProposalBlock): AuthorArtifactProposal {
  return authorArtifactProposalSchema.parse({
    sections: [{ title: "Experience", kind: "experience", blocks: [input] }],
  });
}

function segmentTexts(text: string): readonly string[] {
  return structuredFieldSegments(text).map((segment) => segment.text);
}

describe("structured field segments", () => {
  it.each([
    ["pipe", "Engineer | Acme", ["Engineer", "Acme"]],
    ["bullet", "Engineer • Acme", ["Engineer", "Acme"]],
    ["middle dot", "Engineer · Acme", ["Engineer", "Acme"]],
    ["em dash", "Engineer — Acme", ["Engineer", "Acme"]],
    ["en dash", "Engineer – Acme", ["Engineer", "Acme"]],
    ["comma", "TypeScript, Python", ["TypeScript", "Python"]],
    ["semicolon", "TypeScript; Python", ["TypeScript", "Python"]],
    ["spaced slash", "Lisbon / Remote", ["Lisbon", "Remote"]],
    ["line break", "Engineer\nAcme\r\nLisbon", ["Engineer", "Acme", "Lisbon"]],
  ])("splits on a %s", (_case, text, expected) => {
    expect(segmentTexts(text)).toEqual(expected);
  });

  it("never splits a comma between two digits", () => {
    expect(segmentTexts("Saved 12,000 hours, cut costs")).toEqual([
      "Saved 12,000 hours",
      "cut costs",
    ]);
    expect(segmentTexts("Versions 3, 4")).toEqual(["Versions 3", "4"]);
  });

  it.each([
    ["spaced en dash years", "Acme | 2019 – 2023", ["Acme", "2019 – 2023"]],
    ["unspaced en dash years", "2019–2023", ["2019–2023"]],
    ["em dash years", "2019 — 2023", ["2019 — 2023"]],
    ["month ranges", "Jan 2019 – Dec 2021", ["Jan 2019 – Dec 2021"]],
    ["numbers", "10 – 20 engineers", ["10 – 20 engineers"]],
  ])("never splits a dash inside a numeric range: %s", (_case, text, expected) => {
    expect(segmentTexts(text)).toEqual(expected);
  });

  it("splits a dash with one non-numeric side", () => {
    expect(segmentTexts("Acme — 2019")).toEqual(["Acme", "2019"]);
    expect(segmentTexts("Present – 2019")).toEqual(["Present", "2019"]);
    expect(segmentTexts("May – June 2020")).toEqual(["May", "June 2020"]);
  });

  it.each([
    ["Present", "Acme | 2019 – Present", ["Acme", "2019 – Present"]],
    ["month start", "Jan 2019 – present", ["Jan 2019 – present"]],
    ["trailing punctuation", "2021 – Now)", ["2021 – Now)"]],
    ["current", "2020 — Current", ["2020 — Current"]],
  ])("keeps an open-ended range whole: %s", (_case, text, expected) => {
    expect(segmentTexts(text)).toEqual(expected);
  });

  it("keeps an unspaced slash and a hyphen inside one segment", () => {
    expect(segmentTexts("CI/CD | full-stack")).toEqual(["CI/CD", "full-stack"]);
  });

  it("drops empty and punctuation-only segments", () => {
    expect(segmentTexts(" | Acme ||  - , Lisbon ")).toEqual(["Acme", "Lisbon"]);
  });

  it("splits a leading label of up to four words from its value", () => {
    expect(segmentTexts("Programming Languages: TypeScript, Python")).toEqual([
      "Programming Languages",
      "TypeScript",
      "Python",
    ]);
    expect(segmentTexts("One two three four five: value")).toEqual([
      "One two three four five: value",
    ]);
  });

  it("records each segment's offset in the block text", () => {
    const text = "Skills: Go |  Rust";
    for (const segment of structuredFieldSegments(text)) {
      expect(text.slice(segment.start, segment.start + segment.text.length)).toBe(segment.text);
    }
  });
});

describe("bounded field matching", () => {
  it("matches normalized verbatim text bounded by non-letter-or-digit characters", () => {
    expect(containsBoundedField("Languages: Go,  Rust", "go")).toBe(true);
    expect(containsBoundedField("Worked at Northwind   Freight.", "Northwind Freight")).toBe(true);
    expect(containsBoundedField("Go", "Go")).toBe(true);
  });

  it("does not match a field inside a longer word", () => {
    expect(containsBoundedField("Engineer at Google", "Go")).toBe(false);
    expect(containsBoundedField("Ergonomics", "Go")).toBe(false);
    expect(containsBoundedField("2019 to 20231", "2023")).toBe(false);
  });

  it("unifies dash variants and their surrounding space on both sides", () => {
    expect(containsBoundedField("Engineer (2019-2023)", "2019 – 2023")).toBe(true);
    expect(containsBoundedField("Engineer, 2019 — 2023", "2019–2023")).toBe(true);
    expect(containsBoundedField("Engineer, 2019 ‐ 2023", "2019 - 2023")).toBe(true);
    expect(containsBoundedField("Engineer, 2019 – 2024 and 2023", "2019 – 2023")).toBe(false);
    expect(containsBoundedField("Engineer, 2019 – 20234", "2019 – 2023")).toBe(false);
  });

  it("does not match part of a thousands-separated number", () => {
    expect(containsBoundedField("Saved 12,500 hours and 3,000 more", "Saved 12,000 hours")).toBe(
      false,
    );
  });
});

describe("structured field claim completion", () => {
  it("adds one claim per field found in the cited chunks, in retrieved order", () => {
    const input = block("Staff Engineer | Northwind Freight | 2019 – 2023", [
      { text: "Staff Engineer", evidenceChunkIds: ["second", "first"] },
    ]);
    const evidence = [
      chunk("first", "Staff Engineer at Northwind Freight from 2019 – 2023", 0),
      chunk("uncited", "Northwind Freight 2019 2023", 1),
      chunk("second", "Northwind Freight, 2019", 2),
    ];

    const completed = completeStructuredFieldClaims(input, evidence);

    expect(completed.claims).toEqual([
      ...input.claims,
      { text: "Northwind Freight", substantive: true, evidenceChunkIds: ["first", "second"] },
      { text: "2019 – 2023", substantive: true, evidenceChunkIds: ["first"] },
    ]);
  });

  it("searches only cited chunks when the block has substantive claims", () => {
    const input = block("Staff Engineer | Lisbon", [
      { text: "Staff Engineer", evidenceChunkIds: ["cited"] },
    ]);
    const evidence = [chunk("cited", "Staff Engineer"), chunk("uncited", "Lisbon", 1)];

    expect(completeStructuredFieldClaims(input, evidence)).toBe(input);
  });

  it("searches all retrieved chunks when the block has no substantive claims", () => {
    const input = block("Ada Example | Lisbon", [
      { text: "Ada Example | Lisbon", evidenceChunkIds: [], substantive: false },
    ]);
    const evidence = [chunk("name", "Ada Example", 0), chunk("city", "Based in Lisbon.", 1)];

    expect(completeStructuredFieldClaims(input, evidence).claims.slice(1)).toEqual([
      { text: "Ada Example", substantive: true, evidenceChunkIds: ["name"] },
      { text: "Lisbon", substantive: true, evidenceChunkIds: ["city"] },
    ]);
  });

  it("completes a label only when the label itself appears in evidence", () => {
    const evidence = [chunk("skills", "Languages: TypeScript, Python")];
    const labelled = completeStructuredFieldClaims(
      block("Languages: TypeScript, Python", []),
      evidence,
    );
    expect(labelled.claims.map((claim) => claim.text)).toEqual([
      "Languages",
      "TypeScript",
      "Python",
    ]);

    const unsupportedLabel = completeStructuredFieldClaims(
      block("Tooling: TypeScript, Python", []),
      evidence,
    );
    expect(unsupportedLabel.claims.map((claim) => claim.text)).toEqual(["TypeScript", "Python"]);
  });

  it("does not match a short field inside a longer evidence word", () => {
    const input = block("Skills: Go", []);
    const completed = completeStructuredFieldClaims(input, [chunk("employer", "Skills at Google")]);

    expect(completed.claims.map((claim) => claim.text)).toEqual(["Skills"]);
  });

  it("skips fields already covered by existing substantive claims", () => {
    const input = block("Staff Engineer | Lisbon", [
      { text: "Staff Engineer", evidenceChunkIds: ["cited"] },
    ]);
    const completed = completeStructuredFieldClaims(input, [
      chunk("cited", "Staff Engineer in Lisbon"),
    ]);

    expect(completed.claims).toEqual([
      ...input.claims,
      { text: "Lisbon", substantive: true, evidenceChunkIds: ["cited"] },
    ]);
  });

  it("never adds a duplicate claim for a repeated field", () => {
    const input = block("Python, Python", []);
    const completed = completeStructuredFieldClaims(input, [chunk("skills", "Python")]);

    expect(completed.claims).toEqual([
      { text: "Python", substantive: true, evidenceChunkIds: ["skills"] },
    ]);
  });

  it("adds no claim for a thousands value that evidence only reproduces in pieces", () => {
    const input = block("Saved 12,000 hours annually", []);
    const evidence = [
      chunk("first", "Saved 12,500 hours annually", 0),
      chunk("second", "Automated 3,000 hours annually", 1),
    ];

    expect(completeStructuredFieldClaims(input, evidence)).toBe(input);
  });

  it("adds no claim for a range whose end year appears only elsewhere", () => {
    const input = block("Acme | 2019 – 2023", [{ text: "Acme", evidenceChunkIds: ["cited"] }]);
    const completed = completeStructuredFieldClaims(input, [
      chunk("cited", "Acme, 2019 – 2024. Promoted in 2023."),
    ]);

    expect(completed).toBe(input);
  });

  it("adds a range claim when evidence writes the range with another dash", () => {
    const input = block("Acme | 2019 – 2023", [{ text: "Acme", evidenceChunkIds: ["cited"] }]);
    const completed = completeStructuredFieldClaims(input, [chunk("cited", "Acme (2019-2023)")]);

    expect(completed.claims.slice(1)).toEqual([
      { text: "2019 – 2023", substantive: true, evidenceChunkIds: ["cited"] },
    ]);
  });

  it("adds no claim for a field absent from the evidence", () => {
    const input = block("Staff Engineer | Porto", [
      { text: "Staff Engineer", evidenceChunkIds: ["cited"] },
    ]);

    expect(completeStructuredFieldClaims(input, [chunk("cited", "Staff Engineer in Lisbon")])).toBe(
      input,
    );
  });

  it("covers a supported heading end to end and leaves an unsupported field rejected", () => {
    const evidence = [chunk("cited", "Staff Engineer, Northwind Freight, 2019 – 2023")];
    const supported = proposal(
      block("Staff Engineer | Northwind Freight | 2019 – 2023", [
        { text: "Staff Engineer", evidenceChunkIds: ["cited"] },
      ]),
    );
    expect(
      completeCvProposalIssues(completeAuthorClaimCoverage(supported, evidence), evidence),
    ).toEqual([]);

    const changedYear = proposal(
      block("Staff Engineer | Northwind Freight | 2019 – 2024", [
        { text: "Staff Engineer", evidenceChunkIds: ["cited"] },
      ]),
    );
    expect(
      completeCvProposalIssues(completeAuthorClaimCoverage(changedYear, evidence), evidence),
    ).toContainEqual(expect.objectContaining({ code: "substantive_text_uncovered" }));
  });
});
