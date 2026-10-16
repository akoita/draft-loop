/**
 * A minimal, dependency-free TrueType reader for the few facts a PDF simple font needs: the
 * advance width of a code point (`cmap` format 4 plus `hmtx`) and the descriptor metrics (`head`,
 * `hhea`, `OS/2`, `post`). It reads only; it never subsets or rewrites a font.
 *
 * Keep this file free of enums and parameter properties: `scripts/generate-carlito-font-module.mjs`
 * loads it through Node's type stripping.
 */

export interface TrueTypeMetrics {
  readonly unitsPerEm: number;
  /** Font bounding box in 1000-unit em space: xMin, yMin, xMax, yMax. */
  readonly bbox: readonly [number, number, number, number];
  /** Typographic ascent and descent (descent is negative), in 1000-unit em space. */
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly italicAngle: number;
  readonly weightClass: number;
}

export interface TrueTypeFont {
  readonly metrics: TrueTypeMetrics;
  /** Advance width of a Unicode code point in 1000-unit em space; the `.notdef` width if unmapped. */
  readonly advanceWidth1000: (codePoint: number) => number;
  /** True when the font has a glyph (not `.notdef`) for the code point. */
  readonly hasGlyph: (codePoint: number) => boolean;
}

/**
 * One embeddable font as the generated data module stores it: the unmodified TrueType file,
 * Flate-compressed and base64-encoded, with the descriptor metrics and the advance widths of
 * WinAnsi codes 32 to 255 (per 1000 em) read from it by this parser.
 */
export interface EmbeddedFontData {
  readonly baseFont: string;
  /** SHA-256 of the uncompressed TrueType file. */
  readonly sha256: string;
  /** Uncompressed length of the TrueType file, for the `/Length1` entry. */
  readonly length1: number;
  readonly bbox: readonly [number, number, number, number];
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly italicAngle: number;
  readonly stemV: number;
  readonly widths: readonly number[];
  readonly flateBase64: string;
}

function fail(message: string): never {
  throw new Error(`Unsupported TrueType font: ${message}`);
}

export function parseTrueTypeFont(bytes: Uint8Array): TrueTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  const tableCount = view.getUint16(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    tables.set(tag, view.getUint32(record + 8));
  }
  const table = (tag: string): number => tables.get(tag) ?? fail(`missing ${tag} table`);

  const head = table("head");
  const unitsPerEm = view.getUint16(head + 18);
  if (unitsPerEm === 0) fail("unitsPerEm is zero");
  const scale = (value: number): number => Math.round((value * 1000) / unitsPerEm);

  const hhea = table("hhea");
  const hmtx = table("hmtx");
  const numberOfHMetrics = view.getUint16(hhea + 34);
  if (numberOfHMetrics === 0) fail("no horizontal metrics");
  const advanceOfGlyph = (glyph: number): number =>
    view.getUint16(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1));

  const os2 = table("OS/2");
  const os2Version = view.getUint16(os2);
  const post = table("post");

  // cmap: prefer Windows Unicode BMP (3,1); format 4 is the only subtable read.
  const cmap = table("cmap");
  let subtable = -1;
  for (let index = 0; index < view.getUint16(cmap + 2); index += 1) {
    const record = cmap + 4 + index * 8;
    if (view.getUint16(record) === 3 && view.getUint16(record + 2) === 1) {
      subtable = cmap + view.getUint32(record + 4);
    }
  }
  if (subtable < 0 || view.getUint16(subtable) !== 4) fail("no format 4 (3,1) cmap subtable");
  const segmentCount = view.getUint16(subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const idDeltas = startCodes + segmentCount * 2;
  const idRangeOffsets = idDeltas + segmentCount * 2;

  const glyphOf = (codePoint: number): number => {
    if (codePoint > 0xffff) return 0;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      if (codePoint > view.getUint16(endCodes + segment * 2)) continue;
      const start = view.getUint16(startCodes + segment * 2);
      if (codePoint < start) return 0;
      const rangeOffset = view.getUint16(idRangeOffsets + segment * 2);
      const delta = view.getUint16(idDeltas + segment * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const address = idRangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2;
      const glyph = view.getUint16(address);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };

  return {
    metrics: {
      unitsPerEm,
      bbox: [
        scale(view.getInt16(head + 36)),
        scale(view.getInt16(head + 38)),
        scale(view.getInt16(head + 40)),
        scale(view.getInt16(head + 42)),
      ],
      ascent: scale(view.getInt16(hhea + 4)),
      descent: scale(view.getInt16(hhea + 6)),
      capHeight: os2Version >= 2 ? scale(view.getInt16(os2 + 88)) : scale(view.getInt16(hhea + 4)),
      italicAngle: view.getInt32(post + 4) / 65536,
      weightClass: view.getUint16(os2 + 4),
    },
    advanceWidth1000: (codePoint) => scale(advanceOfGlyph(glyphOf(codePoint))),
    hasGlyph: (codePoint) => glyphOf(codePoint) !== 0,
  };
}
