import type { DraftArtifact } from "@draft-loop/schemas";
import type { RenderingTemplate } from "@draft-loop/schemas/rendering-template";

import {
  blockLines,
  type LayoutBlock,
  labelledLayout,
  layoutBlocks,
  layoutMetrics,
  profilePdfFont,
  roleHasSpaceBefore,
  roleHeaderLines,
  textWidthPt,
  wrapTextToWidth,
} from "./document-layout.js";
import type { RenderingLayoutProfile } from "./index.js";
import { type EmbeddedPdfFonts, embeddedFontFlateBytes, embeddedPdfFonts } from "./pdf-fonts.js";
import { tagPdfCommands } from "./pdf-run-recovery.js";
import {
  createPdfGlyphEncoder,
  decodeGlyphHex,
  decodeUnicodeTextString,
  embeddedFontDraws,
  type PdfGlyphEncoder,
  parseToUnicodeCMap,
  pdfUnicodeTextString,
  toUnicodeCMap,
} from "./pdf-unicode-font.js";
import type { EmbeddedFontData } from "./truetype-font.js";
import { winAnsiCode, windows1252Characters } from "./winansi.js";

/**
 * A dependency-free PDF of the same layout the DOCX uses: text in the profile's font (bold for the
 * title and headings), a rule under each heading, hanging bullets and the profile's A4 margins,
 * drawn with the template's look (#1791): the name's alignment, heading case and colours, the
 * rule's colour, accent-coloured dates, justified text and a slanted context line under a role.
 * Carlito is embedded in full as a Unicode font: its text is written as glyph ids and read back
 * through a ToUnicode map, so every character Carlito has a glyph for survives (#1829). Helvetica
 * is the unembedded standard font, written in WinAnsi, so Latin accents and common punctuation
 * survive there. A character the font cannot draw is written as "?" in either.
 */

const pointsPerMillimeter = 72 / 25.4;

function octal(code: number): string {
  return `\\${code.toString(8).padStart(3, "0")}`;
}

function pdfLiteral(value: string): string {
  let result = "";
  for (const character of value.normalize("NFC")) {
    const code = winAnsiCode(character);
    if (code === null) {
      result += /\s/u.test(character) ? " " : "?";
    } else if (character === "\\" || character === "(" || character === ")") {
      result += `\\${character}`;
    } else if (code >= 0x20 && code <= 0x7e) {
      result += character;
    } else {
      result += octal(code);
    }
  }
  return result;
}

/** A text string for the document's metadata: a literal when WinAnsi holds it, else Unicode. */
function pdfTextString(value: string): string {
  const text = value.normalize("NFC");
  return [...text].every((character) => winAnsiCode(character) !== null)
    ? `(${pdfLiteral(text)})`
    : pdfUnicodeTextString(text);
}

/** Decode the escapes of one PDF literal string written in WinAnsi back to text. */
export function decodePdfLiteralEscapes(value: string): string {
  return value.replace(/\\([0-7]{1,3}|[\s\S])/gu, (_, escaped: string) => {
    if (/^[0-7]+$/u.test(escaped)) {
      const code = Number.parseInt(escaped, 8);
      return windows1252Characters.get(code) ?? String.fromCodePoint(code);
    }
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      default:
        return escaped;
    }
  });
}

/** The ToUnicode map of each font resource name (`F1`, …) of a PDF, by its objects. */
export function pdfFontUnicodeMaps(
  objects: ReadonlyMap<number, string>,
): ReadonlyMap<string, ReadonlyMap<number, string>> {
  const maps = new Map<string, ReadonlyMap<number, string>>();
  for (const body of objects.values()) {
    const resources = /\/Font\s*<<([^>]*)>>/u.exec(body)?.[1];
    if (resources === undefined) continue;
    for (const entry of resources.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/gu)) {
      const font = objects.get(Number(entry[2]));
      const cmapId = font === undefined ? null : /\/ToUnicode\s+(\d+)\s+0\s+R/u.exec(font)?.[1];
      if (cmapId === null || cmapId === undefined) continue;
      const cmap = /\bstream\s*\r?\n([\s\S]*?)\r?\nendstream\b/u.exec(
        objects.get(Number(cmapId)) ?? "",
      )?.[1];
      if (cmap !== undefined) maps.set(entry[1] ?? "", parseToUnicodeCMap(cmap));
    }
    break;
  }
  return maps;
}

