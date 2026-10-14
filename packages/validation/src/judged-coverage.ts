import type { RequirementCoverageAssessment } from "./requirement-coverage-assessment.js";

/**
 * Findings a later "satisfied" judgement settles: the deterministic token-match miss, and the
 * warning that a revision dropped the block that covered the requirement (#1212).
 */
const judgementSettledCodes = new Set(["uncovered-requirement", "coverage-block-dropped"]);

/** Requirements the critic judged satisfied; no other basis or status counts. */
export function judgedCoveredRequirementIds(
  assessments: readonly RequirementCoverageAssessment[],
): readonly string[] {
  return assessments
    .filter(({ status, basis }) => status === "covered" && basis === "judgement")
    .map(({ requirementId }) => requirementId);
}

/**
 * Drops the `uncovered-requirement` and `coverage-block-dropped` findings of each
 * requirement judged covered. Every other finding, including protected-rule and
 * explicit-gap findings, is kept unchanged.
 */
export function withoutJudgedUncoveredFindings<
  Finding extends { readonly code: string; readonly requirementId?: string | undefined },
>(findings: readonly Finding[], judgedRequirementIds: readonly string[]): readonly Finding[] {
  if (judgedRequirementIds.length === 0) return findings;
  const judged = new Set(judgedRequirementIds);
  return findings.filter(
    (finding) =>
      !(
        judgementSettledCodes.has(finding.code) &&
        finding.requirementId !== undefined &&
        judged.has(finding.requirementId)
      ),
  );
}
