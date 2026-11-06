/** Longest quote of the offending text placed in a finding message. */
const MAX_QUOTE_CHARACTERS = 50;

/**
 * A CV speaks in the candidate's implied voice. A third-person pronoun or a reviewer's phrase
 * about the candidate is a career note copied as written. All-caps forms are left alone, since
 * they are more often acronyms than pronouns.
 */
const englishNarrationPattern =
  /(?<![\p{L}\p{N}])(?:[Hh]e|[Ss]he|[Hh]is|[Hh]er|[Hh]im|[Hh]imself|[Hh]erself|[Tt]he candidate|[Ll]abell?ed as such)(?![\p{L}\p{N}])/u;

/**
 * French narration (#2320): a third-person subject with a verb, or the candidate named as such.
 * Possessives such as "son" or "sa" are left out, since French CV prose uses them for systems.
 */
const frenchNarrationPattern =
  /(?<![\p{L}\p{N}])(?:(?:[Ii]l|[Ee]lle) (?:a|avait|est|était|a été)|[Ll]e candidat|[Ll]a candidate|[Ll]abellisée? comme tel(?:le)?)(?![\p{L}\p{N}])/u;

/** The pattern for a document language; a language without one is not checked. */
function narrationPatternFor(language: string): RegExp | undefined {
  const code = language.trim().toLowerCase().split("-")[0];
  if (code === "en") return englishNarrationPattern;
  if (code === "fr") return frenchNarrationPattern;
  return undefined;
}

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
export function findCandidateNarration(
  text: string,
  language = "en",
): CandidateNarration | undefined {
  const match = narrationPatternFor(language)?.exec(text) ?? null;
  if (match === null) return undefined;
  const start = match.index;
  const end = start + match[0].length;
  const quoteEnd = Math.min(text.length, start + MAX_QUOTE_CHARACTERS);
  return { quote: text.slice(start, quoteEnd).trimEnd(), start, end };
}
