/**
 * Role headers: the line that opens a role in an Experience or Projects section (a paragraph
 * directly followed by bullets). The line is drawn bold; when its last " | " segment is a date
 * range, that segment is right-aligned on the same line. Only layout changes: the text of the
 * block is never edited, and the separator that the layout does not draw is restored when the
 * inspectors recover the visible text.
 */

import { docxCompactStyle, splitCompactText } from "./compact-list.js";

const roleSeparator = " | ";

const monthWord = String.raw`\p{L}{3,10}\.?`;
const yearNumber = String.raw`(?:19|20)\d{2}`;
const datePoint = String.raw`(?:${monthWord}\s+)?${yearNumber}`;
const ongoingWord = String.raw`(?:present|current|now|today|ongoing|présent|actuel|heute|aktuell)`;
const rangeJoiner = String.raw`(?:to|until|till|à|bis|-|–|—)`;
// A range, optionally followed by a place after a comma ("Jan 2020 to Mar 2021, Paris").
const dateRangePattern = new RegExp(
  String.raw`^${datePoint}\s*${rangeJoiner}\s*(?:${datePoint}|${ongoingWord})(?:\s*,\s*[^|]+)?$`,
  "iu",
);

export interface RoleHeaderParts {
  readonly left: string;
  readonly date: string;
}

/** Whether a segment is a conservative month-year or year date range. */
export function isDateRange(segment: string): boolean {
  return dateRangePattern.test(segment.trim());
}

/**
 * Split a role line on its last " | " when that last segment is a date range; null when there
 * is no such split and the whole line stays one bold run.
 */
export function splitRoleHeader(text: string): RoleHeaderParts | null {
  const index = text.lastIndexOf(roleSeparator);
  if (index <= 0) return null;
  const left = text.slice(0, index).trim();
  const date = text.slice(index + roleSeparator.length).trim();
  return left !== "" && isDateRange(date) ? { left, date } : null;
}

const hasPipeSegment = (text: string | undefined): boolean =>
  text?.includes(roleSeparator) === true;

interface SectionBlock {
  readonly type: string;
  readonly text: string;
}

/** A paragraph with a " | " segment that opens a role: followed by bullets or a context line. */
function isPipeRoleHeader(blocks: readonly SectionBlock[], index: number): boolean {
  const block = blocks[index];
  const next = blocks[index + 1];
  return (
    block !== undefined &&
    block.type !== "bullet" &&
    hasPipeSegment(block.text) &&
    next !== undefined &&
    (next.type === "bullet" || !hasPipeSegment(next.text))
  );
}

/**
 * Whether block `index` of a section is a role header. In experience and projects, a paragraph
 * with a " | " segment is one when bullets or a plain paragraph follow it; a plain paragraph
 * directly after such a header is its context line and stays regular; and a paragraph directly
 * followed by bullets is still a role header when it is not itself a context line.
 */
export function isRoleHeaderBlock(
  sectionKind: string,
  blocks: readonly SectionBlock[],
  index: number,
): boolean {
  const block = blocks[index];
  if (
    (sectionKind !== "experience" && sectionKind !== "projects") ||
    block === undefined ||
    block.type === "bullet"
  ) {
    return false;
  }
  const isContextLine = !hasPipeSegment(block.text) && isPipeRoleHeader(blocks, index - 1);
  if (isContextLine) return false;
  return isPipeRoleHeader(blocks, index) || blocks[index + 1]?.type === "bullet";
}

/** Whether block `index` is the context line directly under a role header ("Paris | scope"). */
export function isRoleContextLine(
  sectionKind: string,
  blocks: readonly SectionBlock[],
  index: number,
): boolean {
  const block = blocks[index];
  return (
    (sectionKind === "experience" || sectionKind === "projects") &&
    block !== undefined &&
    block.type !== "bullet" &&
    index > 0 &&
    isRoleHeaderBlock(sectionKind, blocks, index - 1) &&
    !isRoleHeaderBlock(sectionKind, blocks, index)
  );
}

/** The lines of a role header and, when the dates are right-aligned, the date on the last line. */
export interface RoleHeaderLines {
  readonly lines: readonly string[];
  readonly date: string | null;
}

/** Least space kept between the left part and the right-aligned date, in points. */
export const roleDateGapPt = 12;

export interface RoleHeaderMeasure {
  readonly widthPt: number;
  readonly boldWidth: (text: string) => number;
  readonly regularWidth: (text: string) => number;
  readonly wrapBold: (text: string, widthPt: number) => readonly string[];
}

/**
 * Lay a role line out to the content width. The left part wraps in the room the date leaves; if a
 * single word is still wider than that room, the whole line falls back to plain bold wrapping.
 */
export function layoutRoleHeader(text: string, measure: RoleHeaderMeasure): RoleHeaderLines {
  const parts = splitRoleHeader(text);
  if (parts !== null) {
    const room = measure.widthPt - measure.regularWidth(parts.date) - roleDateGapPt;
    if (room > 0) {
      const lines = measure.wrapBold(parts.left, room);
      if (lines.every((line) => measure.boldWidth(line) <= room)) {
        return { lines, date: parts.date };
      }
    }
  }
  return { lines: measure.wrapBold(text, measure.widthPt), date: null };
}

/** A PDF text run with the font resource number and position the inspectors read. */
export interface PdfTextRun {
  readonly text: string;
  readonly fontNumber: number;
  readonly x: number;
  readonly y: number;
  /**
   * Marked-content tag the layout wrote around the run: an inline label, a compact list line or a
   * line of the title.
   */
  readonly tag?: "label" | "compact" | "title" | undefined;
}

/** The F3 resource is the role-header bold: the same face as F2, not a section heading. */
export const roleFontNumber = 3;

/**
 * Join a right-aligned date back onto its role line: a regular run on the same baseline as the
 * role-header run before it is the dates, which the layout draws without the " | " before them.
 */
export function joinRoleDateRuns(runs: readonly PdfTextRun[]): readonly PdfTextRun[] {
  const joined: PdfTextRun[] = [];
  for (const run of runs) {
    const previous = joined.at(-1);
    if (
      previous !== undefined &&
      previous.tag === undefined &&
      previous.fontNumber === roleFontNumber &&
      run.fontNumber === 1 &&
      run.y === previous.y &&
      run.x > previous.x
    ) {
      joined[joined.length - 1] = {
        ...previous,
        text: `${previous.text}${roleSeparator}${run.text}`,
      };
    } else {
      joined.push(run);
    }
  }
  return joined;
}

/**
 * The visible text of one DOCX paragraph. A bare `<w:tab/>` is the right-aligned date of a role
 * header and reads back as its " | " separator; tab stop definitions carry attributes and are
 * not matched.
 */
export function docxParagraphText(paragraphXml: string, decode: (value: string) => string): string {
  let text = "";
  for (const match of paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>/gu)) {
    text += match[1] === undefined ? roleSeparator : decode(match[1]);
  }
  return text;
}

/**
 * The blocks one DOCX paragraph stands for. A compact-list paragraph is the " · "-joined text of
 * several bullets and splits back into them; any other paragraph is its one text.
 */
export function docxParagraphUnits(
  paragraphXml: string,
  decode: (value: string) => string,
): readonly string[] {
  const text = docxParagraphText(paragraphXml, decode);
  const compact = new RegExp(`<w:pStyle\\b[^>]*w:val\\s*=\\s*["']${docxCompactStyle}["']`, "u");
  return compact.test(paragraphXml) ? splitCompactText(text) : [text];
}
