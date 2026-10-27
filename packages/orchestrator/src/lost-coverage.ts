import type { RequirementCoverageAssessment, ValidationIssue } from "@draft-loop/validation";

import { COVERAGE_BLOCK_DROPPED_CODE } from "./dropped-coverage.js";

export const COVERAGE_LOST_CODE = "coverage-lost";

const lostCoverageMessage =
  "This requirement was covered in the previous version but is not covered in this one; check that the revision still shows it.";

/**
 * Content-free warnings for requirements the previous round's critique found covered, on any
 * basis, that this round's critique no longer finds covered (#1861). The revision-time check only
 * sees blocks the critic cited that disappeared; this one compares the two verdicts, so a reworded
 * block, a word-match requirement or a re-judged one cannot drop out of coverage unannounced. A
 * requirement already reported as dropped by the revision is not reported twice.
 */
export function lostCoverageFindings(input: {
  readonly previous: readonly RequirementCoverageAssessment[] | undefined;
  readonly current: readonly RequirementCoverageAssessment[] | undefined;
  readonly findings: readonly ValidationIssue[];
}): readonly ValidationIssue[] {
  if (input.previous === undefined || input.current === undefined) return Object.freeze([]);
  const coveredBefore = new Set(
    input.previous
      .filter((assessment) => assessment.status === "covered")
      .map((assessment) => assessment.requirementId),
  );
  const alreadyReported = new Set(
    input.findings
      .filter((finding) => finding.code === COVERAGE_BLOCK_DROPPED_CODE)
      .map((finding) => finding.requirementId),
  );
  const reported = new Set<string>();
  const findings: ValidationIssue[] = [];
  for (const assessment of input.current) {
    const { requirementId } = assessment;
    if (
      (assessment.status !== "uncovered" && assessment.status !== "needs-judgement") ||
      !coveredBefore.has(requirementId) ||
      alreadyReported.has(requirementId) ||
      reported.has(requirementId)
    ) {
      continue;
    }
    reported.add(requirementId);
    findings.push(
      Object.freeze({
        code: COVERAGE_LOST_CODE,
        category: "coverage",
        severity: "warning",
        message: lostCoverageMessage,
        requirementId,
      }),
    );
  }
  return Object.freeze(findings);
}
