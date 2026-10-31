/**
 * The run's stop reason in plain words (#1113, #1110, #2013).
 *
 * Two sources say why the loop stopped. The evaluation's `stopReason` names the two pauses the
 * orchestrator decides from the findings (consensus, a persisting finding), and the stopping
 * decision the run records on arrival names the rest: ready, stable scores, the round limit, the
 * budget, a stop by the person. The decision reaches the screens as the approval readiness, on
 * which the host also marks autopilot's conflict pause.
 */

import type { ApprovalReadiness, ApprovalReadinessStopReason } from "./approval-readiness.js";

export const CONSENSUS_READY_REASON = "Stopped: author and critic agree it's ready";
export const PERSISTING_FINDINGS_REASON =
  "Paused: the same blocking finding persisted for two rounds — decide it to continue";
export const APPLICATION_READY_REASON = "Stopped: the draft passed the final checks";
export const STABLE_SCORES_REASON =
  "Stopped: the scores stopped improving between rounds — a revision would not help";
export const ROUND_LIMIT_REASON = "Stopped: the round limit was reached — raise it for a new run";
export const BUDGET_REASON =
  "Stopped: the run reached its cost or time limit — raise it for a new run";
export const CANCELLED_REASON = "Stopped: you stopped the run";
export const AUTOPILOT_CONFLICT_REASON =
  "Paused: autopilot found a conflict only you can settle — a disputed claim or a factuality finding";

const decisionReasons: Readonly<Record<ApprovalReadinessStopReason, string | null>> = {
  "application-ready": APPLICATION_READY_REASON,
  "stable-convergence": STABLE_SCORES_REASON,
  "max-rounds": ROUND_LIMIT_REASON,
  "budget-exhausted": BUDGET_REASON,
  cancelled: CANCELLED_REASON,
  "autopilot-conflict": AUTOPILOT_CONFLICT_REASON,
  continue: null,
};

/**
 * The plain sentence for a stop, or null when the reason has no wording of its own. The
 * evaluation's finding-based pauses win; then the recorded decision; a run recorded before the
 * decision carried its reason falls back to the evaluation's limit reasons.
 */
export function plainStopReason(
  stopReason: string,
  readiness: Pick<ApprovalReadiness, "stopReason"> | null = null,
): string | null {
  switch (stopReason) {
    case "consensus-ready":
      return CONSENSUS_READY_REASON;
    case "persisting-findings":
      return PERSISTING_FINDINGS_REASON;
    default:
      break;
  }
  if (readiness?.stopReason !== undefined) return decisionReasons[readiness.stopReason];
  switch (stopReason) {
    case "stable-convergence":
      return STABLE_SCORES_REASON;
    case "max-rounds":
      return ROUND_LIMIT_REASON;
    default:
      return null;
  }
}
