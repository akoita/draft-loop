import { t } from "@lingui/core/macro";
import { countedNouns } from "./counted-nouns.js";
import type { RunAuthorInputView } from "./run-author-input.js";

export interface RunAuthorInputDisplay {
  /** Side-panel value, e.g. "15 items". */
  readonly value: string;
  /** Side-panel detail, e.g. "of 181 chunks and 40 facts". */
  readonly detail: string;
  /** Summary of the gap list, e.g. "No sent evidence for 2 requirements"; absent without a gap. */
  readonly gapSummary?: string;
  readonly unmatchedRequirements: readonly string[];
  /** The candidate's direction for the round, when they gave one. */
  readonly direction?: { readonly text: string; readonly createdAt: string };
}

/** What the review's "Author input" fact shows; `undefined` hides the fact. */
export function runAuthorInputDisplay(
  input: RunAuthorInputView | null | undefined,
): RunAuthorInputDisplay | undefined {
  if (input === undefined || input === null) return undefined;
  const { knowledgeChunkCount, knowledgeFactCount, unmatchedRequirements } = input;
  const { chunk, fact } = countedNouns;
  const detail =
    knowledgeChunkCount === undefined
      ? t`${chunk(input.sentChunkCount)} and ${fact(input.sentFactCount)}`
      : knowledgeFactCount === undefined
        ? t`of ${chunk(knowledgeChunkCount)}`
        : t`of ${chunk(knowledgeChunkCount)} and ${fact(knowledgeFactCount)}`;
  return {
    value: countedNouns.item(input.sentChunkCount + input.sentFactCount),
    detail,
    ...(unmatchedRequirements.length === 0
      ? {}
      : {
          gapSummary: t`No sent evidence for ${countedNouns.requirement(unmatchedRequirements.length)}`,
        }),
    unmatchedRequirements,
    ...(input.candidateDirection === undefined ? {} : { direction: input.candidateDirection }),
  };
}
