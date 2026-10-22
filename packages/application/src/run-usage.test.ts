import type { ExecutionRecord } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { runUsage, summarizeUsage } from "./run-usage.js";

const call = (overrides: Partial<ExecutionRecord>): ExecutionRecord =>
  ({
    id: "run-1:1:author:attempt:1",
    step: "author",
    status: "completed",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    route: "vertex-ai",
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedUsd: 0.1,
    ...overrides,
  }) as ExecutionRecord;

describe("runUsage", () => {
  it("sums completed calls by company, model and route, counting unpriced calls apart", () => {
    const usage = runUsage([
      call({}),
      call({ estimatedUsd: 0.2 }),
      call({ estimatedUsd: null }),
      call({ provider: "openai", modelId: "gpt-6-luna", route: "openai-api", step: "critic" }),
      call({ status: "failed", estimatedUsd: null, inputTokens: 0, outputTokens: 0 }),
    ]);

    expect(usage).toEqual({
      calls: 4,
      inputTokens: 400,
      outputTokens: 200,
      estimatedUsd: 0.4,
      unpricedCalls: 1,
      lines: [
        {
          company: "anthropic",
          model: "claude-sonnet-5-5",
          route: "vertex-ai",
          calls: 3,
          inputTokens: 300,
          outputTokens: 150,
          estimatedUsd: 0.3,
          unpricedCalls: 1,
        },
        {
          company: "openai",
          model: "gpt-6-luna",
          route: "openai-api",
          calls: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedUsd: 0.1,
          unpricedCalls: 0,
        },
      ],
    });
  });

  it("keeps calls recorded before routes apart from routed ones", () => {
    const { route: _route, ...unrouted } = call({});

    expect(
      runUsage([call({}), unrouted as ExecutionRecord]).lines.map((line) => line.route),
    ).toEqual(["vertex-ai", null]);
  });

  it("reports an empty history as zero usage", () => {
    expect(runUsage([])).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
      unpricedCalls: 0,
      lines: [],
    });
  });
});

describe("summarizeUsage", () => {
  it("passes grouped lines through and totals them", () => {
    const line = {
      company: "anthropic",
      model: "claude-haiku-5-5",
      route: "vertex-ai",
      calls: 2,
      inputTokens: 10,
      outputTokens: 5,
      estimatedUsd: 0.000_000_4,
      unpricedCalls: 0,
    };

    const summary = summarizeUsage([line, { ...line, route: "anthropic-api" }]);

    expect(summary.calls).toBe(4);
    expect(summary.lines).toHaveLength(2);
    expect(summary.estimatedUsd).toBe(0.000_001);
  });
});
