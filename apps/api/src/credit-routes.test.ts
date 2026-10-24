import {
  type ApplicationService,
  type ApplicationView,
  type WorkspaceDescriptor,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import { type PlanId, resolveEntitlements } from "@draft-loop/schemas/entitlements";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { MemberRole, SignedInMember } from "@draft-loop/storage/tenant-directory";
import type { CreditBalance, PlanAssignment } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import type { ApiAuthOptions } from "./request-auth.js";
import type { TenantApplication } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const tenantId = "org-north";

/** Standard models on both sides, three rounds: two blocks of rounds at the base price of 1. */
const workspace = {
  id: "r1",
  root: "r1",
  jobDescriptionPath: "job.md",
  sourceDirectory: "evidence",
  language: "en",
  outputFormat: "markdown",
  requiredSections: ["Experience"],
  maxRounds: 3,
  maxCostUsd: 2,
  maxDurationMs: 600_000,
  author: { company: "anthropic", model: "claude-opus-5-5" },
  critic: { company: "openai", model: "gpt-6-sol" },
  fixtureMode: true,
} as WorkspaceDescriptor;

const premiumPair = {
  author: { id: "premium-anthropic-author", version: 1 },
  critic: { id: "premium-openai-critic", version: 1 },
};

/** A pro-like plan: economy and standard tiers only. */
function assignment(planId: PlanId = "pro", seats?: number): PlanAssignment {
  return {
    planId,
    catalogVersion: 1,
    overrides: {},
    seats: seats ?? null,
    periodStart: "2026-10-01",
    assignedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** A limited balance in a 10-credit allowance with no grants. */
function balance(allowanceUsed: number, overrides: Partial<CreditBalance> = {}): CreditBalance {
  return {
    periodStart: "2026-10-01",
    periodEnd: "2026-11-01",
    allowance: 10,
    allowanceUsed,
    reserved: 0,
    grantsRemaining: 0,
    remaining: 10 - allowanceUsed,
    unlimited: false,
    ...overrides,
  };
}

interface Scenario {
  assignment: PlanAssignment | undefined;
  balance: CreditBalance;
  workspace: WorkspaceDescriptor;
  application: Partial<ApplicationView> | undefined;
  role: MemberRole;
}

let scenario: Scenario;
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let signIn: ApiAuthOptions;
let app: FastifyInstance | undefined;

const assignmentRead = vi.fn();
const entitlementsRead = vi.fn();
const balanceRead = vi.fn();

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
    resolveSignIn: async ({ subject }): Promise<SignedInMember | undefined> =>
      subject === "member-1" ? { tenantId, memberId: "member-1", role: scenario.role } : undefined,
  };
});

beforeEach(() => {
  scenario = {
    assignment: assignment(),
    balance: balance(0),
    workspace,
    application: undefined,
    role: "member",
  };
  assignmentRead.mockReset();
  assignmentRead.mockImplementation(async () => scenario.assignment);
  entitlementsRead.mockReset();
  entitlementsRead.mockImplementation(async () =>
    scenario.assignment === undefined
      ? undefined
      : resolveEntitlements(scenario.assignment.planId, scenario.assignment.overrides, {
          seats: scenario.assignment.seats ?? undefined,
        }),
  );
  balanceRead.mockReset();
  balanceRead.mockImplementation(async () => scenario.balance);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeApplication(): TenantApplication {
  return {
    service: {
      readWorkspace: async (root: string) => {
        if (root === "missing") throw new WorkspaceNotFoundError(root);
        return scenario.workspace;
      },
      getApplication: async () => scenario.application,
    } as unknown as ApplicationService,
    workspaceRoot: (workspaceId) => workspaceId,
    enqueueRun: async () => undefined,
    monthUsage: async () => [],
    knowledgeIntake: {} as TenantApplication["knowledgeIntake"],
    knowledgeStore: { id: "knowledge", reference: "knowledge" },
    sensitivityRules: {} as TenantApplication["sensitivityRules"],
    consents: {} as ConsentLedger,
    recordArchives: {} as TenantApplication["recordArchives"],
  };
}

async function api(mode: "owner" | "oidc" = "oidc"): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    ...(mode === "oidc" ? { auth: signIn } : {}),
    tenants: {
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      ...(mode === "owner" ? { ownerTenantId: tenantId } : {}),
      applicationFor: fakeApplication,
      recordAccessFor: () =>
        ({
          listRecords: async () => ["r1"],
          listMemberRecords: async () => [{ workspaceId: "r1" }],
        }) as unknown as CandidateRecordAccess,
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      entitlementsFor: () => ({
        entitlements: entitlementsRead,
        assignment: assignmentRead,
        ledger: { reserve: vi.fn(), refund: vi.fn(), balance: balanceRead },
      }),
    },
  });
  return app;
}

