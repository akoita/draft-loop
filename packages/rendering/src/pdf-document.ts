import type { DraftArtifact } from "@draft-loop/schemas";

import {
  blockLines,
  type LayoutBlock,
  layoutBlocks,
  layoutMetrics,
  textWidthPt,
  wrapTextToWidth,
} from "./document-layout.js";
import type { RenderingLayoutProfile } from "./index.js";

/**
 * A dependency-free PDF of the same layout the DOCX uses: Helvetica text (bold for the title and
 * headings), a rule under each heading, hanging bullets and the profile's A4 margins. Text is
 * written in WinAnsi, so Latin accents and common punctuation survive; characters outside it are
 * written as "?" because the standard fonts cannot draw them.
 */

const pointsPerMillimeter = 72 / 25.4;

const windows1252Specials: Readonly<Record<string, number>> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

function octal(code: number): string {
  return `\\${code.toString(8).padStart(3, "0")}`;
}

/** The WinAnsi code for one character, or null when the standard fonts cannot draw it. */
function winAnsiCode(character: string): number | null {
  const special = windows1252Specials[character];
  if (special !== undefined) return special;
  const code = character.codePointAt(0) ?? 0x3f;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return null;
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

const windows1252Characters: ReadonlyMap<number, string> = new Map(
  Object.entries(windows1252Specials).map(([character, code]) => [code, character]),
);

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
  const bulletTextOffset = textWidthPt(bulletPrefix, body, false);

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
      const wrapped = wrapTextToWidth(block.text, right - left, metrics.titleSizePt, true);
      for (const line of wrapped) {
        if (y - metrics.titleLinePt < bottom && !atPageTop()) startPage();
        const width = textWidthPt(line, metrics.titleSizePt, true);
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
        const width = textWidthPt(line, body, false);
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

export function buildPdf(input: PdfRenderInput): Uint8Array {
  const { artifact, profile } = input;
  const pageWidth = toPoints(profile.pageWidthMm);
  const pageHeight = toPoints(profile.pageHeightMm);
  const pages = pageCommands(profile, layoutBlocks(artifact));

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = page.map((line) => line.commands).join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(pageWidth)} ${fixed(pageHeight)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const infoId = objects.length;
  const createdDate = input.generatedAt
    ? input.generatedAt.replace(/[-:TZ.]/gu, "").slice(0, 14)
    : "20260813120000";
  objects[infoId] =
    `<< /Title (${pdfLiteral(input.documentTitle)}) /Author (DraftLoop) /Creator (DraftLoop CV Engine) /CreationDate (D:${createdDate}Z) >>`;

  // Every written character is ASCII except the binary-marker comment, so offsets are byte counts.
  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  let byteLength = encoder.encode(pdf).length;
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = byteLength;
    const object = `${index} 0 obj\n${objects[index]}\nendobj\n`;
    pdf += object;
    byteLength += encoder.encode(object).length;
  }
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${byteLength}\n%%EOF\n`;
  return encoder.encode(pdf);
}
