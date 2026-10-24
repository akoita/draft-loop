import type { ApplicationService, HostedKnowledgeIntake } from "@draft-loop/application";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import { cloudLoggingOptions } from "./logging.js";
import type { Caller } from "./request-auth.js";
import {
  type ApiApplication,
  registerTenantApplications,
  type TenantApplication,
  TenantContextMissingError,
  tenantIdOf,
} from "./tenant-context.js";

const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };

/** A stand-in tenant application whose every answer names its tenant. */
function fakeApplication(tenantId: string): TenantApplication {
  return {
    service: { whoAmI: () => tenantId } as unknown as ApplicationService,
    workspaceRoot: (workspaceId) => `${tenantId}/${workspaceId}`,
    enqueueRun: async () => undefined,
    monthUsage: async () => [],
    knowledgeIntake: {
      listKnowledgeBases: async () => [{ id: `${tenantId}-base` }],
    } as unknown as HostedKnowledgeIntake,
    knowledgeStore: { id: "knowledge", reference: `${tenantId}/knowledge` },
    sensitivityRules: {} as TenantApplication["sensitivityRules"],
    consents: {} as TenantApplication["consents"],
    recordArchives: {} as TenantApplication["recordArchives"],
  };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A server whose callers come from a test header: `owner`, or a member's tenant id. */
async function tenantServer(
  options: { readonly ownerTenantId?: string; readonly cacheSize?: number } = {},
  logLines?: string[],
) {
  const applicationFor = vi.fn(fakeApplication);
  const server = Fastify(
    logLines === undefined
      ? {}
      : { logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }) },
  );
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    const header = request.headers["x-test-caller"];
    if (typeof header !== "string") return;
    request.caller =
      header === "owner"
        ? { kind: "owner" }
        : { kind: "member", tenantId: header, memberId: `${header}-member`, role: "member" };
  });
  const application = registerTenantApplications(server, {
    budgetCeiling,
    applicationFor,
    ...options,
  });
  const whoAmI = () => (application.service as unknown as { whoAmI(): string }).whoAmI();
  server.post("/test", async (request) => {
    // Read after an await, so the tenant must survive the handler's async steps too.
    const bases = await application.knowledgeIntake?.listKnowledgeBases();
    return {
      service: whoAmI(),
      root: application.workspaceRoot("w"),
      store: application.knowledgeStore?.reference,
      bases: bases?.map(({ id }) => id),
      body: request.body,
    };
  });
  app = server;
  return { server, application, applicationFor };
}

function call(server: FastifyInstance, caller: string | undefined) {
  return server.inject({
    method: "POST",
    url: "/test",
    headers: caller === undefined ? {} : { "x-test-caller": caller },
    payload: { note: "kept" },
  });
}

describe("tenantIdOf", () => {
  it("takes a member's organisation and the owner's configured tenant", () => {
    const member: Caller = { kind: "member", tenantId: "org-a", memberId: "m-1", role: "admin" };
    expect(tenantIdOf(member, "owner-tenant")).toBe("org-a");
    expect(tenantIdOf({ kind: "owner" }, "owner-tenant")).toBe("owner-tenant");
    expect(tenantIdOf({ kind: "owner" }, undefined)).toBeUndefined();
    expect(tenantIdOf(undefined, "owner-tenant")).toBeUndefined();
  });
});

describe("registerTenantApplications", () => {
  it("serves each request from its caller's tenant, composing each tenant once", async () => {
    const { server, applicationFor } = await tenantServer({ ownerTenantId: "owner-tenant" });

    const a = await call(server, "org-a");
    const b = await call(server, "org-b");
    const owner = await call(server, "owner");
    await call(server, "org-a");

    expect(a.json()).toEqual({
      service: "org-a",
      root: "org-a/w",
      store: "org-a/knowledge",
      bases: ["org-a-base"],
      body: { note: "kept" },
    });
    expect(b.json()).toMatchObject({ service: "org-b", root: "org-b/w", bases: ["org-b-base"] });
    expect(owner.json()).toMatchObject({ service: "owner-tenant", root: "owner-tenant/w" });
    expect(applicationFor.mock.calls.map(([tenantId]) => tenantId)).toEqual([
      "org-a",
      "org-b",
      "owner-tenant",
    ]);
  });

  it("logs each request's tenant and member ids, and nothing it sent", async () => {
    const lines: string[] = [];
    const { server } = await tenantServer({}, lines);

    await call(server, "org-a");

    const completed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.message === "request completed");
    expect(completed).toMatchObject({ tenantId: "org-a", memberId: "org-a-member" });
    expect(lines.join("\n")).not.toContain("kept");
  });

  it("fails closed when a route runs without a tenant", async () => {
    const { server, application } = await tenantServer();

    expect((await call(server, "owner")).statusCode).toBe(500);
    expect((await call(server, undefined)).statusCode).toBe(500);
    expect(() => application.workspaceRoot("w")).toThrow(TenantContextMissingError);
    expect(() => application.service.initialize).toThrow(TenantContextMissingError);
    await expect(application.monthUsage("2026-10")).rejects.toThrow(TenantContextMissingError);
  });

  it("keeps a bounded number of tenants composed, dropping the least recently used", async () => {
    const { server, applicationFor } = await tenantServer({ cacheSize: 2 });

    for (const tenantId of ["org-a", "org-b", "org-a", "org-c", "org-a", "org-b"]) {
      expect((await call(server, tenantId)).json().service).toBe(tenantId);
    }

    expect(applicationFor.mock.calls.map(([tenantId]) => tenantId)).toEqual([
      "org-a",
      "org-b",
      "org-c",
      "org-b",
    ]);
  });

  it("never replays one tenant's idempotent result to another", async () => {
    const { server, application } = await tenantServer();
    server.post("/once", async (request) =>
      application.idempotency?.once("runs:w", "key-1", {}, async () => request.caller),
    );
    const once = (caller: string) =>
      server.inject({ method: "POST", url: "/once", headers: { "x-test-caller": caller } });

    const first = await once("org-a");
    const replay = await once("org-a");
    const other = await once("org-b");

    expect(replay.json()).toEqual(first.json());
    expect(other.json()).toMatchObject({ kind: "member", tenantId: "org-b" });
  });
});

describe("buildApi with tenants", () => {
  it("refuses one fixed application alongside the callers' tenants", async () => {
    const application: ApiApplication = { ...fakeApplication("org-a"), budgetCeiling };
    await expect(
      buildApi({
        ownerToken: "owner-token-for-tests-0123456789abcdef",
        application,
        tenants: { budgetCeiling, applicationFor: fakeApplication },
      }),
    ).rejects.toThrow("not both");
  });
});
