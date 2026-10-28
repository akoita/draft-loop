/**
 * The visible placeholders an author writes in a CV header when the evidence states no name or
 * contact details (#1875), so the person sees where to add them instead of a CV with no header.
 * They are never career facts: export refuses a draft that still holds one (#1878).
 */
export const CV_HEADER_PLACEHOLDERS = ["[Your name]", "[Email]", "[Phone]", "[City]"] as const;

/** Each placeholder occurrence in `text`, as start and end offsets, in reading order. */
export function cvHeaderPlaceholderSpans(
  text: string,
): readonly { readonly start: number; readonly end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const placeholder of CV_HEADER_PLACEHOLDERS) {
    let start = text.indexOf(placeholder);
    while (start !== -1) {
      spans.push({ start, end: start + placeholder.length });
      start = text.indexOf(placeholder, start + placeholder.length);
    }
  }
  return spans.sort((left, right) => left.start - right.start);
}
