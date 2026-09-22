/** Closed set of phrases that may join two claim-covered spans without a claim of their own. */
const joiningPhrases: readonly (readonly string[])[] = [
  ["as", "well", "as"],
  ["who"],
  ["which"],
  ["that"],
  ["while"],
  ["where"],
  ["with"],
  ["including"],
];

function isJoiningRun(run: readonly string[]): boolean {
  let index = 0;
  let phrases = 0;
  while (index < run.length) {
    if (run[index] === "and") {
      index += 1;
      continue;
    }
    const phrase = joiningPhrases.find((candidate) =>
      candidate.every((word, offset) => run[index + offset] === word),
    );
    if (phrase === undefined) return false;
    index += phrase.length;
    phrases += 1;
  }
  return phrases > 0;
}

/**
 * Mark whole uncovered gaps as covered when they consist only of joining
 * phrases (optionally separated by "and") and sit between two covered tokens.
 * Gaps at the block start or end, or containing any other word, stay uncovered.
 */
export function coverJoiningGaps(
  words: readonly string[],
  covered: readonly boolean[],
): readonly boolean[] {
  const result = [...covered];
  let start = 0;
  while (start < words.length) {
    if (covered[start]) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < words.length && !covered[end]) end += 1;
    const bounded = start > 0 && end < words.length;
    if (bounded && isJoiningRun(words.slice(start, end))) result.fill(true, start, end);
    start = end;
  }
  return result;
}
