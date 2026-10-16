import type { DraftArtifact } from "@draft-loop/schemas";

import {
  blockLines,
  type LayoutBlock,
  layoutBlocks,
  layoutMetrics,
  profilePdfFont,
  textWidthPt,
  wrapTextToWidth,
} from "./document-layout.js";
import type { RenderingLayoutProfile } from "./index.js";
import { embeddedFontFlateBytes, embeddedPdfFonts } from "./pdf-fonts.js";
import type { EmbeddedFontData } from "./truetype-font.js";
import { winAnsiCode, windows1252Characters } from "./winansi.js";

/**
 * A dependency-free PDF of the same layout the DOCX uses: text in the profile's font (bold for the
 * title and headings), a rule under each heading, hanging bullets and the profile's A4 margins.
 * Carlito is embedded in full as a TrueType simple font; Helvetica is the unembedded standard
 * font. Text is written in WinAnsi, so Latin accents and common punctuation survive; characters
 * outside it are written as "?" because neither font setup can draw them.
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

interface PlacedLine {
  readonly commands: string;
}

function toPoints(millimeters: number): number {
  return millimeters * pointsPerMillimeter;
}

function fixed(value: number): string {
  return value.toFixed(4);
}

function pageCommands(profile: RenderingLayoutProfile, blocks: readonly LayoutBlock[]) {
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
  const text = (font: "F1" | "F2", size: number, x: number, baseline: number, value: string) =>
    `BT /${font} ${size} Tf 1 0 0 1 ${fixed(x)} ${fixed(baseline)} Tm (${pdfLiteral(value)}) Tj ET`;

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
        const x = Math.max(left, (left + right - width) / 2);
        place(text("F2", metrics.titleSizePt, x, y - metrics.titleSizePt, line));
        y -= metrics.titleLinePt;
      }
      y -= metrics.titleAfterPt;
      return;
    }
    if (block.kind === "contact") {
      for (const line of blockLines(block, profile)) {
        if (y - bodyLine < bottom && !atPageTop()) startPage();
        const width = textWidthPt(line, body, false, font);
        const x = Math.max(left, (left + right - width) / 2);
        place(text("F1", body, x, y - body, line));
        y -= bodyLine;
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
      place(text("F2", heading, left, baseline, block.text));
      const ruleY = baseline - 3;
      place(
        `q 0.5 w 0.58 0.64 0.68 RG ${fixed(left)} ${fixed(ruleY)} m ${fixed(right)} ${fixed(ruleY)} l S Q`,
      );
      y -= headingLine + metrics.headingAfterPt;
      return;
    }
    const lines = blockLines(block, profile);
    lines.forEach((line, lineIndex) => {
      if (y - bodyLine < bottom && !atPageTop()) startPage();
      if (block.kind === "bullet") {
        const value = lineIndex === 0 ? `${bulletPrefix}${line}` : line;
        const x = lineIndex === 0 ? left : left + bulletTextOffset;
        place(text("F1", body, x, y - body, value));
      } else {
        place(text("F1", body, left, y - body, line));
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

function embeddedFontObjects(
  descriptorId: number,
  fileId: number,
  data: EmbeddedFontData,
): { readonly font: string; readonly descriptor: string; readonly file: Uint8Array } {
  return {
    font: `<< /Type /Font /Subtype /TrueType /BaseFont /${data.baseFont} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${data.widths.join(" ")}] /FontDescriptor ${descriptorId} 0 R >>`,
    // Flags 32 is "nonsymbolic": the font is addressed through WinAnsi, not its own encoding.
    descriptor: `<< /Type /FontDescriptor /FontName /${data.baseFont} /Flags 32 /FontBBox [${data.bbox.join(" ")}] /ItalicAngle ${data.italicAngle} /Ascent ${data.ascent} /Descent ${data.descent} /CapHeight ${data.capHeight} /StemV ${data.stemV} /FontFile2 ${fileId} 0 R >>`,
    file: streamObject(
      `/Filter /FlateDecode /Length1 ${data.length1}`,
      embeddedFontFlateBytes(data),
    ),
  };
}

export function buildPdf(input: PdfRenderInput): Uint8Array {
  const { artifact, profile } = input;
  const pageWidth = toPoints(profile.pageWidthMm);
  const pageHeight = toPoints(profile.pageHeightMm);
  const pages = pageCommands(profile, layoutBlocks(artifact));

  const objects: PdfObjectBody[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  const embedded = embeddedPdfFonts(profilePdfFont(profile));
  if (embedded === null) {
    objects[3] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  } else {
    // F1 is object 3 and F2 is object 4; their descriptors and font files follow as 5 to 8.
    const regular = embeddedFontObjects(5, 6, embedded.regular);
    const bold = embeddedFontObjects(7, 8, embedded.bold);
    objects[3] = regular.font;
    objects[4] = bold.font;
    objects[5] = regular.descriptor;
    objects[6] = regular.file;
    objects[7] = bold.descriptor;
    objects[8] = bold.file;
  }
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = page.map((line) => line.commands).join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(pageWidth)} ${fixed(pageHeight)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    // Page content is ASCII (non-ASCII text is octal-escaped), so its length is a byte count.
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const infoId = objects.length;
  const createdDate = input.generatedAt
    ? input.generatedAt.replace(/[-:TZ.]/gu, "").slice(0, 14)
    : "20260813120000";
  objects[infoId] =
    `<< /Title (${pdfLiteral(input.documentTitle)}) /Author (DraftLoop) /Creator (DraftLoop CV Engine) /CreationDate (D:${createdDate}Z) >>`;

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
