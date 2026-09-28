import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import {
  createAuthorGroundingGuide,
  extractProtectedValues,
  supportsProtectedValue,
  supportsProtectedValueInChunks,
} from "./author-grounding.js";
import { completeCvProposalIssues } from "./complete-cv.js";

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

function proposal(text: string, evidenceChunkId: string) {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "bullet",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: [evidenceChunkId] }],
          },
        ],
      },
    ],
  });
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

  it("matches a protected multiword name wrapped word by word in source evidence", () => {
    expect(
      supportsProtectedValue("Technical summary: **FLUX** RPC was deployed.", "FLUX RPC"),
    ).toBe(true);
    expect(
      supportsProtectedValue("Technical summary: C**FLUX** RPC was deployed.", "FLUX RPC"),
    ).toBe(false);
  });

  it.each([
    ["Yarrowline", "Yarrowline's"],
    ["Yarrowline", "Yarrowline’s"],
    ["Yarrowline's client record", "Yarrowline’s"],
    ["Yarrowline’s client record", "Yarrowline's"],
  ])("supports the ordinary possessive of an exact single-word name: %s / %s", (evidence, name) => {
    expect(supportsProtectedValue(evidence, name)).toBe(true);
    expect(supportsProtectedValueInChunks([evidence], name)).toBe(true);
  });

  it.each([
    ["NorthYarrowline", "Yarrowline's"],
    ["YarrowlineX", "Yarrowline's"],
    ["Yarrowlune", "Yarrowline's"],
    ["Yarrowlines", "Yarrowline's"],
    ["Tidemark", "Yarrowline's"],
    ["Yarrowline", "Yarrowlines'"],
    ["Yarrowline", "Yarrowline's Company"],
  ])(
    "rejects changed, partial, plural, or unrelated possessive names: %s / %s",
    (evidence, name) => {
      expect(supportsProtectedValue(evidence, name)).toBe(false);
      expect(supportsProtectedValueInChunks([evidence], name)).toBe(false);
    },
  );

  it("grounds the full fictional client-attribution claim against cited evidence", () => {
    const claim = "Worked on an integration for Yarrowline's client, the Tidemark Land Office.";
    const evidence = chunk(
      "client-source",
      "Yarrowline employed Meral on an integration for its client, the Tidemark Land Office.",
    );
    const protectedValues = extractProtectedValues(claim);

    expect(protectedValues).toContain("Yarrowline's");
    expect(protectedValues).toContain("Tidemark Land Office");
    for (const value of protectedValues) {
      expect(supportsProtectedValueInChunks([evidence.text], value), value).toBe(true);
    }
    expect(completeCvProposalIssues(proposal(claim, evidence.id), [evidence])).toEqual([]);
  });
});
