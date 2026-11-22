import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { agreementWithLabels, cohortRoles, scoreCohortDraft } from "./cohort-scorer.js";

const caseDirectory = new URL(
  "../fixtures/fresh-software-engineering-cohort/case-d/",
  import.meta.url,
);
const profile = readFileSync(new URL("candidate-profile.md", caseDirectory), "utf8");
const jobDescription = readFileSync(new URL("job-description.md", caseDirectory), "utf8");

function draft(...texts: string[]) {
  return {
    sections: [
      {
        kind: "experience",
        title: "Experience",
        blocks: texts.map((text, index) => ({ id: `b${index}`, type: "paragraph", text })),
      },
    ],
  };
}

const faithful = draft(
  "Ivo Sen · ivo.sen@profile.test",
  "Wickbarrow Sensor Works, Test Systems Developer, June 2015 to October 2018.",
  "Oxbow Robotics Lab, Build and Release Engineer, February 2020 to July 2022. Median local verification went from 22 to 16 minutes in 30 clean build trials.",
  "Kiteframe Robotics, Software Tooling Engineer, Aug 2022 to present.",
  "Career gap from November 2018 to January 2020.",
);

describe("cohortRoles", () => {
  it("reads dated roles and skips gaps and projects", () => {
    expect(cohortRoles(profile)).toEqual([
      {
        evidenceId: "d-role-1",
        employer: "Wickbarrow Sensor Works",
        start: "June 2015",
        end: "October 2018",
      },
      {
        evidenceId: "d-role-2",
        employer: "Oxbow Robotics Lab",
        start: "February 2020",
        end: "July 2022",
      },
      {
        evidenceId: "d-role-3",
        employer: "Kiteframe Robotics",
        start: "August 2022",
        end: "present",
      },
    ]);
  });
});

describe("scoreCohortDraft", () => {
  it("passes a draft that keeps every role, date and number", () => {
    const score = scoreCohortDraft({ artifact: faithful, profile, jobDescription });
    expect(score.verdicts).toEqual({
      "placeholder-left": "pass",
      "altered-number": "pass",
      "role-omission": "pass",
      "chronology-drift": "pass",
    });
  });

  it("fails each mode on its own defect, with content-free reasons", () => {
    const score = scoreCohortDraft({
      artifact: draft(
        "[Your Name] · [Email]",
        "Oxbow Robotics Lab, 2019 to 2022. Verification fell from 22 to 12 minutes.",
        "Kiteframe Robotics, August 2022 to present.",
      ),
      profile,
      jobDescription,
    });
    expect(score.verdicts).toEqual({
      "placeholder-left": "fail",
      "altered-number": "fail",
      "role-omission": "fail",
      "chronology-drift": "fail",
    });
    expect(score.reasons["role-omission"]).toEqual(["d-role-1"]);
    expect(score.reasons["chronology-drift"]).toEqual(["d-role-2", "d-gap-1"]);
    expect(score.reasons["altered-number"]).toEqual(["2 number(s)"]);
  });

  it("treats a missing draft as nothing to score", () => {
    const score = scoreCohortDraft({ artifact: null, profile, jobDescription });
    expect(score.verdicts["role-omission"]).toBe("fail");
    expect(score.verdicts["placeholder-left"]).toBe("pass");
  });
});

describe("other profile formats", () => {
  it("reads '·' headings, short months, employment ids and a short employer name", () => {
    const other = [
      "<!-- evidence-id: a-employment-1 -->",
      "## Bright Silt Consulting · Software Consultant · Jan 2018 to Jun 2020",
      "<!-- evidence-id: a-gap-1 -->",
      "### Career break — July 2020 to March 2021",
    ].join("\n");
    expect(cohortRoles(other)).toEqual([
      {
        evidenceId: "a-employment-1",
        employer: "Bright Silt Consulting",
        start: "Jan 2018",
        end: "Jun 2020",
      },
    ]);
    const kept = scoreCohortDraft({
      artifact: draft(
        "Bright Silt, consultant, January 2018 to June 2020. Career break until 2021.",
      ),
      profile: other,
      jobDescription: "",
    });
    expect(kept.verdicts["role-omission"]).toBe("pass");
    expect(kept.verdicts["chronology-drift"]).toBe("pass");
    const hidden = scoreCohortDraft({
      artifact: draft("Bright Silt, consultant, 01/2018 to 06/2020."),
      profile: other,
      jobDescription: "",
    });
    expect(hidden.reasons["chronology-drift"]).toEqual(["a-gap-1"]);
  });
});

describe("agreementWithLabels", () => {
  it("reports agreement and both rates per mode", () => {
    const pass = {
      "placeholder-left": "pass",
      "altered-number": "pass",
      "role-omission": "pass",
      "chronology-drift": "pass",
    } as const;
    const [placeholder] = agreementWithLabels([
      { scored: { ...pass, "placeholder-left": "fail" }, labels: { "placeholder-left": "fail" } },
      { scored: pass, labels: { "placeholder-left": "fail" } },
      { scored: pass, labels: { "placeholder-left": "pass" } },
    ]);
    expect(placeholder).toEqual({
      mode: "placeholder-left",
      rounds: 3,
      agreement: 2 / 3,
      truePositiveRate: 0.5,
      trueNegativeRate: 1,
    });
  });
});
