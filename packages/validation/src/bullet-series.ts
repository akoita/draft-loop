/** Most consecutive bullet blocks a section may hold before the run reads as a wall of bullets. */
const MAX_BULLETS_IN_A_ROW = 4;
/** A section of at least this many blocks that is all short bullets reads as a list of fragments. */
const MIN_SHORT_SECTION_BLOCKS = 4;
/** A bullet of at most this many words fits on one line. */
const ONE_LINE_WORDS = 15;
/** Adjacent bullets are acceptable only when both are fuller than this many words. */
const MIN_ADJACENT_BULLET_WORDS = 30;

export type BulletSeriesReason = "long-run" | "short-section" | "short-adjacent";

export interface BulletSeriesFinding {
  readonly reason: BulletSeriesReason;
  /** The block that opens the offending run. */
  readonly blockId: string;
  readonly message: string;
}

export interface BulletSeriesBlock {
  readonly id: string;
  readonly type: string;
  readonly text: string;
}

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

/**
 * Finds bullet blocks that crowd a section: bullet markers should sit several lines apart. One
 * finding is emitted per run of consecutive bullets, anchored to its first block, for the first
 * matching rule: more than four bullets in a row, a section of four or more blocks that are all
 * one-line bullets, or two adjacent bullets where either is under about thirty words.
 */
export function findBulletSeries(blocks: readonly BulletSeriesBlock[]): BulletSeriesFinding[] {
  const findings: BulletSeriesFinding[] = [];
  let index = 0;
  while (index < blocks.length) {
    if (blocks[index]?.type !== "bullet") {
      index += 1;
      continue;
    }
    let end = index;
    while (blocks[end + 1]?.type === "bullet") end += 1;
    const run = blocks.slice(index, end + 1);
    const first = run[0];
    if (first !== undefined) {
      const wholeSection = run.length === blocks.length;
      if (run.length > MAX_BULLETS_IN_A_ROW) {
        findings.push({
          reason: "long-run",
          blockId: first.id,
          message: `${run.length} bullets in a row; keep at most ${MAX_BULLETS_IN_A_ROW} and put a paragraph between series`,
        });
      } else if (
        wholeSection &&
        run.length >= MIN_SHORT_SECTION_BLOCKS &&
        run.every((block) => words(block.text) <= ONE_LINE_WORDS)
      ) {
        findings.push({
          reason: "short-section",
          blockId: first.id,
          message: `section is ${run.length} one-line bullets; write labelled paragraphs or fuller bullets instead`,
        });
      } else if (
        run.some(
          (block, position) =>
            position > 0 &&
            (words(block.text) < MIN_ADJACENT_BULLET_WORDS ||
              words(run[position - 1]?.text ?? "") < MIN_ADJACENT_BULLET_WORDS),
        )
      ) {
        findings.push({
          reason: "short-adjacent",
          blockId: first.id,
          message:
            "short bullets sit on adjacent lines; bullet markers should be several lines apart, so merge short items into a fuller bullet or a paragraph",
        });
      }
    }
    index = end + 1;
  }
  return findings;
}
