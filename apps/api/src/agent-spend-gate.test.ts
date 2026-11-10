import type { ApplicationService, WorkspaceDescriptor } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import { createMemoryAgentTokenStore } from "@draft-loop/storage/agent-tokens";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { centsOf } from "./agent-spend-gate.js";
import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const owner = { authorization: `Bearer ${ownerToken}` };
const at = "2026-11-09T10:00:00.000Z";

const descriptor = {
  id: "owner",
  root: "/tenants/owner/workspaces/owner",
  maxRounds: 3,
  maxCostUsd: 2,
  maxDurationMs: 600_000,
  author: { company: "anthropic", model: "claude-haiku-5-5" },
  critic: { company: "openai", model: "gpt-6-luna" },
  fixtureMode: true,
} as unknown as WorkspaceDescriptor;

const snapshot = {
  schemaVersion: 1,
  runId: "run-1",
  workspaceId: "owner",
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

let app: FastifyInstance;
let begun: unknown[];
let failNext: boolean;

beforeEach(async () => {
  begun = [];
  failNext = false;
  const service = {
    readWorkspace: async () => descriptor,
    getApplication: async () => undefined,
    begin: async (command: unknown) => {
      if (failNext) {
        failNext = false;
        throw new Error("stub: the run could not be saved");
      }
      begun.push(command);
      return snapshot;
    },
  } as unknown as ApplicationService;
  app = await buildApi({
    ownerToken,
    logger: false,
    agentTokens: createMemoryAgentTokenStore(),
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      workJournal: createWorkJournalService({
        store: createMemoryWorkJournalNoteStore(),
        tenantId: "owner",
      }),
    },
  });
});

afterEach(async () => {
  await app.close();
});

async function issue(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/workspaces/owner/agent-tokens",
    headers: owner,
    payload: { label: "Claude Code", ...payload },
  });
}

async function starter(monthlyCapUsd = 5) {
  const issued = await issue({ scopes: ["runs:start"], monthly_cap_usd: monthlyCapUsd });
  expect(issued.statusCode).toBe(201);
  return { authorization: `Bearer ${issued.json().token as string}` };
}

const body = { applicationId: "app-1", opportunityBrief: { briefId: "brief-1", version: 2 } };

function start(headers: Record<string, string>, key: string, payload: object = body) {
  return app.inject({
    method: "POST",
    url: "/v1/workspaces/owner/runs",
    headers: { ...headers, "idempotency-key": key },
    payload,
  });
}

describe("agent spend cap", () => {
  it("issues runs:start only with a monthly cap, and a cap only with runs:start", async () => {
    expect((await issue({ scopes: ["runs:start"] })).json().error.code).toBe(
      "agent_spend_cap_mismatch",
    );
    expect((await issue({ scopes: ["journal"], monthly_cap_usd: 5 })).statusCode).toBe(400);
    expect((await issue({ scopes: ["runs:start"], monthly_cap_usd: 501 })).statusCode).toBe(400);
    const issued = await issue({ scopes: ["runs:start"], monthly_cap_usd: 12.5 });
    expect(issued.json()).toMatchObject({
      scopes: ["runs:start"],
      monthly_cap_usd: 12.5,
      spent_this_month_usd: 0,
    });
  });

  it("starts a run on a reviewed brief, reserving the workspace's run limit once per key", async () => {
    const headers = await starter(5);
    expect((await start(headers, "key-00000001")).statusCode).toBe(201);
    expect((await start(headers, "key-00000001")).statusCode).toBe(201);
    expect((await start(headers, "key-00000002")).statusCode).toBe(201);
    const refused = await start(headers, "key-00000003");
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toMatchObject({
      code: "agent_spend_cap_reached",
      params: { capUsd: 5, spentUsd: 4 },
    });
    expect(begun).toHaveLength(2);
    const [listed] = (
      await app.inject({ method: "GET", url: "/v1/workspaces/owner/agent-tokens", headers: owner })
    ).json().tokens;
    expect(listed).toMatchObject({ monthly_cap_usd: 5, spent_this_month_usd: 4 });
  });

  it("gives a refused start's reservation back", async () => {
    const headers = await starter(2);
    failNext = true;
    expect((await start(headers, "key-00000001")).statusCode).toBe(500);
    expect((await start(headers, "key-00000002")).statusCode).toBe(201);
  });

  it("refuses a start that names models or a career profile", async () => {
    const headers = await starter();
    for (const extra of [
      { candidateProfile: { profileId: "profile-1", version: 1 } },
      {
        modelProfiles: {
          author: { id: "premium-anthropic-author", version: 1 },
          critic: { id: "premium-openai-critic", version: 1 },
        },
      },
    ]) {
      const refused = await start(headers, "key-00000001", { ...body, ...extra });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error.message).toContain("reviewed brief only");
    }
    expect((await start(headers, "key-00000002", { applicationId: "app-1" })).statusCode).toBe(403);
    expect(begun).toEqual([]);
  });

  it("tells an agent what it may still spend in the estimate", async () => {
    const headers = await starter(5);
    await start(headers, "key-00000001");
    const estimate = await app.inject({
      method: "GET",
      url: "/v1/workspaces/owner/runs/estimate",
      headers,
    });
    expect(estimate.statusCode).toBe(200);
    expect(estimate.json().agentSpend).toEqual({
      monthlyCapUsd: 5,
      spentThisMonthUsd: 2,
      remainingUsd: 3,
      runReservesUsd: 2,
    });
  });

  it("rounds a limit up to whole cents", () => {
    expect(centsOf(2)).toBe(200);
    expect(centsOf(0.015)).toBe(2);
    expect(centsOf(1.1)).toBe(110);
  });
});
