import { planIdSchema, resolveEntitlements } from "@draft-loop/schemas/entitlements";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import {
  type CreditBalance,
  CreditLedgerError,
  type PlanAssignment,
  PlanAssignmentError,
} from "@draft-loop/storage-postgres";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import type { TenantEntitlements } from "./entitlement-gate.js";
import { createMemoryIdempotencyStore } from "./idempotency.js";
import { cloudLoggingOptions } from "./logging.js";
import type { OperatorTenant } from "./operator-plan-routes.js";
import type { TenantApplication, TenantApplications } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const key = "grant-key-0001";

/** One organisation's plan and ledger in memory, keeping the stores' codes. */
function memoryOperatorTenants(organisations: readonly string[]) {
  const assignments = new Map<string, PlanAssignment>();
  const grants = new Map<string, { sequence: number; credits: number; reason: string }[]>();
  const stores = new Map<string, OperatorTenant>();
  const balanceOf = (organisationId: string): CreditBalance => {
    const assignment = assignments.get(organisationId);
    const entitlements =
      assignment === undefined
        ? undefined
        : resolveEntitlements(assignment.planId, assignment.overrides, {
            seats: assignment.seats ?? undefined,
          });
    const allowance = entitlements?.creditsPerPeriod ?? 0;
    const grantsRemaining = (grants.get(organisationId) ?? []).reduce(
      (sum, grant) => sum + grant.credits,
      0,
    );
    return {
      periodStart: assignment?.periodStart ?? null,
      periodEnd: null,
      allowance,
      allowanceUsed: 0,
      reserved: 0,
      grantsRemaining,
      remaining: allowance + grantsRemaining,
      unlimited: entitlements?.creditsPerPeriod === null,
    };
  };
  const operatorFor = (organisationId: string): OperatorTenant => {
    const existing = stores.get(organisationId);
    if (existing !== undefined) return existing;
    const known = () => {
      if (!organisations.includes(organisationId)) {
        throw new PlanAssignmentError("organisation_not_found", "No such organisation.");
      }
    };
    const created: OperatorTenant = {
      idempotency: createMemoryIdempotencyStore(),
      plans: {
        currentPlanAssignment: async () => assignments.get(organisationId),
        assignPlan: async (input) => {
          known();
          if (
            new Date(`${input.periodStart}T00:00:00.000Z`).toISOString().slice(0, 10) !==
            input.periodStart
          ) {
            throw new PlanAssignmentError("invalid_plan_assignment", "Bad date.");
          }
          const planId = planIdSchema.safeParse(input.planId);
          if (!planId.success) {
            throw new PlanAssignmentError("invalid_plan_assignment", "Unknown plan id.");
          }
          try {
            resolveEntitlements(planId.data, input.overrides ?? {}, { seats: input.seats });
          } catch {
            throw new PlanAssignmentError("invalid_plan_assignment", "Needs seats.");
          }
          const assignment: PlanAssignment = {
            planId: planId.data,
            catalogVersion: 1,
            overrides: input.overrides ?? {},
            seats: input.seats ?? null,
            periodStart: input.periodStart,
            assignedAt: input.assignedAt,
          };
          assignments.set(organisationId, assignment);
          return assignment;
        },
      },
      ledger: {
        balance: async () => {
          if (!organisations.includes(organisationId)) {
            throw new CreditLedgerError("organisation_not_found", "No such organisation.");
          }
          return balanceOf(organisationId);
        },
        grant: async (input) => {
          if (!organisations.includes(organisationId)) {
            throw new CreditLedgerError("organisation_not_found", "No such organisation.");
          }
          if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.reason)) {
            throw new CreditLedgerError("invalid_credit_request", "Bad reason.");
          }
          const list = grants.get(organisationId) ?? [];
          const grant = { sequence: list.length + 1, credits: input.credits, reason: input.reason };
          grants.set(organisationId, [...list, grant]);
          return { ...grant, expiresAt: "2027-10-24T09:30:00.000Z" };
        },
      },
    };
    stores.set(organisationId, created);
    return created;
  };
  return { operatorFor, grantsOf: (organisationId: string) => grants.get(organisationId) ?? [] };
}

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let signingKey: KeyPair;
let keys: JWTVerifyGetKey;
let app: FastifyInstance | undefined;
let logLines: string[];
let tenants: ReturnType<typeof memoryOperatorTenants>;

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
  keys = createLocalJWKSet({ keys: [publicJwk] });
});

