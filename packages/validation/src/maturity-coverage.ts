/** A closed qualifier vocabulary, not a taxonomy of company stages. */
const maturityVocabulary = [
  "early stage",
  "seed stage",
  "pre seed",
  "series a",
  "series b",
  "series c",
  "growth stage",
  "late stage",
  "scale up",
  "startup stage",
] as const;

const maturityPatterns = new Map<string, RegExp>(
  maturityVocabulary.map((qualifier) => [
    qualifier,
    new RegExp(`(?<![\\p{L}\\p{N}])${qualifier}(?![\\p{L}\\p{N}])`, "u"),
  ]),
);

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-‐‑–—−_]/gu, " ")
    .replace(/(?<![\p{L}\p{N}])scaleups?(?![\p{L}\p{N}])/gu, "scale up")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Undefined means the requirement states no organisation-maturity qualifier and
 * ordinary matching applies unchanged. A recognized qualifier must be stated
 * literally; stage is never inferred from headcount, funding, or organisation
 * type, so `startup` alone is an organisation type rather than a qualifier.
 */
export function requiredMaturityQualifiers(requirement: string): readonly string[] | undefined {
  const normalized = normalize(requirement);
  const stated = maturityVocabulary.filter((qualifier) =>
    maturityPatterns.get(qualifier)?.test(normalized),
  );
  return stated.length === 0 ? undefined : stated;
}

/** The qualifier must appear in the same block that matches the requirement. */
export function blockStatesMaturityQualifiers(block: string, required: readonly string[]): boolean {
  const normalized = normalize(block);
  return required.every((qualifier) => maturityPatterns.get(qualifier)?.test(normalized) === true);
}
