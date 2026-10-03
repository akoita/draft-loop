/** One contiguous UTF-16 slice, with offsets into the unchanged original source text. */
export interface CanonicalProfileExtractionTextWindow {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface CanonicalProfileExtractionSectionFocus {
  readonly extractionFocusSourceId: string;
  readonly extractionFocusWindow: CanonicalProfileExtractionTextWindow;
}

export const canonicalProfileExtractionSectionFocusInstructions =
  "This is one bounded window from input.extractionFocusSourceId. Extract all supported facts whose evidence is in input.extractionFocusWindow.text. Use other supplied sources only as needed for factual context. Include an outside-window counterfact only when it is grounded in a supplied source and needed for a genuine conflict or duplicate that includes at least one fact grounded in the focused window; omit unrelated outside-window facts. Evidence must remain an exact contiguous quote from the unchanged original source, so a quote may extend across a window boundary; never clip evidence to the artificial window. Do not invent facts or counterfacts. Preserve all existing evidence, key, and schema rules.";

/**
 * Splits text into four contiguous, non-empty windows. Boundaries use UTF-16
 * offsets for String.slice but are selected only between Unicode code points.
 * A nearby newline boundary is preferred to keep ordinary lines together.
 */
export function planCanonicalProfileExtractionTextWindows(
  text: string,
): readonly CanonicalProfileExtractionTextWindow[] | null {
  const codePoints = Array.from(text);
  if (codePoints.length < 4) return null;

  const offsets = [0];
  for (const codePoint of codePoints) {
    offsets.push((offsets.at(-1) ?? 0) + codePoint.length);
  }

  const boundaries = [0];
  const newlinePreferenceRadius = Math.max(1, Math.ceil(codePoints.length * 0.08));
  for (let boundaryNumber = 1; boundaryNumber < 4; boundaryNumber += 1) {
    const target = Math.round((codePoints.length * boundaryNumber) / 4);
    const minimum = (boundaries.at(-1) ?? 0) + 1;
    const maximum = codePoints.length - (4 - boundaryNumber);
    const low = Math.max(minimum, target - newlinePreferenceRadius);
    const high = Math.min(maximum, target + newlinePreferenceRadius);
    let preferredNewlineBoundary: number | undefined;
    for (let candidate = low; candidate <= high; candidate += 1) {
      if (codePoints[candidate - 1] !== "\n") continue;
      if (
        preferredNewlineBoundary === undefined ||
        Math.abs(candidate - target) < Math.abs(preferredNewlineBoundary - target)
      ) {
        preferredNewlineBoundary = candidate;
      }
    }
    boundaries.push(preferredNewlineBoundary ?? Math.min(maximum, Math.max(minimum, target)));
  }
  boundaries.push(codePoints.length);

  const windows: CanonicalProfileExtractionTextWindow[] = [];
  for (let index = 0; index < 4; index += 1) {
    const startCodePoint = boundaries[index];
    const endCodePoint = boundaries[index + 1];
    if (
      startCodePoint === undefined ||
      endCodePoint === undefined ||
      endCodePoint <= startCodePoint
    ) {
      return null;
    }
    const start = offsets[startCodePoint];
    const end = offsets[endCodePoint];
    if (start === undefined || end === undefined || end <= start) return null;
    windows.push({ start, end, text: text.slice(start, end) });
  }
  return windows;
}

export function canonicalProfileExtractionSectionFocus(
  sourceId: string,
  window: CanonicalProfileExtractionTextWindow,
): CanonicalProfileExtractionSectionFocus {
  return {
    extractionFocusSourceId: sourceId,
    extractionFocusWindow: { start: window.start, end: window.end, text: window.text },
  };
}
