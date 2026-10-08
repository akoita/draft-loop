import type { CanonicalProfileExtractionTextWindow } from "./canonical-profile-extraction-sections.js";
import { findMarkdownHeadings } from "./canonical-profile-extraction-structure.js";

/** How many times one planned window may be halved after output-limit failures. */
export const maximumCanonicalProfileExtractionSplitDepth = 3;
/** No half is ever shorter than this many UTF-16 units. */
export const minimumCanonicalProfileExtractionSplitCharacters = 1_000;

function isSurrogatePairBoundary(text: string, offset: number): boolean {
  return (
    offset > 0 &&
    offset < text.length &&
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
}

/** The candidate offset nearest the middle; the lower one wins a tie so the result is stable. */
function nearest(candidates: readonly number[], middle: number): number | undefined {
  let best: number | undefined;
  for (const candidate of candidates) {
    if (
      best === undefined ||
      Math.abs(candidate - middle) < Math.abs(best - middle) ||
      (Math.abs(candidate - middle) === Math.abs(best - middle) && candidate < best)
    ) {
      best = candidate;
    }
  }
  return best;
}

function chooseSplitOffset(text: string): number | undefined {
  const minimum = minimumCanonicalProfileExtractionSplitCharacters;
  const maximum = text.length - minimum;
  if (maximum < minimum) return undefined;
  const middle = Math.floor(text.length / 2);
  const allowed = (offset: number): boolean => offset >= minimum && offset <= maximum;

  const heading = nearest(
    findMarkdownHeadings(text)
      .map((candidate) => candidate.offset)
      .filter(allowed),
    middle,
  );
  if (heading !== undefined) return heading;

  const newlines: number[] = [];
  const before = text.lastIndexOf("\n", middle - 1);
  if (before !== -1) newlines.push(before + 1);
  const after = text.indexOf("\n", middle);
  if (after !== -1) newlines.push(after + 1);
  const newline = nearest(newlines.filter(allowed), middle);
  if (newline !== undefined) return newline;

  // Exact middle, moved by one unit when it would cut a surrogate pair.
  return [middle, middle - 1, middle + 1].find(
    (offset) => allowed(offset) && !isSurrogatePairBoundary(text, offset),
  );
}

/**
 * Split one window into two contiguous halves with exact offsets into the original source. The cut
 * prefers the Markdown heading nearest the middle, then the newline nearest the middle, then the
 * exact middle, and never leaves a half under the minimum size or cuts a surrogate pair. Each half
 * carries the parent's heading path, plus its own heading when it starts at one. Returns null when
 * the window is too small to halve.
 */
export function splitCanonicalProfileExtractionWindow(
  window: CanonicalProfileExtractionTextWindow,
): readonly [CanonicalProfileExtractionTextWindow, CanonicalProfileExtractionTextWindow] | null {
  const offset = chooseSplitOffset(window.text);
  if (offset === undefined) return null;
  const headings = findMarkdownHeadings(window.text);
  const half = (from: number, to: number): CanonicalProfileExtractionTextWindow => {
    const title = headings.find((heading) => heading.offset === from)?.title ?? "";
    const parentPath = window.headingPath ?? [];
    const path =
      title.length === 0 || parentPath.at(-1) === title ? parentPath : [...parentPath, title];
    return {
      start: window.start + from,
      end: window.start + to,
      text: window.text.slice(from, to),
      ...(path.length === 0 ? {} : { headingPath: path }),
    };
  };
  return [half(0, offset), half(offset, window.text.length)];
}
