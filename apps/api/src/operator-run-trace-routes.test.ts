import { createMemoryRunSpanStore, type RunSpanRecord } from "@draft-loop/storage/run-spans";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";

import { registerOperatorRunTraceRoutes } from "./operator-run-trace-routes.js";
import type { Caller } from "./request-auth.js";

const requestId = "4bf92f3577b34da6a3ce929d0e0e4736";
const url = "/v1/operator/organisations/org-a/runs/run-1/trace";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(caller: Caller | undefined, logs: Record<string, unknown>[] = []) {
  const stores = new Map([["org-a", createMemoryRunSpanStore()]]);
  const span: RunSpanRecord = {
    workspaceId: "ws-1",
    runId: "run-1",
    spanId: "s1",
    parentSpanId: null,
    name: "invoke_agent",
    startedAt: "2026-11-19T08:00:00.000Z",
    endedAt: "2026-11-19T08:00:04.000Z",
    status: "error",
    attributes: {
      "draftloop.step": "author",
      "gen_ai.provider.name": "anthropic",
      "error.type": "provider_overloaded",
      "draftloop.request.id": requestId,
    },
  };
  await stores.get("org-a")?.put(span);
  app = Fastify({
    logger: { level: "info", stream: { write: (line: string) => logs.push(JSON.parse(line)) } },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("caller", undefined);
  app.addHook("onRequest", async (request) => {
    request.caller = caller;
  });
  registerOperatorRunTraceRoutes(app, {
    runSpansFor: (organisationId) => stores.get(organisationId) ?? createMemoryRunSpanStore(),
  });
  return app;
}

describe("the operator's run trace", () => {
  it("returns the run's content-free spans, its workspace and request id, and audits the read", async () => {
    const logs: Record<string, unknown>[] = [];
    const api = await start({ kind: "owner" }, logs);
    const response = await api.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      organisation_id: "org-a",
      run_id: "run-1",
      workspace_id: "ws-1",
      request_id: requestId,
    });
    expect(body.spans).toHaveLength(1);
    expect(Object.keys(body.spans[0]).sort()).toEqual([
      "attributes",
      "ended_at",
      "name",
      "parent_span_id",
      "span_id",
      "started_at",
      "status",
    ]);
    expect(logs.find((line) => line.audit !== undefined)?.audit).toEqual({
      action: "run_trace_read",
      actor: "owner-token",
      organisationId: "org-a",
      runId: "run-1",
      spans: 1,
    });
  });

  it("answers 404 for a run the organisation has no trace for", async () => {
    const api = await start({ kind: "owner" });
    const response = await api.inject({
      method: "GET",
      url: "/v1/operator/organisations/org-b/runs/run-1/trace",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("trace_not_found");
  });

  it("refuses members and anonymous callers", async () => {
    for (const caller of [
      undefined,
      { kind: "member", tenantId: "org-a", memberId: "m-1", role: "owner" } as unknown as Caller,
    ]) {
      const api = await start(caller);
      const response = await api.inject({ method: "GET", url });
      expect(response.statusCode).toBe(403);
      await api.close();
      app = undefined;
    }
  });
});
