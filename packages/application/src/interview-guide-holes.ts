/**
 * Closing the holes the claim check leaves in a guide (#2849). When it drops a sentence, the
 * sentences around it can stop making sense: a later one refers back to it ("also", "this"), a
 * numbered beat starts at "Second", or a heading such as "Suggested time split" keeps a stub of
 * its plan. Deterministic rules, no model call:
 *
 * - A kept sentence that refers back ("also" anywhere, "This" or "Cela" first) while an earlier
 *   sentence of the same part was dropped is dropped with it.
 * - Ordinal openers ("First", "Second", "Deuxièmement" and "1.", "2.") are renumbered over the
 *   kept sentences.
 * - An item that lost more than half of its sentences no longer holds what its heading promises,
 *   so it is dropped whole.
 */

export interface GuideSentenceVerdict<Sentence> {
  readonly sentence: Sentence;
  readonly text: string;
  /** Whether the claim check kept it. */
  readonly holds: boolean;
}

export interface ClosedGuidePart<Sentence> {
  readonly kept: readonly Sentence[];
  /** The kept sentences' text, renumbered where they open with an ordinal. */
  readonly texts: readonly string[];
  /** Sentences dropped by the check and those dropped with them, in order. */
  readonly dropped: readonly string[];
}

// Words that tie a sentence to an earlier one wherever they stand, and openers that point back.
const linkingWords = ["also", "likewise", "aussi", "également", "de même"];
const pointingOpeners = [
  "this",
  "that",
  "these",
  "those",
  "it",
  "they",
  "cela",
  "ceci",
  "ce",
  "ces",
  "cette",
  "il",
  "elle",
];
const linkingPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${linkingWords.join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);
const pointingPattern = new RegExp(`^(?:${pointingOpeners.join("|")})(?![\\p{L}\\p{N}])`, "iu");

const englishOrdinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];
const frenchOrdinals = [
  "Premièrement",
  "Deuxièmement",
  "Troisièmement",
  "Quatrièmement",
  "Cinquièmement",
  "Sixièmement",
];
const frenchOrdinalAdjectives = ["Premier", "Deuxième", "Troisième", "Quatrième", "Cinquième"];
const ordinalLists = [englishOrdinals, frenchOrdinals, frenchOrdinalAdjectives];

/** The rank (0-based) a sentence opens with and the rest of it; undefined without an ordinal. */
function ordinalOf(
  text: string,
): { readonly rank: number; readonly rewrite: (rank: number) => string } | undefined {
  const numbered = /^(\d{1,2})([.)])(\s)/u.exec(text);
  if (numbered !== null) {
    const rest = text.slice(numbered[0].length);
    return {
      rank: Number(numbered[1]) - 1,
      rewrite: (rank) => `${rank + 1}${numbered[2]}${numbered[3]}${rest}`,
    };
  }
  for (const list of ordinalLists) {
    const rank = list.findIndex((word) => new RegExp(`^${word}(?![\\p{L}\\p{N}])`, "u").test(text));
    if (rank >= 0) {
      const word = list[rank] ?? "";
      const rest = text.slice(word.length);
      return { rank, rewrite: (next) => `${list[next] ?? word}${rest}` };
    }
  }
  return undefined;
}

/** Whether a sentence leans on an earlier one: "also" anywhere, or "This", "Cela" first. */
export function refersBack(text: string): boolean {
  return linkingPattern.test(text) || pointingPattern.test(text.trimStart());
}

/**
 * One part of an item (its text or its trap) after the check: drops what refers back to a dropped
 * sentence and renumbers the ordinals that remain.
 */
export function closeGuidePart<Sentence>(
  verdicts: readonly GuideSentenceVerdict<Sentence>[],
): ClosedGuidePart<Sentence> {
  const kept: Sentence[] = [];
  const texts: string[] = [];
  const dropped: string[] = [];
  let lostEarlier = false;
  let nextRank = 0;
  for (const verdict of verdicts) {
    const ordinal = ordinalOf(verdict.text);
    const dependent = lostEarlier && ordinal === undefined && refersBack(verdict.text);
    if (!verdict.holds || dependent) {
      dropped.push(verdict.text);
      lostEarlier = true;
      continue;
    }
    kept.push(verdict.sentence);
    if (ordinal === undefined) {
      texts.push(verdict.text);
    } else {
      texts.push(ordinal.rank === nextRank ? verdict.text : ordinal.rewrite(nextRank));
      nextRank += 1;
    }
  }
  return { kept, texts, dropped };
}

/** Whether an item kept enough of its text to still hold what its heading promises. */
export function keepsItsPromise(written: number, kept: number): boolean {
  return kept > 0 && kept * 2 >= written;
}
