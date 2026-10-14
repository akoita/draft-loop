import type { ApplicationView } from "@draft-loop/application";

import { type EarlierRunView, earlierRunAllowsAction } from "../earlier-run.js";
import type { DesktopReviewState, ReviewAction } from "../model.js";

/**
 * Host-side rules for an earlier run of an application: it opens read-only, and the host refuses
 * every change to it. Only an application-scoped request has a latest run to compare with.
 */
export interface EarlierRunScope {
  readonly application: Pick<ApplicationView, "runs">;
  /** The application's newest run; undefined before its first run. */
  readonly latestRunId: string | undefined;
}

/** Whether the run is one of the application's own runs. */
export function runBelongsToApplication(scope: EarlierRunScope, runId: string): boolean {
  return scope.application.runs.some((run) => run.id === runId);
}

/** The earlier-run marker for a loaded run, or null for the latest run or an unscoped review. */
export function earlierRunFor(
  scope: EarlierRunScope | undefined,
  runId: string,
): EarlierRunView | null {
  if (scope?.latestRunId === undefined || runId === scope.latestRunId) return null;
  return { latestRunId: scope.latestRunId };
}

/**
 * Whether a scoped review action must be refused because it would change a run other than the
 * application's latest. Actions that change no run stay allowed.
 */
export function refusesEarlierRunAction(
  scope: EarlierRunScope | undefined,
  runId: string,
  type: ReviewAction["type"],
): boolean {
  if (scope === undefined || earlierRunAllowsAction(type)) return false;
  return runId !== scope.latestRunId;
}

/** The review state with its earlier-run marker, when it has one. */
export function withEarlierRun(
  state: DesktopReviewState,
  earlierRun: EarlierRunView | null,
): DesktopReviewState {
  return earlierRun === null ? state : { ...state, earlierRun };
}
