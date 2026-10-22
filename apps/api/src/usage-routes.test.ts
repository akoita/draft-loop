import type { ApplicationService, UsageLine } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;

const executionHistory = [
  {
    step: "author",
    status: "completed",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    route: "vertex-ai",
    inputTokens: 1200,
    outputTokens: 800,
    estimatedUsd: 0.05,
    output: { sections: ["Private draft text"] },
  },
  {
    step: "critic",
    status: "completed",
    provider: "openai",
    modelId: "gpt-6-luna",
    route: "openai-api",
    inputTokens: 900,
    outputTokens: 300,
    estimatedUsd: null,
  },
];

const monthLine: UsageLine = {
  company: "anthropic",
  model: "claude-sonnet-5-5",
  route: "vertex-ai",
  calls: 12,
  inputTokens: 14_000,
  outputTokens: 9_000,
  estimatedUsd: 0.6,
  unpricedCalls: 0,
};

let app: FastifyInstance;

async function build(
  status: ApplicationService["status"],
  monthUsage: (month: string) => Promise<readonly UsageLine[]> = async () => [],
): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: { status } as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage,
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("usage", () => {
  it("reads a run's usage by company, model and route, without its content", async () => {
    const status = vi.fn(async () => ({ executionHistory }) as unknown as RunSnapshot);
    await build(status);

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1/usage",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(status).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      runId: "run-1",
    });
    expect(response.json()).toEqual({
      runId: "run-1",
      workspaceId: "workspace-1",
      calls: 2,
      inputTokens: 2100,
      outputTokens: 1100,
      estimatedUsd: 0.05,
      unpricedCalls: 1,
      lines: [
        {
          company: "anthropic",
          model: "claude-sonnet-5-5",
          route: "vertex-ai",
          calls: 1,
          inputTokens: 1200,
          outputTokens: 800,
          estimatedUsd: 0.05,
          unpricedCalls: 0,
        },
        {
          company: "openai",
          model: "gpt-6-luna",
          route: "openai-api",
          calls: 1,
          inputTokens: 900,
          outputTokens: 300,
          estimatedUsd: 0,
          unpricedCalls: 1,
        },
      ],
    });
    expect(response.body).not.toContain("Private draft text");
  });

  it("answers 404 for a run that does not exist", async () => {
    await build(async () => undefined);

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/missing/usage",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
  });

  it("reads the tenant's month and refuses a malformed month", async () => {
    const monthUsage = vi.fn(async () => [{ ...monthLine, extra: "dropped" }]);
    await build(async () => undefined, monthUsage);

    const response = await app.inject({
      method: "GET",
      url: "/v1/usage?month=2026-10",
      headers: { authorization },
    });
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/usage?month=2026-1",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(monthUsage).toHaveBeenCalledWith("2026-10");
    expect(response.json()).toEqual({
      month: "2026-10",
      calls: 12,
      inputTokens: 14_000,
      outputTokens: 9_000,
      estimatedUsd: 0.6,
      unpricedCalls: 0,
      lines: [monthLine],
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("requires the owner token", async () => {
    await build(async () => undefined);

    const response = await app.inject({ method: "GET", url: "/v1/usage?month=2026-10" });

    expect(response.statusCode).toBe(401);
  });
});
