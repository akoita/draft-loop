import { winAnsiCode } from "./winansi.js";

/** At most this many characters are named, so a refusal stays readable. */
const namedCharacterLimit = 12;

/**
 * The characters of `text` the built-in PDF writer cannot draw, each once, as `U+XXXX` code points
 * in code point order. Whitespace is drawn as a space, so it is never named. A code point names a
 * character, not content, so a refusal may carry it.
 */
export function pdfUndrawableCharacters(text: string): readonly string[] {
  const codes = new Set<number>();
  for (const character of text.normalize("NFC")) {
    if (/\s/u.test(character) || winAnsiCode(character) !== null) continue;
    codes.add(character.codePointAt(0) ?? 0);
  }
  return [...codes]
    .sort((left, right) => left - right)
    .slice(0, namedCharacterLimit)
    .map((code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
}
