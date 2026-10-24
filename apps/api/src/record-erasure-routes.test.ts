import {
  type ApplicationService,
  type HostedKnowledgeIntake,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import {
  type CandidateRecordErasure,
  RecordErasureError,
} from "@draft-loop/storage/record-erasure";
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
import { cloudLoggingOptions } from "./logging.js";
import type { TenantErasure } from "./record-erasure-routes.js";
import type { ApiAuthOptions } from "./request-auth.js";
import type { TenantApplication } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const tenantId = "org-north";
const now = "2026-10-24T09:00:00.000Z";

/** The fictional organisation's people; each member id is also their sign-in subject. */
const roles: Readonly<Record<string, MemberRole>> = {
  "owner-1": "owner",
  "admin-1": "admin",
  "coach-1": "member",
};
const members: MemberRecord[] = Object.entries(roles).map(([memberId, role]) => ({
  organisationId: tenantId,
  memberId,
  email: `${memberId}@north.example.test`,
  role,
  status: "active",
  invitedAt: now,
  updatedAt: now,
}));
const directory = {
  listMembers: async (organisationId: string) => (organisationId === tenantId ? members : []),
} as unknown as TenantDirectory;

/**
 * Records `r1`, `r2` and `busy`, whose run is active; each holds an object. `failNextErase`
 * interrupts an erasure after its objects are deleted, as a crash would.
 */
function memoryErasure() {
  const records = new Set(["r1", "r2", "busy"]);
  const closed = new Set<string>();
  const objects = new Set([
    "tenants/org-north/workspaces/r1/exports/run-1.md",
    "tenants/org-north/knowledge/knowledge/v-r2",
  ]);
  const keysOf = (id: string) =>
    [...objects].filter((key) => key.includes(`/${id}/`) || key.endsWith(`v-${id}`));
  const state = { failNextErase: false };
  const port: CandidateRecordErasure = {
    close: async (id) => {
      if (closed.has(id)) return { state: "closed", resumed: true, objectKeys: keysOf(id) };
      if (!records.has(id)) return { state: "missing" };
      if (id === "busy") return { state: "run-active" };
      closed.add(id);
      return { state: "closed", resumed: false, objectKeys: keysOf(id) };
    },
    isClosed: async (id) => closed.has(id),
    erase: async (id) => {
      if (!closed.has(id)) throw new RecordErasureError("not_closed", "Not closed.");
      if (state.failNextErase) {
        state.failNextErase = false;
        throw new Error("connection lost");
      }
      closed.delete(id);
      records.delete(id);
      return { rowsRemoved: 42, objectKeys: [] };
    },
  };
  const erasure: TenantErasure = {
    records: port,
    blobs: { removeObject: async (key) => objects.delete(key) },
  };
  return { erasure, records, closed, objects, state };
}

function memoryRecordAccess(): CandidateRecordAccess {
  return {
    assignMember: async ({ workspaceId, memberId }) => ({ workspaceId, memberId, assignedAt: now }),
    unassignMember: async () => true,
    listRecordMembers: async (workspaceId) => [
      { workspaceId, memberId: "coach-1", assignedAt: now },
    ],
    listMemberRecords: async (memberId) =>
      memberId === "coach-1" ? [{ workspaceId: "r1", memberId, assignedAt: now }] : [],
    listRecords: async () => ["r1", "r2"],
  };
}

function fakeApplication(): TenantApplication {
  return {
    service: {
      readWorkspace: async (root: string) => {
        if (root !== "r1" && root !== "r2") throw new WorkspaceNotFoundError(root);
        return {};
      },
    } as unknown as ApplicationService,
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
      const role = roles[subject];
      return role === undefined ? undefined : { tenantId, memberId: subject, role };
    },
  };
});

