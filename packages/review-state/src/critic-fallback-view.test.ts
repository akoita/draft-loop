import type { ExecutionRecord, RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { criticFallbackView } from "./critic-fallback-view.js";

function execution(overrides: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    step: "author",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    ...overrides,
  } as ExecutionRecord;
}

function run(executionHistory: readonly ExecutionRecord[]): RunSnapshot {
  return { executionHistory } as unknown as RunSnapshot;
}

const switched = {
  fromProvider: "openai",
  fromModel: "gpt-6.1-terra",
  errorClass: "quota-exhausted",
  round: 2,
};

describe("the critic fallback view (#3123)", () => {
  it("is null while the run keeps its critic", () => {
    expect(
      criticFallbackView(run([execution({}), execution({ step: "critic", provider: "openai" })])),
    ).toBeNull();
  });

  it("names both critics, the error class and the round", () => {
    const view = criticFallbackView(
      run([
        execution({}),
        execution({ step: "critic", provider: "openai", modelId: "gpt-6.1-terra" }),
        execution({
          step: "critic",
          provider: "mistral",
          modelId: "mistral-large-3",
          criticFallback: switched,
        }),
      ]),
    );
    expect(view).toEqual({
      ...switched,
      toProvider: "mistral",
      toModel: "mistral-large-3",
      sameCompanyAsAuthor: false,
    });
  });

  it("flags a fallback from the author's company", () => {
    const view = criticFallbackView(
      run([
        execution({}),
        execution({
          step: "critic",
          provider: "Anthropic",
          modelId: "claude-haiku-5-5",
          criticFallback: switched,
        }),
      ]),
    );
    expect(view?.sameCompanyAsAuthor).toBe(true);
  });
});
