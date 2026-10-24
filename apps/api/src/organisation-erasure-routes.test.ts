import type { ApplicationService, HostedKnowledgeIntake } from "@draft-loop/application";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { MemberRole, SignedInMember } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { cloudLoggingOptions } from "./logging.js";
import type { TenantErasure } from "./record-erasure-routes.js";
import type { ApiAuthOptions } from "./request-auth.js";
import type { TenantApplication } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };

/** Fictional people of two organisations; each member id is also their sign-in subject. */
const people: Readonly<Record<string, { tenantId: string; role: MemberRole }>> = {
  "owner-north": { tenantId: "org-north", role: "owner" },
  "admin-north": { tenantId: "org-north", role: "admin" },
  "coach-north": { tenantId: "org-north", role: "member" },
  "owner-south": { tenantId: "org-south", role: "owner" },
};

interface MemoryTenant {
  exists: boolean;
  /** Set by the first delete; the organisation never reopens. */
  closing: boolean;
  active: boolean;
  records: Set<string>;
  closed: Set<string>;
  objects: Set<string>;
  rows: number;
  /** Fails the next record erase, as a lost connection would. */
  failNextErase: boolean;
}

function memoryTenant(tenantId: string): MemoryTenant {
  return {
    exists: true,
    closing: false,
    active: false,
    records: new Set(["r1", "r2"]),
    closed: new Set(),
    objects: new Set([
      `tenants/${tenantId}/workspaces/r1/exports/run-1.md`,
      `tenants/${tenantId}/knowledge/knowledge/v-r2`,
      `tenants/${tenantId}/knowledge/knowledge/v-shared`,
    ]),
    rows: 10,
    failNextErase: false,
  };
}

function erasureOf(tenantId: string, tenant: MemoryTenant): TenantErasure {
  const keysOf = (id: string) =>
    [...tenant.objects].filter((key) => key.includes(`/${id}/`) || key.endsWith(`v-${id}`));
  return {
    records: {
      close: async (id) => {
        if (tenant.closed.has(id))
          return { state: "closed", resumed: true, objectKeys: keysOf(id) };
        if (!tenant.records.has(id)) return { state: "missing" };
        tenant.closed.add(id);
        return { state: "closed", resumed: false, objectKeys: keysOf(id) };
      },
      isClosed: async (id) => tenant.closed.has(id),
      erase: async (id) => {
        if (tenant.failNextErase) {
          tenant.failNextErase = false;
          throw new Error("connection lost");
        }
        tenant.closed.delete(id);
        tenant.records.delete(id);
        tenant.rows -= 4;
        return { rowsRemoved: 4, objectKeys: [] };
      },
    },
    blobs: {
      removeObject: async (key) => tenant.objects.delete(key),
      removePrefix: async (keyPrefix) => {
        expect(keyPrefix).toBe(`tenants/${tenantId}/`);
        const keys = [...tenant.objects].filter((key) => key.startsWith(keyPrefix));
        for (const key of keys) tenant.objects.delete(key);
        return keys.length;
      },
    },
    organisation: {
      close: async () => {
        if (!tenant.exists) return { state: "missing" };
        if (tenant.closing) return { state: "closing", resumed: true };
        if (tenant.active) return { state: "run-active" };
        tenant.closing = true;
        return { state: "closing", resumed: false };
      },
      isClosing: async () => tenant.exists && tenant.closing,
      listRecords: async () => [...new Set([...tenant.records, ...tenant.closed])].sort(),
      eraseRemainder: async () => {
        const rowsRemoved = tenant.rows;
        tenant.rows = 0;
        tenant.exists = false;
        return { rowsRemoved };
      },
    },
    objectPrefix: `tenants/${tenantId}/`,
  };
}

function fakeApplication(): TenantApplication {
  return {
    service: {} as ApplicationService,
    workspaceRoot: (workspaceId) => workspaceId,
    enqueueRun: async () => undefined,
    monthUsage: async () => [],
    knowledgeIntake: {} as HostedKnowledgeIntake,
    knowledgeStore: { id: "knowledge", reference: "knowledge" },
    sensitivityRules: {} as TenantApplication["sensitivityRules"],
    consents: {} as TenantApplication["consents"],
    recordArchives: {} as TenantApplication["recordArchives"],
  };
}

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let signIn: ApiAuthOptions;
let app: FastifyInstance | undefined;
let logLines: string[];
let tenants: Record<string, MemoryTenant>;

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
  signIn = {
    mode: "oidc",
    issuer,
    audience,
    webClientId: "draft-loop-web",
    allowHttp: false,
    keys: createLocalJWKSet({ keys: [publicJwk] }),
    resolveSignIn: async ({ subject }): Promise<SignedInMember | undefined> => {
      const person = people[subject];
      return person === undefined || !tenants[person.tenantId]?.exists
        ? undefined
        : { tenantId: person.tenantId, memberId: subject, role: person.role };
    },
  };
});

