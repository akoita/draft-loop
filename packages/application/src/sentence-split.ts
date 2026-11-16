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

const endPattern = /[.!?…]+["'”’)]*(?=\s|$)/gu;

function endsSentence(text: string, start: number, end: number): boolean {
  const rest = text.slice(end).trimStart();
  if (rest === "") return true;
  const next = rest[0] ?? "";
  if (next !== next.toUpperCase() && next === next.toLowerCase()) return false;
  if (text[start] !== ".") return true;
  const word = (/\S+$/u.exec(text.slice(0, end))?.[0] ?? "").toLowerCase();
  return !abbreviations.has(word);
}

export function sentencesOf(text: string): string[] {
  const flat = text.replace(/\s+/gu, " ").trim();
  const sentences: string[] = [];
  let from = 0;
  for (const match of flat.matchAll(endPattern)) {
    const end = match.index + match[0].length;
    if (!endsSentence(flat, match.index, end)) continue;
    sentences.push(flat.slice(from, end).trim());
    from = end;
  }
  sentences.push(flat.slice(from).trim());
  return sentences.filter(Boolean);
}
