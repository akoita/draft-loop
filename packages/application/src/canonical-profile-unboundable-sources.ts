import {
  type CanonicalCandidateProfileExtractionSource,
  maximumUnplannedCanonicalCandidateProfileExtractionSourceCharacters,
} from "./candidate-profile-extraction.js";
import { planCanonicalProfileExtractionCalls } from "./canonical-profile-extraction-plan.js";

export const canonicalProfileUnboundableSourceMessage = `A selected source is too large to extract in bounded windows alongside the other selected sources. Select fewer sources, or split it into smaller files, and derive again.`;

/** Whether any source is too large to be sent whole in one provider request. */
export function hasCanonicalProfileSourceAboveUnplannedBound(
  sources: readonly Pick<CanonicalCandidateProfileExtractionSource, "text">[],
): boolean {
  return sources.some(
    (source) =>
      source.text.length > maximumUnplannedCanonicalCandidateProfileExtractionSourceCharacters,
  );
}

/**
 * Separate sources that can only be sent whole above the per-request bound because no bounded
 * window plan exists for the set. Planning is attempted on the full set first.
 */
export function partitionCanonicalProfileUnboundableSources<
  Source extends Pick<CanonicalCandidateProfileExtractionSource, "id" | "text">,
>(
  sources: readonly Source[],
): { readonly boundable: readonly Source[]; readonly unboundable: readonly Source[] } {
  if (!hasCanonicalProfileSourceAboveUnplannedBound(sources)) {
    return { boundable: sources, unboundable: [] };
  }
  if (planCanonicalProfileExtractionCalls(sources) !== null) {
    return { boundable: sources, unboundable: [] };
  }
  const large = new Set(
    sources
      .filter((source) => hasCanonicalProfileSourceAboveUnplannedBound([source]))
      .map((source) => source.id),
  );
  return {
    boundable: sources.filter((source) => !large.has(source.id)),
    unboundable: sources.filter((source) => large.has(source.id)),
  };
}
