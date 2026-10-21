/** Longest quote of the offending text placed in a finding message. */
const MAX_QUOTE_CHARACTERS = 50;

/**
 * A CV speaks in the candidate's implied voice. A third-person pronoun or a reviewer's phrase
 * about the candidate is a career note copied as written. All-caps forms are left alone, since
 * they are more often acronyms than pronouns.
 */
const narrationPattern =
  /(?<![\p{L}\p{N}])(?:[Hh]e|[Ss]he|[Hh]is|[Hh]er|[Hh]im|[Hh]imself|[Hh]erself|[Tt]he candidate|[Ll]abell?ed as such)(?![\p{L}\p{N}])/u;

export interface CandidateNarration {
  /** The text from the offending word on, as written and shortened to a quote. */
  readonly quote: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Finds the first place a block narrates the candidate in the third person ("He remained an
 * employee", "his main responsibility") or comments on the CV itself ("labelled as such").
 */
export function findCandidateNarration(text: string): CandidateNarration | undefined {
  const match = narrationPattern.exec(text);
  if (match === null) return undefined;
  const start = match.index;
  const end = start + match[0].length;
  const quoteEnd = Math.min(text.length, start + MAX_QUOTE_CHARACTERS);
  return { quote: text.slice(start, quoteEnd).trimEnd(), start, end };
}
