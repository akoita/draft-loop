/**
 * Pairing two drafts line by line and marking up what changed between them.
 *
 * The review's version compare and the run comparison read two drafts the same way: sections
 * and lines are aligned across the two, and each line is set as a redline whose marks are not
 * colour-only (deletions are struck, insertions underlined).
 */

import type { ReviewArtifact, ReviewBlock } from "@draft-loop/ui/model";
import { useMemo } from "react";
import { type DiffOp, diffWords } from "./diff.js";

/** One draft line as it stands across two versions, ready to be marked up on the sheet. */
export interface DraftBlockPair {
  readonly key: string;
  /** The current block, or null when this line survives only in the previous version. */
  readonly block: ReviewBlock | null;
  /** The matching previous text, or null when this line is wholly new. */
  readonly previousText: string | null;
  readonly text: string;
}

/** One section of the draft, with its lines already paired across the two versions. */
export interface DraftSectionPair {
  readonly key: string;
  readonly title: string;
  readonly removed: boolean;
  readonly blocks: readonly DraftBlockPair[];
}

interface VersionPair<T> {
  readonly current: T | null;
  readonly previous: T | null;
}

/**
 * Lines up two versions of one ordered list. Ids are authoritative; whatever they leave
 * unmatched falls back to `fallbackScore`, because a revision may rewrite a line without keeping
 * its id. Each unmatched record takes the highest-scoring unmatched previous record, earliest on
 * a tie; a score of zero or less never pairs. Records that exist only in the previous version
 * come back as removals, in their old place.
 */
function alignVersions<T extends { readonly id: string }>(
  current: readonly T[],
  previous: readonly T[],
  fallbackScore: (currentItem: T, previousItem: T) => number,
): readonly VersionPair<T>[] {
  const previousIndexById = new Map(previous.map((item, index) => [item.id, index]));
  const taken = new Set<number>();
  const matches: (number | null)[] = current.map((item) => {
    const index = previousIndexById.get(item.id);
    if (index === undefined || taken.has(index)) return null;
    taken.add(index);
    return index;
  });
  current.forEach((item, index) => {
    if (matches[index] !== null) return;
    let best: number | null = null;
    let bestScore = 0;
    for (let candidate = 0; candidate < previous.length; candidate += 1) {
      const previousItem = previous[candidate];
      if (previousItem === undefined || taken.has(candidate)) continue;
      const score = fallbackScore(item, previousItem);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best === null) return;
    taken.add(best);
    matches[index] = best;
  });

  const pairs: VersionPair<T>[] = [];
  let cursor = 0;
  const emitRemovedBefore = (limit: number): void => {
    for (; cursor < limit; cursor += 1) {
      const previousItem = previous[cursor];
      if (previousItem !== undefined && !taken.has(cursor)) {
        pairs.push({ current: null, previous: previousItem });
      }
    }
  };
  current.forEach((item, index) => {
    const match = matches[index] ?? null;
    if (match === null) {
      pairs.push({ current: item, previous: null });
      return;
    }
    emitRemovedBefore(match);
    cursor = match + 1;
    pairs.push({ current: item, previous: previous[match] ?? null });
  });
  emitRemovedBefore(previous.length);
  return pairs;
}

/** Lower-cased words with their surrounding punctuation trimmed, so "akoita," matches "akoita". */
function lineWords(text: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const token of text.toLowerCase().split(/\s+/u)) {
    const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (word !== "") words.add(word);
  }
  return words;
}

/** A rewritten line must keep at least this share of the shorter line's words to pair with it. */
export const LINE_PAIR_MIN_SHARED_WORDS = 0.5;

/**
 * How alike two lines read: 2 for the same text, otherwise the share of the shorter line's words
 * the other also uses, or 0 below the pairing threshold. Unrelated lines must not pair just
 * because they sit at the same position, or the redline interleaves two different facts.
 */
export function lineSimilarity(text: string, previousText: string): number {
  if (text === previousText) return 2;
  const words = lineWords(text);
  const previousWords = lineWords(previousText);
  const shorter = Math.min(words.size, previousWords.size);
  if (shorter === 0) return 0;
  let shared = 0;
  for (const word of words) if (previousWords.has(word)) shared += 1;
  const similarity = shared / shorter;
  return similarity >= LINE_PAIR_MIN_SHARED_WORDS ? similarity : 0;
}

/** Pairs the lines of one section across two versions, keeping removals in document order. */
export function pairDraftBlocks(
  currentBlocks: readonly ReviewBlock[],
  previousBlocks: readonly ReviewBlock[],
): readonly DraftBlockPair[] {
  const pairs: DraftBlockPair[] = [];
  for (const pair of alignVersions(currentBlocks, previousBlocks, (block, previousBlock) =>
    lineSimilarity(block.text, previousBlock.text),
  )) {
    if (pair.current === null) {
      if (pair.previous === null) continue;
      pairs.push({
        key: `removed-${pair.previous.id}`,
        block: null,
        previousText: pair.previous.text,
        text: pair.previous.text,
      });
      continue;
    }
    pairs.push({
      key: pair.current.id,
      block: pair.current,
      previousText: pair.previous === null ? null : pair.previous.text,
      text: pair.current.text,
    });
  }
  return pairs;
}

