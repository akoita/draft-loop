const symbolicPercentagePattern = /^(\d+(?:[.,]\d+)*)%$/u;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Accept only the bounded `N percent` -> `N%` spelling demonstrated by the replay corpus. */
export function supportsProtectedValueParaphrase(
  evidence: string,
  protectedValue: string,
): boolean {
  const match = symbolicPercentagePattern.exec(protectedValue.normalize("NFKC"));
  const quantity = match?.[1];
  if (quantity === undefined) return false;

  const evidenceEquivalent = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapePattern(quantity)}\\s+percent(?![\\p{L}\\p{N}-])`,
    "iu",
  );
  return evidenceEquivalent.test(evidence.normalize("NFKC"));
}