/**
 * One text-showing operand of our content streams, the way a viewer reads it: a WinAnsi literal,
 * a hex string of glyph ids read through the font's ToUnicode map, or a `TJ` array of those.
 */
export const pdfShownTextPattern =
  /(?:\(((?:\\.|[^()])*)\)\s*Tj|<([0-9A-Fa-f\s]*)>\s*Tj|\[((?:\s*(?:<[0-9A-Fa-f\s]*>|[-+]?\d+(?:\.\d+)?))*)\s*\]\s*TJ)/gu;

/** The text of one `pdfShownTextPattern` match, read with the font it is shown in. */
export function decodePdfShownText(
  match: RegExpMatchArray,
  map: ReadonlyMap<number, string> | undefined,
): string {
  if (match[1] !== undefined) return decodePdfLiteralEscapes(match[1]);
  const glyphs =
    match[2] ??
    [...(match[3] ?? "").matchAll(/<([0-9A-Fa-f\s]*)>/gu)].map((part) => part[1]).join("");
  return decodeGlyphHex(glyphs, map ?? new Map());
}

/** The text an `/ActualText` operand carries: a WinAnsi literal or a `<FEFF…>` Unicode string. */
export function decodePdfActualText(operand: string): string {
  if (operand.startsWith("(")) return decodePdfLiteralEscapes(operand.slice(1, -1));
  return decodeUnicodeTextString(operand.slice(1, -1)) ?? "";
}

interface PlacedLine {
  readonly commands: string;
}

function toPoints(millimeters: number): number {
  return millimeters * pointsPerMillimeter;
}

function fixed(value: number): string {
  return value.toFixed(4);
}

/** What the template draws beyond the profile's metrics, as the print CSS and the DOCX draw it. */
interface PdfLook {
  readonly nameAlign: "center" | "left";
  /** Fill colours as PDF `rg` operands; null draws in black. */
  readonly nameColor: string | null;
  readonly contactColor: string | null;
  readonly accentColor: string | null;
  /** The heading rule's stroke colour; null draws no rule. */
  readonly ruleColor: string;
  readonly rule: boolean;
  readonly headingCaps: boolean;
  readonly justify: boolean;
  readonly italicContext: boolean;
}

