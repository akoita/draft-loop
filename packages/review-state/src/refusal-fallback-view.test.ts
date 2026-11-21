import type { ExecutionRecord, RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { refusalFallbackViews } from "./refusal-fallback-view.js";

function execution(overrides: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    step: "author",
    round: 1,
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    ...overrides,
  } as ExecutionRecord;
}

function run(executionHistory: readonly ExecutionRecord[]): RunSnapshot {
  return { executionHistory } as unknown as RunSnapshot;
}

describe("the refusal fallback views (#3120)", () => {
  it("is empty when Claude answered every call", () => {
    expect(refusalFallbackViews(run([execution({}), execution({ step: "critic" })]))).toEqual([]);
  });

  it("names each declined call's step, round, both models and the category", () => {
    const views = refusalFallbackViews(
      run([
        execution({}),
        execution({
          step: "revision",
          round: 2,
          modelId: "claude-sonnet-5",
          refusalFallback: { fromModel: "claude-sonnet-5-5", category: "cyber", credit: true },
        }),
      ]),
    );
    expect(views).toEqual([
      {
        step: "revision",
        round: 2,
        fromModel: "claude-sonnet-5-5",
        toModel: "claude-sonnet-5",
        category: "cyber",
      },
    ]);
  });
});
