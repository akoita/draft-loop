import type { DraftArtifact } from "@draft-loop/schemas";
import { RunTransitionError } from "./run-transition-error.js";

/** The candidate's replacement text for one block of the reviewed draft. */
export interface CandidateBlockEdit {
  readonly blockId: string;
  readonly text: string;
}

/** The suffix of the version the candidate's review edits produce from the reviewed one. */
export const CANDIDATE_EDIT_VERSION_SUFFIX = "-candidate-edits";

export const CANDIDATE_EDIT_RATIONALE = "The candidate edited this block in the review.";

const CANDIDATE_EDIT_DECISION_PREFIX = "decision-candidate-edit-";

/** The blocks whose text the candidate's review edits set in this version (#1901). */
export function candidateEditedBlockIds(artifact: DraftArtifact): ReadonlySet<string> {
  return new Set(
    artifact.decisions
      .filter(
        (decision) =>
          decision.type === "edit" && decision.id.startsWith(CANDIDATE_EDIT_DECISION_PREFIX),
      )
      .map((decision) => decision.id.slice(CANDIDATE_EDIT_DECISION_PREFIX.length)),
  );
}

/**
 * The version the candidate approves when they edited blocks in the review (#1899): the reviewed
 * artifact with each edited block's text replaced and one `edit` decision per block. The critic
 * never saw the new wording, so every claim in an edited block drops to `unverified`; it keeps its
 * evidence links, and a block's only claim takes the new text so final checks judge what is
 * actually exported. Null when no edit changes any text, so approval binds the reviewed version.
 */
export function applyCandidateEdits(
  artifact: DraftArtifact,
  edits: readonly CandidateBlockEdit[],
  createdAt: string,
): DraftArtifact | null {
  const blocks = new Map(
    artifact.sections.flatMap((section) => section.blocks.map((block) => [block.id, block])),
  );
  const replacements = new Map<string, string>();
  for (const edit of edits) {
    const block = blocks.get(edit.blockId);
    if (block === undefined)
      throw new RunTransitionError(`The edited block ${edit.blockId} is not in the draft.`);
    const text = edit.text.trim();
    if (text === "")
      throw new RunTransitionError(`The edit to block ${edit.blockId} leaves it empty.`);
    if (text === block.text) replacements.delete(edit.blockId);
    else replacements.set(edit.blockId, text);
  }
  if (replacements.size === 0) return null;

  const editedClaimIds = new Set(
    [...replacements.keys()].flatMap((blockId) => blocks.get(blockId)?.claimIds ?? []),
  );
  return {
    ...artifact,
    id: `${artifact.id}${CANDIDATE_EDIT_VERSION_SUFFIX}`,
    version: artifact.version + 1,
    parentVersionId: artifact.id,
    createdAt,
    sections: artifact.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        const text = replacements.get(block.id);
        return text === undefined ? block : { ...block, text };
      }),
    })),
    claims: artifact.claims.map((claim) => {
      if (!editedClaimIds.has(claim.id)) return claim;
      const text = replacements.get(claim.blockId);
      const onlyClaim = blocks.get(claim.blockId)?.claimIds.length === 1;
      return {
        ...claim,
        status: "unverified" as const,
        ...(onlyClaim && text !== undefined ? { text } : {}),
      };
    }),
    decisions: [
      ...artifact.decisions,
      ...[...replacements.keys()].map((blockId) => ({
        id: `${CANDIDATE_EDIT_DECISION_PREFIX}${blockId}`,
        type: "edit" as const,
        rationale: CANDIDATE_EDIT_RATIONALE,
        createdAt,
      })),
    ],
  };
}
