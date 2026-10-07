import type { RequirementCoverageAssessment } from "./requirement-coverage-assessment.js";

const uncoveredRequirementCode = "uncovered-requirement";

/** Requirements the critic judged satisfied; no other basis or status counts. */
export function judgedCoveredRequirementIds(
  assessments: readonly RequirementCoverageAssessment[],
): readonly string[] {
  return assessments
    .filter(({ status, basis }) => status === "covered" && basis === "judgement")
    .map(({ requirementId }) => requirementId);
}

/**
 * Drops only the deterministic `uncovered-requirement` finding of each judged
 * requirement. Every other finding, including protected-rule and explicit-gap
 * findings, is kept unchanged.
 */
export function withoutJudgedUncoveredFindings<
  Finding extends { readonly code: string; readonly requirementId?: string | undefined },
>(findings: readonly Finding[], judgedRequirementIds: readonly string[]): readonly Finding[] {
  if (judgedRequirementIds.length === 0) return findings;
  const judged = new Set(judgedRequirementIds);
  return findings.filter(
    (finding) =>
      !(
        finding.code === uncoveredRequirementCode &&
        finding.requirementId !== undefined &&
        judged.has(finding.requirementId)
      ),
  );
}
