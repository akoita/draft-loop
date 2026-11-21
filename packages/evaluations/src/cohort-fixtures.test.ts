import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Every full-CV cohort case (#1105) names only evidence ids that its own fictional profile
 * holds, and only numbered requirement ids that its own job description lists.
 */

const fixtures = new URL("../fixtures/", import.meta.url);
const cohorts = readdirSync(fixtures).filter((name) => name.endsWith("-cohort"));

interface Expectations {
  readonly caseId: string;
  readonly requirementExpectations: readonly { readonly requirementId: string }[];
  readonly [section: string]: unknown;
}

function caseDirectories(cohort: string): readonly URL[] {
  const root = new URL(`${cohort}/`, fixtures);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("case-"))
    .map((entry) => new URL(`${entry.name}/`, root));
}

function sourceIdsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(sourceIdsIn);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === "sourceIds" && Array.isArray(inner) ? (inner as string[]) : sourceIdsIn(inner),
  );
}

describe("full-CV cohort fixtures", () => {
  const cases = cohorts.flatMap(caseDirectories);

  it("include the non-tech cohort", () => {
    expect(cohorts).toContain("non-tech-cv-cohort");
    expect(cases.length).toBeGreaterThanOrEqual(12);
  });

  for (const directory of cases) {
    it(`stay closed over their own ids: ${directory.pathname.split("/").slice(-3, -1).join("/")}`, () => {
      const profile = readFileSync(new URL("candidate-profile.md", directory), "utf8");
      const job = readFileSync(new URL("job-description.md", directory), "utf8");
      const expectations = JSON.parse(
        readFileSync(new URL("expectations.json", directory), "utf8"),
      ) as Expectations;
      const evidenceIds = new Set(
        [...profile.matchAll(/<!-- evidence-id: ([\w-]+) -->/gu)].map((match) => match[1]),
      );
      const requirementIds = new Set([...job.matchAll(/\[(r\d+)\]/gu)].map((match) => match[1]));
      for (const id of sourceIdsIn(expectations)) {
        expect(evidenceIds.has(id), `${expectations.caseId}: ${id}`).toBe(true);
      }
      // Older cases name requirements by topic instead of an [rN] marker in the job text.
      const numbered = expectations.requirementExpectations.filter(({ requirementId }) =>
        /^r\d+$/u.test(requirementId),
      );
      for (const { requirementId } of numbered) {
        expect(requirementIds.has(requirementId), `${expectations.caseId}: ${requirementId}`).toBe(
          true,
        );
      }
    });
  }
});
