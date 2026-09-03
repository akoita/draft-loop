import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { completeAuthorEvidenceCitations } from "./author-evidence-completion.js";
import { completeCvProposalIssues } from "./complete-cv.js";

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

function singleClaimProposal(
  text: string,
  substantive = true,
  evidenceChunkIds: readonly string[] = [],
): AuthorArtifactProposal {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [{ text, substantive, evidenceChunkIds: [...evidenceChunkIds] }],
          },
        ],
      },
    ],
  });
}

describe("author evidence citation completion", () => {
  it("matches protected values with exact NFKC and en-US lowercase comparison", () => {
    const text = "Staff Engineer";
    const proposal = singleClaimProposal(text);
    const completed = completeAuthorEvidenceCitations(proposal, [
      chunk("chunk-normalized", "Ｓtaff Engineer"),
    ]);

    expect(completed.sections[0]?.blocks[0]?.claims[0]).toMatchObject({
      text,
      substantive: true,
      evidenceChunkIds: ["chunk-normalized"],
    });
    expect(proposal.sections[0]?.blocks[0]?.claims[0]?.evidenceChunkIds).toEqual([]);
  });

  it("preserves existing citation order and appends matching retrieval order without duplicates", () => {
    const proposal = singleClaimProposal("Staff Engineer at Example Systems, 2024.", true, [
      "chunk-existing",
    ]);
    const completed = completeAuthorEvidenceCitations(proposal, [
      chunk("chunk-first", "Example Systems delivered dependable systems.", 0),
      chunk("chunk-existing", "Staff Engineer at Example Systems.", 1),
      chunk("chunk-second", "Improved reliability in 2024.", 2),
      chunk("chunk-unrelated", "plain evidence with no protected value", 3),
    ]);

    expect(completed.sections[0]?.blocks[0]?.claims[0]?.evidenceChunkIds).toEqual([
      "chunk-existing",
      "chunk-first",
      "chunk-second",
    ]);
  });

  it("leaves non-substantive and protected-value-free claims unchanged", () => {
    const proposal = authorArtifactProposalSchema.parse({
      sections: [
        {
          title: "Summary",
          kind: "summary",
          blocks: [
            {
              type: "paragraph",
              text: "Summary",
              claims: [
                {
                  text: "Staff Engineer at Example Systems, 2024.",
                  substantive: false,
                  evidenceChunkIds: [],
                },
                {
                  text: "reliable systems",
                  substantive: true,
                  evidenceChunkIds: [],
                },
              ],
            },
          ],
        },
      ],
    });

    const completed = completeAuthorEvidenceCitations(proposal, [
      chunk("chunk-support", "Staff Engineer at Example Systems, 2024."),
    ]);

    expect(completed).toBe(proposal);
  });

  it("does not mutate the parsed proposal", () => {
    const proposal = singleClaimProposal("Staff Engineer at Example Systems, 2024.");
    const before = structuredClone(proposal);

    completeAuthorEvidenceCitations(proposal, [
      chunk("chunk-support", "Staff Engineer at Example Systems, 2024."),
    ]);

    expect(proposal).toEqual(before);
  });

  it("leaves unsupported protected values for the unchanged validator to reject", () => {
    const proposal = singleClaimProposal("Staff Engineer at Example Systems, 2025.");
    const evidence = [chunk("chunk-2024", "Staff Engineer at Example Systems, 2024.")];
    const completed = completeAuthorEvidenceCitations(proposal, evidence);

    expect(completed.sections[0]?.blocks[0]?.claims[0]?.evidenceChunkIds).toEqual(["chunk-2024"]);
    expect(completeCvProposalIssues(completed, evidence)).toEqual([
      {
        code: "factual_invariant_violation",
        path: ["sections", 0, "blocks", 0, "claims", 0, "text"],
        message: "CV claim changes a factual invariant absent from cited evidence",
      },
    ]);
  });
});
