import type { ReviewExecutionView } from "./model.js";

/** "10 min" for whole minutes, otherwise whole seconds rounded up, e.g. "90s". */
export function formatLimitDuration(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1_000);
  return seconds > 0 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
}

/**
 * The limits suffix of the run-progress line: the per-call limit of the executing step's route,
 * when it has one, then what is left of the run's own duration budget.
 */
export function executionLimitText(
  execution: Pick<ReviewExecutionView, "callLimitMs" | "timeoutRemainingMs">,
): string {
  const callLimit =
    execution.callLimitMs === undefined || execution.callLimitMs === null
      ? ""
      : ` · call limit ${formatLimitDuration(execution.callLimitMs)}`;
  const runLimit =
    execution.timeoutRemainingMs === null
      ? " · no run limit"
      : ` · run limit in ${Math.ceil(execution.timeoutRemainingMs / 1_000)}s`;
  return `${callLimit}${runLimit}`;
}
