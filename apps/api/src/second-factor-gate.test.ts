import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { Caller } from "./request-auth.js";
import { registerSecondFactorGate } from "./second-factor-gate.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function server(caller: Caller, members: number) {
  app = Fastify();
  app.decorateRequest("caller", undefined);
  app.addHook("onRequest", async (request) => {
    request.caller = caller;
  });
  registerSecondFactorGate(app, { memberCount: async () => members });
  const ok = async () => ({ ok: true });
  app.delete("/v1/organisation", ok);
  app.delete("/v1/workspaces/:workspaceId", ok);
  app.get("/v1/workspaces/:workspaceId/archive", ok);
  app.get("/v1/workspaces/:workspaceId/export", ok);
  app.get("/v1/workspaces/:workspaceId", ok);
  return app;
}

const member = (role: "owner" | "admin" | "member", secondFactor = false): Caller => ({
  kind: "member",
  tenantId: "org-north",
  memberId: `${role}-1`,
  role,
  ...(secondFactor ? { secondFactor: true as const } : {}),
});

const guarded = [
  ["DELETE", "/v1/organisation"],
  ["DELETE", "/v1/workspaces/r1"],
  ["GET", "/v1/workspaces/r1/archive"],
  ["GET", "/v1/workspaces/r1/export"],
] as const;

describe("the second factor gate (#2952)", () => {
  it.each(guarded)(
    "refuses %s %s to an owner of a shared organisation without a second factor",
    async (method, url) => {
      const api = await server(member("owner"), 3);

      const response = await api.inject({ method, url });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("second_factor_required");
    },
  );

  it.each(guarded)("admits %s %s with a second factor", async (method, url) => {
    const api = await server(member("admin", true), 3);

    expect((await api.inject({ method, url })).statusCode).toBe(200);
  });

  it.each(guarded)("admits %s %s to a person alone in their organisation", async (method, url) => {
    const api = await server(member("owner"), 1);

    expect((await api.inject({ method, url })).statusCode).toBe(200);
  });

  it("leaves other routes, plain members and the owner token to the routes' own checks", async () => {
    expect(
      (await (await server(member("owner"), 3)).inject({ method: "GET", url: "/v1/workspaces/r1" }))
        .statusCode,
    ).toBe(200);
    await app?.close();
    expect(
      (
        await (
          await server(member("member"), 3)
        ).inject({ method: "DELETE", url: "/v1/organisation" })
      ).statusCode,
    ).toBe(200);
    await app?.close();
    expect(
      (
        await (
          await server({ kind: "owner" }, 3)
        ).inject({ method: "DELETE", url: "/v1/organisation" })
      ).statusCode,
    ).toBe(200);
  });
});
