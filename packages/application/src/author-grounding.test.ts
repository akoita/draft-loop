import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { createAuthorGroundingGuide, extractProtectedValues } from "./author-grounding.js";

const checksum = "a".repeat(64);

function chunk(id: string, text: string, rank = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: `source-${id}`,
    ordinal: rank,
    lineStart: rank + 1,
    lineEnd: rank + 1,
    checksum,
    text,
    rank,
  };
}

describe("author grounding guide", () => {
  it("extracts protected values in first exact occurrence order and deduplicates normalized values", () => {
    expect(
      extractProtectedValues(
        "Staff Engineer at Example Systems delivered 85% growth in 2022-2026, earned AWS Certified Developer, and shared HTTPS://Example.com/CV with Ada@example.com before https://example.com/cv and AWS.",
      ),
    ).toEqual([
      "Staff Engineer",
      "Example Systems",
      "Example",
      "85%",
      "2022",
      "2026",
      "AWS",
      "AWS Certified Developer",
      "HTTPS://Example.com/CV",
      "HTTPS",
      "CV",
      "Ada@example.com",
    ]);
  });

  it("builds a stable metadata-free entry for each evidence chunk with protected values", () => {
    const guide = createAuthorGroundingGuide([
      chunk("chunk-first", "Staff Engineer at Example Systems, 2024.", 0),
      chunk("chunk-empty", "plain evidence with no protected values", 1),
      chunk("chunk-second", "AWS Certified Developer; 85% improvement.", 2),
    ]);

    expect(guide).toEqual([
      {
        evidenceChunkId: "chunk-first",
        protectedValues: ["Staff Engineer", "Example Systems", "Example", "2024"],
      },
      {
        evidenceChunkId: "chunk-second",
        protectedValues: ["AWS", "AWS Certified Developer", "85%"],
      },
    ]);
    for (const entry of guide) {
      expect(Object.keys(entry).sort()).toEqual(["evidenceChunkId", "protectedValues"]);
    }
  });

  it("omits empty and protected-value-free evidence", () => {
    expect(
      createAuthorGroundingGuide([
        chunk("blank", "  \n", 0),
        chunk("plain", "plain evidence with no protected values", 1),
      ]),
    ).toEqual([]);
  });
});
