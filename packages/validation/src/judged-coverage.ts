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

/**
 * Requirements the critic reported as a gap: a judged "uncovered" verdict, or a coverage finding
 * of its own about the requirement.
 */
export function criticReportedGapIds(
  assessments: readonly RequirementCoverageAssessment[],
  critiqueFindings: readonly { readonly category: string; readonly requirementId?: string }[],
): readonly string[] {
  return [
    ...assessments
      .filter(({ status, basis }) => status === "uncovered" && basis === "judgement")
      .map(({ requirementId }) => requirementId),
    ...critiqueFindings
      .filter(({ category }) => category === "coverage")
      .flatMap(({ requirementId }) => (requirementId === undefined ? [] : [requirementId])),
  ];
}

/**
 * Token matching misses equivalent phrasing (#1789), so its miss of a critical requirement blocks
 * only when the critic also reports the gap; otherwise the finding stays as a warning. Every other
 * finding is kept unchanged.
 */
export function withWordMatchGapsConfirmed<
  Finding extends {
    readonly code: string;
    readonly severity: "error" | "warning";
    readonly requirementId?: string | undefined;
  },
>(findings: readonly Finding[], criticGapIds: readonly string[]): readonly Finding[] {
  const confirmed = new Set(criticGapIds);
  return findings.map((finding) =>
    finding.code === "uncovered-requirement" &&
    finding.severity === "error" &&
    (finding.requirementId === undefined || !confirmed.has(finding.requirementId))
      ? { ...finding, severity: "warning" as const }
      : finding,
  );
}
