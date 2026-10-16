import { carlitoBold, carlitoRegular } from "./carlito-font-data.js";
import type { EmbeddedFontData } from "./truetype-font.js";
import { winAnsiCode } from "./winansi.js";

/**
 * The PDF fonts a layout profile can ask for. Helvetica is one of the 14 standard fonts and
 * needs no embedding; Carlito (metric-compatible with Calibri) is embedded in full from the
 * vendored data module.
 */
export type PdfFontFamily = "helvetica" | "carlito";

export interface EmbeddedPdfFonts {
  readonly regular: EmbeddedFontData;
  readonly bold: EmbeddedFontData;
}

/** The embedded faces for a family, or null for a standard font that needs no embedding. */
export function embeddedPdfFonts(font: PdfFontFamily): EmbeddedPdfFonts | null {
  return font === "carlito" ? { regular: carlitoRegular, bold: carlitoBold } : null;
}

/** The compressed TrueType file exactly as the PDF stores it in `/FontFile2`. */
export function embeddedFontFlateBytes(data: EmbeddedFontData): Uint8Array {
  return new Uint8Array(Buffer.from(data.flateBase64, "base64"));
}

/** Advance width of a text run in 1000-unit em space for an embedded font. */
export function embeddedTextUnits(text: string, data: EmbeddedFontData): number {
  const fallback = data.widths[0x3f - 32] ?? 500;
  let units = 0;
  for (const character of text.normalize("NFC")) {
    const code = winAnsiCode(character);
    if (code !== null) units += data.widths[code - 32] ?? fallback;
    else units += /\s/u.test(character) ? (data.widths[0] ?? fallback) : fallback;
  }
  return units;
}
