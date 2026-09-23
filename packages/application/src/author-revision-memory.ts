/**
 * In-process memory of the last rejected author proposal per run and round.
 *
 * When the local validator rejects an author proposal, the next author attempt
 * for the same run and round in this process revises that proposal against a
 * specific validation report instead of regenerating from content-free codes.
 *
 * The entries quote candidate content, so they are never persisted: not in run
 * history, diagnostics, retry feedback, or captures. After a process restart
 * the memory is empty, and retries fall back to content-free retry feedback.
 * The store is bounded and evicts its oldest entry first.
 */
import type { AuthorRevisionReportItem } from "./author-revision-report.js";

/** Maximum number of remembered rejections across all runs in one process. */
export const maxAuthorRevisionEntries = 16;

export interface AuthorRevision {
  readonly rejectedProposal: unknown;
  readonly report: readonly AuthorRevisionReportItem[];
}

const revisions = new Map<string, AuthorRevision>();

/** The memory key of one author step: the run and its round. */
export function authorRevisionKey(runId: string, round: number): string {
  return `${runId}:${round}`;
}

/** Remember the latest rejection for a key, replacing any earlier one. */
export function rememberAuthorRevision(key: string, revision: AuthorRevision): void {
  revisions.delete(key);
  revisions.set(key, revision);
  while (revisions.size > maxAuthorRevisionEntries) {
    const oldest = revisions.keys().next().value;
    if (oldest === undefined) break;
    revisions.delete(oldest);
  }
}

/** Return and delete the remembered rejection for a key, so it is used at most once. */
export function takeAuthorRevision(key: string): AuthorRevision | undefined {
  const revision = revisions.get(key);
  revisions.delete(key);
  return revision;
}

/** Drop any remembered rejection for a key. */
export function forgetAuthorRevision(key: string): void {
  revisions.delete(key);
}

/** Test-only: empty the memory. */
export function resetAuthorRevisionMemoryForTests(): void {
  revisions.clear();
}
