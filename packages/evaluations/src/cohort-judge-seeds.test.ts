import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { type CaseSeeds, plantedModes, seededDrafts } from "./cohort-judge-seeds.js";

const fixtures = new URL("../fixtures/", import.meta.url);
const seeds = JSON.parse(
  readFileSync(new URL("failure-taxonomy/seeds.json", fixtures), "utf8"),
) as { readonly cases: Readonly<Record<string, CaseSeeds>> };
const labels = JSON.parse(
  readFileSync(new URL("failure-taxonomy/labels.json", fixtures), "utf8"),
) as {
  readonly rounds: readonly {
    readonly id: string;
    readonly cohort: string;
    readonly split: string;
  }[];
};

describe("planted failures", () => {
  it("covers every train and dev case, with one sentence per must-cover fact", () => {
    const cases = new Map(
      labels.rounds
        .filter(({ split }) => split !== "held-out")
        .map(({ id, cohort }) => [id.replace(/-r\d+$/u, ""), cohort]),
    );
    for (const [caseName, cohort] of cases) {
      const caseSeeds = seeds.cases[caseName];
      expect(caseSeeds, caseName).toBeDefined();
      for (const mode of plantedModes) expect(caseSeeds?.[mode].length).toBeGreaterThan(10);
      const expectations = JSON.parse(
        readFileSync(new URL(`${cohort}/${caseName}/expectations.json`, fixtures), "utf8"),
      ) as { readonly mustCover: readonly { readonly id: string }[] };
      expect(Object.keys(caseSeeds?.mustCover ?? {}).sort()).toEqual(
        expectations.mustCover.map(({ id }) => id).sort(),
      );
    }
  });

  it("plants only modes the real draft passes, and labels only the planted mode", () => {
    const caseSeeds = seeds.cases["case-nurse"] as CaseSeeds;
    const copies = seededDrafts({
      roundId: "case-nurse-r9",
      draft: "Real draft.",
      labels: {
        "attribution-inflation": "fail",
        "scope-stretch": "pass",
        "unsupported-claim": "pass",
      },
      seeds: caseSeeds,
    });
    expect(copies.map(({ id }) => id)).toEqual([
      "case-nurse-r9+scope-stretch",
      "case-nurse-r9+unsupported-claim",
      "case-nurse-r9+must-cover",
    ]);
    expect(copies[0]?.draft).toBe(`Real draft.\n${caseSeeds["scope-stretch"]}`);
    expect(copies[0]?.labels).toEqual({ "scope-stretch": "fail" });
    expect(copies[2]?.labels).toEqual({ "must-cover-omission": "pass" });
    expect(copies[2]?.draft).toContain(caseSeeds.mustCover["n-audit"] ?? "missing");
  });
});
