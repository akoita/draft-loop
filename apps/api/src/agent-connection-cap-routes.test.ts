import type { ApplicationService, WorkspaceDescriptor } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import {
  type AgentConnectionCapStore,
  createMemoryAgentConnectionCapStore,
} from "@draft-loop/storage/agent-connection-caps";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";
import type { HostedContentScreening } from "./content-screening-service.js";
import type { TenantEntitlements } from "./entitlement-gate.js";
import type { TenantApplication } from "./tenant-context.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const at = "2026-11-09T10:00:00.000Z";
const connections = "/v1/workspaces/ws-1/agent-connections";

const descriptor = {
  id: "ws-1",
  root: "ws-1",
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

const snapshot = {
  schemaVersion: 1,
  runId: "run-1",
  workspaceId: "ws-1",
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

const consent = {
  "provider-transmission": { action: "granted", providers: ["anthropic", "openai"] },
} as unknown as ConsentState;

const entitlements: NonNullable<Awaited<ReturnType<TenantEntitlements["entitlements"]>>> = {
  ...resolveEntitlements("pro"),
  modelTiers: ["economy", "standard"],
  concurrentRuns: null,
  runsPerDay: null,
};

const balance = {
  periodStart: "2026-11-01",
  periodEnd: "2026-12-01",
  allowance: 10,
  allowanceUsed: 0,
  reserved: 0,
  grantsRemaining: 0,
  remaining: 10,
  unlimited: false,
};

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

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let signingKey: KeyPair;
let publicJwk: JWK;
let app: FastifyInstance | undefined;
let begun: unknown[];
/** Another tenant's caps, which no request of this tenant may reach. */
const otherCaps = createMemoryAgentConnectionCapStore();

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function bearer(claims: Record<string, unknown>) {
  const token = await new SignJWT({ email: "ada@example.test", email_verified: true, ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("person-1")
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  return { authorization: `Bearer ${token}` };
}

const person = () => bearer({ azp: "draft-loop-web" });
const assistant = (scope = "openid draftloop:runs:start", azp = "assistant") =>
  bearer({ azp, scope });

/** An API in sign-in mode over one stub workspace, with or without connection caps. */
async function signInApi(caps?: AgentConnectionCapStore): Promise<FastifyInstance> {
  begun = [];
  const service = {
    readWorkspace: async () => descriptor,
    getApplication: async () => undefined,
    getOpportunity: async () => undefined,
    begin: async (command: unknown) => {
      begun.push(command);
      return snapshot;
    },
  } as unknown as ApplicationService;
  app = await buildApi({
    ownerToken,
    logger: false,
    auth: {
      mode: "oidc",
      issuer,
      audience,
      webClientId: "draft-loop-web",
      allowHttp: false,
      resolveSignIn: async () => ({ tenantId: "org-1", memberId: "member-1", role: "admin" }),
      keys: createLocalJWKSet({ keys: [publicJwk] }),
    },
    tenants: {
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      applicationFor: () => ({
        service,
        workspaceRoot: (workspaceId) => `/tenants/org-1/workspaces/${workspaceId}`,
        enqueueRun: async () => undefined,
        monthUsage: async () => [],
        consents: { current: async () => consent } as unknown as ConsentLedger,
        // The start names no stored brief and no knowledge base, so screening reads nothing.
        contentScreening: { mode: "off", store: {} } as unknown as HostedContentScreening,
        knowledgeIntake: {} as TenantApplication["knowledgeIntake"],
        knowledgeStore: { id: "knowledge", reference: "knowledge" },
        sensitivityRules: {} as TenantApplication["sensitivityRules"],
        recordArchives: {} as TenantApplication["recordArchives"],
      }),
      recordAccessFor: () =>
        ({
          listRecords: async () => ["ws-1"],
          listMemberRecords: async () => [{ workspaceId: "ws-1" }],
        }) as unknown as CandidateRecordAccess,
      knowledgeOwnersFor: () => ({}) as KnowledgeBaseOwners,
      entitlementsFor: () => ({
        entitlements: async () => entitlements,
        assignment: vi.fn(),
        ledger: {
          reserve: async (input: { runId: string; credits: number }) => ({
            refused: null,
            reservation: { ...reservation, runId: input.runId, credits: input.credits },
            created: true,
            balanceBefore: balance,
            balanceAfter: balance,
          }),
          refund: vi.fn(),
          balance: vi.fn(),
        },
      }),
      ...(caps === undefined
        ? {}
        : { agentConnectionCapsFor: (tenantId) => (tenantId === "org-1" ? caps : otherCaps) }),
    },
  });
  return app;
}

const body = { applicationId: "app-1", opportunityBrief: { briefId: "brief-1", version: 2 } };

function start(api: FastifyInstance, headers: Record<string, string>, key: string) {
  return api.inject({
    method: "POST",
    url: "/v1/workspaces/ws-1/runs",
    headers: { ...headers, "idempotency-key": key },
    payload: body,
  });
}

async function setCap(api: FastifyInstance, monthlyCapUsd: number, clientId = "assistant") {
  return api.inject({
    method: "PUT",
    url: connections,
    headers: await person(),
    payload: { client_id: clientId, monthly_cap_usd: monthlyCapUsd },
  });
}

describe("assistant connection caps", () => {
  it("lets the person set, change, list and remove a connection's cap", async () => {
    const api = await signInApi(createMemoryAgentConnectionCapStore());
    const url = "https://assistant.example.test/client.json";

    expect((await setCap(api, 5, url)).json()).toMatchObject({
      client_id: url,
      monthly_cap_usd: 5,
      spent_this_month_usd: 0,
    });
    expect((await setCap(api, 7.5, url)).statusCode).toBe(200);
    expect((await setCap(api, 501)).statusCode).toBe(400);
    expect((await setCap(api, 0)).statusCode).toBe(400);
    const listed = await api.inject({ method: "GET", url: connections, headers: await person() });
    expect(listed.json().connections).toEqual([
      expect.objectContaining({ client_id: url, monthly_cap_usd: 7.5 }),
    ]);
    const remove = async () =>
      api.inject({
        method: "DELETE",
        url: `${connections}?client_id=${encodeURIComponent(url)}`,
        headers: await person(),
      });
    expect((await remove()).statusCode).toBe(204);
    expect((await remove()).json().error.code).toBe("agent_connection_cap_not_found");
  });

  it("never lets an assistant read or set a cap, its own included", async () => {
    const api = await signInApi(createMemoryAgentConnectionCapStore());
    const headers = await assistant();

    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const response = await api.inject({
        method,
        url: method === "DELETE" ? `${connections}?client_id=assistant` : connections,
        headers,
        ...(method === "PUT" ? { payload: { client_id: "assistant", monthly_cap_usd: 500 } } : {}),
      });
      expect(response.statusCode, method).toBe(403);
    }
  });

  it("starts runs within the connection's cap, once per key, and refuses past it", async () => {
    const api = await signInApi(createMemoryAgentConnectionCapStore());
    await setCap(api, 5);
    const headers = await assistant();

    expect((await start(api, headers, "key-00000001")).statusCode).toBe(201);
    expect((await start(api, headers, "key-00000001")).statusCode).toBe(201);
    expect((await start(api, headers, "key-00000002")).statusCode).toBe(201);
    const refused = await start(api, headers, "key-00000003");
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toMatchObject({
      code: "agent_spend_cap_reached",
      message: expect.stringContaining("agent connection"),
      params: { capUsd: 5, spentUsd: 4 },
    });
    expect(begun).toHaveLength(2);
    const listed = await api.inject({ method: "GET", url: connections, headers: await person() });
    expect(listed.json().connections).toEqual([
      expect.objectContaining({ monthly_cap_usd: 5, spent_this_month_usd: 4 }),
    ]);
  });

  it("refuses a connection without a cap, and one cap never serves another assistant", async () => {
    const api = await signInApi(createMemoryAgentConnectionCapStore());
    await setCap(api, 5);

    const other = await start(
      api,
      await assistant("draftloop:runs:start", "another-assistant"),
      "key-00000001",
    );
    expect(other.statusCode).toBe(429);
    expect(other.json().error.message).toContain("no monthly spend cap");
    const unscoped = await start(
      api,
      await assistant("draftloop:applications:read"),
      "key-00000002",
    );
    expect(unscoped.statusCode).toBe(403);
    expect(begun).toEqual([]);
  });

  it("tells the assistant what it may still spend in the estimate", async () => {
    const api = await signInApi(createMemoryAgentConnectionCapStore());
    await setCap(api, 5);
    const headers = await assistant();
    await start(api, headers, "key-00000001");

    const estimate = await api.inject({
      method: "GET",
      url: "/v1/workspaces/ws-1/runs/estimate",
      headers,
    });

    expect(estimate.statusCode).toBe(200);
    expect(estimate.json().agentSpend).toEqual({
      monthlyCapUsd: 5,
      spentThisMonthUsd: 2,
      remainingUsd: 3,
      runReservesUsd: 2,
      draftReservesUsd: 0.5,
    });
  });

  it("fails closed without a cap store: no start, and no cap routes", async () => {
    const api = await signInApi();

    const refused = await start(api, await assistant(), "key-00000001");
    expect(refused.statusCode).toBe(403);
    expect(begun).toEqual([]);
    const listed = await api.inject({ method: "GET", url: connections, headers: await person() });
    expect(listed.statusCode).toBe(404);
  });

  it("leaves the person's own starts outside any connection cap", async () => {
    const api = await signInApi(createMemoryAgentConnectionCapStore());

    expect((await start(api, await person(), "key-00000001")).statusCode).toBe(201);
  });
});
