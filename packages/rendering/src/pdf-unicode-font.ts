import { inflateSync } from "node:zlib";

import type { EmbeddedFontData, TrueTypeFont } from "./truetype-font.js";
import { parseTrueTypeFont } from "./truetype-font.js";

/**
 * Carlito in a PDF as a Unicode font (#1829): a Type0 font with Identity-H encoding, whose text is
 * written as glyph ids and read back through a ToUnicode map. Every character the font has a glyph
 * for is drawn; one it has none for is drawn as "?" and reads back as "?", so the integrity check
 * still refuses it rather than hiding it.
 */

const parsedFonts = new WeakMap<EmbeddedFontData, TrueTypeFont>();

/** The embedded TrueType file, parsed once per process. */
export function embeddedTrueTypeFont(data: EmbeddedFontData): TrueTypeFont {
  const cached = parsedFonts.get(data);
  if (cached !== undefined) return cached;
  const bytes = new Uint8Array(inflateSync(Buffer.from(data.flateBase64, "base64")));
  const font = parseTrueTypeFont(bytes);
  parsedFonts.set(data, font);
  return font;
}

const space = 0x20;
const replacement = 0x3f;

/**
 * Characters Carlito has no glyph for but draws faithfully with another's: the hyphens Word
 * inserts as the hyphen-minus, the figure and horizontal bars as the dashes they look like. The
 * run then carries the written character as `/ActualText`.
 */
const equivalentGlyphs: Readonly<Record<number, number>> = {
  8208: 0x2d,
  8209: 0x2d,
  8210: 0x2013,
  8213: 0x2014,
};

/** Invisible characters drawn as nothing; the run carries them as `/ActualText`. */
const invisible = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

/**
 * The code point a character is drawn with: its own, an equivalent's, a space for whitespace,
 * null for an invisible character, or "?" when the font has no glyph for it.
 */
function drawnCodePoint(font: TrueTypeFont, character: string): number | null {
  if (/\s/u.test(character)) return space;
  const codePoint = character.codePointAt(0) ?? replacement;
  if (invisible.has(codePoint)) return null;
  if (font.glyphId(codePoint) !== 0) return codePoint;
  const equivalent = equivalentGlyphs[codePoint];
  if (equivalent !== undefined && font.glyphId(equivalent) !== 0) return equivalent;
  return replacement;
}

/** True when the font draws the character with its own glyph, an equivalent, or as nothing. */
function draws(font: TrueTypeFont, character: string): boolean {
  const drawn = drawnCodePoint(font, character);
  return drawn !== replacement || character === "?";
}

/** One glyph a document drew: what it reads back as, and its advance width per 1000 em. */
export interface PdfGlyph {
  readonly glyphId: number;
  readonly text: string;
  readonly width: number;
}

export interface PdfGlyphRun {
  /** The run as Identity-H hex: four digits per glyph. */
  readonly hex: string;
  /**
   * What the run reads back as when a viewer's map differs from the written text, because two
   * characters share a glyph (a non-breaking hyphen drawn with the hyphen). The run then carries it
   * as `/ActualText`. Undefined when the map reads the run back as written.
   */
  readonly actualText?: string;
}

/** The glyphs of one embedded face in one PDF, collected as its runs are written. */
export interface PdfGlyphEncoder {
  readonly encode: (text: string) => PdfGlyphRun;
  /** Every glyph written so far, by ascending id. */
  readonly glyphs: () => readonly PdfGlyph[];
}