async function get(server: FastifyInstance, url: string, as: "member" | "owner" = "member") {
  const token =
    as === "owner"
      ? ownerToken
      : await new SignJWT({ email_verified: true })
          .setProtectedHeader({ alg: "ES256", kid: "key-1" })
          .setIssuer(issuer)
          .setAudience(audience)
          .setSubject("member-1")
          .setExpirationTime("5m")
          .sign(signingKey.privateKey);
  const response = await server.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.statusCode, body: response.json() };
}

describe("GET /v1/organisation/credits", () => {
  it("shows a member the plan, its limits and the balance", async () => {
    scenario.assignment = assignment("team", 5);
    scenario.balance = balance(3, { reserved: 1, remaining: 6 });
    const server = await api();

    const response = await get(server, "/v1/organisation/credits");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      organisationId: tenantId,
      planId: "team",
      entitlements: {
        modelTiers: resolveEntitlements("team", {}, { seats: 5 }).modelTiers,
        runsPerDay: resolveEntitlements("team", {}, { seats: 5 }).runsPerDay,
        concurrentRuns: resolveEntitlements("team", {}, { seats: 5 }).concurrentRuns,
        seats: 5,
        candidateRecords: resolveEntitlements("team", {}, { seats: 5 }).candidateRecords,
      },
      periodStart: "2026-10-01",
      periodEnd: "2026-11-01",
      unlimited: false,
      allowance: 10,
      // 3 settled plus the 1 reserved from the allowance.
      used: 4,
      reserved: 1,
      grantsRemaining: 0,
      remaining: 6,
      warning: false,
    });
  });

  it("is readable by every role", async () => {
    for (const role of ["owner", "admin", "member"] as const) {
      scenario.role = role;
      const server = await api();
      expect((await get(server, "/v1/organisation/credits")).status).toBe(200);
      await server.close();
      app = undefined;
    }
  });

  it("refuses an organisation without a plan", async () => {
    scenario.assignment = undefined;
    const server = await api();

    const response = await get(server, "/v1/organisation/credits");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("plan_required");
    expect(balanceRead).not.toHaveBeenCalled();
  });

  it.each([
    [7, 0, false],
    [8, 0, true],
    [9, 0, true],
    [10, 0, true],
    // Reserved credits count: 5 settled and 3 held is 8 of 10 committed.
    [5, 3, true],
    [5, 2, false],
  ])("flags the warning at 80%%: %i settled, %i reserved", async (settled, held, warning) => {
    scenario.balance = balance(settled, { reserved: held, remaining: 10 - settled - held });
    const server = await api();

    const { body } = await get(server, "/v1/organisation/credits");

    expect(body.warning).toBe(warning);
    expect(body.used).toBe(settled + held);
  });

  it("counts the allowance only, never operator grants, in what is used", async () => {
    // 7 of the allowance settled, 4 held from grants: the allowance is 70% used.
    scenario.balance = balance(7, { reserved: 4, grantsRemaining: 6, remaining: 9 });
    const server = await api();

    const { body } = await get(server, "/v1/organisation/credits");

    expect(body).toMatchObject({ used: 7, reserved: 4, grantsRemaining: 6, remaining: 9 });
    expect(body.warning).toBe(false);
  });

  it("never warns on an unlimited plan, and reports no allowance or remaining", async () => {
    scenario.assignment = assignment("internal");
    scenario.balance = balance(99, {
      allowance: 0,
      unlimited: true,
      remaining: 0,
      reserved: 3,
    });
    const server = await api();

    const { body } = await get(server, "/v1/organisation/credits");

    expect(body).toMatchObject({
      planId: "internal",
      unlimited: true,
      allowance: null,
      remaining: null,
      used: 102,
      warning: false,
    });
  });

  it("never warns on a zero allowance", async () => {
    scenario.balance = balance(0, { allowance: 0, grantsRemaining: 5, remaining: 5 });
    const server = await api();

    const { body } = await get(server, "/v1/organisation/credits");

    expect(body).toMatchObject({ allowance: 0, used: 0, remaining: 5, warning: false });
  });

  it("does not answer the operator's owner token, which belongs to no organisation", async () => {
    const server = await api();

    const response = await get(server, "/v1/organisation/credits", "owner");

    expect(response.status).toBe(401);
    expect(assignmentRead).not.toHaveBeenCalled();
  });

  it("is not served in owner-token mode", async () => {
    const server = await api("owner");

    const response = await get(server, "/v1/organisation/credits", "owner");

    expect(response.status).toBe(404);
    expect(assignmentRead).not.toHaveBeenCalled();
  });
});

