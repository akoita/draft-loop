import {
  applySemanticRelevanceFloor,
  cosineSimilarity,
  type SemanticRelevanceFloor,
  semanticRelevanceFloorForIdentity,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import type { DraftArtifact, JobRequirement } from "@draft-loop/schemas";
import type {
  RequirementCoverageAssessment,
  RequirementCoverageEvidence,
} from "@draft-loop/validation";

/*
 * Semantic candidate evidence for lexically uncovered requirements (#952).
 *
 * An embedding score only proposes evidence; it never decides coverage (see
 * `docs/evaluation/semantic-requirement-coverage.md`). A candidate therefore becomes
 * `needs-judgement`, never `covered`, and protected-rule, covered, and explicit-gap assessments are
 * never touched. Open the local model with `openLocalTextEmbedder` and pass the embedder in.
 */

/**
 * Fixed user-visible sentence for a candidate; it never quotes requirement or block text. It is
 * defined here rather than in the validation rationale map because that map holds only sentences
 * the deterministic rule can produce, and the judgement step (#953) replaces this one.
 */
export const semanticCandidateRationale =
  "Possibly covered with different wording; needs judgement against the cited blocks.";

export const defaultMaxSemanticCandidates = 3;

const embeddingBatchSize = 32;

export interface AttachSemanticCoverageCandidatesRequest {
  readonly assessments: readonly RequirementCoverageAssessment[];
  readonly requirements: readonly Pick<JobRequirement, "id" | "text">[];
  readonly artifact: Pick<DraftArtifact, "sections">;
  readonly embedder: TextEmbedder;
  /** Overrides the floor calibrated for the embedder's identity. */
  readonly floor?: SemanticRelevanceFloor;
  readonly maxCandidates?: number;
  readonly signal?: AbortSignal;
}

export interface AttachSemanticCoverageCandidatesResult {
  readonly assessments: readonly RequirementCoverageAssessment[];
  /**
   * False when candidates could not be produced (uncalibrated model without an explicit floor, or
   * an embedder failure), so callers can tell the user that semantic candidates were unavailable.
   */
  readonly candidatesAvailable: boolean;
  /** The floor that was applied, or null when none could be. */
  readonly floor: SemanticRelevanceFloor | null;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function isEligible(assessment: RequirementCoverageAssessment): boolean {
  return assessment.status === "uncovered" && assessment.basis === "lexical";
}

function round3(value: number): number {
  return Math.round(Math.min(1, Math.max(-1, value)) * 1000) / 1000;
}

async function embedAll(
  embedder: TextEmbedder,
  texts: readonly string[],
  role: "document" | "query",
  signal: AbortSignal | undefined,
): Promise<readonly Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += embeddingBatchSize) {
    signal?.throwIfAborted();
    const batch = texts.slice(start, start + embeddingBatchSize);
    const embedded = await embedder.embed(
      batch,
      role,
      signal === undefined ? undefined : { signal },
    );
    if (embedded.length !== batch.length) {
      throw new Error("The embedder returned an unexpected number of vectors.");
    }
    vectors.push(...embedded);
  }
  return vectors;
}

/**
 * Turns lexically uncovered, non-protected assessments into `needs-judgement` assessments carrying
 * up to `maxCandidates` blocks that pass the relevance floor. Everything else is returned as the
 * identical object. Never throws except to rethrow an abort.
 */
export async function attachSemanticCoverageCandidates(
  request: AttachSemanticCoverageCandidatesRequest,
): Promise<AttachSemanticCoverageCandidatesResult> {
  const { assessments, embedder, signal } = request;
  const floor = request.floor ?? semanticRelevanceFloorForIdentity(embedder.identity) ?? null;
  // An uncalibrated model must not create candidates: its scores have no meaningful threshold.
  if (floor === null) return { assessments, candidatesAvailable: false, floor: null };

  const maxCandidates = Math.max(
    0,
    Math.floor(request.maxCandidates ?? defaultMaxSemanticCandidates),
  );
  const requirementTexts = new Map(request.requirements.map((item) => [item.id, item.text]));
  const eligible = assessments.filter(
    (assessment) => isEligible(assessment) && requirementTexts.has(assessment.requirementId),
  );
  const blocks = request.artifact.sections.flatMap((section) => section.blocks);
  if (eligible.length === 0 || blocks.length === 0 || maxCandidates === 0) {
    return { assessments, candidatesAvailable: true, floor };
  }

  signal?.throwIfAborted();
  let blockVectors: readonly Float32Array[];
  let queryVectors: readonly Float32Array[];
  try {
    blockVectors = await embedAll(
      embedder,
      blocks.map((block) => block.text),
      "document",
      signal,
    );
    queryVectors = await embedAll(
      embedder,
      eligible.map((assessment) => requirementTexts.get(assessment.requirementId) as string),
      "query",
      signal,
    );
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    return { assessments, candidatesAvailable: false, floor };
  }

  const replacements = new Map<string, RequirementCoverageAssessment>();
  for (const [index, assessment] of eligible.entries()) {
    const query = queryVectors[index] as Float32Array;
    const scored = blocks
      .map((block, blockIndex) => ({
        blockId: block.id,
        score: cosineSimilarity(query, blockVectors[blockIndex] as Float32Array),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          (left.blockId < right.blockId ? -1 : left.blockId > right.blockId ? 1 : 0),
      );
    const candidates = applySemanticRelevanceFloor(scored, floor).slice(0, maxCandidates);
    if (candidates.length === 0) continue;
    replacements.set(
      assessment.requirementId,
      Object.freeze({
        requirementId: assessment.requirementId,
        status: "needs-judgement",
        basis: "semantic-candidate",
        evidence: Object.freeze(
          candidates.map(
            (candidate): RequirementCoverageEvidence =>
              Object.freeze({ blockId: candidate.blockId, score: round3(candidate.score) }),
          ),
        ),
        rationale: semanticCandidateRationale,
      }),
    );
  }

  return {
    assessments: Object.freeze(
      assessments.map((assessment) => replacements.get(assessment.requirementId) ?? assessment),
    ),
    candidatesAvailable: true,
    floor,
  };
}
