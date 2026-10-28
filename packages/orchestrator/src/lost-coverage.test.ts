import type { RequirementCoverageAssessment } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";

import { COVERAGE_LOST_CODE, lostCoverageFindings } from "./lost-coverage.js";

function assessment(
  requirementId: string,
  status: RequirementCoverageAssessment["status"],
  basis: RequirementCoverageAssessment["basis"] = "judgement",
): RequirementCoverageAssessment {
  return { requirementId, status, basis, evidence: [], rationale: "Fictional." };
}

describe("lostCoverageFindings", () => {
  it("reports each requirement covered before and not now, on any basis", () => {
    const findings = lostCoverageFindings({
      previous: [
        assessment("judged", "covered"),
        assessment("word-match", "covered", "lexical"),
        assessment("kept", "covered"),
        assessment("never", "uncovered"),
        assessment("gap", "covered"),
      ],
      current: [
        assessment("judged", "uncovered"),
        assessment("word-match", "needs-judgement", "semantic-candidate"),
        assessment("kept", "covered", "lexical"),
        assessment("never", "uncovered"),
        assessment("gap", "explicit-gap", "lexical"),
      ],
      findings: [],
    });
    expect(findings.map(({ code, requirementId }) => [code, requirementId])).toEqual([
      [COVERAGE_LOST_CODE, "judged"],
      [COVERAGE_LOST_CODE, "word-match"],
    ]);
    expect(findings.every(({ severity }) => severity === "warning")).toBe(true);
  });

  it("leaves a requirement the revision already reported as dropped, and the first round", () => {
    const previous = [assessment("req-1", "covered")];
    const current = [assessment("req-1", "uncovered")];
    expect(
      lostCoverageFindings({
        previous,
        current,
        findings: [
          {
            code: "coverage-block-dropped",
            severity: "warning",
            message: "dropped",
            requirementId: "req-1",
          },
        ],
      }),
    ).toEqual([]);
    expect(lostCoverageFindings({ previous: undefined, current, findings: [] })).toEqual([]);
  });
});
