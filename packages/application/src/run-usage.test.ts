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
    const usage = runUsage({
      executionHistory: [
        call({}),
        call({ estimatedUsd: 0.2 }),
        call({ estimatedUsd: null }),
        call({ provider: "openai", modelId: "gpt-6-luna", route: "openai-api", step: "critic" }),
        call({ status: "failed", estimatedUsd: null, inputTokens: 0, outputTokens: 0 }),
      ],
    });

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

  it("counts the application plan step's calls with the run's executions", () => {
    const step = (name: "plan" | "review", provider: string, modelId: string, route: string) => ({
      step: name,
      provider,
      modelId,
      route,
      inputTokens: 10,
      outputTokens: 5,
      estimatedUsd: 0.01,
      completedAt: "2026-10-22T10:00:00.000Z",
    });
    const usage = runUsage({
      executionHistory: [call({})],
      applicationPlan: {
        schemaVersion: 1,
        plan: {} as never,
        review: null,
        revisedPlan: null,
        steps: [
          step("plan", "anthropic", "claude-sonnet-5-5", "vertex-ai"),
          step("review", "openai", "gpt-6-luna", "openai-api"),
        ],
      },
    });

    expect(usage).toMatchObject({ calls: 3, inputTokens: 120, estimatedUsd: 0.12 });
    expect(usage.lines.map((line) => [line.route, line.calls])).toEqual([
      ["vertex-ai", 2],
      ["openai-api", 1],
    ]);
  });

  it("keeps calls recorded before routes apart from routed ones", () => {
    const { route: _route, ...unrouted } = call({});

    expect(
      runUsage({ executionHistory: [call({}), unrouted as ExecutionRecord] }).lines.map(
        (line) => line.route,
      ),
    ).toEqual(["vertex-ai", null]);
  });

  it("reports an empty history as zero usage", () => {
    expect(runUsage({ executionHistory: [] })).toEqual({
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
