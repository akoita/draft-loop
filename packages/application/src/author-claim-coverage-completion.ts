import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { claimCoverageIssues } from "./claim-coverage.js";

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

/**
 * Add full-span claim metadata only when an uncovered block is reproduced in
 * retrieved evidence already cited by a substantive claim in that block.
 */
export function completeAuthorClaimCoverage(
  proposal: AuthorArtifactProposal,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): AuthorArtifactProposal {
  const uncoveredBlocks = new Set(
    claimCoverageIssues(proposal).map(
      (issue) => `${String(issue.path[1])}:${String(issue.path[3])}`,
    ),
  );
  if (uncoveredBlocks.size === 0) return proposal;

  const evidenceById = new Map(retrievedEvidence.map((chunk) => [chunk.id, chunk] as const));
  let proposalChanged = false;
  const sections = proposal.sections.map((section, sectionIndex) => {
    let sectionChanged = false;
    const blocks = section.blocks.map((block, blockIndex) => {
      if (!uncoveredBlocks.has(`${sectionIndex}:${blockIndex}`)) return block;

      const blockText = normalized(block.text);
      if (blockText === "") return block;
      const citedIds = new Set(
        block.claims
          .filter((claim) => claim.substantive)
          .flatMap((claim) => claim.evidenceChunkIds),
      );
      const supportingChunkIds = retrievedEvidence
        .filter(
          (chunk) =>
            citedIds.has(chunk.id) &&
            normalized(evidenceById.get(chunk.id)?.text ?? "").includes(blockText),
        )
        .map((chunk) => chunk.id);
      if (supportingChunkIds.length === 0) return block;

      sectionChanged = true;
      return {
        ...block,
        claims: [
          ...block.claims,
          { text: block.text, substantive: true, evidenceChunkIds: supportingChunkIds },
        ],
      };
    });
    if (!sectionChanged) return section;
    proposalChanged = true;
    return { ...section, blocks };
  });

  return proposalChanged ? { ...proposal, sections } : proposal;
}
