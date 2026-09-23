/** Verbs the narrow split recognises before one technical name and a software noun. */
export const narrowOpeningActionVerbs: ReadonlySet<string> = new Set([
  "Built",
  "Implemented",
  "Developed",
  "Automated",
  "Deployed",
  "Migrated",
  "Optimized",
  "Refactored",
  "Integrated",
  "Tested",
]);

/**
 * Title and adjective words that open role names such as "Senior Engineer".
 * They are never treated as opening actions, even if the verb list grows.
 */
export const excludedTitleWords: ReadonlySet<string> = new Set([
  "Lead",
  "Senior",
  "Principal",
  "Staff",
  "Chief",
  "Head",
  "Junior",
  "Associate",
  "Interim",
  "Acting",
  "Deputy",
  "Assistant",
]);

const openingActionVerbs: ReadonlySet<string> = new Set([
  ...narrowOpeningActionVerbs,
  "Led",
  "Designed",
  "Created",
  "Delivered",
  "Managed",
  "Architected",
  "Launched",
  "Drove",
  "Owned",
  "Scaled",
  "Reduced",
  "Improved",
  "Introduced",
  "Established",
  "Mentored",
  "Maintained",
  "Wrote",
  "Shipped",
  "Ran",
  "Coordinated",
  "Engineered",
  "Modernized",
  "Modernised",
  "Streamlined",
  "Spearheaded",
  "Optimised",
  "Configured",
  "Collaborated",
  "Partnered",
  "Directed",
  "Oversaw",
  "Defined",
  "Authored",
  "Published",
  "Presented",
  "Trained",
  "Hired",
  "Taught",
  "Using",
  "Used",
  "Leveraged",
]);

/** Return whether a word is a listed opening action and never a title word. */
export function isOpeningActionVerb(word: string): boolean {
  return openingActionVerbs.has(word) && !excludedTitleWords.has(word);
}

/**
 * Linking and state words that can make the capitalised match a subject, as in
 * "Built TypeScript is the employer", rather than a verb and its object.
 */
export const linkingWords: ReadonlySet<string> = new Set([
  "is",
  "was",
  "were",
  "are",
  "be",
  "been",
  "has",
  "had",
  "have",
  "became",
  "becomes",
  "remains",
  "remained",
  "founded",
  "acquired",
  "merged",
  "employs",
  "employed",
  "hired",
  "and",
  "or",
  "of",
]);

const followingWordPattern = /^\s+(\p{Ll}[\p{L}'’-]*)/u;

/** Return whether the verb phrase continues with a lowercase, non-linking word. */
function continuesVerbPhrase(following: string): boolean {
  const word = followingWordPattern.exec(following)?.[1];
  return word !== undefined && !linkingWords.has(word);
}

/**
 * Drop a listed action verb that opens the claim from a multi-word capitalised
 * match when the verb phrase continues with a lowercase object word, so
 * "Led Kafka migrations" protects "Kafka". A match followed by punctuation, the
 * end of the text, a capitalised word, or a linking word stays whole, because
 * it may be a name such as an employer. The remaining word or words stay a
 * protected value and are still checked against the evidence.
 */
export function withoutOpeningActionVerb(text: string, matched: string, start: number): string {
  if (text.slice(0, start).trim() !== "") return matched;
  const match = /^(\S+)\s+(\S[\s\S]*)$/u.exec(matched);
  const verb = match?.[1];
  const rest = match?.[2];
  if (
    verb === undefined ||
    rest === undefined ||
    !isOpeningActionVerb(verb) ||
    !continuesVerbPhrase(text.slice(start + matched.length))
  )
    return matched;
  return rest;
}
