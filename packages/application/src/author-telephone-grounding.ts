const internationalPhoneShape = /^\s*\+[ \t]*[0-9][0-9 \t()-]*\s*$/u;

function phoneDigits(value: string): string | undefined {
  if (!internationalPhoneShape.test(value)) return undefined;
  const digits = value.replace(/[^0-9]/gu, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : undefined;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Decide whether an international phone-only claim is supported by one cited
 * chunk. `undefined` means the claim is outside this deliberately narrow rule.
 */
export function supportsInternationalPhoneClaim(
  claimText: string,
  citedChunks: readonly string[],
): boolean | undefined {
  const digits = phoneDigits(claimText);
  if (digits === undefined) return undefined;

  const literal = escapePattern(claimText.trim().normalize("NFKC"));
  const numberPattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${literal}(?![ \\t()-]*[0-9])(?![\\p{L}\\p{N}])`,
    "u",
  );
  return citedChunks.some((chunk) => numberPattern.test(chunk.normalize("NFKC")));
}
