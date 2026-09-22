import { extractProtectedValues } from "./author-grounding.js";

// A word is a maximal run of letters that may contain an apostrophe or hyphen.
const wordPattern = /\p{L}+(?:['’-]\p{L}+)*/gu;
const capitalisedPattern = /^[\p{Lu}\p{Lt}]/u;
const sentenceStartPattern = /(?:^|[.!?]\s+)[^\p{L}\p{N}]*$/u;

const exemptWords = new Set(
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun",
    "Present",
    "I",
  ].map(normalizedIdentity),
);

function normalizedIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/’/gu, "'");
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function appearsAsWord(evidence: string, identity: string): boolean {
  return new RegExp(`(?<!\\p{L})${escapedPattern(identity)}(?!\\p{L})`, "u").test(
    normalizedIdentity(evidence),
  );
}

/** Match a name as a whole word; a possessive name is also supported by its base form. */
export function supportsSingleWordName(evidence: string, name: string): boolean {
  const identity = normalizedIdentity(name);
  const base = identity.endsWith("'s") ? identity.slice(0, -2) : undefined;
  return (
    appearsAsWord(evidence, identity) ||
    (base !== undefined && base !== "" && appearsAsWord(evidence, base))
  );
}

/**
 * Return the capitalised single words in a claim that need evidence support.
 * Sentence-initial words, calendar words, and words inside protected values
 * are exempt because they are either ordinary capitalisation or already
 * checked as protected values.
 */
export function singleWordNames(claimText: string): readonly string[] {
  const protectedWords = new Set(
    extractProtectedValues(claimText).flatMap((value) => value.match(wordPattern) ?? []),
  );
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of claimText.matchAll(wordPattern)) {
    const word = match[0];
    const identity = normalizedIdentity(word);
    if (
      !capitalisedPattern.test(word) ||
      seen.has(identity) ||
      exemptWords.has(identity) ||
      protectedWords.has(word) ||
      sentenceStartPattern.test(claimText.slice(0, match.index))
    )
      continue;
    seen.add(identity);
    names.push(word);
  }
  return Object.freeze(names);
}

/** Return capitalised single words in a claim that no cited evidence chunk contains. */
export function unsupportedSingleWordNames(
  claimText: string,
  evidenceTexts: readonly string[],
): readonly string[] {
  return Object.freeze(
    singleWordNames(claimText).filter(
      (name) => !evidenceTexts.some((evidence) => supportsSingleWordName(evidence, name)),
    ),
  );
}
