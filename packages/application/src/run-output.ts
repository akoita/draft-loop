import type { ExecutionCoverageJudgement, RunEvent, RunSnapshot } from "@draft-loop/orchestrator";
import type { RequirementCoverageBasis } from "@draft-loop/validation";

import type { ApplicationIo } from "./index.js";

/*
 * Local run output: event lines, the snapshot summary, and the requirement coverage listing.
 *
 * Everything here is content-free except the critic rationales of coverage assessments, which
 * are user-visible critic text. Requirement and block text is never printed.
 */

function countDetail(event: RunEvent, key: string): number {
  const value = event.details?.[key];
  return typeof value === "number" ? value : 0;
}

/** The readable summary for a `coverage.judged` event; counts only. */
function coverageJudgedLine(event: RunEvent): string {
  const invalid = countDetail(event, "invalid");
  const unanswered = countDetail(event, "unanswered");
  const version = event.details?.instructionsVersion;
  return (
    `Coverage judgement: ${countDetail(event, "requested")} requested, ` +
    `${countDetail(event, "satisfied")} satisfied, ` +
    `${countDetail(event, "notSatisfied")} not satisfied` +
    `${invalid > 0 ? `, ${invalid} invalid` : ""}` +
    `${unanswered > 0 ? `, ${unanswered} unanswered` : ""}` +
    ` (${typeof version === "string" ? version : "unversioned"})`
  );
}

export function runEventLine(event: RunEvent): string {
  if (event.type === "coverage.judged") return coverageJudgedLine(event);
  return `event ${event.type}: state=${event.state} round=${event.round}${event.step === null ? "" : ` step=${event.step}`}`;
}

export function outputEvents(events: readonly RunEvent[], io: ApplicationIo): void {
  for (const event of events) io.write(runEventLine(event));
}

export function outputSnapshot(snapshot: RunSnapshot, io: ApplicationIo): void {
  io.write(
    `run ${snapshot.runId}: state=${snapshot.state} round=${snapshot.round} approval=${snapshot.approval}`,
  );
  io.write(
    `costUsd=${snapshot.totalCostUsd.toFixed(6)} executions=${snapshot.executionHistory.length}`,
  );
  if (snapshot.latestEvaluation !== null) {
    io.write(
      `evaluation: ready=${snapshot.latestEvaluation.ready} stop=${snapshot.latestEvaluation.stopReason}`,
    );
  }
  if (snapshot.findings.length > 0) {
    const errors = snapshot.findings.filter((finding) => finding.severity === "error").length;
    io.write(`findings: total=${snapshot.findings.length} errors=${errors}`);
  }
  if (snapshot.lastError !== null) {
    io.write(
      `providerFailure: code=${snapshot.lastError.code} provider=${snapshot.lastError.provider} step=${snapshot.lastError.step} attempt=${snapshot.lastError.attempt}/${snapshot.lastError.maxAttempts} retryable=${snapshot.lastError.retryable}`,
    );
  }
}

const coverageBasisLabels: Readonly<Record<RequirementCoverageBasis, string>> = Object.freeze({
  lexical: "matching wording",
  "protected-rule": "strict rule",
  "semantic-candidate": "semantic candidate (needs judgement)",
  judgement: "critic judgement",
});

/**
 * The assessments of the latest completed critic execution of the current round that carries a
 * coverage judgement, in requirement order. Absent when no critic execution judged coverage.
 */
export function currentRoundCoverageJudgement(
  snapshot: RunSnapshot,
): ExecutionCoverageJudgement | undefined {
  return snapshot.executionHistory
    .filter(
      (execution) =>
        execution.step === "critic" &&
        execution.status === "completed" &&
        execution.round === snapshot.round &&
        execution.coverageJudgement !== undefined,
    )
    .at(-1)?.coverageJudgement;
}

/** Lists each requirement's coverage assessment; prints nothing when none was recorded. */
export function outputCoverageAssessments(snapshot: RunSnapshot, io: ApplicationIo): void {
  const judgement = currentRoundCoverageJudgement(snapshot);
  if (judgement === undefined) return;
  io.write(`Requirement coverage (round ${snapshot.round}):`);
  for (const assessment of judgement.assessments) {
    io.write(
      `  [${assessment.status}] ${assessment.requirementId} — ${coverageBasisLabels[assessment.basis]} — ${assessment.rationale}`,
    );
    if (assessment.evidence.length > 0) {
      io.write(`    evidence: ${assessment.evidence.map((item) => item.blockId).join(", ")}`);
    }
  }
}
