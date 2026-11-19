/**
 * Which career facts a person's approval edit changed (#3070), found without a model call. The
 * edit is diffed word by word against the drafted block. A replaced span counts as factual when it
 * holds a number or a date, or names something (a title, an employer, a person): it starts with a
 * capital letter. A factual span then points at the one profile fact whose value holds the old
 * words and shares the most words with the drafted block, then the one it covers best; when no
 * fact or several equal ones match, nothing is suggested.
 *
 * Fictional example: "Led a team of 5 engineers" edited to "Led a team of 8 engineers" against the
 * fact "Led a team of 5 engineers at Example Corp" suggests "Led a team of 8 engineers at Example
 * Corp", quoting the edited sentence.
 */

import type { CanonicalCandidateProfileFact } from "./canonical-candidate-profile.js";
import { factSuggestionLimits } from "./fact-suggestion.js";
import { normalizedFactText } from "./fact-usage.js";

export interface EditedFactChange {
  /** The profile fact the edit contradicts. */
  readonly fact: CanonicalCandidateProfileFact;
  /** The drafted words the person replaced, as drafted. */
  readonly before: string;
  /** The words they wrote instead. */
  readonly after: string;
  /** The fact's value with the replacement applied: the `correct` suggestion's value. */
  readonly value: string;
  /** The edited sentence that holds the new words: the suggestion's quote. */
  readonly quote: string;
}

export interface EditedFactChangeInput {
  readonly draftedText: string;
  readonly editedText: string;
  readonly facts: readonly CanonicalCandidateProfileFact[];
}

/** Words beyond this are not diffed: a block is a few sentences, never a document. */
const maximumWords = 400;

const monthNames = new Set([
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
]);

interface Word {
  /** As written, without surrounding punctuation. */
  readonly text: string;
  /** Compared form. */
  readonly key: string;
  /** First word of a sentence, where a capital letter names nothing. */
  readonly start: boolean;
}

const letterOrDigit = /^[\p{L}\p{N}]$/u;
const closing = new Set(['"', "'", ")", "]", "\u2019", "\u201d"]);
const sentenceEnds = new Set([".", "!", "?", ":", ";"]);

/** A raw word without the punctuation around it; a trailing % or + stays, as in "40%". */
function trimWord(raw: string): string {
  const characters = [...raw];
  let first = 0;
  let last = characters.length;
  while (first < last && !letterOrDigit.test(characters[first] ?? "")) first += 1;
  while (last > first) {
    const character = characters[last - 1] ?? "";
    if (letterOrDigit.test(character) || character === "%" || character === "+") break;
    last -= 1;
  }
  return characters.slice(first, last).join("");
}

/** Whether a raw word ends its sentence, closing quotes and brackets aside. */
function endsSentence(raw: string): boolean {
  const characters = [...raw];
  let index = characters.length - 1;
  while (index >= 0 && closing.has(characters[index] ?? "")) index -= 1;
  return sentenceEnds.has(characters[index] ?? "");
}

function words(text: string): Word[] {
  const found: Word[] = [];
  let start = true;
  for (const raw of text.normalize("NFKC").split(/\s+/u)) {
    const trimmed = trimWord(raw);
    if (trimmed.length === 0) continue;
    found.push({ text: trimmed, key: trimmed.toLowerCase(), start });
    start = endsSentence(raw);
    if (found.length >= maximumWords) break;
  }
  return found;
}

interface Replacement {
  readonly before: readonly Word[];
  readonly after: readonly Word[];
}

