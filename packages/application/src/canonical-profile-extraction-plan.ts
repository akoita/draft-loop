import type { CanonicalProfileExtractionTextWindow } from "./canonical-profile-extraction-sections.js";
import {
  canonicalProfileExtractionWindowCharacters,
  planCanonicalProfileExtractionSizeWindows,
} from "./canonical-profile-extraction-size-windows.js";
import { planCanonicalProfileExtractionStructureWindows } from "./canonical-profile-extraction-structure.js";

const proactivePlanMinimumSourceCount = 1;
const proactivePlanMaximumSourceCount = 4;
const proactivePlanTotalTextThreshold = 65_536;
// One 512 Ki source with newline-shortened windows (down to ~80% of the window size) needs up to
// about 80 calls.
// Adaptive splits after output-limit failures count against the same cap.
export const proactivePlanMaximumCallCount = 96;

export interface CanonicalProfileExtractionPlannedCall {
  readonly sourceId: string;
  readonly window?: CanonicalProfileExtractionTextWindow;
}

/**
 * Split text into contiguous, non-empty windows bounded by the window size. Text with Markdown
 * headings is cut at heading boundaries; other text is cut by size alone.
 */
export function planCanonicalProfileExtractionBoundedTextWindows(
  text: string,
  maxOutputTokens?: number,
): readonly CanonicalProfileExtractionTextWindow[] | null {
  const windowCharacters = canonicalProfileExtractionWindowCharacters(maxOutputTokens);
  return (
    planCanonicalProfileExtractionStructureWindows(text, windowCharacters) ??
    planCanonicalProfileExtractionSizeWindows(text, windowCharacters)
  );
}

/**
 * Plan bounded source-focused calls for a large prepared corpus. Lengths use
 * JavaScript string units, and windows retain offsets into each full source. The window size
 * follows the extraction output-token budget and is 8,192 units when the budget is unknown.
 */
export function planCanonicalProfileExtractionCalls(
  sources: readonly { readonly id: string; readonly text: string }[],
  maxOutputTokens?: number,
): readonly CanonicalProfileExtractionPlannedCall[] | null {
  if (
    sources.length < proactivePlanMinimumSourceCount ||
    sources.length > proactivePlanMaximumSourceCount ||
    new Set(sources.map((source) => source.id)).size !== sources.length
  ) {
    return null;
  }

  const windowCharacters = canonicalProfileExtractionWindowCharacters(maxOutputTokens);
  const totalTextLength = sources.reduce((total, source) => total + source.text.length, 0);
  if (totalTextLength <= proactivePlanTotalTextThreshold) return null;

  const calls: CanonicalProfileExtractionPlannedCall[] = [];
  for (const source of sources) {
    if (source.text.length <= windowCharacters) {
      calls.push({ sourceId: source.id });
      continue;
    }

    // Prefer heading-aligned windows, but never let packing waste cross the call cap that plain
    // size windows would meet.
    const structured = planCanonicalProfileExtractionStructureWindows(
      source.text,
      windowCharacters,
    );
    const windows =
      structured !== null && calls.length + structured.length <= proactivePlanMaximumCallCount
        ? structured
        : planCanonicalProfileExtractionSizeWindows(source.text, windowCharacters);
    if (windows === null) return null;
    for (const window of windows) {
      calls.push({ sourceId: source.id, window });
      if (calls.length > proactivePlanMaximumCallCount) return null;
    }
  }

  return calls.length <= proactivePlanMaximumCallCount ? calls : null;
}
