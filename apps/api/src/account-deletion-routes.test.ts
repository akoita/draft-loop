import type { ApplicationService, HostedKnowledgeIntake } from "@draft-loop/application";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type {
  MemberRecord,
  MemberRole,
  SignedInMember,
  TenantDirectory,
} from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import type { TenantEntitlements } from "./entitlement-gate.js";
import type { IdentityAccounts } from "./identity-accounts.js";
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
        if (tenant.active) return { state: "run-active" };
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
  deletedAccounts = [];
  failIdentity = false;
  tenants = { "org-north": memoryTenant("org-north"), "org-south": memoryTenant("org-south") };
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

let deletedAccounts: string[];
let failIdentity: boolean;

const identityAccounts: IdentityAccounts = {
  deleteAccount: async (subject) => {
    if (failIdentity) throw new Error("identity provider down");
    deletedAccounts.push(subject);
  },
};

/** Only the member list is read by these routes; the rest of the directory is never reached. */
const directory = {
  listMembers: async (organisationId: string): Promise<readonly MemberRecord[]> =>
    Object.entries(people)
      .filter(([, person]) => person.tenantId === organisationId)
      .map(([memberId, person]) => ({
        organisationId,
        memberId,
        email: `${memberId}@example.test`,
        role: person.role,
        status: "active",
        invitedAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      })),
} as unknown as TenantDirectory;

async function api(
  auth: ApiAuthOptions = signIn,
  accounts: IdentityAccounts | undefined = identityAccounts,
): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    auth,
    directory,
    ...(accounts === undefined ? {} : { identityAccounts: accounts }),
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
    tenants: {
      ...(auth.mode === "owner" ? { ownerTenantId: "owner" } : {}),
      budgetCeiling,
      applicationFor: fakeApplication,
      recordAccessFor: () => ({}) as CandidateRecordAccess,
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      // Never read: these tests start no run.
      entitlementsFor: () => ({}) as TenantEntitlements,
      erasureFor: (tenantId) => {
        const tenant = tenants[tenantId] ?? { ...memoryTenant(tenantId), exists: false };
        tenants[tenantId] = tenant;
        return erasureOf(tenantId, tenant);
      },
    },
  });
  return app;
}

async function as(person: string, roles: readonly string[] = []): Promise<string> {
  if (person === "operator") return `Bearer ${ownerToken}`;
  const token = await new SignJWT({
    email_verified: true,
    email: `${person}@example.test`,
    ...(roles.length === 0 ? {} : { realm_access: { roles } }),
  })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(person)
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  return `Bearer ${token}`;
}

async function deleteAccount(server: FastifyInstance, person: string, confirm: string) {
  const response = await server.inject({
    method: "DELETE",
    url: "/v1/account",
    headers: { authorization: await as(person) },
    payload: { confirm },
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

const accountLines = () =>
  logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.accountDeletion !== undefined)
    .map((entry) => entry.accountDeletion);

describe("account deletion route", () => {
  it("erases a person's one-person organisation, then their sign-in account", async () => {
    const server = await api();
    expect(await deleteAccount(server, "owner-south", "someone@example.test")).toMatchObject({
      status: 400,
      body: { error: { code: "confirmation_mismatch" } },
    });
    expect(tenants["org-south"]?.exists).toBe(true);

    // The typed address matches whatever its case and surrounding spaces.
    expect(await deleteAccount(server, "owner-south", " Owner-South@Example.test ")).toEqual({
      status: 200,
      body: { identity: "deleted" },
    });
    expect(tenants["org-south"]).toMatchObject({ exists: false, rows: 0 });
    expect(tenants["org-south"]?.objects.size).toBe(0);
    expect(tenants["org-north"]).toMatchObject({ exists: true, rows: 10 });
    expect(deletedAccounts).toEqual(["owner-south"]);
    expect(accountLines()).toEqual([
      {
        organisationId: "org-south",
        records: 2,
        objectsRemoved: 3,
        rowsRemoved: 10,
        identity: "deleted",
      },
    ]);
    // Nothing of the person's address reaches the log.
    expect(logLines.join("\n")).not.toContain("owner-south@example.test");
  });

  it("refuses a person who shares their organisation, and a running run", async () => {
    const server = await api();
    for (const person of ["owner-north", "coach-north"]) {
      expect(await deleteAccount(server, person, `${person}@example.test`)).toMatchObject({
        status: 409,
        body: { error: { code: "organisation_has_members" } },
      });
    }
    expect(tenants["org-north"]?.exists).toBe(true);

    const south = tenants["org-south"] as MemoryTenant;
    south.active = true;
    expect(await deleteAccount(server, "owner-south", "owner-south@example.test")).toMatchObject({
      status: 409,
      body: { error: { code: "run_active" } },
    });
    expect(south.exists).toBe(true);
    expect(deletedAccounts).toEqual([]);
  });

  it("says the sign-in account was kept when the identity provider cannot delete it", async () => {
    failIdentity = true;
    const server = await api();
    expect(await deleteAccount(server, "owner-south", "owner-south@example.test")).toEqual({
      status: 200,
      body: { identity: "kept" },
    });
    expect(tenants["org-south"]?.exists).toBe(false);
    expect(logLines.some((line) => line.includes("sign-in account not deleted"))).toBe(true);

    await app?.close();
    tenants["org-south"] = memoryTenant("org-south");
    const withoutClient = await api(signIn, undefined);
    expect(await deleteAccount(withoutClient, "owner-south", "owner-south@example.test")).toEqual({
      status: 200,
      body: { identity: "kept" },
    });
    expect(deletedAccounts).toEqual([]);
  });

  it("keeps an account that holds the operator role, with or without a second factor", async () => {
    const server = await api();
    const response = await server.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { authorization: await as("owner-south", ["draft-loop-operator"]) },
      payload: { confirm: "owner-south@example.test" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "operator_account" } });
    expect(tenants["org-south"]?.exists).toBe(true);
    expect(deletedAccounts).toEqual([]);
  });

  it("is reached only by the person's own sign-in", async () => {
    const server = await api();
    const operator = await server.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { authorization: await as("operator") },
      payload: { confirm: "owner-south@example.test" },
    });
    expect(operator.statusCode).toBe(401);
    expect(tenants["org-south"]?.exists).toBe(true);
  });
});
