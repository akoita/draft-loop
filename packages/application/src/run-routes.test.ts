import type { ExecutionRecord, RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { runRoutesLine, runStepRoutes } from "./run-routes.js";

function execution(
  step: ExecutionRecord["step"],
  status: ExecutionRecord["status"],
  route?: string,
): ExecutionRecord {
  return {
    id: `${step}-${status}-${route ?? "none"}`,
    runId: "run-1",
    contextSnapshotId: "snapshot-1",
    round: 1,
    step,
    status,
    provider: step === "critic" ? "openai" : "anthropic",
    ...(route === undefined ? {} : { route }),
    modelId: "model-1",
    providerRequestId: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: null,
    completedAt: "2026-10-21T10:00:00.000Z",
  };
}

function snapshot(executions: readonly ExecutionRecord[]): Pick<RunSnapshot, "executionHistory"> {
  return { executionHistory: executions };
}

describe("runStepRoutes", () => {
  it("lists each step's routes once, in first-use order, so a route change shows", () => {
    const history = snapshot([
      execution("author", "completed", "vertex-ai"),
      execution("critic", "completed", "openai-api"),
      execution("revision", "completed", "vertex-ai"),
      execution("revision", "completed", "anthropic-api"),
      execution("critic", "completed", "openai-api"),
    ]);

    expect(runStepRoutes(history)).toEqual([
      { step: "author", route: "vertex-ai" },
      { step: "critic", route: "openai-api" },
      { step: "revision", route: "vertex-ai" },
      { step: "revision", route: "anthropic-api" },
    ]);
    expect(runRoutesLine(history)).toBe(
      "routes: author=vertex-ai critic=openai-api revision=vertex-ai revision=anthropic-api",
    );
  });

  it("shows a fallback with the route it left and its cause", () => {
    const fallback = {
      ...execution("author", "completed", "anthropic-api"),
      routeFallback: { from: "vertex-ai", cause: "route-unavailable" },
    };
    const history = snapshot([execution("author", "completed", "vertex-ai"), fallback]);

    expect(runStepRoutes(history)).toEqual([
      { step: "author", route: "vertex-ai" },
      {
        step: "author",
        route: "anthropic-api",
        fallback: { from: "vertex-ai", cause: "route-unavailable" },
      },
    ]);
    expect(runRoutesLine(history)).toBe(
      "routes: author=vertex-ai author=anthropic-api(fallback from vertex-ai: route-unavailable)",
    );
  });

  it("leaves out failed calls and calls recorded before routes, rather than guessing", () => {
    const history = snapshot([
      execution("author", "failed", "vertex-ai"),
      execution("author", "completed"),
    ]);

    expect(runStepRoutes(history)).toEqual([]);
    expect(runRoutesLine(history)).toBeUndefined();
  });
});