function rgb(hex: string): string {
  const value = Number.parseInt(hex.replace(/^#/u, ""), 16);
  return [16, 8, 0].map((shift) => fixed(((value >> shift) & 0xff) / 255)).join(" ");
}

function pdfLook(template: RenderingTemplate | undefined): PdfLook {
  const accent = template?.accentColor ?? null;
  return {
    nameAlign: template?.name.align ?? "center",
    nameColor: accent === null ? null : rgb("#1b2329"),
    contactColor: accent === null ? null : rgb("#3b4852"),
    accentColor: accent === null ? null : rgb(accent),
    ruleColor: rgb(template?.headings.ruleColor ?? "#94a3ad"),
    rule: template?.headings.rule ?? true,
    headingCaps: template?.headings.case === "uppercase",
    justify: template?.body.align === "justify",
    italicContext: template?.roles.contextStyle === "italic",
  };
}

/** Uppercase drawn text keeps the text as written for extraction, as the DOCX `caps` does. */
function actualText(written: string, commands: string, unicode = false): string {
  const operand = unicode ? pdfUnicodeTextString(written) : `(${pdfLiteral(written)})`;
  return `/Span << /ActualText ${operand} >> BDC ${commands} EMC`;
}

/** The faces a document draws in, with the glyphs each has written so far. */
interface PdfGlyphFaces {
  readonly regular: PdfGlyphEncoder;
  readonly bold: PdfGlyphEncoder;
  readonly fonts: EmbeddedPdfFonts;
}

/** A run's glyphs as a `Tj` operand, or a `TJ` array that widens each space by `spacing` em. */
function glyphOperand(hex: string, spaceHex: string, spacingThousandths: number): string {
  if (spacingThousandths === 0) return `<${hex}> Tj`;
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < hex.length; index += 4) {
    const glyph = hex.slice(index, index + 4);
    current += glyph;
    if (glyph === spaceHex) {
      parts.push(`<${current}> ${fixed(-spacingThousandths)}`);
      current = "";
    }
  }
  if (current !== "") parts.push(`<${current}>`);
  return `[${parts.join(" ")}] TJ`;
}

const contextSlant = 0.2;

function pageCommands(
  profile: RenderingLayoutProfile,
  blocks: readonly LayoutBlock[],
  look: PdfLook = pdfLook(undefined),
  faces: PdfGlyphFaces | null = null,
) {
  const metrics = layoutMetrics(profile);
  const pageWidth = toPoints(profile.pageWidthMm);
  const pageHeight = toPoints(profile.pageHeightMm);
  const left = toPoints(profile.marginsMm.left);
  const right = pageWidth - toPoints(profile.marginsMm.right);
  const top = pageHeight - toPoints(profile.marginsMm.top);
  const bottom = toPoints(profile.marginsMm.bottom);
  const body = profile.typography.bodyFontSizePt;
  const bodyLine = profile.lineMetricsPt.body;
  const bulletPrefix = "• ";
  const font = profilePdfFont(profile);
  const bulletTextOffset = textWidthPt(bulletPrefix, body, false, font);

  const pages: PlacedLine[][] = [[]];
  let y = top;
  const atPageTop = (): boolean => y === top;
  const startPage = (): void => {
    pages.push([]);
    y = top;
  };
  const place = (commands: string): void => {
    pages.at(-1)?.push({ commands });
  };
  const text = (
    font: "F1" | "F2" | "F3",
    size: number,
    x: number,
    baseline: number,
    value: string,
    style: {
      readonly color?: string | null;
      readonly wordSpacing?: number;
      /** The text as written, when the drawn text differs from it (a capitalised heading). */
      readonly written?: string;
    } = {},
  ) => {
    const color = style.color === undefined || style.color === null ? "" : `${style.color} rg `;
    const wordSpacing = style.wordSpacing ?? 0;
    if (faces === null) {
      const spacing = wordSpacing === 0 ? "" : `${fixed(wordSpacing)} Tw `;
      const run = `BT ${color}/${font} ${size} Tf ${spacing}1 0 0 1 ${fixed(x)} ${fixed(baseline)} Tm (${pdfLiteral(value)}) Tj ET`;
      // Fill colour and word spacing outlive ET, so a styled run restores the state it changed.
      const restored = color === "" && spacing === "" ? run : `q ${run} Q`;
      return style.written === undefined || style.written === value
        ? restored
        : actualText(style.written, restored);
    }
    // Word spacing applies only to one-byte codes, so a glyph-id run widens its spaces in `TJ`.
    const face = font === "F1" ? faces.regular : faces.bold;
    const glyphs = face.encode(value);
    const spaceHex = face.encode(" ").hex;
    const operand = glyphOperand(glyphs.hex, spaceHex, (wordSpacing * 1000) / size);
    const run = `BT ${color}/${font} ${size} Tf 1 0 0 1 ${fixed(x)} ${fixed(baseline)} Tm ${operand} ET`;
    const restored = color === "" ? run : `q ${run} Q`;
    const data = font === "F1" ? faces.fonts.regular : faces.fonts.bold;
    const written =
      style.written === undefined || style.written === value
        ? glyphs.actualText
        : drawableText(style.written, data);
    return written === undefined ? restored : actualText(written, restored, true);
  };
  /** A line's left edge under the name's alignment. */
  const aligned = (width: number): number =>
    look.nameAlign === "left" ? left : Math.max(left, (left + right - width) / 2);
  /** The word spacing that fills a justified line to `width`; the last line keeps its own. */
  const justified = (line: string, x: number, isLast: boolean): number => {
    if (!look.justify || isLast) return 0;
    const spaces = line.split(" ").length - 1;
    if (spaces === 0) return 0;
    const extra = right - x - textWidthPt(line, body, false, font);
    return extra > 0 ? extra / spaces : 0;
  };
  /** A slanted run about its own baseline, so its start stays where it is placed. */
  const slanted = (baseline: number, commands: string): string =>
    `q 1 0 ${fixed(contextSlant)} 1 ${fixed(-contextSlant * baseline)} 0 cm ${commands} Q`;

  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    if (block.kind === "title") {
      const wrapped = wrapTextToWidth(
        block.text,
        right - left,
        metrics.titleSizePt,
        true,
        Number.POSITIVE_INFINITY,
        font,
      );
      for (const line of wrapped) {
        if (y - metrics.titleLinePt < bottom && !atPageTop()) startPage();
        const width = textWidthPt(line, metrics.titleSizePt, true, font);
        // Tagged so the lines of a wrapped title read back as the one block they are.
        place(
          tagPdfCommands(
            "title",
            text("F2", metrics.titleSizePt, aligned(width), y - metrics.titleSizePt, line, {
              color: look.nameColor,
            }),
          ),
        );
        y -= metrics.titleLinePt;
      }
      y -= metrics.titleAfterPt;
      return;
    }
    if (block.kind === "contact") {
      const lines = blockLines(block, profile);
      // A one-line "Label: text" contact line keeps its bold label, as a body line does.
      const labelled =
        lines.length === 1
          ? labelledLayout({ kind: "paragraph", text: block.text }, profile)
          : null;
      if (labelled !== null && labelled.laterLines.length === 0 && labelled.firstRest !== "") {
        if (y - bodyLine < bottom && !atPageTop()) startPage();
        const labelWidth = textWidthPt(labelled.label, body, true, font);
        const gap = textWidthPt(" ", body, false, font);
        const width = labelWidth + gap + textWidthPt(labelled.firstRest, body, false, font);
        const x = aligned(width);
        const color = { color: look.contactColor };
        place(tagPdfCommands("label", text("F3", body, x, y - body, labelled.label, color)));
        place(text("F1", body, x + labelWidth + gap, y - body, labelled.firstRest, color));
        y -= bodyLine;
      } else {
        for (const line of lines) {
          if (y - bodyLine < bottom && !atPageTop()) startPage();
          const width = textWidthPt(line, body, false, font);
          place(text("F1", body, aligned(width), y - body, line, { color: look.contactColor }));
          y -= bodyLine;
        }
      }
      y -= metrics.contactAfterPt;
      return;
    }
    if (block.kind === "heading") {
      const headingLine = profile.lineMetricsPt.heading;
      const needed =
        metrics.headingBeforePt +
        headingLine +
        metrics.headingAfterPt +
        (next === undefined ? 0 : bodyLine);
      if (y - needed < bottom && !atPageTop()) startPage();
      if (!atPageTop()) y -= metrics.headingBeforePt;
      const heading = profile.typography.headingFontSizePt;
      const baseline = y - heading;
      const drawn = look.headingCaps ? block.text.toLocaleUpperCase() : block.text;
      place(
        text("F2", heading, left, baseline, drawn, {
          color: look.accentColor,
          written: block.text,
        }),
      );
      const ruleY = baseline - 3;
      if (look.rule) {
        place(
          `q 0.5 w ${look.ruleColor} RG ${fixed(left)} ${fixed(ruleY)} m ${fixed(right)} ${fixed(ruleY)} l S Q`,
        );
      }
      y -= headingLine + metrics.headingAfterPt;
      return;
    }
    if (block.kind === "role") {
      const { lines, date } = roleHeaderLines(block, profile);
      const before =
        !atPageTop() && roleHasSpaceBefore(blocks[index - 1]) ? metrics.roleBeforePt : 0;
      // Keep a role header with the first line of its bullets rather than ending a page on it.
      const needed = before + lines.length * bodyLine + metrics.blockAfterPt + bodyLine;
      if (y - needed < bottom && !atPageTop()) startPage();
      else y -= before;
      lines.forEach((line, lineIndex) => {
        if (y - bodyLine < bottom && !atPageTop()) startPage();
        place(text("F3", body, left, y - body, line));
        if (date !== null && lineIndex === lines.length - 1) {
          const dateX = right - textWidthPt(date, body, false, font);
          place(text("F1", body, dateX, y - body, date, { color: look.accentColor }));
        }
        y -= bodyLine;
      });
      y -= metrics.blockAfterPt;
      return;
    }
    if (block.kind === "compact") {
      // One wrapped paragraph; the tag lets the inspectors split it back into its bullets.
      for (const line of blockLines(block, profile)) {
        if (y - bodyLine < bottom && !atPageTop()) startPage();
        place(tagPdfCommands("compact", text("F1", body, left, y - body, line)));
        y -= bodyLine;
      }
      y -= metrics.blockAfterPt;
      return;
    }
    const labelled = labelledLayout(block, profile);
    if (labelled !== null) {
      const isBullet = block.kind === "bullet";
      const textX = isBullet ? left + bulletTextOffset : left;
      const lineCount = 1 + labelled.laterLines.length;
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        if (y - bodyLine < bottom && !atPageTop()) startPage();
        if (lineIndex === 0) {
          if (isBullet) place(text("F1", body, left, y - body, bulletPrefix));
          place(tagPdfCommands("label", text("F3", body, textX, y - body, labelled.label)));
          if (labelled.firstRest !== "") {
            const restX =
              textX +
              textWidthPt(labelled.label, body, true, font) +
              textWidthPt(" ", body, false, font);
            const wordSpacing = justified(labelled.firstRest, restX, lineCount === 1);
            place(text("F1", body, restX, y - body, labelled.firstRest, { wordSpacing }));
          }
        } else {
          const line = labelled.laterLines[lineIndex - 1] ?? "";
          const wordSpacing = justified(line, textX, lineIndex === lineCount - 1);
          place(text("F1", body, textX, y - body, line, { wordSpacing }));
        }
        y -= bodyLine;
      }
      y -= metrics.blockAfterPt;
      return;
    }
    const lines = blockLines(block, profile);
    // The line under a role header, as the print CSS slants it; the PDF embeds no italic face.
    const context = look.italicContext && blocks[index - 1]?.kind === "role";
    lines.forEach((line, lineIndex) => {
      if (y - bodyLine < bottom && !atPageTop()) startPage();
      const isLast = lineIndex === lines.length - 1;
      if (block.kind === "bullet") {
        const x = left + bulletTextOffset;
        const wordSpacing = justified(line, x, isLast);
        if (lineIndex === 0 && wordSpacing === 0) {
          place(text("F1", body, left, y - body, `${bulletPrefix}${line}`));
        } else {
          // Word spacing would also widen the gap after the bullet, so it is drawn on its own.
          if (lineIndex === 0) place(text("F1", body, left, y - body, bulletPrefix));
          place(text("F1", body, x, y - body, line, { wordSpacing }));
        }
      } else {
        const commands = text("F1", body, left, y - body, line, {
          wordSpacing: justified(line, left, isLast),
          ...(context ? { color: rgb("#4a5560") } : {}),
        });
        place(context ? slanted(y - body, commands) : commands);
      }
      y -= bodyLine;
    });
    y -= metrics.blockAfterPt;
  });
  return pages;
}