/** Pairs the whole draft across two versions. Sections match by id, then by title. */
export function pairDraftSections(
  artifact: ReviewArtifact,
  previousArtifact: ReviewArtifact | null,
): readonly DraftSectionPair[] {
  const sections: DraftSectionPair[] = [];
  for (const pair of alignVersions(
    artifact.sections,
    previousArtifact?.sections ?? [],
    (section, previousSection) => (section.title === previousSection.title ? 1 : 0),
  )) {
    if (pair.current === null) {
      if (pair.previous === null) continue;
      sections.push({
        key: `removed-${pair.previous.id}`,
        title: pair.previous.title,
        removed: true,
        blocks: pairDraftBlocks([], pair.previous.blocks),
      });
      continue;
    }
    sections.push({
      key: pair.current.id,
      title: pair.current.title,
      removed: false,
      blocks: pairDraftBlocks(pair.current.blocks, pair.previous?.blocks ?? []),
    });
  }
  return sections;
}

interface RedlineOp {
  readonly key: string;
  readonly kind: "equal" | "insert" | "delete";
  readonly text: string;
}

/** How much of a line a word-level alignment must preserve before it is worth showing. */
export const REDLINE_MIN_RETENTION = 0.5;
/** Below two separate edit regions the alignment already reads as one clean replacement. */
export const REDLINE_MIN_EDIT_REGIONS = 2;

/**
 * Non-whitespace characters. Word tokenisation leaves nearly every space in an `equal` op,
 * so counting whitespace would make every alignment look far better preserved than it is.
 */
function inkLength(text: string): number {
  return text.replace(/\s+/gu, "").length;
}

export interface RedlineShape {
  /** Maximal runs of insert/delete ops, uninterrupted by an `equal` op carrying any ink. */
  readonly editRegions: number;
  /** Share of the longer version's ink characters that survived the revision, 0…1. */
  readonly retention: number;
}

/** A pure read of how fragmented a word-level alignment is. Deterministic in the ops alone. */
export function redlineShape(ops: readonly DiffOp[]): RedlineShape {
  let equalInk = 0;
  let previousInk = 0;
  let nextInk = 0;
  let editRegions = 0;
  let insideRegion = false;

  for (const op of ops) {
    const ink = inkLength(op.text);
    if (op.kind === "equal") {
      equalInk += ink;
      previousInk += ink;
      nextInk += ink;
      if (ink > 0) insideRegion = false;
      continue;
    }
    if (op.kind === "delete") previousInk += ink;
    else nextInk += ink;
    if (ink > 0 && !insideRegion) {
      editRegions += 1;
      insideRegion = true;
    }
  }

  const longest = Math.max(previousInk, nextInk);
  return { editRegions, retention: longest === 0 ? 1 : equalInk / longest };
}

/**
 * A rewritten sentence aligns into interleaved scraps that read worse than either version
 * alone, so past a fragmentation threshold the line is marked up the way a proof-reader would:
 * strike the old sentence whole, write the new one under it. Returns the input unchanged —
 * by identity, so the caller can tell — whenever the word-level marks still carry meaning.
 */
export function collapseFragmentedRedline(ops: readonly DiffOp[]): readonly DiffOp[] {
  const shape = redlineShape(ops);
  if (shape.retention >= REDLINE_MIN_RETENTION) return ops;
  // A line that kept none of its words is a replacement even as one region: whitespace alone
  // still aligns, and would otherwise interleave the old and new words.
  if (shape.editRegions < REDLINE_MIN_EDIT_REGIONS) {
    const rewritten =
      shape.retention === 0 &&
      ops.some((op) => op.kind === "delete") &&
      ops.some((op) => op.kind === "insert");
    if (!rewritten) return ops;
  }

  let previousText = "";
  let nextText = "";
  for (const op of ops) {
    if (op.kind !== "insert") previousText += op.text;
    if (op.kind !== "delete") nextText += op.text;
  }

  const collapsed: DiffOp[] = [];
  if (previousText !== "") collapsed.push({ kind: "delete", text: previousText });
  if (nextText !== "") collapsed.push({ kind: "insert", text: nextText });
  return collapsed;
}

/**
 * The marked-up reading view of one draft line. A null `previousText` means the line is new,
 * so the redline marks all of it as an insertion. The alignment is memoised on this line's own
 * two texts: typing in one line must not re-diff the rest of the sheet.
 */
export function BlockRedline({
  previousText,
  text,
  showChanges,
}: {
  readonly previousText: string | null;
  readonly text: string;
  readonly showChanges: boolean;
}) {
  const redline = useMemo<{
    readonly replaced: boolean;
    readonly ops: readonly RedlineOp[];
  } | null>(() => {
    if (!showChanges) return null;
    const aligned = diffWords(previousText ?? "", text);
    const marks = collapseFragmentedRedline(aligned);
    let offset = 0;
    return {
      replaced: marks !== aligned,
      ops: marks.map((op) => {
        const key = `${op.kind}-${offset}`;
        offset += op.text.length;
        return { key, kind: op.kind, text: op.text };
      }),
    };
  }, [previousText, showChanges, text]);

  if (redline === null) return text;
  const marks = redline.ops.map((op) =>
    op.kind === "equal" ? (
      <span key={op.key}>{op.text}</span>
    ) : op.kind === "insert" ? (
      <ins className="redline-ins" key={op.key}>
        {op.text}
      </ins>
    ) : (
      <del className="redline-del" key={op.key}>
        {op.text}
      </del>
    ),
  );
  // A whole-line replacement is set as two stacked lines, so each version still reads as a
  // sentence instead of as one run-on paragraph.
  if (redline.replaced) return <span className="redline-replacement">{marks}</span>;
  return <>{marks}</>;
}
