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
// Conservative: a status-qualified clause cannot establish an attained degree.
const uncertainCredential =
  /\b(?:no|not|never|without|incomplete|unfinished|uncompleted|unearned|pending|expected|expecting|pursuing|studying|student|candidate|candidacy|coursework|courses|course|training|enrolled|ongoing|progress|planned|planning|honorary|honoris|abandoned|withdrawn|withdrawal|dropped|failed|revoked|suspended|required|preferred|desired)\b/u;

/**
 * Clauses split on `;` and on a sentence-final `.` only. Commas stay inside the
 * clause because the credential grammar uses them for specialisation and year
 * ranges, and because a qualifier such as `, not completed` belongs to the
 * credential it disqualifies.
 */
const clauseBoundary = /;|\.(?=\s|$)/u;
// A status term with no topic of its own qualifies the credential beside it,
// so `; not completed` stays attached instead of becoming an independent clause.
const statusFragment =
  /^(?!.*\bin\b)(?=.*\b(?:no|not|never|without|incomplete|unfinished|uncompleted|unearned|pending|expected|expecting|withdrawn|withdrawal|abandoned|dropped|failed|revoked|suspended|ongoing|progress|honorary|honoris)\b).*$/u;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/computer[-‐‑–]science/gu, "computer science")
    .replace(/\s+/gu, " ")
    .trim();
}

function clauses(text: string): readonly string[] {
  const parts = normalize(text)
    .split(clauseBoundary)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  return parts.reduce<string[]>((merged, clause) => {
    const previous = merged.at(-1);
    if (previous !== undefined && statusFragment.test(clause)) {
      merged[merged.length - 1] = `${previous} ${clause}`;
      return merged;
    }
    merged.push(clause);
    return merged;
  }, []);
}

/**
 * Undefined leaves other requirements to the lexical matcher. A recognized
 * requirement returns false rather than falling back to permissive overlap.
 * Quantitative subjects are literal; no taxonomy of equivalent fields is inferred.
 *
 * The grammar is evaluated per clause, so a block covers the requirement only
 * when one clause independently states a permitted attained degree. An uncertain
 * clause is never rescued by a neighbouring clause, and an unrelated clause never
 * disqualifies an attained degree stated beside it.
 */
export function explicitDegreeCoverage(
  requirement: string,
  blocks: readonly string[],
): boolean | undefined {
  const parsed = requirementPattern.exec(normalize(requirement));
  if (parsed === null) return undefined;
  const subjects = new Set([parsed[1], parsed[2]]);
  return blocks.some((text) =>
    clauses(text).some((clause) => {
      if (uncertainCredential.test(clause)) return false;
      const degree = credentialPattern.exec(clause);
      if (degree === null) return false;
      const field = degree[1]?.startsWith("quantitative") ? "quantitative" : degree[1];
      return subjects.has(field);
    }),
  );
}
