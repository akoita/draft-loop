import type { ApplicationService } from "@draft-loop/application";
import { CliUserError } from "@draft-loop/application";
import { createMemoryRunSpanStore, type RunSpanRecord } from "@draft-loop/storage/run-spans";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const trace = "/v1/workspaces/workspace-1/runs/run-1/trace";

const workflow: RunSpanRecord = {
  workspaceId: "workspace-1",
  runId: "run-1",
  spanId: "s1",
  parentSpanId: null,
  name: "invoke_workflow",
  startedAt: "2026-11-11T08:00:00.000Z",
  endedAt: "2026-11-11T08:00:09.000Z",
  status: "error",
  attributes: { "draftloop.run.id": "run-1" },
};
const author: RunSpanRecord = {
  ...workflow,
  spanId: "s2",
  parentSpanId: "s1",
  name: "invoke_agent",
  startedAt: "2026-11-11T08:00:01.000Z",
  endedAt: null,
  status: null,
  attributes: { "draftloop.step": "author", "gen_ai.usage.input_tokens": 1200 },
};

let app: FastifyInstance;

async function build(readWorkspace: ApplicationService["readWorkspace"], withSpans = true) {
  const runSpans = createMemoryRunSpanStore();
  await runSpans.put(author);
  await runSpans.put(workflow);
  await runSpans.put({ ...workflow, workspaceId: "workspace-2" });
  await runSpans.put({ ...workflow, runId: "run-2" });
  app = await buildApi({
    ownerToken,
    logger: false,
    application: {
      service: { readWorkspace } as unknown as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
    ...(withSpans ? { runSpans } : {}),
  });
}

afterEach(async () => {
  await app.close();
});

describe("a run's trace", () => {
  it("lists the run's spans in start order, and only that run's", async () => {
    await build(async () => ({ id: "workspace-1" }) as never);

    const response = await app.inject({ method: "GET", url: trace, headers: { authorization } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      spans: [
        {
          span_id: "s1",
          parent_span_id: null,
          name: "invoke_workflow",
          started_at: "2026-11-11T08:00:00.000Z",
          ended_at: "2026-11-11T08:00:09.000Z",
          status: "error",
          attributes: { "draftloop.run.id": "run-1" },
        },
        {
          span_id: "s2",
          parent_span_id: "s1",
          name: "invoke_agent",
          started_at: "2026-11-11T08:00:01.000Z",
          ended_at: null,
          status: null,
          attributes: { "draftloop.step": "author", "gen_ai.usage.input_tokens": 1200 },
        },
      ],
    });
  });

  it("answers an empty trace for a run nothing was recorded for", async () => {
    await build(async () => ({ id: "workspace-1" }) as never);

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-9/trace",
      headers: { authorization },
    });

    expect(response.json()).toEqual({ spans: [] });
  });

  it("reads no span when the workspace is refused, and needs the caller's token", async () => {
    await build(async () => {
      throw new CliUserError("Workspace not found.");
    });

    const refused = await app.inject({ method: "GET", url: trace, headers: { authorization } });
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect(refused.body).not.toContain("invoke_workflow");

    const anonymous = await app.inject({ method: "GET", url: trace });
    expect(anonymous.statusCode).toBe(401);
  });

  it("refuses a malformed run id and is not served without a span store", async () => {
    await build(async () => ({ id: "workspace-1" }) as never);
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/has%20space/trace",
      headers: { authorization },
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();

    await build(async () => ({ id: "workspace-1" }) as never, false);
    const absent = await app.inject({ method: "GET", url: trace, headers: { authorization } });
    expect(absent.statusCode).toBe(404);
  });
});
