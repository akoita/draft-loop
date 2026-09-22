// A token is a maximal run of letters or numbers.
const tokenPattern = /[\p{L}\p{N}]+/gu;
const uppercaseStartPattern = /^\p{Lu}/u;

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function appearsAsWholeWord(evidence: string, token: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapedPattern(token)}(?![\\p{L}\\p{N}])`, "u").test(
    evidence,
  );
}

/**
 * Return the short names in a claim: letter or number runs of one or two
 * characters that start with an uppercase letter, such as "Go", "R", or "UI".
 */
export function shortNameTokens(claimText: string): readonly string[] {
  return Object.freeze(
    (claimText.normalize("NFKC").match(tokenPattern) ?? []).filter(
      (token) => [...token].length <= 2 && uppercaseStartPattern.test(token),
    ),
  );
}

/**
 * Decide whether cited evidence relates to a claim made only of short names.
 * Callers use this only when the claim has no longer meaningful token. The
 * claim is related when it has at least one short name and every short name
 * appears in the evidence as a case-sensitive whole word.
 */
export function shortNamesRelated(claimText: string, evidenceTexts: readonly string[]): boolean {
  const names = shortNameTokens(claimText);
  const evidence = evidenceTexts.map((text) => text.normalize("NFKC"));
  return (
    names.length > 0 &&
    names.every((name) => evidence.some((text) => appearsAsWholeWord(text, name)))
  );
}
