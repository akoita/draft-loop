import {
  type ApplicationService,
  type ApplicationView,
  CliUserError,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { SignedInMember } from "@draft-loop/storage/tenant-directory";
import type { ReserveCreditsResult } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import type { TenantEntitlements } from "./entitlement-gate.js";
import { cloudLoggingOptions } from "./logging.js";
import type { ApiAuthOptions } from "./request-auth.js";
import type { TenantApplication } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const tenantId = "org-north";
const at = "2026-10-24T09:00:00.000Z";

type Entitlements = NonNullable<Awaited<ReturnType<TenantEntitlements["entitlements"]>>>;

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

const snapshot = {
  schemaVersion: 1,
  runId: "run-from-service",
  workspaceId: "r1",
  contextSnapshotId: "context-1",
  state: "drafting",
  round: 0,
  currentStep: null,
  artifact: null,
  findings: [],
  totalCostUsd: 0,
  executionHistory: [],
  approval: "pending",
  startedAt: at,
  updatedAt: at,
  lastError: null,
} as unknown as RunSnapshot;

const grantedConsent: ConsentState = {
  "provider-transmission": {
    action: "granted",
    providers: ["anthropic", "openai"],
  },
} as unknown as ConsentState;

const proEntitlements: Entitlements = {
  ...resolveEntitlements("pro"),
  modelTiers: ["economy", "standard"],
  concurrentRuns: null,
  runsPerDay: null,
};

const balance = {
  periodStart: "2026-10-01",
  periodEnd: "2026-11-01",
  allowance: 10,
  allowanceUsed: 0,
  reserved: 0,
  grantsRemaining: 0,
  remaining: 10,
  unlimited: false,
};

/** What a stored reservation looks like to the route; it reads none of it. */
const reservation = {
  runId: "",
  credits: 0,
  estimateVersion: 1,
  state: "open" as const,
  fromAllowance: 0,
  fromGrants: 0,
  reservedAt: at,
  closedAt: null,
};

interface Scenario {
  entitlements: Entitlements | undefined;
  refusal: ReserveCreditsResult | undefined;
  application: Partial<ApplicationView> | undefined;
  workspace: WorkspaceDescriptor;
  consent: ConsentState;
  /** The balances the ledger reports around a new reservation. */
  balances: { before: typeof balance; after: typeof balance };
}

let scenario: Scenario;
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let signIn: ApiAuthOptions;
let app: FastifyInstance | undefined;
let logLines: string[];

const begin = vi.fn(async (_command: { runId?: string }) => snapshot);
const reserve = vi.fn();
const refund = vi.fn();
const enqueue = vi.fn(async (_workspaceId: string, _runId: string) => undefined);
const entitlementsRead = vi.fn();

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
      subject === "owner-1" ? { tenantId, memberId: "owner-1", role: "owner" } : undefined,
  };
});

beforeEach(() => {
  logLines = [];
  scenario = {
    entitlements: proEntitlements,
    refusal: undefined,
    application: undefined,
    workspace,
    consent: grantedConsent,
    balances: { before: balance, after: balance },
  };
  begin.mockClear();
  begin.mockImplementation(async () => snapshot);
  reserve.mockReset();
  reserve.mockImplementation(async (input: { runId: string; credits: number }) =>
    scenario.refusal === undefined
      ? {
          refused: null,
          reservation: { ...reservation, runId: input.runId, credits: input.credits },
          created: true,
          balanceBefore: scenario.balances.before,
          balanceAfter: scenario.balances.after,
        }
      : scenario.refusal,
  );
  refund.mockReset();
  refund.mockResolvedValue({ changed: true, reservation: undefined });
  enqueue.mockClear();
  entitlementsRead.mockReset();
  entitlementsRead.mockImplementation(async () => scenario.entitlements);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeApplication(): TenantApplication {
  return {
    service: {
      readWorkspace: async () => scenario.workspace,
      getApplication: async () => scenario.application,
      begin,
    } as unknown as ApplicationService,
    workspaceRoot: (workspaceId) => workspaceId,
    enqueueRun: enqueue,
    monthUsage: async () => [],
    knowledgeIntake: {} as TenantApplication["knowledgeIntake"],
    knowledgeStore: { id: "knowledge", reference: "knowledge" },
    sensitivityRules: {} as TenantApplication["sensitivityRules"],
    consents: { current: async () => scenario.consent } as unknown as ConsentLedger,
    recordArchives: {} as TenantApplication["recordArchives"],
  };
}

async function api(
  mode: "owner" | "oidc" = "oidc",
  budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
    ...(mode === "oidc" ? { auth: signIn } : {}),
    tenants: {
      budgetCeiling,
      ...(mode === "owner" ? { ownerTenantId: tenantId } : {}),
      applicationFor: fakeApplication,
      recordAccessFor: () =>
        ({ listRecords: async () => ["r1"] }) as unknown as CandidateRecordAccess,
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      entitlementsFor: () => ({
        entitlements: entitlementsRead,
        assignment: vi.fn(),
        ledger: { reserve, refund, balance: vi.fn() },
      }),
    },
  });
  return app;
}

