import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AppliedRevisionEdit } from "@draft-loop/orchestrator";
import { addBilledUsage, type JsonObject, type ModelResponse } from "@draft-loop/providers";
import type { DraftArtifact } from "@draft-loop/schemas";

import { buildGroundedAuthorArtifact } from "./author-output.js";
import { applyAuthorRevisionPatch } from "./author-revision-patch.js";

/** A patched revision that applied and passed the full grounding and validation. */
export interface PatchedRevision {
  readonly artifact: DraftArtifact;
  readonly edits: readonly AppliedRevisionEdit[];
}

export interface PatchedRevisionInputs {
  readonly executionId: string;
  readonly context: ContextSnapshot;
  readonly currentArtifact: DraftArtifact;
  readonly retrievedEvidence: readonly ScoredEvidenceChunk[];
  readonly acceptedFindingIds: readonly string[];
}

/**
 * Apply a targeted revision patch and build the patched artifact with the same grounding,
 * citation and coverage validation as a full proposal. Returns undefined when the patch cannot be
 * used and the caller should request the full-proposal revision instead: a malformed patch, an
 * unknown block, section or finding id, or a result that fails validation.
 *
 * A patched draft keeps every block the patch does not name, so a block that grounding would leave
 * out or shorten is not accepted here: that would silently lose a line nobody flagged.
 */
export function buildPatchedRevision(
  response: ModelResponse<JsonObject>,
  inputs: PatchedRevisionInputs,
): PatchedRevision | undefined {
  const { context } = inputs;
  const applied = applyAuthorRevisionPatch({
    output: response.output,
    currentArtifact: inputs.currentArtifact,
    retrievedEvidence: inputs.retrievedEvidence,
    evidenceManifest: context.evidenceManifest,
    acceptedFindingIds: inputs.acceptedFindingIds,
  });
  if (!applied.ok) return undefined;
  try {
    const grounded = buildGroundedAuthorArtifact({
      proposal: applied.proposal,
      executionId: inputs.executionId,
      context,
      currentArtifact: inputs.currentArtifact,
      retrievedEvidence: inputs.retrievedEvidence,
      requiredSections: context.outputConstraints.requiredSections,
    });
    if (grounded.removedBlocks > 0 || grounded.shortenedBlocks > 0) return undefined;
    return { artifact: grounded.artifact, edits: applied.edits };
  } catch {
    return undefined;
  }
}

/** The response with the tokens and cost of an earlier call of the same attempt added. */
export function withAddedUsage(
  response: ModelResponse<JsonObject>,
  earlier: ModelResponse<JsonObject> | undefined,
): ModelResponse<JsonObject> {
  if (earlier === undefined) return response;
  const { usage } = addBilledUsage(
    { usage: earlier.usage, cost: earlier.cost },
    { usage: response.usage, cost: response.cost },
  );
  return {
    ...response,
    usage,
    cost: {
      estimatedUsd:
        response.cost.estimatedUsd === null || earlier.cost.estimatedUsd === null
          ? (response.cost.estimatedUsd ?? earlier.cost.estimatedUsd)
          : response.cost.estimatedUsd + earlier.cost.estimatedUsd,
    },
  };
}
