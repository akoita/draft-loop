import type { RunSnapshot } from "@draft-loop/orchestrator";

import type { LifecycleAction } from "./index.js";

/** Options a lifecycle command passes through to the run engine. */
export interface LifecycleOptions {
  /** Reason for approving past failing final CV checks; approval only. */
  readonly readinessOverrideRationale?: string;
}

/** The audit rationale and payload recorded for one explicit lifecycle command. */
export function lifecycleDecisionRecord(
  action: LifecycleAction,
  snapshot: RunSnapshot,
): { readonly rationale: string; readonly payload: Readonly<Record<string, string | boolean>> } {
  const override = action === "approve" ? snapshot.approvedArtifact?.readinessOverride : undefined;
  const rationale =
    override !== undefined
      ? `Approved past failing final CV checks (${override.blockers.join(", ")}): ${override.rationale}`
      : action === "approve"
        ? "Approved through the explicit CLI approval command."
        : action === "revision"
          ? "Revision requested through the explicit CLI command."
          : action === "recover-review"
            ? "Returned to review after a provider failure."
            : action === "recover-round-budget"
              ? "Returned to the last fully reviewed round after an exhausted round limit."
              : `${action} requested through the CLI command.`;
  return {
    rationale,
    payload: {
      action,
      source: "cli",
      ...(override === undefined ? {} : { readinessOverride: true }),
    },
  };
}
