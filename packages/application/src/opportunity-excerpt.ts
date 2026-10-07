import { opportunityBriefMaximumExcerptLength } from "@draft-loop/schemas";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Return a provider-proposed quotation only when it is a verbatim excerpt of a cited source.
 *
 * Whitespace runs are collapsed and trimmed on both sides before a case-sensitive substring
 * comparison. The normalized quotation is returned; anything unverifiable, empty, over-long, or
 * found only in an uncited source yields `undefined`. Excerpts are never truncated or repaired.
 */
export function verifiedOpportunityExcerpt(
  proposed: string | null | undefined,
  citedSourceIds: readonly string[],
  sourceTextById: ReadonlyMap<string, string>,
): string | undefined {
  if (typeof proposed !== "string") return undefined;
  const excerpt = collapseWhitespace(proposed);
  if (excerpt.length === 0 || excerpt.length > opportunityBriefMaximumExcerptLength) {
    return undefined;
  }
  for (const sourceId of citedSourceIds) {
    const text = sourceTextById.get(sourceId);
    if (text !== undefined && collapseWhitespace(text).includes(excerpt)) return excerpt;
  }
  return undefined;
}

/** Index source text by source id for excerpt verification. */
export function sourceTextIndex(
  sources: readonly { readonly id: string; readonly text: string }[],
): ReadonlyMap<string, string> {
  return new Map(sources.map((source) => [source.id, source.text]));
}
