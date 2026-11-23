/**
 * Splits running text into sentences. A sentence ends at `.`, `!`, `?` or `…` (with any closing
 * quote or bracket) followed by a space or the end of the text. A dot inside a word never ends one
 * (Node.js, 2.5, U.S.A), nor does a known abbreviation (e.g., i.e., vs.) or an end mark followed by
 * a lowercase word (#2804).
 */

const abbreviations = new Set([
  "e.g.",
  "i.e.",
  "vs.",
  "cf.",
  "approx.",
  "incl.",
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "p.ex.",
]);

const endMarks = new Set([".", "!", "?", "…"]);
const closers = new Set(['"', "'", "”", "’", ")"]);

/** The last run of non-space characters before `end`, found without a regular expression. */
function lastWordBefore(text: string, end: number): string {
  let start = end;
  while (start > 0 && !/\s/u.test(text[start - 1] ?? "")) start -= 1;
  return text.slice(start, end);
}

/**
 * Each run of end marks with its closing quotes or brackets that a space or the end follows, as
 * [start, end) pairs. One pass over the text, so long runs of marks stay linear.
 */
function endRuns(text: string): Array<readonly [number, number]> {
  const runs: Array<readonly [number, number]> = [];
  let index = 0;
  while (index < text.length) {
    if (!endMarks.has(text[index] ?? "")) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < text.length && endMarks.has(text[index] ?? "")) index += 1;
    while (index < text.length && closers.has(text[index] ?? "")) index += 1;
    if (index === text.length || /\s/u.test(text[index] ?? "")) runs.push([start, index]);
  }
  return runs;
}

function endsSentence(text: string, start: number, end: number): boolean {
  const rest = text.slice(end).trimStart();
  if (rest === "") return true;
  const next = rest[0] ?? "";
  if (next !== next.toUpperCase() && next === next.toLowerCase()) return false;
  if (text[start] !== ".") return true;
  const word = lastWordBefore(text, end).toLowerCase();
  return !abbreviations.has(word);
}

export function sentencesOf(text: string): string[] {
  const flat = text.replace(/\s+/gu, " ").trim();
  const sentences: string[] = [];
  let from = 0;
  for (const [start, end] of endRuns(flat)) {
    if (!endsSentence(flat, start, end)) continue;
    sentences.push(flat.slice(from, end).trim());
    from = end;
  }
  sentences.push(flat.slice(from).trim());
  return sentences.filter(Boolean);
}
