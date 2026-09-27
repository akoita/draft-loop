import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { completeAuthorEvidenceCitations } from "./author-evidence-completion.js";
import { supportsProtectedValue, supportsProtectedValueInChunks } from "./author-grounding.js";
import { completeCvProposalIssues } from "./complete-cv.js";

const checksum = "a".repeat(64);

function chunk(id: string, text: string, rank = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "fictional-workspace",
    sourceId: "fictional-source",
    ordinal: rank,
    lineStart: rank + 1,
    lineEnd: rank + 1,
    checksum,
    text,
    rank,
  };
}

function proposal(text: string, evidenceChunkIds: readonly string[], kind = "summary") {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: kind === "experience" ? "Experience" : "Summary",
        kind,
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: [...evidenceChunkIds] }],
          },
        ],
      },
    ],
  });
}

describe("same-chunk compositional support for uncertain multiword terms", () => {
  it("supports reordered capitalized components without accepting prefixes or missing words", () => {
    const source = "At Emberglass Systems, added a Qorvex Relay adapter in Rust.";

    expect(supportsProtectedValue(source, "Rust Qorvex Relay")).toBe(true);
    expect(supportsProtectedValue(source, "Rust Qorvex Relay Pro")).toBe(false);
    expect(supportsProtectedValue(source, "Rust Qorvexed Relay")).toBe(false);
    expect(supportsProtectedValue("Added a Qorvex adapter in Rust.", "Rust Qorvex Relay")).toBe(
      false,
    );
  });

  it("accepts the fictional #619 course wording while keeping the historical baseline separate", () => {
    const source =
      "Completed a Cloud Systems bootcamp course at Ashen Ridge Institute and received a certificate of attendance.";
    const claim =
      "Completed the Ashen Ridge Institute Cloud Systems course; received a certificate of attendance.";
    const evidence = [chunk("course", source)];

    expect(completeCvProposalIssues(proposal(claim, ["course"]), evidence)).toEqual([]);
  });

  it("completes a citation from one chunk when its descriptive term is compositionally supported", () => {
    const source = chunk("adapter", "Added a Qorvex Relay adapter in Rust.");
    const initial = proposal("Built a Rust Qorvex Relay adapter.", []);
    const completed = completeAuthorEvidenceCitations(initial, [source]);

    expect(completed.sections[0]?.blocks[0]?.claims[0]?.evidenceChunkIds).toEqual(["adapter"]);
    expect(completeCvProposalIssues(completed, [source])).toEqual([]);
  });

  it("requires all components in one cited chunk, not a union across chunks", () => {
    const evidence = [chunk("first", "Added a Qorvex adapter in Rust."), chunk("second", "Relay")];

    expect(
      supportsProtectedValueInChunks(
        evidence.map(({ text }) => text),
        "Rust Qorvex Relay",
      ),
    ).toBe(false);
    expect(
      completeCvProposalIssues(
        proposal("Built a Rust Qorvex Relay adapter.", ["first", "second"]),
        evidence,
      ).map(({ code }) => code),
    ).toContain("factual_invariant_violation");
  });

  it("assigns recombined existing name words to semantic review instead of claiming proof", () => {
    const source = "Juniper Field Consulting and Bellwether Transit were separate organizations.";

    expect(supportsProtectedValue(source, "Juniper Field Transit")).toBe(true);
    expect(supportsProtectedValue(source, "Juniper Transit")).toBe(false);
    expect(supportsProtectedValue(source, "Juniper Harbor")).toBe(false);
  });

  it("does not compose from missing or invalid citations", () => {
    const evidence = [chunk("source", "Added a Qorvex Relay adapter in Rust.")];
    const claim = "Built a Rust Qorvex Relay adapter.";

    expect(
      completeCvProposalIssues(proposal(claim, []), evidence).map(({ code }) => code),
    ).toContain("missing_evidence");
    expect(
      completeCvProposalIssues(proposal(claim, ["missing"], "experience"), evidence).map(
        ({ code }) => code,
      ),
    ).toContain("factual_invariant_violation");
  });

  it("keeps exact metric and date checks unchanged", () => {
    const evidence = [
      chunk(
        "facts",
        "Built a Qorvex Relay adapter in Rust; improved throughput by 15% from Jan 2020 to Dec 2023.",
      ),
    ];
    const changedMetric =
      "Built a Rust Qorvex Relay adapter; improved throughput by 20% from Jan 2020 to Dec 2023.";
    const changedDate =
      "Built a Rust Qorvex Relay adapter; improved throughput by 15% from Jan 2020 to Dec 2024.";

    expect(
      completeCvProposalIssues(proposal(changedMetric, ["facts"]), evidence).map(
        ({ code }) => code,
      ),
    ).toContain("factual_invariant_violation");
    expect(
      completeCvProposalIssues(proposal(changedDate, ["facts"]), evidence).map(({ code }) => code),
    ).toContain("factual_invariant_violation");
  });

  it("does not let reordered employer words bypass same-employer date association", () => {
    const source = chunk(
      "role",
      "Northwind Freight\nCareer overview | Jan 2020 to Dec 2024\nRole history: Engineer",
    );
    const header = "Freight Northwind | Engineer | Jan 2020 - Dec 2024";

    expect(supportsProtectedValueInChunks([source.text], "Freight Northwind")).toBe(true);
    expect(
      completeCvProposalIssues(proposal(header, ["role"], "experience"), [source]),
    ).toContainEqual(
      expect.objectContaining({
        code: "factual_invariant_violation",
        path: ["sections", 0, "blocks", 0, "text"],
      }),
    );
  });
});
