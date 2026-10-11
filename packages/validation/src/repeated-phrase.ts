/** Shortest run of words that counts as a repeated phrase; shorter echoes such as "very very" are ignored. */
const MIN_REPEATED_WORDS = 3;
/** Longest run checked, which bounds the scan on long blocks. */
const MAX_REPEATED_WORDS = 40;

export interface RepeatedPhrase {
  /** The second occurrence, as written in the text. */
  readonly phrase: string;
  readonly start: number;
  readonly end: number;
}

interface Word {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

function wordsOf(text: string): readonly Word[] {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)].map((match) => ({
    key: match[0].normalize("NFKC").toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function sameRun(words: readonly Word[], first: number, second: number, length: number): boolean {
  for (let offset = 0; offset < length; offset += 1) {
    if (words[first + offset]?.key !== words[second + offset]?.key) return false;
  }
  return true;
}

/**
 * Finds the longest run of at least three words that is immediately repeated, ignoring case and
 * the punctuation between the copies, as in "the API and the Keycloak infrastructure; the API and
 * the Keycloak infrastructure". Such tails come from stitching overlapping evidence quotes.
 */
export function findRepeatedPhrase(text: string): RepeatedPhrase | undefined {
  const words = wordsOf(text);
  for (let first = 0; first + 2 * MIN_REPEATED_WORDS <= words.length; first += 1) {
    const longest = Math.min(MAX_REPEATED_WORDS, Math.floor((words.length - first) / 2));
    for (let length = longest; length >= MIN_REPEATED_WORDS; length -= 1) {
      if (!sameRun(words, first, first + length, length)) continue;
      const start = words[first + length]?.start ?? 0;
      const end = words[first + 2 * length - 1]?.end ?? start;
      return { phrase: text.slice(start, end), start, end };
    }
  }
  return undefined;
}
