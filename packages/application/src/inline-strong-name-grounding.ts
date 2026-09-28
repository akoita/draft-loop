const multiwordNamePattern = /^\p{L}+(?:[ \t]+\p{L}+)+$/u;
const wordCharacterAtEndPattern = /[\p{L}\p{N}]$/u;
const wordCharacterAtStartPattern = /^[\p{L}\p{N}]/u;

interface StrongLine {
  readonly text: string;
  readonly strongRanges: readonly (readonly [number, number])[];
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

/** Remove balanced inline strong delimiters while retaining their text ranges. */
function parseStrongLine(line: string): StrongLine | undefined {
  if (line.includes("`")) return undefined;

  let text = "";
  let strongStart: number | undefined;
  const strongRanges: [number, number][] = [];
  for (let index = 0; index < line.length; ) {
    if (line[index] !== "*") {
      text += line[index];
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (line[runEnd] === "*") runEnd += 1;
    const runLength = runEnd - index;
    if (runLength > 2) return undefined;
    if (runLength === 1 || isEscaped(line, index)) {
      text += line.slice(index, runEnd);
      index = runEnd;
      continue;
    }

    if (strongStart === undefined) {
      strongStart = text.length;
    } else {
      const strongEnd = text.length;
      if (
        strongStart === strongEnd ||
        /[ \t]$/u.test(text.slice(0, strongEnd)) ||
        /[ \t]/u.test(text.slice(strongStart, strongStart + 1)) ||
        wordCharacterAtEndPattern.test(text.slice(0, strongStart)) ||
        wordCharacterAtStartPattern.test(text.slice(strongEnd))
      ) {
        return undefined;
      }
      strongRanges.push([strongStart, strongEnd]);
      strongStart = undefined;
    }
    index = runEnd;
  }

  if (strongStart !== undefined) return undefined;
  return { text, strongRanges };
}

/** Match a multiword name only when balanced inline strong text marks a word. */
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

  const phrasePattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${phrase.split(" ").join("[ \\t]+")}(?![\\p{L}\\p{N}])`,
    "gu",
  );
  return evidence.split(/\r\n|\n|\r/u).some((line) => {
    const parsed = parseStrongLine(line.normalize("NFKC").toLocaleLowerCase("en-US"));
    if (parsed === undefined) return false;

    for (const match of parsed.text.matchAll(phrasePattern)) {
      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + match[0].length;
      if (
        parsed.strongRanges.some(
          ([strongStart, strongEnd]) => strongStart < matchEnd && strongEnd > matchStart,
        )
      ) {
        return true;
      }
    }
    return false;
  });
}
