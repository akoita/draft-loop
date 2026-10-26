import { describe, expect, it } from "vitest";

import {
  criticReportedGapIds,
  judgedCoveredRequirementIds,
  withoutJudgedUncoveredFindings,
  withWordMatchGapsConfirmed,
} from "./judged-coverage.js";
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

  it("also settles a dropped-covering-block warning once the requirement is judged covered", () => {
    const dropped = [
      { code: "coverage-block-dropped", requirementId: "judged", severity: "warning" },
      { code: "coverage-block-dropped", requirementId: "other", severity: "warning" },
    ];
    expect(withoutJudgedUncoveredFindings(dropped, ["judged"])).toEqual(dropped.slice(1));
  });
});

describe("word-match coverage gaps", () => {
  it("counts the critic's judged gaps and its own coverage findings as reported", () => {
    expect(
      criticReportedGapIds(
        [
          assessment("judged-gap", "uncovered", "judgement"),
          assessment("lexical-gap", "uncovered", "lexical"),
          assessment("covered", "covered", "judgement"),
        ],
        [
          { category: "coverage", requirementId: "critic-gap" },
          { category: "coverage" },
          { category: "factuality", requirementId: "not-coverage" },
        ],
      ),
    ).toEqual(["judged-gap", "critic-gap"]);
  });

  it("blocks on a word-match miss only when the critic confirms it, keeping other findings", () => {
    const findings = [
      { code: "uncovered-requirement", requirementId: "word-match-only", severity: "error" },
      { code: "uncovered-requirement", requirementId: "confirmed", severity: "error" },
      { code: "uncovered-requirement", requirementId: "minor", severity: "warning" },
      { code: "uncovered-requirement", severity: "error" },
      { code: "unsupported-claim", requirementId: "word-match-only", severity: "error" },
    ] as const;

    expect(withWordMatchGapsConfirmed(findings, ["confirmed"])).toEqual([
      { code: "uncovered-requirement", requirementId: "word-match-only", severity: "warning" },
      findings[1],
      findings[2],
      { code: "uncovered-requirement", severity: "warning" },
      findings[4],
    ]);
  });
});
