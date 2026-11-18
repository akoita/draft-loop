import type { ApplicationService } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const root = "/tenants/owner/workspaces/workspace-1";
const url = "/v1/workspaces/workspace-1/runs/run-1/requirement-evidence";

const evidence = {
  runId: "run-1",
  mode: "semantic" as const,
  modelId: "fake-model",
  chunkCount: 2,
  grading: "graded" as const,
  requirements: [
    {
      requirementId: "r1",
      text: "Led a cloud migration",
      candidates: [
        {
          chunkId: "c1",
          origin: "both" as const,
          score: 0.91,
          source: "career-notes.md",
          lineStart: 3,
          lineEnd: 7,
          grade: "supports" as const,
        },
      ],
    },
  ],
};

function scriptedService(methods: Partial<ApplicationService>): ApplicationService {
  return new Proxy(methods, {
    get: (target, name) =>
      (target as Record<string | symbol, unknown>)[name] ??
      (() => {
        throw new Error(`unexpected service call: ${String(name)}`);
      }),
  }) as ApplicationService;
}

let app: FastifyInstance;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: scriptedService(methods),
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("run requirement evidence route", () => {
  it("returns the run's map for its workspace", async () => {
    const readWorkspace = vi.fn(async () => ({}) as never);
    const readRunRequirementEvidence = vi.fn(async () => evidence);
    await build({ readWorkspace, readRunRequirementEvidence });
    const response = await app.inject({ method: "GET", url, headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(evidence);
    expect(readWorkspace).toHaveBeenCalledWith(root);
    expect(readRunRequirementEvidence).toHaveBeenCalledWith({ root, runId: "run-1" });
  });

  it("answers 404 for a run with no map", async () => {
    await build({
      readWorkspace: async () => ({}) as never,
      readRunRequirementEvidence: async () => undefined,
    });
    const response = await app.inject({ method: "GET", url, headers: { authorization } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("refuses an unsafe run id", async () => {
    await build({});
    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/..%2Fx/requirement-evidence",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(400);
  });
});
