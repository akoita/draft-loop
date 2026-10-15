import { activeCandidateDirection, type RunSnapshot } from "@draft-loop/orchestrator";

import type { SqliteStorage } from "@draft-loop/storage";

import type { LifecycleAction } from "./index.js";
import { timestamp } from "./response-execution.js";

/** Options a lifecycle command passes through to the run engine. */
export interface LifecycleOptions {
  /** Reason for approving past failing final CV checks; approval only. */
  readonly readinessOverrideRationale?: string;
  /** Revision only: the candidate's short direction for the author of the next round. */
  readonly candidateDirection?: string;
}

/** Record one explicit lifecycle command as a decision in run history. */
export async function saveLifecycleDecision(
  storage: Pick<SqliteStorage, "saveDecision">,
  workspaceId: string,
  action: LifecycleAction,
  snapshot: RunSnapshot,
): Promise<void> {
  const record = lifecycleDecisionRecord(action, snapshot);
  const { runId } = snapshot;
  await storage.saveDecision({
    id: `decision-${runId}-${action}-${snapshot.round}-${Date.now()}`,
    workspaceId,
    runId,
    roundId: `${runId}:round:${action === "revision" ? snapshot.round - 1 : snapshot.round}`,
    artifactId: snapshot.artifact?.id ?? null,
    type: action === "approve" ? "approve" : "reject-finding",
    rationale: record.rationale,
    actor: "user:cli",
    createdAt: timestamp(),
    payload: record.payload,
  });
}

/** The audit rationale and payload recorded for one explicit lifecycle command. */
export function lifecycleDecisionRecord(
  action: LifecycleAction,
  snapshot: RunSnapshot,
): {
  readonly rationale: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
} {
  const direction = action === "revision" ? activeCandidateDirection(snapshot) : undefined;
  const override = action === "approve" ? snapshot.approvedArtifact?.readinessOverride : undefined;
  const rationale =
    override !== undefined
      ? `Approved past failing final CV checks (${override.blockers.join(", ")}): ${override.rationale}`
      : action === "approve"
        ? "Approved through the explicit CLI approval command."
        : action === "revision"
          ? direction === undefined
            ? "Revision requested through the explicit CLI command."
            : "Revision requested with the candidate's directions for the author."
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
      // The candidate's own instruction for the next round: recorded as a decision, not evidence.
      ...(direction === undefined
        ? {}
        : { candidateDirection: direction.text, candidateDirectionRound: direction.round }),
    },
  };
}
