import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AgentExecution, AppliedRevisionEdit } from "@draft-loop/orchestrator";
import { addBilledUsage, type JsonObject, type ModelResponse } from "@draft-loop/providers";
import {
  type AuthorRevisionEdit,
  authorRevisionPatchSchema,
  type DraftArtifact,
} from "@draft-loop/schemas";

import { buildGroundedAuthorArtifact } from "./author-output.js";
import { applyAuthorRevisionPatch } from "./author-revision-patch.js";

/** A patched revision that applied and passed the full grounding and validation. */
export interface PatchedRevision {
  readonly artifact: DraftArtifact;
  readonly edits: readonly AppliedRevisionEdit[];
  /** Edits of the patch left out because they could not be applied or grounded on their own. */
  readonly droppedEdits: number;
}

export interface PatchedRevisionInputs {
  readonly executionId: string;
  readonly context: ContextSnapshot;
  readonly currentArtifact: DraftArtifact;
  readonly retrievedEvidence: readonly ScoredEvidenceChunk[];
  readonly acceptedFindingIds: readonly string[];
}

/**
 * Apply these edits and build the patched artifact with the same grounding, citation and coverage
 * validation as a full proposal. Undefined when the edits cannot be applied or the result fails
 * validation. A patched draft keeps every block the patch does not name, so a block that grounding
 * would leave out or shorten is not accepted here: that would silently lose a line nobody flagged.
 */
function patchWith(
  edits: readonly AuthorRevisionEdit[],
  inputs: PatchedRevisionInputs,
): Omit<PatchedRevision, "droppedEdits"> | undefined {
  const { context } = inputs;
  const applied = applyAuthorRevisionPatch({
    output: { edits },
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

/**
 * Apply a targeted revision patch. Returns undefined when the patch cannot be used and the caller
 * should request the full-proposal revision instead: a malformed patch, or no edit that applies and
 * passes validation.
 *
 * One bad edit no longer discards the others (#2846). On the 2026-11-16 run of private reference G
 * one failing edit sent a twelve-omission revision to a full rewrite, which changed 25 of 65 blocks
 * and carried few of the omissions. When the whole patch fails, each edit is tried on its own; the
 * edits that apply and ground alone are applied together, and the rest are dropped and counted.
 */
export function buildPatchedRevision(
  response: ModelResponse<JsonObject>,
  inputs: PatchedRevisionInputs,
): PatchedRevision | undefined {
  const parsed = authorRevisionPatchSchema.safeParse(response.output);
  if (!parsed.success) return undefined;
  const edits = parsed.data.edits;
  const whole = patchWith(edits, inputs);
  if (whole !== undefined) return { ...whole, droppedEdits: 0 };
  const kept = edits.filter((edit) => patchWith([edit], inputs) !== undefined);
  if (kept.length === 0 || kept.length === edits.length) return undefined;
  const salvaged = patchWith(kept, inputs);
  return salvaged === undefined
    ? undefined
    : { ...salvaged, droppedEdits: edits.length - kept.length };
}

type OutputFinding = NonNullable<AgentExecution<unknown>["outputFindings"]>[number];

/** The content-free warning shown when a patched revision left out some of its edits. */
export function droppedRevisionEditFindings(droppedEdits: number): readonly OutputFinding[] {
  if (droppedEdits === 0) return [];
  const [edits, pronoun] =
    droppedEdits === 1
      ? ["1 revision edit was", "it"]
      : [`${droppedEdits} revision edits were`, "they"];
  return [
    {
      code: "revision-edits-dropped",
      category: "evidence",
      severity: "warning",
      message: `${edits} left out because ${pronoun} could not be applied or matched to the cited evidence; the other edits were kept. Check whether the findings they addressed are still open.`,
    },
  ];
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
