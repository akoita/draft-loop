import { type GraniteEmbeddingTier, graniteEmbeddingModels } from "./model-manifest.js";
import type { EmbeddingModelIdentity } from "./text-embedder.js";

/**
 * Deterministic relevance floor for semantic candidates.
 *
 * A semantic hit is kept only when its cosine similarity is within `maxMarginFromTop` of the best
 * hit AND at least `minimumScore`. The values are recorded wherever the floor is applied so a
 * retrieval run can be reproduced.
 */
export interface SemanticRelevanceFloor {
  readonly maxMarginFromTop: number;
  readonly minimumScore: number;
}

/**
 * Applies the floor to scored hits and returns the survivors in their input order. Callers pass
 * hits already ordered best first, so the survivors are a prefix of the input.
 */
export function applySemanticRelevanceFloor<Hit extends { readonly score: number }>(
  scored: readonly Hit[],
  floor: SemanticRelevanceFloor,
): readonly Hit[] {
  if (scored.length === 0) {
    return [];
  }
  let top = Number.NEGATIVE_INFINITY;
  for (const hit of scored) {
    if (hit.score > top) {
      top = hit.score;
    }
  }
  return scored.filter(
    (hit) => hit.score >= top - floor.maxMarginFromTop && hit.score >= floor.minimumScore,
  );
}

/**
 * Floors calibrated against the real local models at their native dimensions (see #926, #923, and
 * `docs/evaluation/semantic-retrieval-comparison.md`). The margin keeps the lexical-guard cases at
 * lexical precision; the minimum sits between the best off-topic score and the weakest relevant
 * top score observed for each tier.
 */
export const defaultSemanticRelevanceFloors: Readonly<
  Record<GraniteEmbeddingTier, SemanticRelevanceFloor>
> = Object.freeze({
  "311m": Object.freeze({ maxMarginFromTop: 0.05, minimumScore: 0.8 }),
  "97m": Object.freeze({ maxMarginFromTop: 0.05, minimumScore: 0.75 }),
  "eg2-text": Object.freeze({ maxMarginFromTop: 0.05, minimumScore: 0.68 }),
});

export function defaultSemanticRelevanceFloor(tier: GraniteEmbeddingTier): SemanticRelevanceFloor {
  return defaultSemanticRelevanceFloors[tier];
}

/**
 * The calibrated floor for an embedding identity, or `undefined` when the identity is not a pinned
 * local embedding model at its native dimensions (the calibration does not transfer to other models or to
 * Matryoshka-truncated vectors).
 */
export function semanticRelevanceFloorForIdentity(
  identity: Pick<EmbeddingModelIdentity, "modelId" | "dimensions">,
): SemanticRelevanceFloor | undefined {
  for (const model of Object.values(graniteEmbeddingModels)) {
    if (model.modelId === identity.modelId && model.nativeDimensions === identity.dimensions) {
      return defaultSemanticRelevanceFloor(model.tier);
    }
  }
  return undefined;
}
