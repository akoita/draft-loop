import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { extractProtectedValues } from "./author-grounding.js";
import { completeCvProposalIssues } from "./complete-cv.js";

const checksum = "b".repeat(64);

function chunk(id: string, text: string, ordinal: number): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "fictional-workspace",
    sourceId: "fictional-source",
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

describe("bounded opening and software-description grammar", () => {
  it("protects only the exact employer in an opening lowercase listed-action phrase", () => {
    const text = "At Northstar, built an event service using Go.";
    const evidence = [
      chunk("employer", "Northstar", 0),
      chunk("work", "built an event service", 1),
      chunk("language", "Go", 2),
    ];

    expect(extractProtectedValues(text)).toContain("Northstar");
    expect(extractProtectedValues(text)).not.toContain("At Northstar");
    expect(issues(text, evidence)).toEqual([]);
    expect(
      issues(
        text,
        evidence.filter(({ id }) => id !== "employer"),
      ),
    ).toContain("factual_invariant_violation");
    expect(
      issues(text, [chunk("changed-employer", "Southstar", 0), ...evidence.slice(1)]),
    ).toContain("factual_invariant_violation");

    for (const ambiguousText of [
      "At Northstar, Built an event service using Go.",
      "Experience: At Northstar, built an event service using Go.",
      "At Senior Engineer, built an event service using Go.",
      "At Northstar, created an event service using Go.",
      "At Northstar Labs, built an event service using Go.",
    ]) {
      expect(issues(ambiguousText, evidence), ambiguousText).toContain(
        "factual_invariant_violation",
      );
    }
  });

  it("checks the product, language, and exact model-driven engineering descriptor separately", () => {
    const text =
      "Built ZETA, a Java Model-Driven Engineering tool for compile checks across 3 services.";
    const evidence = [
      chunk("product", "ZETA", 0),
      chunk("language", "Java", 1),
      chunk("descriptor", "Model-Driven Engineering", 2),
      chunk("work", "tool for compile checks across 2 services", 3),
    ];

    expect(extractProtectedValues(text)).toEqual(
      expect.arrayContaining(["ZETA", "Java", "Model-Driven Engineering"]),
    );
    expect(extractProtectedValues(text)).not.toContain("Java Model-Driven Engineering");
    expect(issues(text, evidence)).toContain("factual_invariant_violation");

    const correctedEvidence = [
      ...evidence.slice(0, 3),
      chunk("work", "tool for compile checks across 3 services", 3),
    ];
    expect(issues(text, correctedEvidence)).toEqual([]);
    for (const id of ["product", "language", "descriptor"]) {
      expect(
        issues(
          text,
          correctedEvidence.filter((chunkValue) => chunkValue.id !== id),
        ),
      ).toContain("factual_invariant_violation");
    }
    expect(
      issues(
        "Built ZETAPro, a Java Model-Driven Engineering tool for compile checks.",
        correctedEvidence,
      ),
    ).toContain("factual_invariant_violation");
    expect(
      issues(
        "Senior Built ZETA, a Java Model-Driven Engineering tool for compile checks.",
        correctedEvidence,
      ),
    ).toContain("factual_invariant_violation");
  });

  it("splits only the exact replacement phrase into Haskell and DSL", () => {
    const text =
      "adapters for a polyglot platform, replacing an unmaintainable Haskell-based DSL tool; the parser remains modular.";
    const evidence = [
      chunk("context", "adapters for a polyglot platform, replacing an unmaintainable", 0),
      chunk("language", "Haskell", 1),
      chunk("technology", "DSL", 2),
      chunk("description", "tool; the parser remains modular", 3),
    ];

    expect(extractProtectedValues(text)).toEqual(expect.arrayContaining(["Haskell", "DSL"]));
    expect(extractProtectedValues(text)).not.toContain("Haskell-based DSL");
    expect(issues(text, evidence)).toEqual([]);
    for (const id of ["language", "technology"]) {
      expect(
        issues(
          text,
          evidence.filter((chunkValue) => chunkValue.id !== id),
        ),
      ).toContain("factual_invariant_violation");
    }

    for (const ambiguousText of [
      "replacing an unmaintainable Haskell-based DXL tool; the parser remains modular.",
      "At Northstar, replacing an unmaintainable Haskell-based DSL tool; parser is modular.",
      "Senior replacing an unmaintainable Haskell-based DSL tool; parser is modular.",
      "The Haskell-based DSL tool supports additional plugins.",
    ]) {
      expect(issues(ambiguousText, evidence), ambiguousText).toContain(
        "factual_invariant_violation",
      );
    }
  });
});
