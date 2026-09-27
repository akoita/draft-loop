const multiwordNamePattern = /^\p{L}+(?:[ \t]+\p{L}+)+$/u;

/** Match a multiword name after removing only balanced strong markers around whole words. */
export function supportsInlineStrongMultiwordName(
  evidence: string,
  protectedValue: string,
): boolean {
  const phrase = protectedValue
    .normalize("NFKC")
    .replace(/[ \t]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!multiwordNamePattern.test(phrase)) return false;

  const markedWordPattern = (word: string): string =>
    `(?:(?<![\\\\*\\p{L}\\p{N}])\\*\\*${word}\\*\\*(?![\\*\\p{L}\\p{N}])|${word})`;
  const phrasePattern = new RegExp(
    `(?<![\\*\\p{L}\\p{N}])${phrase
      .split(" ")
      .map(markedWordPattern)
      .join("[ \\t]+")}(?![\\*\\p{L}\\p{N}])`,
    "gu",
  );
  return evidence.split(/\r?\n/u).some((line) => {
    if (line.includes("`")) return false;
    const normalizedLine = line.normalize("NFKC").toLocaleLowerCase("en-US");
    return [...normalizedLine.matchAll(phrasePattern)].some((match) => match[0].includes("**"));
  });
}