export interface PdfRenderInput {
  readonly artifact: DraftArtifact;
  readonly profile: RenderingLayoutProfile;
  /** The template whose look the PDF draws; without one it draws Classic's. */
  readonly template?: RenderingTemplate;
  readonly documentTitle: string;
  readonly generatedAt: string | undefined;
}

type PdfObjectBody = string | Uint8Array;

const textEncoder = new TextEncoder();

function encode(value: PdfObjectBody): Uint8Array {
  return typeof value === "string" ? textEncoder.encode(value) : value;
}

/** A stream object whose bytes are binary and must be counted, never measured as characters. */
function streamObject(dictionary: string, data: Uint8Array): Uint8Array {
  return concatenate([
    encode(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    encode("\nendstream"),
  ]);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Text as a face reads it back: a character the font has no glyph for becomes "?". */
function drawableText(text: string, data: EmbeddedFontData): string {
  let result = "";
  for (const character of text.normalize("NFC")) {
    result += embeddedFontDraws(character, data) ? character : "?";
  }
  return result;
}

/** The five objects of one embedded face, at `firstId` to `firstId + 4`: Type0 font first. */
function unicodeFontObjects(
  firstId: number,
  data: EmbeddedFontData,
  encoder: PdfGlyphEncoder,
): readonly PdfObjectBody[] {
  const [cidFontId, cmapId, descriptorId, fileId] = [1, 2, 3, 4].map((offset) => firstId + offset);
  const glyphs = encoder.glyphs();
  const widths = glyphs.map((glyph) => `${glyph.glyphId} [${glyph.width}]`).join(" ");
  const cmap = toUnicodeCMap(glyphs);
  return [
    `<< /Type /Font /Subtype /Type0 /BaseFont /${data.baseFont} /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${cmapId} 0 R >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${data.baseFont} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /W [${widths}] /CIDToGIDMap /Identity >>`,
    // The CMap is ASCII, so its length in characters is its byte count.
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
    // Flags 32 is "nonsymbolic": the font draws the Latin text a CV holds.
    `<< /Type /FontDescriptor /FontName /${data.baseFont} /Flags 32 /FontBBox [${data.bbox.join(" ")}] /ItalicAngle ${data.italicAngle} /Ascent ${data.ascent} /Descent ${data.descent} /CapHeight ${data.capHeight} /StemV ${data.stemV} /FontFile2 ${fileId} 0 R >>`,
    streamObject(`/Filter /FlateDecode /Length1 ${data.length1}`, embeddedFontFlateBytes(data)),
  ];
}

export function buildPdf(input: PdfRenderInput): Uint8Array {
  const { artifact, profile } = input;
  const pageWidth = toPoints(profile.pageWidthMm);
  const pageHeight = toPoints(profile.pageHeightMm);
  const embedded = embeddedPdfFonts(profilePdfFont(profile));
  const faces =
    embedded === null
      ? null
      : {
          regular: createPdfGlyphEncoder(embedded.regular),
          bold: createPdfGlyphEncoder(embedded.bold),
          fonts: embedded,
        };
  const pages = pageCommands(
    profile,
    layoutBlocks(artifact, profile),
    pdfLook(input.template),
    faces,
  );

  const objects: PdfObjectBody[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  if (embedded === null || faces === null) {
    objects[3] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  } else {
    // F1 is object 3 and F2 is object 4; F3, the role-header bold, reuses object 4 so the bold
    // font file is embedded once. Each face's CID font, ToUnicode map, descriptor and font file
    // follow: the regular's as 5 to 8, the bold's as 9 to 12.
    const [regularFont, ...regularParts] = unicodeFontObjects(4, embedded.regular, faces.regular);
    const [boldFont, ...boldParts] = unicodeFontObjects(8, embedded.bold, faces.bold);
    objects[3] = regularFont ?? "";
    objects[4] = boldFont ?? "";
    regularParts.forEach((part, index) => {
      objects[5 + index] = part;
    });
    boldParts.forEach((part, index) => {
      objects[9 + index] = part;
    });
  }
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = page.map((line) => line.commands).join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(pageWidth)} ${fixed(pageHeight)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    // Page content is ASCII (non-ASCII text is octal-escaped), so its length is a byte count.
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const infoId = objects.length;
  const createdDate = input.generatedAt
    ? input.generatedAt.replace(/[-:TZ.]/gu, "").slice(0, 14)
    : "20260813120000";
  objects[infoId] =
    `<< /Title ${pdfTextString(input.documentTitle)} /Author (DraftLoop) /Creator (DraftLoop CV Engine) /CreationDate (D:${createdDate}Z) >>`;

  // Built as byte chunks: font files are binary, so xref offsets must count bytes, not characters.
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const append = (value: PdfObjectBody): void => {
    const bytes = encode(value);
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  append("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = byteLength;
    append(`${index} 0 obj\n`);
    append(objects[index] ?? "");
    append("\nendobj\n");
  }
  const xrefOffset = byteLength;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  append(xref);
  return concatenate(chunks);
}

/** One text run of a PDF this writer made, as a viewer reads it. */
export interface PdfTextRunRead {
  /** The font resource it is shown in, such as `F1`. */
  readonly font: string;
  /** Our marked-content tag around it, such as `DLLabel`, or null. */
  readonly marked: string | null;
  /** The drawn text, read through the font's ToUnicode map (or WinAnsi). */
  readonly text: string;
  /** The `/ActualText` it carries, when the drawn text differs from the written one. */
  readonly actualText: string | null;
  /** Its content-stream line, for checks on how it is drawn. */
  readonly line: string;
}

/** The text runs of a PDF this writer made, in content order, as a viewer reads them. */
export function readPdfTextRuns(content: Uint8Array): readonly PdfTextRunRead[] {
  const raw = new TextDecoder("latin1").decode(content);
  const objects = new Map<number, string>();
  for (const match of raw.matchAll(/\b(\d+)\s+0\s+obj\s*([\s\S]*?)\bendobj\b/gu)) {
    objects.set(Number(match[1]), match[2] ?? "");
  }
  const maps = pdfFontUnicodeMaps(objects);
  const runs: PdfTextRunRead[] = [];
  for (const line of raw.split("\n")) {
    for (const match of line.matchAll(pdfShownTextPattern)) {
      const prefix = line.slice(0, match.index ?? 0);
      const font = [...prefix.matchAll(/\/(F\d+)\s+[-+]?\d+(?:\.\d+)?\s+Tf/gu)].at(-1)?.[1];
      if (font === undefined) continue;
      const actual = /\/ActualText (\((?:\\.|[^()])*\)|<[0-9A-Fa-f]*>) >> BDC/u.exec(prefix)?.[1];
      runs.push({
        font,
        marked: /^\/(DL\w+) BMC /u.exec(line)?.[1] ?? null,
        text: decodePdfShownText(match, maps.get(font)),
        actualText: actual === undefined ? null : decodePdfActualText(actual),
        line,
      });
    }
  }
  return runs;
}
