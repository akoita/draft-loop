import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { completeAuthorClaimCoverage } from "./author-claim-coverage-completion.js";
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

function proposal(blockText: string, claimText: string): AuthorArtifactProposal {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text: blockText,
            claims: [
              {
                text: claimText,
                substantive: true,
                evidenceChunkIds: ["cited"],
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("author claim coverage completion", () => {
  it("adds an exact evidence-backed full-span claim without changing block prose", () => {
    const input = proposal(
      "Built reliable TypeScript tools across regulated industries.",
      "Built reliable TypeScript tools.",
    );
    const before = structuredClone(input);
    const evidence = [
      chunk("cited", "Experience: Built reliable TypeScript tools across regulated industries."),
    ];

    const completed = completeAuthorClaimCoverage(input, evidence);

    expect(completed.sections[0]?.blocks[0]).toMatchObject({
      text: input.sections[0]?.blocks[0]?.text,
      claims: [
        input.sections[0]?.blocks[0]?.claims[0],
        {
          text: "Built reliable TypeScript tools across regulated industries.",
          substantive: true,
          evidenceChunkIds: ["cited"],
        },
      ],
    });
    expect(completeCvProposalIssues(completed, evidence)).toEqual([]);
    expect(input).toEqual(before);
  });

  it.each([
    ["partial evidence", [chunk("cited", "Built reliable TypeScript tools.")]],
    [
      "uncited exact evidence",
      [
        chunk("cited", "Built reliable TypeScript tools."),
        chunk("uncited", "Built reliable TypeScript tools across regulated industries."),
      ],
    ],
  ])("leaves coverage rejected for %s", (_case, evidence) => {
    const input = proposal(
      "Built reliable TypeScript tools across regulated industries.",
      "Built reliable TypeScript tools.",
    );

    expect(completeAuthorClaimCoverage(input, evidence)).toBe(input);
    expect(completeCvProposalIssues(input, evidence)).toContainEqual(
      expect.objectContaining({ code: "substantive_text_uncovered" }),
    );
  });

  it("leaves already covered blocks unchanged without duplicating claims", () => {
    const input = proposal("Built reliable TypeScript tools.", "Built reliable TypeScript tools.");
    expect(
      completeAuthorClaimCoverage(input, [chunk("cited", "Built reliable TypeScript tools.")]),
    ).toBe(input);
  });

  it("does not repair an unsupported factual value", () => {
    const input = proposal(
      "Built 999 reliable TypeScript tools.",
      "Built 999 reliable TypeScript tools.",
    );
    const evidence = [chunk("cited", "Built reliable TypeScript tools.")];
    const completed = completeAuthorClaimCoverage(input, evidence);

    expect(completed).toBe(input);
    expect(completeCvProposalIssues(completed, evidence)).toContainEqual(
      expect.objectContaining({ code: "factual_invariant_violation" }),
    );
  });
});