/** Spans replaced between two word lists, from their longest common subsequence. */
function replacements(drafted: readonly Word[], edited: readonly Word[]): Replacement[] {
  const rows = drafted.length;
  const columns = edited.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0),
  );
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const current = table[row] as number[];
      const below = table[row + 1] as number[];
      current[column] =
        drafted[row]?.key === edited[column]?.key
          ? (below[column + 1] ?? 0) + 1
          : Math.max(below[column] ?? 0, current[column + 1] ?? 0);
    }
  }
  const found: Replacement[] = [];
  let before: Word[] = [];
  let after: Word[] = [];
  const flush = () => {
    if (before.length > 0 && after.length > 0) found.push({ before, after });
    before = [];
    after = [];
  };
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    if (row < rows && column < columns && drafted[row]?.key === edited[column]?.key) {
      flush();
      row += 1;
      column += 1;
    } else if (
      column < columns &&
      (row >= rows || (table[row]?.[column + 1] ?? 0) >= (table[row + 1]?.[column] ?? 0))
    ) {
      after.push(edited[column] as Word);
      column += 1;
    } else {
      before.push(drafted[row] as Word);
      row += 1;
    }
  }
  flush();
  return found;
}

function isFactual(span: readonly Word[]): boolean {
  return span.some(
    (word) =>
      /\p{N}/u.test(word.text) ||
      monthNames.has(word.key) ||
      (!word.start && /^\p{Lu}/u.test(word.text)),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** The words of `span` as a whole-word, case-insensitive pattern allowing any spacing. */
function spanPattern(span: readonly Word[]): RegExp {
  const body = span.map((word) => escapeRegExp(word.text)).join("[^\\p{L}\\p{N}]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
}

/** Words the fact shares with the drafted block, then the share of its words that are shared. */
function overlap(
  fact: CanonicalCandidateProfileFact,
  draftedKeys: ReadonlySet<string>,
): { readonly shared: number; readonly covered: number } {
  const factWords = new Set(words(fact.value).map((entry) => entry.key));
  let shared = 0;
  for (const word of factWords) {
    if (draftedKeys.has(word)) shared += 1;
  }
  return { shared, covered: factWords.size === 0 ? 0 : shared / factWords.size };
}

/** The sentence of `text` that holds the new words, cut to the quote limit. */
function sentenceWith(text: string, after: readonly Word[]): string {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/u).map((sentence) => sentence.trim());
  const pattern = spanPattern(after);
  const sentence = sentences.find((entry) => pattern.test(entry)) ?? text.trim();
  const characters = [...sentence];
  return characters.length <= factSuggestionLimits.quoteMax
    ? sentence
    : characters.slice(0, factSuggestionLimits.quoteMax).join("");
}

/**
 * The facts an approval edit contradicts, at most one change per fact. An edit that only rewords,
 * reorders, fixes case or punctuation, or changes words that are not facts yields nothing.
 */
export function editedFactChanges(input: EditedFactChangeInput): readonly EditedFactChange[] {
  if (normalizedFactText(input.draftedText) === normalizedFactText(input.editedText)) return [];
  const drafted = words(input.draftedText);
  const draftedKeys = new Set(drafted.map((word) => word.key));
  const changes: EditedFactChange[] = [];
  const changed = new Set<string>();
  for (const { before, after } of replacements(drafted, words(input.editedText))) {
    if (!isFactual(before) && !isFactual(after)) continue;
    const pattern = spanPattern(before);
    const candidates = input.facts
      .filter((fact) => pattern.test(fact.value))
      .map((fact) => ({ fact, score: overlap(fact, draftedKeys) }))
      .sort(
        (left, right) =>
          right.score.shared - left.score.shared || right.score.covered - left.score.covered,
      );
    const [best, next] = candidates;
    if (best === undefined) continue;
    if (
      next !== undefined &&
      next.score.shared === best.score.shared &&
      next.score.covered === best.score.covered
    ) {
      continue;
    }
    if (changed.has(best.fact.id)) continue;
    const replacement = after.map((word) => word.text).join(" ");
    const value = best.fact.value.replace(pattern, replacement).trim();
    if (value.length === 0 || value.length > factSuggestionLimits.valueMax) continue;
    if (normalizedFactText(value) === normalizedFactText(best.fact.value)) continue;
    changed.add(best.fact.id);
    changes.push({
      fact: best.fact,
      before: before.map((word) => word.text).join(" "),
      after: replacement,
      value,
      quote: sentenceWith(input.editedText, after),
    });
  }
  return changes;
}
