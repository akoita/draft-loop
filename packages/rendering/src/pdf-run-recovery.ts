import { splitCompactText } from "./compact-list.js";
import { joinRoleDateRuns, type PdfTextRun } from "./role-header.js";

/**
 * Join a bold inline label back onto the regular run that follows it on the same baseline. The
 * label run is tagged, so a role header (also bold) is never joined here.
 */
function joinLabelRuns(runs: readonly PdfTextRun[]): readonly PdfTextRun[] {
  const joined: PdfTextRun[] = [];
  for (const run of runs) {
    const previous = joined.at(-1);
    if (
      previous !== undefined &&
      previous.tag === "label" &&
      run.tag === undefined &&
      run.fontNumber === 1 &&
      run.y === previous.y &&
      run.x > previous.x
    ) {
      joined[joined.length - 1] = {
        text: `${previous.text} ${run.text}`,
        fontNumber: run.fontNumber,
        x: previous.x,
        y: previous.y,
      };
    } else {
      joined.push(run);
    }
  }
  return joined;
}

function untagged(run: PdfTextRun): PdfTextRun {
  return { text: run.text, fontNumber: run.fontNumber, x: run.x, y: run.y };
}

/**
 * Split the tagged lines of compact paragraphs back into one run per original bullet. Consecutive
 * compact lines are one paragraph; its items were joined with " · ", which may wrap anywhere.
 */
function splitCompactRuns(runs: readonly PdfTextRun[]): readonly PdfTextRun[] {
  const result: PdfTextRun[] = [];
  let pending: PdfTextRun[] = [];
  const flush = (): void => {
    const first = pending[0];
    if (first === undefined) return;
    const text = pending.map((run) => run.text).join(" ");
    for (const item of splitCompactText(text)) result.push({ ...untagged(first), text: item });
    pending = [];
  };
  for (const run of runs) {
    if (run.tag === "compact") {
      pending.push(run);
    } else {
      flush();
      result.push(run.tag === undefined ? run : untagged(run));
    }
  }
  flush();
  return result;
}

/**
 * Join the tagged lines of a wrapped title back into one run. A long headline wraps at the name
 * size, and each line would otherwise read back as a heading of its own (#1929).
 */
function joinTitleRuns(runs: readonly PdfTextRun[]): readonly PdfTextRun[] {
  const joined: PdfTextRun[] = [];
  for (const run of runs) {
    const previous = joined.at(-1);
    if (run.tag === "title" && previous?.tag === "title") {
      joined[joined.length - 1] = { ...previous, text: `${previous.text} ${run.text}` };
    } else {
      joined.push(run);
    }
  }
  return joined.map((run) => (run.tag === "title" ? untagged(run) : run));
}

/**
 * The visible runs of a PDF page as the artifact's blocks: the title, dates, labels and compact
 * lists.
 */
export function recoverPdfRuns(runs: readonly PdfTextRun[]): readonly PdfTextRun[] {
  return splitCompactRuns(joinRoleDateRuns(joinLabelRuns(joinTitleRuns(runs))));
}

const pdfRunTagNames = { label: "Label", compact: "Compact", title: "Title" } as const;

/** The marked-content tag at the start of a content-stream line, when it carries one of ours. */
export function pdfRunTag(lineBeforeText: string): PdfTextRun["tag"] {
  const name = /^\/DL(Label|Compact|Title) BMC /u.exec(lineBeforeText)?.[1];
  if (name === "Label") return "label";
  if (name === "Title") return "title";
  return name === "Compact" ? "compact" : undefined;
}

/** The content-stream wrapper that marks a text command with one of our tags. */
export function tagPdfCommands(tag: NonNullable<PdfTextRun["tag"]>, commands: string): string {
  return `/DL${pdfRunTagNames[tag]} BMC ${commands} EMC`;
}

/**
 * The `/ActualText` operand a line carries for the text command that follows it, when the drawn
 * glyphs differ from the written text (a capitalised heading, or a character drawn with another's
 * glyph): a `(…)` literal or a `<FEFF…>` Unicode string, delimiters kept. Callers decode it.
 */
export function pdfActualTextOperand(lineBeforeText: string): string | undefined {
  return /\/ActualText (\((?:\\.|[^()])*\)|<[0-9A-Fa-f]*>) >> BDC [^(<[]*$/u.exec(
    lineBeforeText,
  )?.[1];
}
