import { describe, expect, it } from "vitest";

import { latestRunId, shouldPoll, startProblem, startRunBody } from "./run-model.js";
import { syntheticBrief, syntheticRun } from "./test-fixtures.js";

describe("run progress", () => {
  it("keeps reading an active run and stops at review or an end", () => {
    expect(shouldPoll(syntheticRun)).toBe(true);
    for (const state of ["awaiting-approval", "paused", "stopped", "approved", "exported"])
      expect(shouldPoll({ ...syntheticRun, state })).toBe(false);
  });

  it("follows the application's newest run", () => {
    const run = (id: string, startedAt: string) => ({ id, startedAt }) as never;
    expect(
      latestRunId({
        runs: [run("old", "2026-10-22T00:00:00Z"), run("new", "2026-10-23T00:00:00Z")],
      } as never),
    ).toBe("new");
  });
});

describe("starting a run", () => {
  it("needs a reviewed brief", () => {
    expect(startProblem(undefined)).toMatch(/job requirements/);
    expect(startProblem(syntheticBrief)).toBe("Mark the job brief reviewed before starting a run.");
    expect(startProblem({ ...syntheticBrief, status: "reviewed" })).toBeUndefined();
    expect(startRunBody(syntheticBrief)).toEqual({
      opportunityBrief: { briefId: "brief-1", version: 2 },
    });
  });
});