export function createPdfGlyphEncoder(data: EmbeddedFontData): PdfGlyphEncoder {
  const font = embeddedTrueTypeFont(data);
  const used = new Map<number, PdfGlyph>();
  const glyphFor = (codePoint: number, text: string): { glyphId: number; readsAs: string } => {
    const glyphId = font.glyphId(codePoint);
    const known = used.get(glyphId);
    if (known === undefined) {
      used.set(glyphId, { glyphId, text, width: font.advanceWidth1000(codePoint) });
      return { glyphId, readsAs: text };
    }
    return { glyphId, readsAs: known.text };
  };
  return {
    encode: (text) => {
      let hex = "";
      let written = "";
      let readBack = "";
      for (const character of text.normalize("NFC")) {
        const codePoint = drawnCodePoint(font, character);
        if (codePoint === null) {
          written += character;
          continue;
        }
        // Whitespace reads back as a space; the integrity check folds every space run to one.
        const shown = codePoint === space ? " " : String.fromCodePoint(codePoint);
        const { glyphId, readsAs } = glyphFor(codePoint, shown);
        hex += glyphId.toString(16).toUpperCase().padStart(4, "0");
        // A character without a glyph is drawn and written as "?", never hidden behind ActualText.
        written += codePoint === replacement ? "?" : codePoint === space ? " " : character;
        readBack += readsAs;
      }
      return readBack === written ? { hex } : { hex, actualText: written };
    },
    glyphs: () => [...used.values()].sort((left, right) => left.glyphId - right.glyphId),
  };
}

/** Advance width of a text run in 1000-unit em space, as `createPdfGlyphEncoder` draws it. */
export function unicodeTextUnits(text: string, data: EmbeddedFontData): number {
  const font = embeddedTrueTypeFont(data);
  let units = 0;
  for (const character of text.normalize("NFC")) {
    const codePoint = drawnCodePoint(font, character);
    if (codePoint !== null) units += font.advanceWidth1000(codePoint);
  }
  return units;
}

/** True when the embedded font draws the character, with its own glyph or an equivalent's. */
export function embeddedFontDraws(character: string, data: EmbeddedFontData): boolean {
  return draws(embeddedTrueTypeFont(data), character);
}

function utf16Hex(text: string): string {
  let hex = "";
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
  }
  return hex;
}

/** A PDF text string for any text: UTF-16BE hex with its byte-order mark. */
export function pdfUnicodeTextString(text: string): string {
  return `<FEFF${utf16Hex(text)}>`;
}

/**
 * The ToUnicode CMap of a face's drawn glyphs: each glyph id reads back as the text it was first
 * drawn for. Written uncompressed, so the inspectors read it as they read the content streams.
 */
export function toUnicodeCMap(glyphs: readonly PdfGlyph[]): string {
  const lines: string[] = [];
  for (let start = 0; start < glyphs.length; start += 100) {
    const chunk = glyphs.slice(start, start + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const glyph of chunk) {
      lines.push(
        `<${glyph.glyphId.toString(16).toUpperCase().padStart(4, "0")}> <${utf16Hex(glyph.text)}>`,
      );
    }
    lines.push("endbfchar");
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    ...lines,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

/** The glyph-id → text map of a ToUnicode CMap, as `toUnicodeCMap` writes one. */
export function parseToUnicodeCMap(cmap: string): ReadonlyMap<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
    for (const pair of (block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/gu)) {
      map.set(Number.parseInt(pair[1] ?? "0", 16), decodeUtf16Hex(pair[2] ?? ""));
    }
  }
  return map;
}

function decodeUtf16Hex(hex: string): string {
  const units: number[] = [];
  for (let index = 0; index + 4 <= hex.length; index += 4) {
    units.push(Number.parseInt(hex.slice(index, index + 4), 16));
  }
  return String.fromCharCode(...units);
}

/** A hex string of Identity-H glyph ids read back through a face's ToUnicode map. */
export function decodeGlyphHex(hex: string, map: ReadonlyMap<number, string>): string {
  const clean = hex.replace(/\s+/gu, "");
  let text = "";
  for (let index = 0; index + 4 <= clean.length; index += 4) {
    text += map.get(Number.parseInt(clean.slice(index, index + 4), 16)) ?? "�";
  }
  return text;
}

/** A PDF text string written as `<FEFF…>` hex, decoded; null for any other hex string. */
export function decodeUnicodeTextString(hex: string): string | null {
  const clean = hex.replace(/\s+/gu, "").toUpperCase();
  return clean.startsWith("FEFF") ? decodeUtf16Hex(clean.slice(4)) : null;
}
