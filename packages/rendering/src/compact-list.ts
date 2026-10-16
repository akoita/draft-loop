/**
 * Compact lists: a run of short one-line bullets reads as a dense stack, so the layout draws it
 * as one wrapped paragraph with the items joined by " · " and no bullet glyphs. Only the
 * presentation changes. Each item keeps its text, and the inspectors split the paragraph back into
 * the original bullet blocks: the PDF tags the lines with "/DLCompact" marked content and the DOCX
 * uses the "CompactList" paragraph style.
 */

import { splitInlineLabel } from "./inline-label.js";

/** The fewest consecutive one-line bullets that are drawn as a compact paragraph. */
export const minCompactListItems = 3;

export const compactSeparator = " · ";
const separatorCharacter = "·";

export const docxCompactStyle = "CompactList";

/**
 * Whether a bullet may join a compact list. The separator must stay unambiguous, so an item that
 * already contains it is left as a bullet. A labelled item ("Cloud: ...") keeps its own line and
 * its bold label, as hand-made CVs lay out labelled lines.
 */
export function isCompactItem(text: string): boolean {
  return (
    text.trim() !== "" && !text.includes(separatorCharacter) && splitInlineLabel(text) === null
  );
}

/**
 * The index ranges (end exclusive) of runs of at least `minCompactListItems` consecutive bullets
 * that are compact items and each fit on one line.
 */
export function findCompactRuns(
  blocks: readonly { readonly type: string; readonly text: string }[],
  fitsOneLine: (text: string) => boolean,
): readonly { readonly start: number; readonly end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  const close = (end: number): void => {
    if (start >= 0 && end - start >= minCompactListItems) runs.push({ start, end });
    start = -1;
  };
  blocks.forEach((block, index) => {
    const eligible =
      block.type === "bullet" && isCompactItem(block.text) && fitsOneLine(block.text);
    if (!eligible) {
      close(index);
    } else if (start < 0) {
      start = index;
    }
  });
  close(blocks.length);
  return runs;
}

/** The items of a compact paragraph's visible text, in order. */
export function splitCompactText(text: string): readonly string[] {
  return text
    .split(separatorCharacter)
    .map((item) => item.replace(/\s+/gu, " ").trim())
    .filter((item) => item !== "");
}
