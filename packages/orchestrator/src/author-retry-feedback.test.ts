import { describe, expect, it } from "vitest";

import { buildAuthorRetryCorrections } from "./author-retry-feedback.js";

describe("structured author retry feedback", () => {
  it("classifies the three allowlisted author correction families", () => {
    expect(
      buildAuthorRetryCorrections([
        {
          code: "factual_invariant_violation",
          path: "sections.0.blocks.0.claims.0.text",
        },
        {
          code: "custom",
          path: "sections.0.blocks.1.claims.0.evidenceChunkIds.0",
        },
        { code: "substantive_text_uncovered", path: "sections.0.blocks.2.text" },
      ]),
    ).toEqual([
      {
        kind: "factual-claim-text",
        path: "sections.0.blocks.0.claims.0.text",
        instruction:
          "Use only factual text supported by cited evidence at this claim path, or omit it.",
      },
      {
        kind: "invalid-evidence-reference",
        path: "sections.0.blocks.1.claims.0.evidenceChunkIds.0",
        instruction:
          "Replace this reference with an approved retrievedEvidence ID that supports the claim, or omit the claim.",
      },
      {
        kind: "uncovered-substantive-text",
        path: "sections.0.blocks.2.text",
        instruction:
          "Cover supported block text with contiguous substantive claims, or remove unsupported text.",
      },
    ]);
  });

  it("drops unknown codes, unsafe paths, and near-match structures", () => {
    expect(
      buildAuthorRetryCorrections([
        { code: "private-prose", path: "sections.0.blocks.0.text" },
        { code: "custom", path: "sections.0.blocks.0.claims.0.evidenceChunkIds.private" },
        { code: "substantive_text_uncovered", path: "candidate secret text!" },
      ]),
    ).toEqual([]);
  });
});
