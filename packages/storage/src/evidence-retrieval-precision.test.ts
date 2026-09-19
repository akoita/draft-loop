import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { evidenceQueryTerms, preferMultiTermEvidenceHits } from "./evidence-retrieval-precision.js";

function hit(id: string, text: string): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "a".repeat(64),
    text,
    rank: 0,
  };
}

describe("evidence retrieval precision", () => {
  it("bounds, normalizes, de-duplicates, and removes query stop words", () => {
    const noise = Array.from({ length: 60 }, (_, index) => `Term${index}`).join(" ");
    const terms = evidenceQueryTerms(`The TYPESCRIPT typescript ${noise}`);
    expect(terms).toHaveLength(48);
    expect(terms.slice(0, 3)).toEqual(["typescript", "term0", "term1"]);
  });

  it("removes one-term distractors when a multi-term hit exists without reordering", () => {
    const precise = hit("precise", "Built TypeScript distributed services.");
    const distractor = hit("distractor", "Built a TypeScript hobby game.");
    const secondPrecise = hit("second", "Maintained distributed TypeScript platforms.");
    expect(
      preferMultiTermEvidenceHits(evidenceQueryTerms("TypeScript distributed services"), [
        precise,
        distractor,
        secondPrecise,
      ]),
    ).toEqual([precise, secondPrecise]);
  });

  it("preserves single-term and sparse multi-term results", () => {
    const first = hit("first", "TypeScript systems.");
    const second = hit("second", "Distributed systems.");
    expect(preferMultiTermEvidenceHits(["typescript"], [first, second])).toEqual([first, second]);
    expect(preferMultiTermEvidenceHits(["typescript", "distributed"], [first, second])).toEqual([
      first,
      second,
    ]);
  });
});
