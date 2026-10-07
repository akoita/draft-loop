/** A deliberately closed grammar, not general credential or subject equivalence. */
const subject = "(?:computer science|quantitative)";
const requirementPattern = new RegExp(
  `^(?:a )?(${subject})(?: or (${subject}))? degree(?: (?:preferred|required))?[.]?$`,
  "u",
);
// Level-qualified form, e.g. "MSc or PhD in Computer Science". Levels are ordered;
// the lowest listed level is the minimum, and no field taxonomy is inferred.
const level =
  "(?:bsc|bs|bachelor of science|bachelor's|bachelor|msc|ms|master of science|master's|master|phd|doctor of philosophy|doctorate|doctoral)";
const requirementSubject = "(computer science|quantitative(?: field| discipline)?)";
const levelRequirementPattern = new RegExp(
  `^(?:an? )?(${level}(?:(?:, or |, | or )${level}){0,2})(?: degrees?)? in (?:an? )?${requirementSubject}` +
    `(?: or (?:an? )?${requirementSubject})?(?: (?:preferred|required))?[.]?$`,
  "u",
);
const credential =
  "(?:bsc|bs|msc|ms|phd|bachelor of science|master of science|doctor of philosophy|doctorate|bachelor(?:'s)? degree|master(?:'s)? degree|doctoral degree|degree)";
const credentialPattern = new RegExp(
  `^(?:(?:earned|completed|holds) (?:an? )?)?(${credential}) in (computer science|quantitative(?: field| discipline)?)` +
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

type Level = 1 | 2 | 3;

function levelOf(text: string): Level | undefined {
  if (/^(?:bsc|bs|bachelor)/u.test(text)) return 1;
  if (/^(?:msc|ms|master)/u.test(text)) return 2;
  if (/^(?:phd|doctor)/u.test(text)) return 3;
  return undefined;
}

function subjectOf(text: string | undefined): string | undefined {
  return text?.startsWith("quantitative") ? "quantitative" : text;
}

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
  const normalized = normalize(requirement);
  const subjectOnly = requirementPattern.exec(normalized);
  const qualified = subjectOnly === null ? levelRequirementPattern.exec(normalized) : null;
  if (subjectOnly === null && qualified === null) return undefined;
  const subjects = new Set(
    subjectOnly === null
      ? [subjectOf(qualified?.[2]), subjectOf(qualified?.[3])]
      : [subjectOnly[1], subjectOnly[2]],
  );
  // A subject-only requirement accepts any level; a bare "degree" counts as bachelor.
  const minimum = Math.min(
    ...(qualified?.[1] ?? "")
      .split(/, or |, | or /u)
      .map((text) => levelOf(text))
      .filter((value): value is Level => value !== undefined),
    3,
  );
  const required = qualified === null ? 1 : minimum;
  return blocks.some((text) =>
    clauses(text).some((clause) => {
      if (uncertainCredential.test(clause)) return false;
      const degree = credentialPattern.exec(clause);
      if (degree === null) return false;
      if (!subjects.has(subjectOf(degree[2]))) return false;
      return (levelOf(degree[1] ?? "") ?? 1) >= required;
    }),
  );
}
