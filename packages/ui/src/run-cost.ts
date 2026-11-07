import { plural, t } from "@lingui/core/macro";
import type { DesktopReviewState } from "./model.js";

export interface RunCostLabel {
  readonly text: string;
  /** Why the figure is incomplete; absent when every model call was priced. */
  readonly explanation?: string;
}

export const costNotRecorded = () => t`Cost not recorded`;

type RunCost = Pick<DesktopReviewState, "totalCostUsd" | "unpricedCallCount">;

/**
 * The run's estimated cost as the person reads it. A call with no price adds nothing to the total,
 * so a total built only from unpriced calls is "not recorded", never $0.000, and a partly priced
 * total is marked as a lower bound.
 */
export function runCostLabel({ totalCostUsd, unpricedCallCount }: RunCost): RunCostLabel {
  if (!Number.isFinite(totalCostUsd)) return { text: costNotRecorded() };
  const total = `$${totalCostUsd.toFixed(3)}`;
  const unpriced = unpricedCallCount ?? 0;
  if (unpriced === 0) return { text: total };
  const explanation = plural(unpriced, {
    one: "# model call has no recorded price, from a subscription session or a model without catalog rates.",
    other:
      "# model calls have no recorded price, from a subscription session or a model without catalog rates.",
  });
  return totalCostUsd === 0
    ? { text: costNotRecorded(), explanation }
    : { text: `${total}+`, explanation: `${explanation} ${t`The total is a lower bound.`}` };
}
