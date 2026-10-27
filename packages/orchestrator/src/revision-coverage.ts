import type { RequirementCoverageAssessment } from "@draft-loop/validation";

/**
 * The critic's judged verdict on one requirement of the draft being revised,
 * as the revising author receives it. Covered requirements carry the block ids
 * the critic cited; uncovered requirements carry none.
 */
export interface RevisionRequirementCoverage {
  readonly requirementId: string;
  readonly verdict: "covered" | "uncovered";
  /** The critic's rationale, already validated as a single line of at most 240 characters. */
  readonly rationale: string;
  readonly citedBlockIds: readonly string[];
}

/** The fields of an execution record the projection reads. */
interface CriticExecutionView {
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly round: number;
  readonly step: string;
  readonly status: string;
  readonly coverageJudgement?: {
    readonly assessments: readonly RequirementCoverageAssessment[];
  };
}

/** Project judged assessments; lexical, protected-rule and unjudged assessments are dropped. */
export function projectRevisionCoverage(
  assessments: readonly RequirementCoverageAssessment[],
): readonly RevisionRequirementCoverage[] {
  return Object.freeze(
    assessments.flatMap((assessment): RevisionRequirementCoverage[] => {
      if (assessment.basis !== "judgement") return [];
      if (assessment.status !== "covered" && assessment.status !== "uncovered") return [];
      return [
        Object.freeze({
          requirementId: assessment.requirementId,
          verdict: assessment.status,
          rationale: assessment.rationale,
          citedBlockIds: Object.freeze(
            assessment.status === "covered"
              ? assessment.evidence.map(({ blockId }) => blockId)
              : [],
          ),
        }),
      ];
    }),
  );
}

/**
 * The judged coverage of the draft a revision step revises: the latest
 * completed critic execution of the previous round of the same run and
 * context. Returns `undefined` for a first draft, or when that critic step
 * carries no judgement or no judged requirement.
 */
export function revisionRequirementCoverage(input: {
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly round: number;
  readonly executionHistory: readonly CriticExecutionView[];
}): readonly RevisionRequirementCoverage[] | undefined {
  const assessments = previousRoundCoverageAssessments(input);
  if (assessments === undefined) return undefined;
  const projected = projectRevisionCoverage(assessments);
  return projected.length === 0 ? undefined : projected;
}

/**
 * Every coverage assessment of the previous round's latest completed critic execution of the same
 * run and context, on any basis; `undefined` in round 1 or when that critic judged nothing.
 */
export function previousRoundCoverageAssessments(input: {
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly round: number;
  readonly executionHistory: readonly CriticExecutionView[];
}): readonly RequirementCoverageAssessment[] | undefined {
  const revisedRound = input.round - 1;
  if (revisedRound < 1) return undefined;
  const latestCritique = input.executionHistory
    .filter(
      (execution) =>
        execution.runId === input.runId &&
        execution.contextSnapshotId === input.contextSnapshotId &&
        execution.round === revisedRound &&
        execution.step === "critic" &&
        execution.status === "completed",
    )
    .at(-1);
  return latestCritique?.coverageJudgement?.assessments;
}
