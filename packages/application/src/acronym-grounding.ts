/** A capitalized phrase followed by a bare number, such as "Key Stage 2". */
export const numberedNameSuffixPattern = /^[ \t]+(\d+)(?![\p{L}\p{N}%]|[.,]\d)/u;

/**
 * Acronym and spelled-out phrase equivalence for deterministic grounding (#3089).
 *
 * A claim may spell out an acronym its source uses ("Key Stage 2" for "KS2", "Advanced Life
 * Support" for "ALS"), or shorten a phrase its source spells out ("QTS" for "Qualified Teacher
 * Status"). Both are accepted only when the initials match a whole source token exactly. This
 * is lexical support, not a check of meaning; the critic still reviews the claim.
 */

const acronymTokenPattern = /(?<![\p{L}\p{N}])(\p{Lu}{2,})(\d*)(?![\p{L}\p{N}])/gu;
const capitalizedWordPattern = /^\p{Lu}[\p{L}'’-]*$/u;
const sourceWordPattern = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const acronymValuePattern = /^\p{Lu}{2,}$/u;

function sourceAcronyms(evidence: string): readonly { letters: string; digits: string }[] {
  return [...evidence.normalize("NFKC").matchAll(acronymTokenPattern)].map((match) => ({
    letters: match[1] ?? "",
    digits: match[2] ?? "",
  }));
}

function lowerWords(text: string): ReadonlySet<string> {
  return new Set(
    (text.normalize("NFKC").toLocaleLowerCase("en-US").match(sourceWordPattern) ?? []).map((word) =>
      word.replace(/’/gu, "'"),
    ),
  );
}

function initials(words: readonly string[]): string {
  return words.map((word) => word[0] ?? "").join("");
}

/**
 * A capitalized phrase is supported when its last two or more words spell an acronym the
 * source holds as a whole token, and any words before them occur in the source as words. A
 * trailing number must be glued to that token: "Key Stage 2" needs "KS2", not "KS1".
 */
export function supportsSpelledOutAcronym(evidence: string, protectedValue: string): boolean {
  const allWords = protectedValue.normalize("NFKC").trim().split(/\s+/u);
  const last = allWords.at(-1) ?? "";
  const digits = /^\d+$/u.test(last) ? last : "";
  const words = digits === "" ? allWords : allWords.slice(0, -1);
  if (words.length < 2 || words.some((word) => !capitalizedWordPattern.test(word))) return false;
  const acronyms = new Set(
    sourceAcronyms(evidence)
      .filter((acronym) => acronym.digits === digits)
      .map(({ letters }) => letters),
  );
  const evidenceWords = lowerWords(evidence);
  for (let start = 0; start <= words.length - 2; start += 1) {
    const leading = words.slice(0, start);
    if (!leading.every((word) => evidenceWords.has(word.toLocaleLowerCase("en-US")))) break;
    if (acronyms.has(initials(words.slice(start)).toLocaleUpperCase("en-US"))) return true;
  }
  return false;
}

/** An acronym claim is supported when consecutive capitalized source words spell it. */
export function supportsAcronymOfSourcePhrase(evidence: string, protectedValue: string): boolean {
  const acronym = protectedValue.normalize("NFKC");
  if (!acronymValuePattern.test(acronym)) return false;
  const sourceWords = evidence.normalize("NFKC").match(sourceWordPattern) ?? [];
  for (let start = 0; start + acronym.length <= sourceWords.length; start += 1) {
    const run = sourceWords.slice(start, start + acronym.length);
    if (run.every((word) => capitalizedWordPattern.test(word)) && initials(run) === acronym) {
      return true;
    }
  }
  return false;
}