beforeEach(() => {
  logLines = [];
  tenants = memoryOperatorTenants(["org-north"]);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function api(mode: "owner" | "oidc" = "owner"): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
    auth:
      mode === "owner"
        ? { mode: "owner" }
        : {
            mode: "oidc",
            issuer,
            audience,
            webClientId: "draft-loop-web",
            allowHttp: false,
            keys,
            resolveSignIn: async ({ subject }) => ({
              tenantId: "org-north",
              memberId: subject,
              role: "owner",
            }),
          },
    tenants: {
      budgetCeiling: { maxRounds: 1, maxCostUsd: 1, maxDurationMs: 1 },
      // Sign-in mode serves no tenant without these; the operator's routes read none of them.
      recordAccessFor: () => ({}) as CandidateRecordAccess,
      knowledgeOwnersFor: () =>
        ({}) as ReturnType<NonNullable<TenantApplications["knowledgeOwnersFor"]>>,
      // Never read: the operator's routes start no run.
      entitlementsFor: () => ({}) as TenantEntitlements,
      // Never composed: the operator's routes read no tenant application.
      applicationFor: () => ({}) as TenantApplication,
      operatorFor: tenants.operatorFor,
    },
  });
  return app;
}

async function memberToken(): Promise<string> {
  return new SignJWT({ email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("member-one")
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
}

function operator(server: FastifyInstance, request: InjectOptions) {
  return server.inject({
    ...request,
    headers: { authorization: `Bearer ${ownerToken}`, ...request.headers },
  });
}

const plan = (organisationId: string, payload: Record<string, unknown>): InjectOptions => ({
  method: "PUT" as const,
  url: `/v1/operator/organisations/${organisationId}/plan`,
  payload,
});
const grant = (
  organisationId: string,
  payload: Record<string, unknown>,
  idempotencyKey: string | null = key,
): InjectOptions => ({
  method: "POST" as const,
  url: `/v1/operator/organisations/${organisationId}/credit-grants`,
  payload,
  ...(idempotencyKey === null ? {} : { headers: { "idempotency-key": idempotencyKey } }),
});
const credits = (organisationId: string): InjectOptions => ({
  method: "GET" as const,
  url: `/v1/operator/organisations/${organisationId}/credits`,
});

const audits = () =>
  logLines
    .map((line) => JSON.parse(line) as { audit?: Record<string, unknown> })
    .flatMap((line) => (line.audit === undefined ? [] : [line.audit]));

describe("the operator's plan and credit routes", () => {
  it.each(["owner", "oidc"] as const)("take the owner token in %s mode", async (mode) => {
    const server = await api(mode);

    const assigned = await operator(
      server,
      plan("org-north", { planId: "pro", periodStart: "2026-10-01" }),
    );

    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({
      assignment: {
        planId: "pro",
        catalogVersion: 1,
        overrides: {},
        seats: null,
        periodStart: "2026-10-01",
        assignedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      },
      entitlements: { modelTiers: expect.any(Array), creditPeriodMonths: 1 },
    });
  });

  it("refuses everyone but the operator's token, with the organisation route's answer", async () => {
    const server = await api("oidc");
    const refusal = {
      error: { code: "unauthorized", message: "The operator's token is required." },
    };
    const requests = [
      plan("org-north", { planId: "pro" }),
      grant("org-north", { credits: 10, reason: "goodwill" }),
      credits("org-north"),
    ];

    for (const request of requests) {
      const member = await server.inject({
        ...request,
        headers: { ...request.headers, authorization: `Bearer ${await memberToken()}` },
      });
      const anonymous = await server.inject(request);
      const wrong = await server.inject({
        ...request,
        headers: {
          ...request.headers,
          authorization: "Bearer not-the-owner-token-0123456789abcdef",
        },
      });
      for (const response of [member, anonymous, wrong]) {
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual(refusal);
      }
    }
    expect(tenants.grantsOf("org-north")).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("defaults the credit period to today's UTC date", async () => {
    const server = await api();

    const response = await operator(server, plan("org-north", { planId: "individual" }));

    expect(response.statusCode).toBe(200);
    expect(response.json().assignment.periodStart).toBe(new Date().toISOString().slice(0, 10));
  });

  it("answers 422 for an unknown plan, a Team without seats and an impossible date", async () => {
    const server = await api();

    for (const payload of [
      { planId: "platinum" },
      { planId: "team" },
      { planId: "pro", periodStart: "2026-02-30" },
    ]) {
      const response = await operator(server, plan("org-north", payload));
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("invalid_plan_assignment");
    }
    expect((await operator(server, credits("org-north"))).json().assignment).toBeNull();
  });

  it("scales a seat-priced plan by its seats", async () => {
    const server = await api();

    const response = await operator(server, plan("org-north", { planId: "team", seats: 3 }));

    expect(response.statusCode).toBe(200);
    expect(response.json().assignment.seats).toBe(3);
    expect(response.json().entitlements.seats).toBe(3);
  });

  it("answers 400 for a malformed body", async () => {
    const server = await api();

    for (const payload of [
      {},
      { planId: "pro", extra: true },
      { planId: "pro", seats: 0 },
      { planId: "pro", overrides: { unknown: 1 } },
      { planId: "pro", periodStart: "yesterday" },
    ]) {
      const response = await operator(server, plan("org-north", payload));
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_request");
    }
  });

  it("answers 404 for an unknown organisation on every route", async () => {
    const server = await api();

    const responses = [
      await operator(server, plan("org-missing", { planId: "pro" })),
      await operator(server, grant("org-missing", { credits: 10, reason: "goodwill" })),
      await operator(server, credits("org-missing")),
    ];

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("organisation_not_found");
    }
    expect(audits()).toEqual([]);
  });

  it("shows a grant in the balance", async () => {
    const server = await api();
    await operator(server, plan("org-north", { planId: "individual", periodStart: "2026-10-01" }));
    const before = (await operator(server, credits("org-north"))).json();

    const granted = await operator(server, grant("org-north", { credits: 25, reason: "goodwill" }));
    const after = (await operator(server, credits("org-north"))).json();

    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({
      grant: { sequence: 1, credits: 25, reason: "goodwill" },
      balance: { grantsRemaining: 25 },
    });
    expect(after.balance.grantsRemaining).toBe(before.balance.grantsRemaining + 25);
    expect(after.balance.remaining).toBe(before.balance.remaining + 25);
    expect(after).toMatchObject({
      organisationId: "org-north",
      assignment: { planId: "individual" },
      entitlements: { creditsPerPeriod: expect.any(Number) },
    });
  });

  it("does not double a retried grant, and refuses a reused key for another grant", async () => {
    const server = await api();
    const request = grant("org-north", { credits: 40, reason: "support.2026-10" });

    const first = await operator(server, request);
    const retry = await operator(server, request);
    const other = await operator(
      server,
      grant("org-north", { credits: 41, reason: "support.2026-10" }),
    );

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(tenants.grantsOf("org-north")).toHaveLength(1);
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe("idempotency_conflict");
    expect(audits().filter((audit) => audit.action === "credits_granted")).toHaveLength(1);
  });

  it("needs an Idempotency-Key and a bounded positive amount with a reason code", async () => {
    const server = await api();

    const bodies = [
      grant("org-north", { credits: 10, reason: "goodwill" }, null),
      grant("org-north", { credits: 0, reason: "goodwill" }),
      grant("org-north", { credits: 1.5, reason: "goodwill" }),
      grant("org-north", { credits: 1_000_001, reason: "goodwill" }),
      grant("org-north", { credits: 10, reason: "Free text with spaces" }),
      grant("org-north", { credits: 10 }),
    ];
    for (const request of bodies) {
      expect((await operator(server, request)).statusCode).toBe(400);
    }
    expect(tenants.grantsOf("org-north")).toEqual([]);
  });

  it("logs one content-free audit line per write, with ids, the plan, numbers and the reason", async () => {
    const server = await api();

    await operator(
      server,
      plan("org-north", { planId: "team", seats: 4, periodStart: "2026-10-01" }),
    );
    await operator(server, grant("org-north", { credits: 15, reason: "goodwill" }));
    await operator(server, credits("org-north"));

    expect(audits()).toEqual([
      {
        action: "organisation_plan_assigned",
        organisationId: "org-north",
        planId: "team",
        seats: 4,
        periodStart: "2026-10-01",
      },
      {
        action: "credits_granted",
        organisationId: "org-north",
        credits: 15,
        reason: "goodwill",
        sequence: 1,
      },
    ]);
    expect(logLines.join("\n")).not.toContain(ownerToken);
  });
});
