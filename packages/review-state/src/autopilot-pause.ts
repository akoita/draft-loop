import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { ApprovalReadiness } from "@draft-loop/ui/approval-readiness";

/**
 * Marks the approval readiness with autopilot's conflict pause (#2013).
 *
 * The orchestrator records that pause on the run snapshot and in the run event, not on the
 * stopping decision, so the projection adds it here as the readiness's stop reason. A run that
 * arrived at approval for any other reason keeps the decision's reason.
 */
export function withAutopilotPause(
  readiness: ApprovalReadiness | null,
  snapshot: Pick<RunSnapshot, "autopilotPause">,
): ApprovalReadiness | null {
  if (readiness === null || snapshot.autopilotPause !== "conflict") return readiness;
  return { ...readiness, stopReason: "autopilot-conflict" };
}
