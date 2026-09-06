import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { extractProtectedValues, supportsProtectedValue } from "./author-grounding.js";

function completedEvidenceChunkIds(
  claim: AuthorArtifactProposal["sections"][number]["blocks"][number]["claims"][number],
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): string[] | null {
  if (!claim.substantive) return null;

  const protectedValues = extractProtectedValues(claim.text);
  if (protectedValues.length === 0) return null;

  const completedIds: string[] = [];
  const seen = new Set<string>();
  for (const chunkId of claim.evidenceChunkIds) {
    if (seen.has(chunkId)) continue;
    seen.add(chunkId);
    completedIds.push(chunkId);
  }

  for (const chunk of retrievedEvidence) {
    const supportsAnyValue = protectedValues.some((value) =>
      supportsProtectedValue(chunk.text, value),
    );
    if (!supportsAnyValue || seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    completedIds.push(chunk.id);
  }

  if (
    completedIds.length === claim.evidenceChunkIds.length &&
    completedIds.every((chunkId, index) => chunkId === claim.evidenceChunkIds[index])
  ) {
    return null;
  }
  return completedIds;
}

/**
 * Complete omitted exact-value citations using only the retrieved evidence.
 * Claim and surrounding proposal content remain provider-owned and unchanged.
 */
export function completeAuthorEvidenceCitations(
  proposal: AuthorArtifactProposal,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): AuthorArtifactProposal {
  let proposalChanged = false;
  const sections = proposal.sections.map((section) => {
    let sectionChanged = false;
    const blocks = section.blocks.map((block) => {
      let blockChanged = false;
      const claims = block.claims.map((claim) => {
        const evidenceChunkIds = completedEvidenceChunkIds(claim, retrievedEvidence);
        if (evidenceChunkIds === null) return claim;
        blockChanged = true;
        return { ...claim, evidenceChunkIds };
      });
      if (!blockChanged) return block;
      sectionChanged = true;
      return { ...block, claims };
    });
    if (!sectionChanged) return section;
    proposalChanged = true;
    return { ...section, blocks };
  });

  return proposalChanged ? { ...proposal, sections } : proposal;
}
