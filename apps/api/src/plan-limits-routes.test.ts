import {
  type ApplicationService,
  type WorkspaceDescriptor,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import {
  type MemberRecord,
  type SignedInMember,
  type TenantDirectory,
  TenantDirectoryError,
} from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import type { TenantEntitlements } from "./entitlement-gate.js";
import type { ApiAuthOptions } from "./request-auth.js";
import type { TenantApplication } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const tenantId = "org-north";
const at = "2026-10-24T09:00:00.000Z";

type Entitlements = NonNullable<Awaited<ReturnType<TenantEntitlements["entitlements"]>>>;

const small: Entitlements = { ...resolveEntitlements("pro"), seats: 2, candidateRecords: 2 };
const unlimited: Entitlements = resolveEntitlements("internal");

const descriptor = {
  id: "r9",
  root: "r9",
  jobDescriptionPath: "job.md",
  sourceDirectory: "sources",
  language: "en",
  outputFormat: "markdown",
  requiredSections: ["Experience"],
  maxRounds: 2,
  maxCostUsd: 1,
  maxDurationMs: 600_000,
  author: { company: "anthropic", model: "claude-opus-5-5" },
  critic: { company: "openai", model: "gpt-6-sol" },
  fixtureMode: true,
} as WorkspaceDescriptor;

let entitlements: Entitlements | undefined;
let records: string[];
let members: MemberRecord[];
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let signIn: ApiAuthOptions;
let app: FastifyInstance | undefined;

const entitlementsRead = vi.fn();
const inviteMember = vi.fn();
const initialize = vi.fn();

function member(email: string, role: MemberRecord["role"] = "member"): MemberRecord {
  return {
    organisationId: tenantId,
    memberId: `m-${email}`,
    email,
    role,
    status: "invited",
    invitedAt: at,
    updatedAt: at,
  };
}

/** A directory that keeps the port's rules for `maxMembers`: duplicates first, then the limit. */
const directory: TenantDirectory = {
  resolveSignIn: async () => undefined,
  createOrganisation: async () => {
    throw new Error("not used");
  },
  listMembers: async () => [...members],
  inviteMember: async (input) => {
    inviteMember(input);
    if (members.some((existing) => existing.email === input.email)) {
      throw new TenantDirectoryError("member_exists", "That email is already invited.");
    }
    if (input.maxMembers !== undefined && members.length >= input.maxMembers) {
      throw new TenantDirectoryError("member_limit_reached", "No seat left.");
    }
    const added = member(input.email, input.role);
    members.push(added);
    return added;
  },
  changeRole: async () => {
    throw new Error("not used");
  },
  removeMember: async (input) => {
    const index = members.findIndex((existing) => existing.memberId === input.memberId);
    if (index < 0) throw new TenantDirectoryError("member_not_found", "No such member.");
    return members.splice(index, 1)[0] as MemberRecord;
  },
};

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
    resolveSignIn: async (): Promise<SignedInMember | undefined> => ({
      tenantId,
      memberId: "m-owner",
      role: "owner",
    }),
  };
});