beforeEach(() => {
  logLines = [];
  tenants = { "org-north": memoryTenant("org-north"), "org-south": memoryTenant("org-south") };
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function api(): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    auth: signIn,
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
    tenants: {
      budgetCeiling,
      applicationFor: fakeApplication,
      recordAccessFor: () => ({}) as CandidateRecordAccess,
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      erasureFor: (tenantId) => {
        const tenant = tenants[tenantId] ?? { ...memoryTenant(tenantId), exists: false };
        tenants[tenantId] = tenant;
        return erasureOf(tenantId, tenant);
      },
    },
  });
  return app;
}

async function as(person: string): Promise<string> {
  if (person === "operator") return `Bearer ${ownerToken}`;
  const token = await new SignJWT({ email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(person)
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  return `Bearer ${token}`;
}

async function remove(server: FastifyInstance, person: string, url: string, confirm: string) {
  const response = await server.inject({
    method: "DELETE",
    url,
    headers: { authorization: await as(person) },
    payload: { confirm },
  });
  return {
    status: response.statusCode,
    code: response.body === "" ? undefined : (response.json().error?.code as string | undefined),
  };
}

const erasureLines = () =>
  logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.erasure !== undefined)
    .map((entry) => entry.erasure);

describe("organisation erasure routes", () => {
  it("lets the owner delete their organisation, records and objects included", async () => {
    const server = await api();
    const own = (person: string, confirm = "org-north") =>
      remove(server, person, "/v1/organisation", confirm);

    expect(await own("admin-north")).toEqual({ status: 403, code: "forbidden" });
    expect(await own("coach-north")).toEqual({ status: 403, code: "forbidden" });
    // The operator's token reaches only operator routes in sign-in mode.
    expect((await own("operator")).status).toBe(401);
    expect(await own("owner-north", "org-south")).toEqual({
      status: 400,
      code: "confirmation_mismatch",
    });
    expect(tenants["org-north"]?.exists).toBe(true);

    expect(await own("owner-north")).toEqual({ status: 204, code: undefined });
    expect(tenants["org-north"]).toMatchObject({ exists: false, rows: 0 });
    expect(tenants["org-north"]?.records.size).toBe(0);
    expect(tenants["org-north"]?.objects.size).toBe(0);
    expect(tenants["org-south"]).toMatchObject({ exists: true, rows: 10 });
    expect(tenants["org-south"]?.objects.size).toBe(3);
    expect(erasureLines()).toEqual([
      { organisationId: "org-north", records: 2, objectsRemoved: 3, rowsRemoved: 10 },
    ]);
    // The owner's sign-in no longer resolves to any organisation.
    expect((await own("owner-north")).status).toBe(403);
  });

  it("refuses while a run is active and finishes an interrupted deletion", async () => {
    const server = await api();
    const north = tenants["org-north"] as MemoryTenant;
    north.active = true;
    expect(await remove(server, "owner-north", "/v1/organisation", "org-north")).toEqual({
      status: 409,
      code: "run_active",
    });
    expect(north.closed.size).toBe(0);

    north.active = false;
    north.failNextErase = true;
    expect((await remove(server, "owner-north", "/v1/organisation", "org-north")).status).toBe(500);
    expect(north.exists).toBe(true);
    // The organisation is closing: its members are refused, another organisation's are not.
    for (const person of ["owner-north", "coach-north"]) {
      const refused = await server.inject({
        method: "GET",
        url: "/v1/usage?month=2026-10",
        headers: { authorization: await as(person) },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.code).toBe("organisation_closing");
    }
    const south = await server.inject({
      method: "GET",
      url: "/v1/usage?month=2026-10",
      headers: { authorization: await as("owner-south") },
    });
    expect(south.statusCode).toBe(200);
    expect(await remove(server, "owner-north", "/v1/organisation", "org-north")).toEqual({
      status: 204,
      code: undefined,
    });
    expect(north).toMatchObject({ exists: false, rows: 0 });
    expect(north.objects.size).toBe(0);
  });

  it("lets only the operator's token delete any organisation by id", async () => {
    const server = await api();
    const url = "/v1/operator/organisations/org-south";
    expect((await remove(server, "owner-south", url, "org-south")).status).toBe(401);
    expect(await remove(server, "operator", url, "org-north")).toEqual({
      status: 400,
      code: "confirmation_mismatch",
    });
    expect(await remove(server, "operator", url, "org-south")).toEqual({
      status: 204,
      code: undefined,
    });
    expect(tenants["org-south"]).toMatchObject({ exists: false, rows: 0 });
    expect(tenants["org-north"]).toMatchObject({ exists: true, rows: 10 });
    expect(await remove(server, "operator", url, "org-south")).toEqual({
      status: 404,
      code: "not_found",
    });
    expect(
      await remove(server, "operator", "/v1/operator/organisations/org-never", "org-never"),
    ).toEqual({ status: 404, code: "not_found" });
  });
});
