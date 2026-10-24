import {
  type ApplicationService,
  type HostedKnowledgeIntake,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import {
  type CandidateRecordAccess,
  CandidateRecordAccessError,
  type CandidateRecordAssignment,
} from "@draft-loop/storage/candidate-records";
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
import { cloudLoggingOptions } from "./logging.js";
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
  "coach-2": "member",
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

/** In-memory assignments that keep the port's rules for an unknown member. */
function memoryRecordAccess(): CandidateRecordAccess {
  const assignments: CandidateRecordAssignment[] = [];
  return {
    assignMember: async ({ workspaceId, memberId }) => {
      if (roles[memberId] === undefined) {
        throw new CandidateRecordAccessError(
          "member_not_found",
          "The organisation has no such member.",
        );
      }
      const existing = assignments.find(
        (row) => row.workspaceId === workspaceId && row.memberId === memberId,
      );
      if (existing !== undefined) return existing;
      const created = { workspaceId, memberId, assignedAt: now };
      assignments.push(created);
      return created;
    },
    assignCreator: async () => undefined,
    unassignMember: async ({ workspaceId, memberId }) => {
      const index = assignments.findIndex(
        (row) => row.workspaceId === workspaceId && row.memberId === memberId,
      );
      if (index < 0) return false;
      assignments.splice(index, 1);
      return true;
    },
    listRecordMembers: async (workspaceId) =>
      assignments.filter((row) => row.workspaceId === workspaceId),
    listMemberRecords: async (memberId) => assignments.filter((row) => row.memberId === memberId),
    listRecords: async () => ["r1", "r2"],
  };
}

/** Only `r1` and `r2` exist. */
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

async function api(mode: "owner" | "oidc" = "oidc"): Promise<FastifyInstance> {
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
      // Knowledge-base routes are registered but never called here.
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      // Never read: these tests start no run.
      entitlementsFor: () => ({}) as TenantEntitlements,
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
  method: "GET" | "PUT" | "DELETE",
  url: string,
) {
  const response = await server.inject({
    method,
    url,
    headers: { authorization: await as(person) },
  });
  return { status: response.statusCode, body: response.body === "" ? null : response.json() };
}

const audits = () =>
  logLines
    .map((line) => JSON.parse(line) as { audit?: Record<string, string> })
    .flatMap((entry) => (entry.audit === undefined ? [] : [entry.audit]));

describe("candidate record member routes", () => {
  it("lets owners and admins assign and remove members, and members read only", async () => {
    const server = await api();

    const assigned = await call(server, "admin-1", "PUT", "/v1/workspaces/r1/members/coach-1");
    expect(assigned).toEqual({
      status: 200,
      body: {
        workspaceId: "r1",
        memberId: "coach-1",
        email: "coach-1@north.example.test",
        role: "member",
        status: "active",
        assignedAt: now,
      },
    });
    // Assigning again is idempotent.
    expect((await call(server, "owner-1", "PUT", "/v1/workspaces/r1/members/coach-1")).status).toBe(
      200,
    );
    expect((await call(server, "owner-1", "PUT", "/v1/workspaces/r1/members/coach-2")).status).toBe(
      200,
    );

    // An assigned member reads the record's members but changes nothing.
    const listed = await call(server, "coach-1", "GET", "/v1/workspaces/r1/members");
    expect(listed.status).toBe(200);
    expect(listed.body.members.map(({ memberId }: { memberId: string }) => memberId)).toEqual([
      "coach-1",
      "coach-2",
    ]);
    for (const method of ["PUT", "DELETE"] as const) {
      expect(await call(server, "coach-1", method, "/v1/workspaces/r1/members/coach-2")).toEqual({
        status: 403,
        body: {
          error: {
            code: "forbidden",
            message:
              "Only an organisation's owners and admins assign members to candidate records.",
          },
        },
      });
    }
    // A member not assigned to the record cannot tell it from an unknown one.
    const notFound = {
      status: 404,
      body: { error: { code: "not_found", message: "No such workspace." } },
    };
    expect(await call(server, "coach-1", "GET", "/v1/workspaces/r2/members")).toEqual(notFound);
    expect(await call(server, "coach-1", "PUT", "/v1/workspaces/r2/members/coach-1")).toEqual(
      notFound,
    );

    expect(await call(server, "admin-1", "DELETE", "/v1/workspaces/r1/members/coach-2")).toEqual({
      status: 204,
      body: null,
    });
    // The unassigned member loses the record at once.
    expect(await call(server, "coach-2", "GET", "/v1/workspaces/r1/members")).toEqual(notFound);
    expect(
      (await call(server, "admin-1", "DELETE", "/v1/workspaces/r1/members/coach-2")).status,
    ).toBe(404);

    expect(audits()).toEqual([
      expect.objectContaining({
        action: "record_member_assigned",
        organisationId: tenantId,
        workspaceId: "r1",
        memberId: "coach-1",
        actor: "admin-1",
      }),
      expect.objectContaining({ action: "record_member_assigned", actor: "owner-1" }),
      expect.objectContaining({ action: "record_member_assigned", memberId: "coach-2" }),
      expect.objectContaining({
        action: "record_member_unassigned",
        workspaceId: "r1",
        memberId: "coach-2",
        actor: "admin-1",
      }),
    ]);
    expect(logLines.join("\n")).not.toContain("@north.example.test");
  });

  it("answers 404 for an unknown member or workspace", async () => {
    const server = await api();
    expect(await call(server, "owner-1", "PUT", "/v1/workspaces/r1/members/nobody")).toEqual({
      status: 404,
      body: {
        error: { code: "member_not_found", message: "The organisation has no such member." },
      },
    });
    for (const [method, url] of [
      ["GET", "/v1/workspaces/never-created/members"],
      ["PUT", "/v1/workspaces/never-created/members/coach-1"],
      ["DELETE", "/v1/workspaces/never-created/members/coach-1"],
    ] as const) {
      expect(await call(server, "admin-1", method, url)).toEqual({
        status: 404,
        body: { error: { code: "not_found", message: "No such workspace." } },
      });
    }
    expect(audits()).toEqual([]);
  });

  it("lets the owner token assign in its own tenant in owner mode", async () => {
    const server = await api("owner");
    expect(
      (await call(server, "owner-token", "PUT", "/v1/workspaces/r2/members/coach-2")).status,
    ).toBe(200);
    const listed = await call(server, "owner-token", "GET", "/v1/workspaces/r2/members");
    expect(listed.body).toEqual({
      workspaceId: "r2",
      members: [
        {
          memberId: "coach-2",
          email: "coach-2@north.example.test",
          role: "member",
          status: "active",
          assignedAt: now,
        },
      ],
    });
    expect(audits()).toEqual([
      expect.objectContaining({ action: "record_member_assigned", actor: "owner-token" }),
    ]);
  });
});
