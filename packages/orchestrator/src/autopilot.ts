import type { ReadinessStopReason } from "@draft-loop/evaluations";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { ValidationIssue } from "@draft-loop/validation";

/**
 * Stop reasons an autopilot run keeps revising through.
 *
 * Blocking findings and a stalled score are feedback the author can act on in
 * the next revision. Readiness and the round limit still stop the run.
 */
const autopilotContinuableStops: ReadonlySet<ReadinessStopReason> = new Set([
  "blocked-findings",
  "stable-convergence",
]);

export interface AutopilotConflicts {
  /** Claims the critic or validation marked as disputed. */
  readonly disputedClaims: number;
  /** Blocking findings that say the draft contradicts the candidate's materials. */
  readonly factualityErrors: number;
}

/**
 * Count what only the candidate can settle: disputed claims and blocking
 * factuality findings, such as a date or metric that disagrees with the source.
 */
export function autopilotConflicts(
  artifact: Pick<DraftArtifact, "claims"> | null,
  findings: readonly Pick<ValidationIssue, "severity" | "category">[],
): AutopilotConflicts {
  return {
    disputedClaims: artifact?.claims.filter((claim) => claim.status === "disputed").length ?? 0,
    factualityErrors: findings.filter(
      (finding) => finding.severity === "error" && finding.category === "factuality",
    ).length,
  };
}

export function hasAutopilotConflict(conflicts: AutopilotConflicts): boolean {
  return conflicts.disputedClaims > 0 || conflicts.factualityErrors > 0;
}

export type AutopilotDecision = "continue" | "pause-on-conflict" | "stop";

/**
 * Whether an autopilot run revises again instead of pausing for the candidate.
 *
 * It continues only below the round limit, so the last round always ends in
 * review rather than in an empty round past the limit. A conflict pauses a run
 * that would otherwise have continued.
 */
export function autopilotDecision(input: {
  readonly stopReason: ReadinessStopReason;
  readonly round: number;
  readonly maxRounds: number;
  readonly conflicts: AutopilotConflicts;
}): AutopilotDecision {
  if (!autopilotContinuableStops.has(input.stopReason) || input.round >= input.maxRounds) {
    return "stop";
  }
  return hasAutopilotConflict(input.conflicts) ? "pause-on-conflict" : "continue";
}
