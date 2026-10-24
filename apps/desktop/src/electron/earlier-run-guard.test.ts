import { createFixtureReviewState } from "@draft-loop/ui/model";
import { describe, expect, it } from "vitest";
import {
  type EarlierRunScope,
  earlierRunFor,
  isChosenEarlierRunId,
  refusesEarlierRunAction,
  runBelongsToApplication,
  withEarlierRun,
} from "./earlier-run-guard.js";

function scope(latestRunId: string | undefined, runIds: readonly string[]): EarlierRunScope {
  return {
    application: {
      runs: runIds.map((id) => ({
        id,
        state: "stopped",
        startedAt: "2026-10-13T08:00:00.000Z",
        updatedAt: "2026-10-13T08:00:00.000Z",
      })) as never,
    },
    latestRunId,
  };
}

describe("the earlier-run guard", () => {
  const twoRuns = scope("run-b", ["run-a", "run-b"]);

  it("knows which runs belong to the application", () => {
    expect(runBelongsToApplication(twoRuns, "run-a")).toBe(true);
    expect(runBelongsToApplication(twoRuns, "run-b")).toBe(true);
    expect(runBelongsToApplication(twoRuns, "run-other")).toBe(false);
  });

  it("marks only a scoped run that is not the latest", () => {
    expect(earlierRunFor(twoRuns, "run-a")).toEqual({ latestRunId: "run-b" });
    expect(earlierRunFor(twoRuns, "run-b")).toBeNull();
    expect(earlierRunFor(undefined, "run-a")).toBeNull();
    expect(earlierRunFor(scope(undefined, []), "pending")).toBeNull();
  });

  it("refuses changes to an earlier run and allows them on the latest", () => {
    for (const type of ["finding-decision", "edit-block", "approve", "export", "resume"] as const) {
      expect(refusesEarlierRunAction(twoRuns, "run-a", type)).toBe(true);
      expect(refusesEarlierRunAction(twoRuns, "run-b", type)).toBe(false);
    }
  });

  it("allows actions that change no run, and anything outside an application", () => {
    for (const type of ["start", "set-autopilot", "acknowledge-provider-transmission"] as const) {
      expect(refusesEarlierRunAction(twoRuns, "run-a", type)).toBe(false);
    }
    expect(refusesEarlierRunAction(undefined, "run-a", "approve")).toBe(false);
  });

  it("lets only the chosen earlier run take approval, export and finding decisions", () => {
    const chosen = { ...scope("run-c", ["run-a", "run-b", "run-c"]), chosenRunId: "run-b" };
    expect(earlierRunFor(chosen, "run-b")).toEqual({ latestRunId: "run-c", chosen: true });
    expect(earlierRunFor(chosen, "run-a")).toEqual({ latestRunId: "run-c" });
    for (const type of ["approve", "export", "finding-decision"] as const) {
      expect(refusesEarlierRunAction(chosen, "run-b", type)).toBe(false);
      expect(refusesEarlierRunAction(chosen, "run-a", type)).toBe(true);
    }
    for (const type of ["request-revision", "edit-block", "resume", "pause", "stop"] as const) {
      expect(refusesEarlierRunAction(chosen, "run-b", type)).toBe(true);
      expect(refusesEarlierRunAction(chosen, "run-c", type)).toBe(false);
    }
    expect(isChosenEarlierRunId(chosen, "run-b")).toBe(true);
    expect(isChosenEarlierRunId(chosen, "run-a")).toBe(false);
    // A choice of the latest run leaves it the latest, with every change open.
    const latestChosen = { ...chosen, chosenRunId: "run-c" };
    expect(earlierRunFor(latestChosen, "run-c")).toBeNull();
    expect(isChosenEarlierRunId(latestChosen, "run-c")).toBe(false);
  });

  it("adds the marker to a review state only when there is one", () => {
    const state = createFixtureReviewState();
    expect(withEarlierRun(state, null)).toBe(state);
    expect(withEarlierRun(state, { latestRunId: "run-b" })).toEqual({
      ...state,
      earlierRun: { latestRunId: "run-b" },
    });
  });
});
