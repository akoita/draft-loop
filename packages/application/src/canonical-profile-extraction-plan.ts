import type { CanonicalProfileExtractionTextWindow } from "./canonical-profile-extraction-sections.js";

const proactivePlanMinimumSourceCount = 1;
const proactivePlanMaximumSourceCount = 4;
const proactivePlanTotalTextThreshold = 65_536;
const proactivePlanSourceWindowThreshold = 8_192;
// One 512 Ki source with newline-shortened windows (down to ~80% of the window size) needs up to
// about 80 calls.
const proactivePlanMaximumCallCount = 96;

export interface CanonicalProfileExtractionPlannedCall {
  readonly sourceId: string;
  readonly window?: CanonicalProfileExtractionTextWindow;
}

/** Split text into contiguous, non-empty windows bounded by the focused-text limit. */
export function planCanonicalProfileExtractionBoundedTextWindows(
  text: string,
): readonly CanonicalProfileExtractionTextWindow[] | null {
  if (text.length === 0) return null;

  const windows: CanonicalProfileExtractionTextWindow[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + proactivePlanSourceWindowThreshold, text.length);
    let end = hardEnd;
    if (
      end < text.length &&
      text.charCodeAt(end - 1) >= 0xd800 &&
      text.charCodeAt(end - 1) <= 0xdbff &&
      text.charCodeAt(end) >= 0xdc00 &&
      text.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }

    const newlineIndex = text.lastIndexOf("\n", end - 1);
    const newlinePreferenceStart = start + Math.ceil((hardEnd - start) * 0.8);
    if (
      newlineIndex >= newlinePreferenceStart &&
      newlineIndex + 1 > start &&
      newlineIndex + 1 <= end
    ) {
      end = newlineIndex + 1;
    }
    if (end <= start || end - start > proactivePlanSourceWindowThreshold) return null;

    windows.push({ start, end, text: text.slice(start, end) });
    start = end;
  }
  return windows;
}

/**
 * Plan bounded source-focused calls for a large prepared corpus. Lengths use
 * JavaScript string units, and windows retain offsets into each full source.
 */
export function planCanonicalProfileExtractionCalls(
  sources: readonly { readonly id: string; readonly text: string }[],
): readonly CanonicalProfileExtractionPlannedCall[] | null {
  if (
    sources.length < proactivePlanMinimumSourceCount ||
    sources.length > proactivePlanMaximumSourceCount ||
    new Set(sources.map((source) => source.id)).size !== sources.length
  ) {
    return null;
  }

  const totalTextLength = sources.reduce((total, source) => total + source.text.length, 0);
  if (totalTextLength <= proactivePlanTotalTextThreshold) return null;

  const calls: CanonicalProfileExtractionPlannedCall[] = [];
  for (const source of sources) {
    if (source.text.length <= proactivePlanSourceWindowThreshold) {
      calls.push({ sourceId: source.id });
      continue;
    }

    const windows = planCanonicalProfileExtractionBoundedTextWindows(source.text);
    if (windows === null) return null;
    for (const window of windows) {
      calls.push({ sourceId: source.id, window });
      if (calls.length > proactivePlanMaximumCallCount) return null;
    }
  }

  return calls.length <= proactivePlanMaximumCallCount ? calls : null;
}