beforeEach(() => {
  entitlements = small;
  records = [];
  members = [member("owner@north.example.test", "owner")];
  entitlementsRead.mockReset();
  entitlementsRead.mockImplementation(async () => entitlements);
  inviteMember.mockClear();
  initialize.mockReset();
  initialize.mockImplementation(async () => {
    records.push("created");
    return descriptor;
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeApplication(): TenantApplication {
  return {
    service: {
      readWorkspace: async () => {
        throw new WorkspaceNotFoundError("r9");
      },
      initialize,
    } as unknown as ApplicationService,
    workspaceRoot: (workspaceId) => workspaceId,
    enqueueRun: async () => undefined,
    monthUsage: async () => [],
    knowledgeIntake: {} as TenantApplication["knowledgeIntake"],
    knowledgeStore: { id: "knowledge", reference: "knowledge" },
    sensitivityRules: {} as TenantApplication["sensitivityRules"],
    consents: {} as TenantApplication["consents"],
    recordArchives: {} as TenantApplication["recordArchives"],
  };
}

async function api(mode: "owner" | "oidc" = "oidc"): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    directory,
    ...(mode === "oidc" ? { auth: signIn } : {}),
    tenants: {
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      ...(mode === "owner" ? { ownerTenantId: tenantId } : {}),
      applicationFor: fakeApplication,
      recordAccessFor: () =>
        ({
          listRecords: async () => records,
          assignCreator: async () => ({ workspaceId: "r9", memberId: "m-owner", assignedAt: at }),
          unassignMember: async () => true,
          listMemberRecords: async () => [],
        }) as unknown as CandidateRecordAccess,
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      entitlementsFor: () => ({
        entitlements: entitlementsRead,
        ledger: { reserve: vi.fn(), refund: vi.fn() },
      }),
    },
  });
  return app;
}

async function send(server: FastifyInstance, method: "POST" | "PUT", url: string, payload: object) {
  const token = await new SignJWT({ email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("owner-1")
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  const response = await server.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown>,
  });
  return { status: response.statusCode, body: response.json() };
}

const invite = (server: FastifyInstance, email: string) =>
  send(server, "POST", "/v1/organisation/members", { email, role: "member" });
const createRecord = (server: FastifyInstance) =>
  send(server, "PUT", "/v1/workspaces/r9", { fixtureMode: true });

describe("seats", () => {
  it("count the owner and every invitation, and refuse the one past the plan", async () => {
    const server = await api();

    expect((await invite(server, "first@north.example.test")).status).toBe(201);
    const refused = await invite(server, "second@north.example.test");

    expect(refused.status).toBe(409);
    expect(refused.body.error).toEqual({
      code: "plan_limit_reached",
      message: "The organisation already has 2 members, the most its plan allows.",
      limit: "seats",
      value: 2,
    });
    expect(members).toHaveLength(2);
  });

  it("take no second seat for an email already invited", async () => {
    const server = await api();
    expect((await invite(server, "first@north.example.test")).status).toBe(201);

    const again = await invite(server, "first@north.example.test");

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("member_exists");
    expect(members).toHaveLength(2);
  });

  it("free a seat when a member is removed", async () => {
    const server = await api();
    expect((await invite(server, "first@north.example.test")).status).toBe(201);
    expect((await invite(server, "second@north.example.test")).status).toBe(409);
    await directory.removeMember({
      organisationId: tenantId,
      memberId: "m-first@north.example.test",
      actorRole: "owner",
    });

    expect((await invite(server, "second@north.example.test")).status).toBe(201);
  });

  it("are unlimited on a plan with no seat limit, naming no limit to the directory", async () => {
    entitlements = unlimited;
    const server = await api();

    for (const name of ["a", "b", "c"]) {
      expect((await invite(server, `${name}@north.example.test`)).status).toBe(201);
    }
    expect(inviteMember.mock.calls.every(([input]) => input.maxMembers === undefined)).toBe(true);
  });

  it("are refused to an organisation with no plan", async () => {
    entitlements = undefined;
    const server = await api();

    const refused = await invite(server, "first@north.example.test");

    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("plan_required");
    expect(inviteMember).not.toHaveBeenCalled();
  });
});

describe("candidate records", () => {
  it("refuse the record past the plan, saving nothing", async () => {
    records = ["r1", "r2"];
    const server = await api();

    const refused = await createRecord(server);

    expect(refused.status).toBe(409);
    expect(refused.body.error).toEqual({
      code: "plan_limit_reached",
      message: "The organisation already has 2 candidate records, the most its plan allows.",
      limit: "candidateRecords",
      value: 2,
    });
    expect(initialize).not.toHaveBeenCalled();
  });

  it("accept the last slot", async () => {
    records = ["r1"];
    const server = await api();

    expect((await createRecord(server)).status).toBe(201);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("are unlimited on a plan with no record limit", async () => {
    entitlements = unlimited;
    records = Array.from({ length: 50 }, (_, index) => `r${index}`);
    const server = await api();

    expect((await createRecord(server)).status).toBe(201);
  });

  it("are refused to an organisation with no plan", async () => {
    entitlements = undefined;
    const server = await api();

    const refused = await createRecord(server);

    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("plan_required");
    expect(initialize).not.toHaveBeenCalled();
  });
});

describe("owner-token mode", () => {
  it("checks neither the plan nor the count when it creates a record", async () => {
    records = ["r1", "r2", "r3", "r4"];
    entitlements = undefined;
    const server = await api("owner");

    const response = await server.inject({
      method: "PUT",
      url: "/v1/workspaces/r9",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { fixtureMode: true },
    });

    expect(response.statusCode).toBe(201);
    expect(entitlementsRead).not.toHaveBeenCalled();
  });
});
