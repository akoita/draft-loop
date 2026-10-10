import { maximumCanonicalCandidateProfileProvenanceQuoteLength } from "@draft-loop/domain";
import type { CanonicalCandidateProfileProvenanceReference } from "@draft-loop/schemas";

import { referenceKey } from "./canonical-profile-fact-keys.js";
import {
  type CanonicalProfileSourceSensitivityGuard,
  createCanonicalProfileQuoteSpanLocator,
} from "./canonical-profile-sensitivity-filter.js";
import { createEvidenceSourceIndex } from "./evidence-text-normalization.js";

interface QuotedMaterial {
  readonly reference: CanonicalCandidateProfileProvenanceReference;
  readonly sensitivity?: CanonicalProfileSourceSensitivityGuard;
}

/**
 * Resolves a grounded evidence quote to the exact contiguous span of the cited source version's
 * normalized text, or undefined when no such span exists.
 */
export type CanonicalProfileFactQuoteResolver = (
  representativeId: string,
  reference: CanonicalCandidateProfileProvenanceReference,
  quote: string,
) => string | undefined;

/**
 * Grounding compares quotes case-insensitively with collapsed whitespace and tolerates Markdown
 * formatting, so a grounded quote is not always a substring. The resolver follows the same rules and
 * returns the verbatim source text the quote matched. A sensitivity-filtered source is resolved in
 * its original text outside the excluded ranges, because the provider only saw the filtered text.
 */
export function createCanonicalProfileFactQuoteResolver(
  materials: readonly QuotedMaterial[],
  sourceTextsByRepresentativeId: ReadonlyMap<string, string>,
): CanonicalProfileFactQuoteResolver {
  const guardsByReference = new Map<string, CanonicalProfileSourceSensitivityGuard>();
  for (const material of materials) {
    if (material.sensitivity !== undefined) {
      guardsByReference.set(referenceKey(material.reference), material.sensitivity);
    }
  }
  const resolvers = new Map<string, (quote: string) => string | undefined>();

  const resolverFor = (
    representativeId: string,
    reference: CanonicalCandidateProfileProvenanceReference,
  ): ((quote: string) => string | undefined) => {
    const guard = guardsByReference.get(referenceKey(reference));
    const cacheKey =
      guard === undefined ? `text:${representativeId}` : `guard:${referenceKey(reference)}`;
    let resolver = resolvers.get(cacheKey);
    if (resolver !== undefined) return resolver;
    if (guard !== undefined) {
      resolver = createCanonicalProfileQuoteSpanLocator(guard);
    } else {
      const text = sourceTextsByRepresentativeId.get(representativeId);
      if (text === undefined) {
        resolver = () => undefined;
      } else {
        const locate = createCanonicalProfileQuoteSpanLocator({
          originalText: text,
          excludedRanges: [],
        });
        const index = createEvidenceSourceIndex(new Map([[representativeId, text]]));
        resolver = (quote) => locate(quote) ?? index.locateExactQuote(representativeId, quote);
      }
    }
    resolvers.set(cacheKey, resolver);
    return resolver;
  };

  return (representativeId, reference, quote) => {
    const span = resolverFor(representativeId, reference)(quote)?.trim();
    return span === undefined ||
      span.length === 0 ||
      span.length > maximumCanonicalCandidateProfileProvenanceQuoteLength
      ? undefined
      : span;
  };
}