describe("GET /v1/workspaces/:workspaceId/runs/estimate", () => {
  it("prices the workspace's settings and tells a member the plan and balance cover it", async () => {
    const server = await api();

    const response = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(response).toEqual({
      status: 200,
      body: {
        // Standard on both sides: base 1, three rounds span two blocks.
        credits: 2,
        estimateVersion: 1,
        basis: { base: 1, premium: false, roundBlocks: 2 },
        maxRounds: 3,
        authorTier: "standard",
        criticTier: "standard",
        plan: { allowed: true, code: null },
        balance: { unlimited: false, remaining: 10, sufficient: true },
      },
    });
  });

  it("follows the workspace's round limit", async () => {
    scenario.workspace = { ...workspace, maxRounds: 5 } as WorkspaceDescriptor;
    const server = await api();

    const { body } = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(body).toMatchObject({ credits: 3, maxRounds: 5 });
  });

  it("prices an application's own premium pair and reports the tier the plan lacks", async () => {
    scenario.assignment = assignment("individual");
    scenario.application = { modelProfiles: premiumPair } as Partial<ApplicationView>;
    const server = await api();

    const { body } = await get(server, "/v1/workspaces/r1/runs/estimate?applicationId=second");

    expect(body).toMatchObject({
      credits: 4,
      basis: { base: 2, premium: true },
      authorTier: "premium",
      plan: { allowed: false, code: "model_tier_not_in_plan", role: "author", tier: "premium" },
    });
  });

  it("names the role and tier of the workspace's own models the plan lacks", async () => {
    scenario.assignment = assignment("individual");
    const server = await api();

    const { body } = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(body.plan).toEqual({
      allowed: false,
      code: "model_tier_not_in_plan",
      role: "author",
      tier: "standard",
    });
  });

  it("does not use an application's pair unless it is named", async () => {
    scenario.application = { modelProfiles: premiumPair } as Partial<ApplicationView>;
    const server = await api();

    const { body } = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(body.credits).toBe(2);
  });

  it("reports a balance that is short without refusing", async () => {
    scenario.balance = balance(9);
    const server = await api();

    const response = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(response.status).toBe(200);
    expect(response.body.balance).toEqual({ unlimited: false, remaining: 1, sufficient: false });
  });

  it("reports an unlimited balance as sufficient", async () => {
    scenario.assignment = assignment("internal");
    scenario.balance = balance(0, { allowance: 0, unlimited: true, remaining: 0 });
    const server = await api();

    const { body } = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(body.balance).toEqual({ unlimited: true, remaining: null, sufficient: true });
  });

  it("reports an organisation without a plan, with no balance", async () => {
    scenario.assignment = undefined;
    const server = await api();

    const response = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(response.status).toBe(200);
    expect(response.body.credits).toBe(2);
    expect(response.body.plan).toEqual({ allowed: false, code: "plan_required" });
    expect(response.body).not.toHaveProperty("balance");
  });

  it("cannot price a model whose tier is unknown", async () => {
    scenario.workspace = {
      ...workspace,
      critic: { company: "openai", model: "model-nobody-registered" },
    } as WorkspaceDescriptor;
    const server = await api();

    const response = await get(server, "/v1/workspaces/r1/runs/estimate");

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "model_tier_unknown", role: "critic" });
    expect(JSON.stringify(response.body)).not.toContain("model-nobody-registered");
  });

  it("answers 404 for a workspace that does not exist", async () => {
    const server = await api();

    expect((await get(server, "/v1/workspaces/missing/runs/estimate")).status).toBe(404);
  });

  it("works in owner-token mode with the estimate alone, reading no plan or balance", async () => {
    const server = await api("owner");

    const response = await get(server, "/v1/workspaces/r1/runs/estimate", "owner");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      credits: 2,
      estimateVersion: 1,
      basis: { base: 1, premium: false, roundBlocks: 2 },
      maxRounds: 3,
      authorTier: "standard",
      criticTier: "standard",
    });
    expect(entitlementsRead).not.toHaveBeenCalled();
    expect(balanceRead).not.toHaveBeenCalled();
  });
});
