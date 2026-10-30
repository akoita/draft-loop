import type { RunSnapshot } from "./index.js";

/**
 * A provider call refused before it started, because its worst-case cost would pass what the
 * run may still spend (#1985). Nothing was billed, so the run stops as budget-exhausted instead
 * of recording a failed call.
 */
export class CallCostBudgetError extends Error {
  override readonly name = "CallCostBudgetError";

  constructor(
    readonly estimatedUsd: number,
    readonly remainingUsd: number,
  ) {
    super(
      `maximum cost budget exhausted: the next call could cost up to $${estimatedUsd.toFixed(2)} and $${Math.max(0, remainingUsd).toFixed(2)} remains`,
    );
  }
}

/** What the run may still spend, when it has a cost limit. */
export function remainingCostUsd(
  snapshot: Pick<RunSnapshot, "budget" | "totalCostUsd">,
): number | undefined {
  const { maxCostUsd } = snapshot.budget;
  return maxCostUsd === undefined ? undefined : maxCostUsd - snapshot.totalCostUsd;
}

/** The remaining budget as an agent request field, absent when the run has no cost limit. */
export function remainingCostField(snapshot: Pick<RunSnapshot, "budget" | "totalCostUsd">): {
  readonly remainingCostUsd?: number;
} {
  const remaining = remainingCostUsd(snapshot);
  return remaining === undefined ? {} : { remainingCostUsd: remaining };
}

/** The budget reason of a call refused before it started; undefined for any other failure. */
export function callCostBudgetReason(error: unknown): string | undefined {
  return error instanceof CallCostBudgetError ? error.message : undefined;
}
