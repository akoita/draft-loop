import type { WorkspaceSettingsPort } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import {
  RunBudgetCeilingConfigError,
  readRunBudgetCeiling,
  runBudgetCeilingMessage,
  runBudgetCeilingViolation,
  withRunBudgetDefaults,
} from "./run-budget-ceiling.js";

const ceiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const env = {
  DRAFT_LOOP_RUN_MAX_ROUNDS: "5",
  DRAFT_LOOP_RUN_MAX_COST_USD: "3",
  DRAFT_LOOP_RUN_MAX_DURATION_MS: "1800000",
};

function settings(documents: Record<string, string>): WorkspaceSettingsPort {
  return {
    read: async (_workspace, name) => documents[name],
    write: async () => undefined,
    remove: async () => false,
  };
}

describe("readRunBudgetCeiling", () => {
  it("reads every limit from the deployment", () => {
    expect(readRunBudgetCeiling(env)).toEqual(ceiling);
    expect(readRunBudgetCeiling({ ...env, DRAFT_LOOP_RUN_MAX_COST_USD: "2.5" }).maxCostUsd).toBe(
      2.5,
    );
  });

  it.each([
    ["a missing limit", { DRAFT_LOOP_RUN_MAX_ROUNDS: undefined }],
    ["an empty limit", { DRAFT_LOOP_RUN_MAX_COST_USD: "" }],
    ["a zero limit", { DRAFT_LOOP_RUN_MAX_COST_USD: "0" }],
    ["a negative limit", { DRAFT_LOOP_RUN_MAX_DURATION_MS: "-1" }],
    ["a fractional round count", { DRAFT_LOOP_RUN_MAX_ROUNDS: "2.5" }],
    ["text", { DRAFT_LOOP_RUN_MAX_COST_USD: "three" }],
  ])("refuses %s", (_label, override) => {
    expect(() => readRunBudgetCeiling({ ...env, ...override })).toThrow(
      RunBudgetCeilingConfigError,
    );
  });
});

describe("runBudgetCeilingViolation", () => {
  it("allows a budget at or under every limit", () => {
    expect(runBudgetCeilingViolation(ceiling, ceiling)).toBeUndefined();
    expect(
      runBudgetCeilingViolation({ maxRounds: 1, maxCostUsd: 0.5, maxDurationMs: 1 }, ceiling),
    ).toBeUndefined();
  });

  it.each([
    [{ ...ceiling, maxRounds: 6 }, "maxRounds"],
    [{ ...ceiling, maxCostUsd: 3.01 }, "maxCostUsd"],
    [{ maxRounds: 3, maxDurationMs: 60_000 }, "maxCostUsd"],
    [{ ...ceiling, maxDurationMs: 1_800_001 }, "maxDurationMs"],
    [{ maxRounds: 3, maxCostUsd: 1 }, "maxDurationMs"],
  ])("names the first limit the ceiling does not allow in %j", (budget, limit) => {
    expect(runBudgetCeilingViolation(budget, ceiling)?.limit).toBe(limit);
  });

  it("explains a refusal with the limit and the ceiling only", () => {
    expect(runBudgetCeilingMessage({ limit: "maxCostUsd", ceiling: 3 })).toBe(
      "The workspace's maxCostUsd is above this deployment's limit of US$3 per run.",
    );
    expect(runBudgetCeilingMessage({ limit: "maxRounds", ceiling: 5 })).toContain("5 rounds");
  });
});

describe("withRunBudgetDefaults", () => {
  it("fills the cost and duration limits a workspace configuration lacks", async () => {
    const port = withRunBudgetDefaults(
      settings({ "workspace.json": JSON.stringify({ id: "w", maxRounds: 3, maxCostUsd: 1 }) }),
      ceiling,
    );

    const text = await port.read("w", "workspace.json");

    expect(JSON.parse(text ?? "")).toEqual({
      id: "w",
      maxRounds: 3,
      maxCostUsd: 1,
      maxDurationMs: 1_800_000,
    });
  });

  it("leaves complete configurations, other documents and malformed text unchanged", async () => {
    const complete = JSON.stringify({ maxRounds: 3, maxCostUsd: 9, maxDurationMs: 1 });
    const port = withRunBudgetDefaults(
      settings({ "workspace.json": complete, "evidence-mode.json": "{}" }),
      ceiling,
    );
    const malformed = withRunBudgetDefaults(settings({ "workspace.json": "{" }), ceiling);

    expect(await port.read("w", "workspace.json")).toBe(complete);
    expect(await port.read("w", "evidence-mode.json")).toBe("{}");
    expect(await port.read("w", "retrieval-mode.json")).toBeUndefined();
    expect(await malformed.read("w", "workspace.json")).toBe("{");
  });
});