async function memberToken(): Promise<string> {
  return new SignJWT({ email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("owner-1")
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
}

async function startRun(
  server: FastifyInstance,
  options: { body?: object; key?: string; owner?: boolean } = {},
) {
  const authorization =
    options.owner === true ? `Bearer ${ownerToken}` : `Bearer ${await memberToken()}`;
  const response = await server.inject({
    method: "POST",
    url: "/v1/workspaces/r1/runs",
    headers: { authorization, "idempotency-key": options.key ?? "key-0000-0001" },
    payload: (options.body ?? {}) as Record<string, unknown>,
  });
  return { status: response.statusCode, body: response.json(), headers: response.headers };
}

describe("starting a run in sign-in mode", () => {
  it("reserves the estimate for the run it begins, then queues it", async () => {
    const server = await api();

    const response = await startRun(server);

    expect(response.status).toBe(201);
    expect(reserve).toHaveBeenCalledTimes(1);
    const reserved = reserve.mock.calls[0]?.[0];
    // Standard on both sides: base 1, three rounds span two blocks.
    expect(reserved).toMatchObject({
      credits: 2,
      estimateVersion: 2,
      caps: { maxConcurrent: null, maxPerDay: null },
    });
    expect(reserved.runId).toMatch(/^run-\d+-[0-9a-f]{8}$/u);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0]?.[0].runId).toBe(reserved.runId);
    expect(enqueue).toHaveBeenCalledWith("r1", snapshot.runId);
    expect(refund).not.toHaveBeenCalled();
  });

  it("passes the plan's run caps to the reservation", async () => {
    scenario.entitlements = { ...proEntitlements, concurrentRuns: 2, runsPerDay: 7 };
    const server = await api();

    expect((await startRun(server)).status).toBe(201);

    expect(reserve.mock.calls[0]?.[0].caps).toEqual({ maxConcurrent: 2, maxPerDay: 7 });
  });

  it("prices a premium pair at double the base", async () => {
    scenario.entitlements = resolveEntitlements("internal");
    const server = await api();

    expect((await startRun(server, { body: { modelProfiles: premiumPair } })).status).toBe(201);

    expect(reserve.mock.calls[0]?.[0].credits).toBe(4);
  });

  it("prices a high reasoning level like a premium model and records rule v2", async () => {
    const server = await api();
    const standardPair = {
      author: { id: "standard-anthropic-author", version: 1, effort: "high" },
      critic: { id: "standard-openai-critic", version: 2 },
    };

    expect((await startRun(server, { body: { modelProfiles: standardPair } })).status).toBe(201);

    expect(reserve.mock.calls[0]?.[0]).toMatchObject({ credits: 4, estimateVersion: 2 });
  });

  it("prices an application's own pair, whatever the request names", async () => {
    scenario.entitlements = resolveEntitlements("internal");
    scenario.application = { modelProfiles: premiumPair } as Partial<ApplicationView>;
    const server = await api();

    const response = await startRun(server, { body: { applicationId: "second" } });

    expect(response.status).toBe(201);
    expect(reserve.mock.calls[0]?.[0].credits).toBe(4);
  });

  it("refuses an organisation without a plan, reserving and beginning nothing", async () => {
    scenario.entitlements = undefined;
    const server = await api();

    const response = await startRun(server);

    expect(response).toMatchObject({
      status: 403,
      body: {
        error: {
          code: "plan_required",
          message: "The organisation has no plan yet; the operator assigns one.",
        },
      },
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a tier the plan lacks, naming the role and tier only", async () => {
    const server = await api();

    const response = await startRun(server, { body: { modelProfiles: premiumPair } });

    expect(response.status).toBe(403);
    expect(response.body.error).toEqual({
      code: "model_tier_not_in_plan",
      message: "The organisation's plan does not include the premium tier for the author.",
      role: "author",
      tier: "premium",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it("names the critic when only the critic's tier is outside the plan", async () => {
    scenario.workspace = {
      ...workspace,
      author: { company: "anthropic", model: "claude-haiku-5-5" },
    } as WorkspaceDescriptor;
    scenario.entitlements = { ...proEntitlements, modelTiers: ["economy"] };
    const server = await api();

    const response = await startRun(server);

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "model_tier_not_in_plan",
      role: "critic",
      tier: "standard",
    });
  });

  it("refuses a model whose tier cannot be determined, unpriced", async () => {
    scenario.workspace = {
      ...workspace,
      critic: { company: "openai", model: "model-nobody-registered" },
    } as WorkspaceDescriptor;
    const server = await api();

    const response = await startRun(server);

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "model_tier_unknown", role: "critic" });
    expect(JSON.stringify(response.body)).not.toContain("model-nobody-registered");
    expect(reserve).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it("answers 402 with the estimate and what is left when the balance is short", async () => {
    scenario.refusal = { refused: "insufficient", balance: { ...balance, remaining: 1 } };
    const server = await api();

    const response = await startRun(server);

    expect(response.status).toBe(402);
    expect(response.body.error).toEqual({
      code: "credits_insufficient",
      message: "The run needs up to 2 credits and the organisation has 1 left.",
      estimate: 2,
      remaining: 1,
    });
    expect(begin).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["concurrent", 2, "The organisation already has 2 runs in flight"],
    ["per_day", 5, "The organisation has started 5 runs today"],
  ] as const)("answers 429 at the %s cap", async (cap, limit, message) => {
    scenario.refusal = { refused: "run_cap", cap, limit, count: limit, balance };
    const server = await api();

    const response = await startRun(server);

    expect(response.status).toBe(429);
    expect(response.body.error).toMatchObject({ code: "run_cap_reached", cap, limit });
    expect(response.body.error.message).toContain(message);
    expect(begin).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("reserves once for an idempotent retry, and queues on every attempt", async () => {
    const server = await api();

    const first = await startRun(server, { key: "retry-0000-0001" });
    const second = await startRun(server, { key: "retry-0000-0001" });

    expect(first.status).toBe(201);
    expect(second).toMatchObject({ status: 201, body: first.body });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("does not remember a refusal, so the retry is checked again", async () => {
    scenario.refusal = { refused: "insufficient", balance: { ...balance, remaining: 0 } };
    const server = await api();
    expect((await startRun(server, { key: "retry-0000-0002" })).status).toBe(402);

    scenario.refusal = undefined;
    expect((await startRun(server, { key: "retry-0000-0002" })).status).toBe(201);

    expect(reserve).toHaveBeenCalledTimes(2);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("refunds the reservation when the run cannot be begun", async () => {
    begin.mockRejectedValueOnce(new CliUserError("The brief is not reviewed."));
    const server = await api();

    const response = await startRun(server);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("rejected");
    const reserved = reserve.mock.calls[0]?.[0];
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund.mock.calls[0]?.[0]).toMatchObject({ runId: reserved.runId });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("answers the begin failure even if the refund fails, logging only a code", async () => {
    begin.mockRejectedValueOnce(new CliUserError("The brief is not reviewed."));
    refund.mockRejectedValueOnce(new Error("connection to db.internal lost"));
    const server = await api();

    const response = await startRun(server);

    expect(response.status).toBe(422);
    const logged = logLines.join("\n");
    expect(logged).toContain("credit refund failed");
    expect(logged).not.toContain("db.internal");
  });

  it("keeps the reservation when only queueing fails, since the run is saved", async () => {
    enqueue.mockRejectedValueOnce(new Error("queue down"));
    const server = await api();

    const failed = await startRun(server, { key: "retry-0000-0003" });
    expect(failed.status).toBe(503);
    expect(refund).not.toHaveBeenCalled();

    const retried = await startRun(server, { key: "retry-0000-0003" });
    expect(retried.status).toBe(201);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("checks the budget ceiling, then consent, before the plan", async () => {
    const tight = await api("oidc", { maxRounds: 2, maxCostUsd: 3, maxDurationMs: 1_800_000 });
    expect((await startRun(tight)).body.error.code).toBe("budget_above_ceiling");
    await tight.close();

    scenario.consent = {};
    const server = await api();
    const refused = await startRun(server);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("transmission_consent_required");

    expect(entitlementsRead).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("refuses to serve sign-in mode without the plan and credit accessors", async () => {
    await expect(
      buildApi({
        ownerToken,
        auth: signIn,
        tenants: {
          budgetCeiling: { maxRounds: 1, maxCostUsd: 1, maxDurationMs: 1 },
          applicationFor: fakeApplication,
          recordAccessFor: () => ({}) as CandidateRecordAccess,
          knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
        },
      }),
    ).rejects.toThrow(/plan and credits/u);
  });
});

describe("starting a run with the owner token", () => {
  it("is not metered or refused: no plan is read and the service picks the run id", async () => {
    scenario.entitlements = undefined;
    const server = await api("owner");

    const response = await startRun(server, { owner: true });

    expect(response.status).toBe(201);
    expect(entitlementsRead).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0]?.[0]).not.toHaveProperty("runId");
    expect(enqueue).toHaveBeenCalledWith("r1", snapshot.runId);
  });
});

/** A balance with `used` of a 10-credit allowance spent and no grants. */
function usedBalance(used: number, overrides: Partial<typeof balance> = {}): typeof balance {
  return { ...balance, allowanceUsed: used, remaining: 10 - used, ...overrides };
}

function thresholdLines(): Record<string, unknown>[] {
  return logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (line) =>
        line.message === "credit allowance 80% used" || line.message === "credit balance exhausted",
    );
}

describe("credit threshold log lines", () => {
  const messages = () => thresholdLines().map((line) => line.message);

  it("logs the 80% line once, at the boundary, with ids and numbers only", async () => {
    scenario.balances = { before: usedBalance(7), after: usedBalance(8) };
    const server = await api();

    expect((await startRun(server)).status).toBe(201);

    const lines = thresholdLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      severity: "WARNING",
      message: "credit allowance 80% used",
      organisationId: tenantId,
      periodEnd: "2026-11-01",
      allowance: 10,
      used: 8,
      remaining: 2,
    });
    // Only the allowed fields, besides the logger's own and the request's bound ids.
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(
      [
        "allowance",
        "memberId",
        "message",
        "organisationId",
        "periodEnd",
        "remaining",
        "reqId",
        "severity",
        "tenantId",
        "time",
        "used",
      ].sort(),
    );
  });

  it("counts reserved credits as used", async () => {
    scenario.balances = {
      before: usedBalance(5, { reserved: 2, remaining: 3 }),
      after: usedBalance(5, { reserved: 3, remaining: 2 }),
    };
    const server = await api();

    await startRun(server);

    expect(thresholdLines()).toMatchObject([{ message: "credit allowance 80% used", used: 8 }]);
  });

  it.each([
    ["below 80% before and after", 6, 7],
    ["already past 80% before", 8, 9],
  ])("logs nothing when the use is %s", async (_label, before, after) => {
    scenario.balances = { before: usedBalance(before), after: usedBalance(after) };
    const server = await api();

    await startRun(server);

    expect(messages()).toEqual([]);
  });

  it("logs the exhaustion line when the remaining credits reach zero", async () => {
    scenario.balances = { before: usedBalance(9), after: usedBalance(10) };
    const server = await api();

    await startRun(server);

    // Past 80% before, so only exhaustion crosses.
    expect(thresholdLines()).toMatchObject([
      { severity: "WARNING", message: "credit balance exhausted", used: 10, remaining: 0 },
    ]);
  });

  it("logs both lines when one reservation crosses both", async () => {
    scenario.balances = { before: usedBalance(7), after: usedBalance(10) };
    const server = await api();

    await startRun(server);

    expect(messages()).toEqual(["credit allowance 80% used", "credit balance exhausted"]);
  });

  it("logs nothing when the balance was already empty", async () => {
    scenario.balances = { before: usedBalance(10), after: usedBalance(10) };
    const server = await api();

    await startRun(server);

    expect(messages()).toEqual([]);
  });

  it("never logs the 80% line for an unlimited plan or a zero allowance", async () => {
    const unlimited = { ...balance, allowance: 0, unlimited: true, remaining: 0 };
    scenario.balances = {
      before: { ...unlimited, allowanceUsed: 5 },
      after: { ...unlimited, allowanceUsed: 99, reserved: 5 },
    };
    const server = await api();
    await startRun(server);
    expect(messages()).toEqual([]);

    // Only operator grants: no allowance to be 80% through, but running out is still logged.
    const grantsOnly = { ...balance, allowance: 0, remaining: 1, grantsRemaining: 1 };
    scenario.balances = {
      before: grantsOnly,
      after: { ...grantsOnly, remaining: 0, grantsRemaining: 0, reserved: 1 },
    };
    await startRun(server, { key: "key-0000-0002" });
    expect(messages()).toEqual(["credit balance exhausted"]);
  });

  it("does not use grants as allowance when it measures the use", async () => {
    // 8 of 10 allowance credits are gone; 5 grant credits remain: the warning holds, nothing is exhausted.
    scenario.balances = {
      before: usedBalance(7, { grantsRemaining: 5, remaining: 8 }),
      after: usedBalance(8, { grantsRemaining: 5, remaining: 7 }),
    };
    const server = await api();

    await startRun(server);

    expect(thresholdLines()).toMatchObject([
      { message: "credit allowance 80% used", used: 8, remaining: 7 },
    ]);
  });

  it("logs once for an idempotent retry", async () => {
    scenario.balances = { before: usedBalance(7), after: usedBalance(8) };
    const server = await api();

    await startRun(server, { key: "retry-0000-0009" });
    await startRun(server, { key: "retry-0000-0009" });

    expect(messages()).toEqual(["credit allowance 80% used"]);
  });

  it("does not log for a reservation that already existed", async () => {
    reserve.mockImplementation(async (input: { runId: string; credits: number }) => ({
      refused: null,
      reservation: { ...reservation, runId: input.runId, credits: input.credits },
      created: false,
    }));
    const server = await api();

    expect((await startRun(server)).status).toBe(201);

    expect(messages()).toEqual([]);
  });

  it("logs nothing when the run could not be begun, since its credits are refunded", async () => {
    scenario.balances = { before: usedBalance(7), after: usedBalance(8) };
    begin.mockRejectedValueOnce(new CliUserError("The brief is not reviewed."));
    const server = await api();

    expect((await startRun(server)).status).toBe(422);

    expect(messages()).toEqual([]);
  });

  it("logs nothing in owner-token mode, where nothing is reserved", async () => {
    scenario.balances = { before: usedBalance(7), after: usedBalance(10) };
    const server = await api("owner");

    expect((await startRun(server, { owner: true })).status).toBe(201);

    expect(messages()).toEqual([]);
  });
});
