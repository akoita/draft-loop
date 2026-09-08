/** A deliberately closed grammar, not general credential or subject equivalence. */
const subject = "(?:computer science|quantitative)";
const requirementPattern = new RegExp(
  `^(?:a )?(${subject})(?: or (${subject}))? degree(?: (?:preferred|required))?[.]?$`,
  "u",
);
const credential =
  "(?:bsc|bs|msc|ms|phd|bachelor of science|master of science|doctor of philosophy|bachelor(?:'s)? degree|master(?:'s)? degree|doctoral degree|degree)";
const credentialPattern = new RegExp(
  `^(?:(?:earned|completed|holds) (?:an? )?)?${credential} in (computer science|quantitative(?: field| discipline)?)` +
    "(?:, [a-z][a-z -]{0,79})?(?:, (?:19|20)[0-9]{2}(?: (?:to|-) (?:19|20)[0-9]{2})?)?[.]?$",
  "u",
);
// Conservative: a status-qualified block cannot establish an attained degree.
const uncertainCredential =
  /\b(?:no|not|never|without|incomplete|unfinished|uncompleted|unearned|pending|expected|expecting|pursuing|studying|student|candidate|candidacy|coursework|courses|course|training|enrolled|ongoing|progress|planned|planning|honorary|honoris|abandoned|withdrawn|withdrawal|dropped|failed|revoked|suspended|required|preferred|desired)\b/u;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/computer[-‐‑–]science/gu, "computer science")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Undefined leaves other requirements to the lexical matcher. A recognized
 * requirement returns false rather than falling back to permissive overlap.
 * Quantitative subjects are literal; no taxonomy of equivalent fields is inferred.
 */
export function explicitDegreeCoverage(
  requirement: string,
  blocks: readonly string[],
): boolean | undefined {
  const parsed = requirementPattern.exec(normalize(requirement));
  if (parsed === null) return undefined;
  const subjects = new Set([parsed[1], parsed[2]]);
  return blocks.some((text) => {
    const normalized = normalize(text);
    if (uncertainCredential.test(normalized)) return false;
    const degree = credentialPattern.exec(normalized);
    if (degree === null) return false;
    const field = degree[1]?.startsWith("quantitative") ? "quantitative" : degree[1];
    return subjects.has(field);
  });
}
