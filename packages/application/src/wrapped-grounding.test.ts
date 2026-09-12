import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { completeAuthorEvidenceCitations } from "./author-evidence-completion.js";
import { supportsProtectedValue, supportsProtectedValueInChunks } from "./author-grounding.js";
import { buildAuthorArtifact } from "./author-output.js";
import { completeCvProposalIssues } from "./complete-cv.js";

function chunk(text: string, index = 0): ScoredEvidenceChunk {
  return {
    id: `chunk-${index}`,
    sourceId: "source",
    workspaceId: "workspace",
    ordinal: index,
    lineStart: 1,
    lineEnd: 3,
    checksum: "a".repeat(64),
    text,
    rank: index,
  };
}
function proposal(text: string, ids: string[]) {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          { type: "paragraph", text, claims: [{ text, substantive: true, evidenceChunkIds: ids }] },
        ],
      },
    ],
  });
}

describe("wrapped protected values", () => {
  it.each([" ", "\n    ", "\r\n  ", "\t", "\u00a0"])(
    "accepts whitespace wrapping %j within one chunk",
    (separator) => {
      const evidence = [chunk(`AWS Certified${separator}Developer.`)];
      const completed = completeAuthorEvidenceCitations(
        proposal("AWS Certified Developer.", []),
        evidence,
      );
      expect(completed.sections[0]?.blocks[0]?.claims[0]?.evidenceChunkIds).toEqual(["chunk-0"]);
      expect(completeCvProposalIssues(completed, evidence)).toEqual([]);
      expect(() =>
        buildAuthorArtifact({
          proposal: completed,
          executionId: "wrapped",
          retrievedEvidence: evidence,
          context: {
            language: "en",
            evidenceManifest: [
              { id: "source", path: "/synthetic/source.md", checksum: "a".repeat(64) },
            ],
          },
        }),
      ).not.toThrow();
    },
  );

  it("does not assemble a name from separate chunks", () => {
    const evidence = [chunk("AWS Certified"), chunk("Developer", 1)];
    expect(
      supportsProtectedValueInChunks(
        evidence.map((chunk) => chunk.text),
        "AWS Certified Developer",
      ),
    ).toBe(false);
    expect(
      completeCvProposalIssues(
        proposal("AWS Certified Developer.", ["chunk-0", "chunk-1"]),
        evidence,
      ),
    ).toContainEqual(expect.objectContaining({ code: "factual_invariant_violation" }));
  });

  it.each([
    ["AWS Certified-Developer", "AWS Certified Developer"],
    ["AWS Certified Developer", "AWS Certified Architect"],
    ["85%", "85"],
    ["2020\n2024", "2021"],
    ["GraphQL", "Graph QL"],
  ])("preserves non-whitespace differences: %s", (evidence, value) => {
    expect(supportsProtectedValue(evidence, value)).toBe(false);
  });

  it("preserves experience contradiction checks across chunks", () => {
    expect(
      supportsProtectedValueInChunks(
        ["No GraphQL experience.", "GraphQL experience."],
        "No GraphQL experience",
      ),
    ).toBe(false);
    expect(
      supportsProtectedValueInChunks(["No GraphQL experience."], "No GraphQL experience"),
    ).toBe(true);
  });
});
