import { describe, expect, it } from "vitest";

import { judgedCoveredRequirementIds, withoutJudgedUncoveredFindings } from "./judged-coverage.js";
import type { RequirementCoverageAssessment } from "./requirement-coverage-assessment.js";

function assessment(
  requirementId: string,
  status: RequirementCoverageAssessment["status"],
  basis: RequirementCoverageAssessment["basis"],
): RequirementCoverageAssessment {
  return { requirementId, status, basis, evidence: [], rationale: "Fixed rationale." };
}

describe("judgedCoveredRequirementIds", () => {
  it("returns only requirements covered by judgement", () => {
    expect(
      judgedCoveredRequirementIds([
        assessment("judged", "covered", "judgement"),
        assessment("lexical", "covered", "lexical"),
        assessment("protected", "covered", "protected-rule"),
        assessment("unjudged", "needs-judgement", "semantic-candidate"),
        assessment("rejected", "uncovered", "judgement"),
        assessment("gap", "explicit-gap", "lexical"),
      ]),
    ).toEqual(["judged"]);
  });

  it("returns nothing for no assessments", () => {
    expect(judgedCoveredRequirementIds([])).toEqual([]);
  });
});

describe("withoutJudgedUncoveredFindings", () => {
  const findings = [
    { code: "uncovered-requirement", requirementId: "judged", severity: "error" },
    { code: "uncovered-requirement", requirementId: "other", severity: "error" },
    { code: "uncovered-requirement", severity: "warning" },
    { code: "explicit-gap", requirementId: "judged", severity: "warning" },
    { code: "unsupported-claim", requirementId: "judged", severity: "error" },
    { code: "unsupported-claim", severity: "error" },
  ];

  it("removes only the uncovered-requirement finding of each judged requirement", () => {
    expect(withoutJudgedUncoveredFindings(findings, ["judged"])).toEqual(findings.slice(1));
  });

  it("returns the findings unchanged when nothing is judged", () => {
    expect(withoutJudgedUncoveredFindings(findings, [])).toBe(findings);
  });
});
