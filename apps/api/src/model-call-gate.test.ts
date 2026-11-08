import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantEntitlements } from "./entitlement-gate.js";
import { registerModelCallGate } from "./model-call-gate.js";
import type { Caller } from "./request-auth.js";

const now = new Date("2026-11-08T22:00:00.000Z");
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The gate before four stand-in routes, with a fixed caller and a counter of `limit` calls. */
async function server(planId: "beta" | "pro", caller: Caller, used = 0) {
  let calls = used;
  const take = vi.fn(async ({ limit }: { limit: number }) => {
    if (calls >= limit) return { allowed: false as const, used: calls };
    calls += 1;
    return { allowed: true as const, used: calls };
  });
  const tenant = {
    entitlements: async () => resolveEntitlements(planId),
    modelCalls: { take },
  } as unknown as TenantEntitlements;
  app = Fastify();
  app.decorateRequest("caller", undefined);
  app.addHook("onRequest", async (request) => {
    request.caller = caller;
  });
  registerModelCallGate(app, { entitlementsFor: () => tenant, now: () => now });
  const ok = async () => ({ ok: true });
  app.post("/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/actions", ok);
  app.get("/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/live", ok);
  app.post("/v1/workspaces/:workspaceId/applications/:applicationId/material", ok);
  app.post("/v1/workspaces/:workspaceId/profiles/:profileId/derivation", ok);
  app.post("/v1/workspaces/:workspaceId/brief", ok);
  return { app, take };
}

const member: Caller = { kind: "member", tenantId: "org-north", memberId: "m-1", role: "owner" };
const routes = [
  ["POST", "/v1/workspaces/r1/career-interview/sessions/s1/actions", { action: "answer" }],
  ["GET", "/v1/workspaces/r1/career-interview/sessions/s1/live", undefined],
  ["POST", "/v1/workspaces/r1/applications/a1/material", {}],
  ["POST", "/v1/workspaces/r1/profiles/p1/derivation", {}],
] as const;

describe("model calls outside runs", () => {
  it.each(routes)(
    "refuses %s %s for a Beta organisation past 20 a day",
    async (method, url, body) => {
      const { app: api } = await server("beta", member, 20);

      const response = await api.inject({
        method,
        url,
        ...(body === undefined ? {} : { payload: body }),
      });

      expect(response.statusCode).toBe(429);
      expect(response.json().error).toMatchObject({ code: "model_call_cap_reached", limit: 20 });
      expect(response.headers["retry-after"]).toBe(String(2 * 60 * 60));
    },
  );

  it.each(routes)(
    "allows %s %s for a Beta organisation under its bound",
    async (method, url, body) => {
      const { app: api, take } = await server("beta", member, 19);

      const response = await api.inject({
        method,
        url,
        ...(body === undefined ? {} : { payload: body }),
      });

      expect(response.statusCode).toBe(200);
      expect(take).toHaveBeenCalledWith({ limit: 20, now });
    },
  );

  it.each(routes)("never counts %s %s for Pro, which has no cap", async (method, url, body) => {
    const { app: api, take } = await server("pro", member, 1_000);

    const response = await api.inject({
      method,
      url,
      ...(body === undefined ? {} : { payload: body }),
    });

    expect(response.statusCode).toBe(200);
    expect(take).not.toHaveBeenCalled();
  });

  it("counts interview actions only when they ask the interviewer, and never brief extraction", async () => {
    const { app: api, take } = await server("beta", member, 20);
    const act = (action: string) =>
      api.inject({
        method: "POST",
        url: "/v1/workspaces/r1/career-interview/sessions/s1/actions",
        payload: { action },
      });

    expect((await act("confirm")).statusCode).toBe(200);
    expect((await act("pause")).statusCode).toBe(200);
    expect((await act("own_subject")).statusCode).toBe(429);
    const brief = await api.inject({ method: "POST", url: "/v1/workspaces/r1/brief", payload: {} });
    expect(brief.statusCode).toBe(200);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("leaves the owner token uncounted", async () => {
    const { app: api, take } = await server("beta", { kind: "owner" }, 20);

    const response = await api.inject({
      method: "POST",
      url: "/v1/workspaces/r1/applications/a1/material",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(take).not.toHaveBeenCalled();
  });
});