beforeEach(() => {
  logLines = [];
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function api(erasure: TenantErasure, mode: "owner" | "oidc" = "oidc") {
  const access = memoryRecordAccess();
  app = await buildApi({
    ownerToken,
    directory,
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
    ...(mode === "oidc" ? { auth: signIn } : {}),
    tenants: {
      budgetCeiling,
      ...(mode === "owner" ? { ownerTenantId: tenantId } : {}),
      applicationFor: fakeApplication,
      recordAccessFor: () => access,
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      erasureFor: (id) => {
        if (id !== tenantId) throw new Error("another tenant's erasure");
        return erasure;
      },
    },
  });
  return app;
}

async function as(person: string): Promise<string> {
  if (person === "owner-token") return `Bearer ${ownerToken}`;
  const token = await new SignJWT({ email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(person)
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  return `Bearer ${token}`;
}

async function call(
  server: FastifyInstance,
  person: string,
  method: "GET" | "DELETE",
  url: string,
  payload?: object,
) {
  const response = await server.inject({
    method,
    url,
    headers: { authorization: await as(person) },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return {
    status: response.statusCode,
    code: response.body === "" ? undefined : (response.json().error?.code as string | undefined),
  };
}

const erase = (server: FastifyInstance, person: string, id: string, confirm = id) =>
  call(server, person, "DELETE", `/v1/workspaces/${id}`, { confirm });

const erasureLines = () =>
  logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.erasure !== undefined);

describe("candidate record erasure route", () => {
  it("lets owners and admins erase a record they confirm, and nobody else", async () => {
    const memory = memoryErasure();
    const server = await api(memory.erasure);

    expect(await erase(server, "coach-1", "r1")).toEqual({ status: 403, code: "forbidden" });
    expect(await erase(server, "owner-1", "r1", "r2")).toEqual({
      status: 400,
      code: "confirmation_mismatch",
    });
    expect((await call(server, "owner-1", "DELETE", "/v1/workspaces/r1")).status).toBe(400);
    // The owner token is the operator's in sign-in mode; it never reaches a workspace.
    expect((await erase(server, "owner-token", "r1")).status).toBe(401);
    expect(memory.closed.size).toBe(0);
    expect(memory.records.has("r1")).toBe(true);

    expect(await erase(server, "admin-1", "r1")).toEqual({ status: 204, code: undefined });
    expect(memory.records.has("r1")).toBe(false);
    expect([...memory.objects]).toEqual(["tenants/org-north/knowledge/knowledge/v-r2"]);
    expect(await erase(server, "owner-1", "r1")).toEqual({ status: 404, code: "not_found" });
    expect(await erase(server, "owner-1", "never")).toEqual({ status: 404, code: "not_found" });
    expect(await erase(server, "owner-1", "r2")).toEqual({ status: 204, code: undefined });
    expect(memory.objects.size).toBe(0);
  });

  it("refuses a record whose run is active and leaves it open", async () => {
    const memory = memoryErasure();
    const server = await api(memory.erasure);
    expect(await erase(server, "owner-1", "busy")).toEqual({ status: 409, code: "run_active" });
    expect(memory.closed.has("busy")).toBe(false);
  });

  it("hides a closed record from every route and finishes an interrupted erasure", async () => {
    const memory = memoryErasure();
    const server = await api(memory.erasure);
    expect((await call(server, "owner-1", "GET", "/v1/workspaces/r1/members")).status).toBe(200);

    memory.state.failNextErase = true;
    expect((await erase(server, "owner-1", "r1")).status).toBe(500);
    // The objects went first; the rows are still there, closed to everyone.
    expect(memory.objects.has("tenants/org-north/workspaces/r1/exports/run-1.md")).toBe(false);
    expect(memory.closed.has("r1")).toBe(true);
    for (const person of ["owner-1", "coach-1"]) {
      expect(await call(server, person, "GET", "/v1/workspaces/r1/members")).toEqual({
        status: 404,
        code: "not_found",
      });
    }
    expect((await call(server, "owner-1", "GET", "/v1/workspaces/r2/members")).status).toBe(200);

    expect(await erase(server, "owner-1", "r1")).toEqual({ status: 204, code: undefined });
    expect(memory.records.has("r1")).toBe(false);
    expect(erasureLines().map((entry) => entry.erasure)).toEqual([
      { workspaceId: "r1", resumed: true, objectKeys: 0, objectsRemoved: 0, rowsRemoved: 42 },
    ]);
    // Content-free: ids, counts and the tenant and member on the request's logger.
    expect(erasureLines()[0]).toMatchObject({
      tenantId,
      memberId: "owner-1",
      message: "candidate record erased",
    });
  });

  it("serves the owner token in owner-token mode", async () => {
    const memory = memoryErasure();
    const server = await api(memory.erasure, "owner");
    expect(await erase(server, "owner-token", "r1")).toEqual({ status: 204, code: undefined });
    expect(erasureLines().map((entry) => entry.erasure)).toEqual([
      { workspaceId: "r1", resumed: false, objectKeys: 1, objectsRemoved: 1, rowsRemoved: 42 },
    ]);
  });
});
