import { carlitoBold, carlitoRegular } from "./carlito-font-data.js";
import type { PdfFontFamily } from "./pdf-fonts.js";
import { embeddedFontDraws } from "./pdf-unicode-font.js";
import { winAnsiCode } from "./winansi.js";

/** At most this many characters are named, so a refusal stays readable. */
const namedCharacterLimit = 12;

function drawable(character: string, font: PdfFontFamily): boolean {
  if (font === "helvetica") return winAnsiCode(character) !== null;
  return embeddedFontDraws(character, carlitoRegular) && embeddedFontDraws(character, carlitoBold);
}

/**
 * The characters of `text` the built-in PDF writer cannot draw in `font`, each once, as `U+XXXX`
 * code points in code point order: Helvetica draws WinAnsi only, Carlito every character it has
 * a glyph for (#1829). Whitespace is drawn as a space, so it is never named. A code point names a
 * character, not content, so a refusal may carry it.
 */
export function pdfUndrawableCharacters(
  text: string,
  font: PdfFontFamily = "helvetica",
): readonly string[] {
  const codes = new Set<number>();
  for (const character of text.normalize("NFC")) {
    if (/\s/u.test(character) || drawable(character, font)) continue;
    codes.add(character.codePointAt(0) ?? 0);
  }
  return [...codes]
    .sort((left, right) => left - right)
    .slice(0, namedCharacterLimit)
    .map((code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
}

/** The font a PDF this writer made draws its text in, read from the PDF itself. */
export function builtInPdfFont(content: Uint8Array): PdfFontFamily {
  return /\/BaseFont\s*\/Carlito\b/u.test(new TextDecoder("latin1").decode(content))
    ? "carlito"
    : "helvetica";
}
