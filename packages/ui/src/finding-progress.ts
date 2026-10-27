/**
 * The Findings panel's progress line. Before the critique has run there is nothing to resolve, so
 * it says so instead of "0 of 0 resolved · all findings resolved", which read as a finished review
 * next to the "Not evaluated" badge.
 */

export interface FindingProgress {
  readonly resolved: number;
  readonly total: number;
  readonly needsAction: number;
  readonly runInProgress: boolean;
  /** Whether a critique has judged the current draft. */
  readonly critiqued: boolean;
}

export const NOT_CRITIQUED_PROGRESS = "No findings yet: the critique has not run";

/** "3 of 5 resolved · 2 need action", or the not-critiqued line while nothing was judged. */
export function findingProgressLine(progress: FindingProgress): string {
  const { resolved, total, needsAction, runInProgress, critiqued } = progress;
  if (!critiqued && total === 0) return NOT_CRITIQUED_PROGRESS;
  const counted = `${resolved} of ${total} resolved`;
  if (needsAction === 0) return `${counted} · all findings resolved`;
  return runInProgress
    ? `${counted} · ${needsAction} open`
    : `${counted} · ${needsAction} need action`;
}
