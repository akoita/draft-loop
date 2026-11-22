import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type CohortCaseExpectations,
  cohortJudgeInput,
  cohortJudgeQuestions,
  cohortJudgeVerdicts,
  defaultJudgeThresholds,
  tuneJudgeThresholds,
} from "./cohort-judge.js";

const expectations: CohortCaseExpectations = {
  mustCover: [
    { id: "x-registration", fact: "State registration since 2017." },
    { id: "x-audit", fact: "Keep the 71% to 88% audit result." },
  ],
  prohibitedClaims: [{ id: "x-als", claim: "Holds an ALS certificate." }],
};

const clean = {
  "must-cover:x-registration": 0.9,
  "must-cover:x-audit": 0.8,
  "attribution-inflation": 0.1,
  "scope-stretch": 0.2,
  "unsupported-claim": 0.05,
};

describe("cohort judge", () => {
  it("asks one question per must-cover fact and one per other mode", () => {
    const names = cohortJudgeQuestions(expectations).map(({ name }) => name);
    expect(names).toEqual([
      "must-cover:x-registration",
      "must-cover:x-audit",
      "attribution-inflation",
      "scope-stretch",
      "unsupported-claim",
    ]);
  });

  it("sends the profile, the draft and the case's unsupported claims", () => {
    expect(cohortJudgeInput({ profile: "P", draft: "D", expectations })).toEqual({
      sourceProfile: "P",
      draft: "D",
      unsupportedClaims: ["Holds an ALS certificate."],
    });
  });

  it("passes a clean draft and fails each mode on its own signal", () => {
    expect(Object.values(cohortJudgeVerdicts(clean))).toEqual(["pass", "pass", "pass", "pass"]);
    expect(
      cohortJudgeVerdicts({ ...clean, "must-cover:x-audit": 0.3 })["must-cover-omission"],
    ).toBe("fail");
    expect(cohortJudgeVerdicts({ ...clean, "scope-stretch": 0.7 })["scope-stretch"]).toBe("fail");
  });

  it("fails closed when the model refused a question", () => {
    const verdicts = cohortJudgeVerdicts({
      ...clean,
      "must-cover:x-audit": null,
      "attribution-inflation": null,
    });
    expect(verdicts["must-cover-omission"]).toBe("fail");
    expect(verdicts["attribution-inflation"]).toBe("fail");
  });

  it("tunes a threshold only where the tuning rounds hold both labels", () => {
    const rounds = [
      { probabilities: { ...clean, "scope-stretch": 0.35 }, labels: { "scope-stretch": "fail" } },
      { probabilities: { ...clean, "scope-stretch": 0.15 }, labels: { "scope-stretch": "pass" } },
      { probabilities: clean, labels: { "unsupported-claim": "pass" } },
    ] as const;
    const tuned = tuneJudgeThresholds(rounds);
    expect(tuned["scope-stretch"]).toBe(0.3);
    expect(tuned["unsupported-claim"]).toBe(defaultJudgeThresholds["unsupported-claim"]);
  });

  it("builds valid questions for every cohort case", () => {
    const fixtures = new URL("../fixtures/", import.meta.url);
    const cohorts = readdirSync(fixtures).filter((name) => name.endsWith("-cohort"));
    for (const cohort of cohorts) {
      for (const name of readdirSync(new URL(`${cohort}/`, fixtures))) {
        if (!name.startsWith("case-")) continue;
        const caseExpectations = JSON.parse(
          readFileSync(new URL(`${cohort}/${name}/expectations.json`, fixtures), "utf8"),
        ) as CohortCaseExpectations;
        const names = cohortJudgeQuestions(caseExpectations).map((question) => question.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names.length).toBeGreaterThan(3);
      }
    }
  });
});
