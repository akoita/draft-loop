import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { extractProtectedValues } from "./author-grounding.js";
import { completeCvProposalIssues } from "./complete-cv.js";

const checksum = "a".repeat(64);

function chunk(id: string, text: string, ordinal: number): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal,
    lineStart: ordinal + 1,
    lineEnd: ordinal + 1,
    checksum,
    text,
    rank: ordinal,
  };
}

function issues(text: string, evidence: readonly ScoredEvidenceChunk[]) {
  const proposal = authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: evidence.map(({ id }) => id) }],
          },
        ],
      },
    ],
  });
  return completeCvProposalIssues(proposal, evidence).map(({ code }) => code);
}

describe("software description protected parts", () => {
  it("grounds a closed language and a separate product name before a software phrase", () => {
    const text = "Python NimbusLedger event ingestion";
    const evidence = [chunk("language", "Python", 0), chunk("product", "NimbusLedger", 1)];

    expect(extractProtectedValues(text)).toEqual(["Python", "NimbusLedger"]);
    expect(issues(text, evidence)).toEqual([]);
  });

  it("grounds a mid-sentence language and rejects a near-match language name", () => {
    const midSentence =
      "Built event ingestion contributions to Python NimbusLedger event ingestion";
    expect(
      issues(midSentence, [
        chunk("contribution", "Built event ingestion contributions to", 0),
        chunk("language", "Python", 1),
        chunk("product", "NimbusLedger", 2),
      ]),
    ).toEqual([]);

    const nearMatch = "JavaWorks NimbusLedger event ingestion";
    expect(
      issues(nearMatch, [
        chunk("near-language", "JavaWorks", 0),
        chunk("product", "NimbusLedger", 1),
        chunk("description", "event ingestion", 2),
      ]),
    ).toContain("factual_invariant_violation");
  });

  it("keeps a language-looking employer phrase intact", () => {
    const text = "Worked at Python NimbusLedger software company";
    expect(
      issues(text, [chunk("language", "Python", 0), chunk("company", "NimbusLedger", 1)]),
    ).toContain("factual_invariant_violation");
  });

  it("rejects either missing component without requiring a merged source phrase", () => {
    const text = "Python NimbusLedger event ingestion";
    expect(issues(text, [chunk("language", "Python", 0)])).toContain("factual_invariant_violation");
    expect(issues(text, [chunk("product", "NimbusLedger", 0)])).toContain(
      "factual_invariant_violation",
    );
  });

  it("keeps company, title, and linking contexts as complete protected names", () => {
    expect(extractProtectedValues("Python NimbusLedger is the employer")).toContain(
      "Python NimbusLedger",
    );
    expect(extractProtectedValues("Senior Python NimbusLedger event ingestion")).toContain(
      "Senior Python NimbusLedger",
    );
    expect(extractProtectedValues("Python NimbusLedger company")).toContain("Python NimbusLedger");
  });

  it("grounds a project name and MVP label as separate protected components", () => {
    const text = "LEDGERKIT MVP: worked from audit report";
    const evidence = [
      chunk("project", "LEDGERKIT", 0),
      chunk("label", "MVP", 1),
      chunk("work", "Worked from an audit report", 2),
    ];

    expect(extractProtectedValues(text)).toContain("LEDGERKIT");
    expect(extractProtectedValues(text)).toContain("MVP");
    expect(issues(text, evidence)).toEqual([]);
    expect(issues(text, evidence.slice(1))).toContain("factual_invariant_violation");
    expect(
      issues(
        text,
        evidence.filter(({ id }) => id !== "label"),
      ),
    ).toContain("factual_invariant_violation");
  });

  it("requires both the project acronym and the closed Java modifier in an appositive", () => {
    const text = "Built FLUXDSL, a Java model-driven engineering tool";
    const evidence = [
      chunk("project", "FLUXDSL", 0),
      chunk("language", "Java", 1),
      chunk("description", "model-driven engineering tool", 2),
    ];

    expect(extractProtectedValues(text)).toContain("FLUXDSL");
    expect(extractProtectedValues(text)).toContain("Java");
    expect(issues(text, evidence)).toEqual([]);
    expect(
      issues(
        text,
        evidence.filter(({ id }) => id !== "project"),
      ),
    ).toContain("factual_invariant_violation");
    expect(
      issues(
        text,
        evidence.filter(({ id }) => id !== "language"),
      ),
    ).toContain("factual_invariant_violation");
  });

  it("rejects unknown languages and software qualifiers", () => {
    expect(
      issues("Built FLUXDSL, a Klingon model-driven engineering tool", [
        chunk("project", "FLUXDSL", 0),
        chunk("language", "Klingon", 1),
        chunk("description", "model-driven engineering tool", 2),
      ]),
    ).toContain("factual_invariant_violation");
    expect(
      issues("Built FLUXDSL, a Java proprietary-supervision widget", [
        chunk("project", "FLUXDSL", 0),
        chunk("language", "Java", 1),
        chunk("description", "proprietary-supervision widget", 2),
      ]),
    ).toContain("factual_invariant_violation");
  });
});
