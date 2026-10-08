import type { CanonicalProfileExtractionTextWindow } from "./canonical-profile-extraction-sections.js";

/** Window size, in UTF-16 units, used when the output-token budget is unknown or small. */
export const minimumCanonicalProfileExtractionWindowCharacters = 8_192;
const maximumCanonicalProfileExtractionWindowCharacters = 32_768;
// Measured on dense career text with Mistral Large 4: structured output needs at least 2.8 tokens
// per source character, so plan for 3.
const outputTokensPerSourceCharacter = 3;
// Leave a quarter of the budget free, so denser-than-measured text does not hit the output ceiling.
const outputBudgetSafetyFactor = 0.75;

/** Largest window whose dense extraction output is expected to fit the output-token budget. */
export function canonicalProfileExtractionWindowCharacters(maxOutputTokens?: number): number {
  if (maxOutputTokens === undefined || !Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
    return minimumCanonicalProfileExtractionWindowCharacters;
  }
  return Math.min(
    maximumCanonicalProfileExtractionWindowCharacters,
    Math.max(
      minimumCanonicalProfileExtractionWindowCharacters,
      Math.floor((maxOutputTokens * outputBudgetSafetyFactor) / outputTokensPerSourceCharacter),
    ),
  );
}

/**
 * Split text into contiguous, non-empty windows no longer than the window size, preferring a
 * newline in the last fifth of each window and never splitting a surrogate pair.
 */
export function planCanonicalProfileExtractionSizeWindows(
  text: string,
  windowCharacters: number = minimumCanonicalProfileExtractionWindowCharacters,
): readonly CanonicalProfileExtractionTextWindow[] | null {
  if (text.length === 0) return null;

  const windows: CanonicalProfileExtractionTextWindow[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + windowCharacters, text.length);
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
    if (end <= start || end - start > windowCharacters) return null;

    windows.push({ start, end, text: text.slice(start, end) });
    start = end;
  }
  return windows;
}
