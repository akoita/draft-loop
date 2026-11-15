import type { ExecutionRecordInput } from "@draft-loop/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PostgresStorage } from "./postgres-storage.js";
import { createTestSchema, type TestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-01T09:00:00.000Z";

/** One workspace with one run and round, so executions can be saved under it. */
async function seedRun(storage: PostgresStorage): Promise<void> {
  await storage.saveWorkspace({
    id: "workspace-1",
    state: "collecting",
    createdAt: at,
    updatedAt: at,
  });
  await storage.saveContextSnapshot({
    id: "context-1",
    workspaceId: "workspace-1",
    schemaVersion: 1,
    createdAt: at,
    payload: { job: "fixture" },
  });
  await storage.saveRun({
    id: "run-1",
    workspaceId: "workspace-1",
    contextSnapshotId: "context-1",
    state: "drafting",
    round: 1,
    currentStep: "author",
    budget: { maxRounds: 3, maxCostUsd: 3 },
    artifactId: null,
    approval: "pending",
    totalCostUsd: 0,
    startedAt: at,
    updatedAt: at,
    lastError: null,
    payload: {},
  });
  await storage.saveRound({
    id: "round-1",
    workspaceId: "workspace-1",
    runId: "run-1",
    number: 1,
    state: "drafting",
    startedAt: at,
    completedAt: null,
    evaluation: null,
    payload: {},
  });
}

let attempt = 0;
const execution = (overrides: Partial<ExecutionRecordInput>): ExecutionRecordInput => {
  attempt += 1;
  return {
    id: `execution-${attempt}`,
    workspaceId: "workspace-1",
    runId: "run-1",
    roundId: "round-1",
    contextSnapshotId: "context-1",
    artifactId: null,
    attempt,
    step: "author",
    status: "completed",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    providerRequestId: null,
    outputChecksum: null,
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedUsd: 0.25,
    startedAt: at,
    completedAt: "2026-10-15T10:00:00.000Z",
    errorCode: null,
    output: null,
    payload: { source: "phase-zero-cli", route: "vertex-ai" },
    ...overrides,
  };
};

describe.runIf(connectionString !== undefined)("Postgres month usage", () => {
  let schema: TestSchema;
  let tenantA: PostgresStorage;
  let tenantB: PostgresStorage;
  let tenantC: PostgresStorage;

  beforeAll(async () => {
    schema = await createTestSchema(connectionString ?? "", "usage");
    tenantA = await schema.open("tenant-a");
    tenantB = await schema.open("tenant-b");
    tenantC = await schema.open("tenant-c");
    await seedRun(tenantA);
    await seedRun(tenantB);
    await tenantA.saveExecution(execution({}));
    await tenantA.saveExecution(execution({ estimatedUsd: 0.5, inputTokens: 200 }));
    await tenantA.saveExecution(execution({ estimatedUsd: null }));
    await tenantA.saveExecution(
      execution({
        step: "critic",
        provider: "openai",
        modelId: "gpt-6-luna",
        payload: { source: "phase-zero-cli", route: "openai-api" },
      }),
    );
    await tenantA.saveExecution(execution({ payload: { source: "phase-zero-cli" } }));
    // Neither an unbilled failed attempt nor a call completed in another month counts.
    await tenantA.saveExecution(
      execution({
        status: "failed",
        estimatedUsd: null,
        errorCode: "timeout",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }),
    );
    // A failed attempt whose rejected response was billed counts (#1967).
    await tenantA.saveExecution(
      execution({
        status: "failed",
        estimatedUsd: 1,
        errorCode: "invalid-response",
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
      }),
    );
    await tenantA.saveExecution(execution({ completedAt: "2026-09-30T23:59:59.999Z" }));
    await tenantB.saveExecution(execution({ estimatedUsd: 9 }));
  });

  afterAll(async () => {
    await tenantA?.close();
    await tenantB?.close();
    await tenantC?.close();
    await schema?.drop();
  });

  it("sums the tenant's billed calls in the month by company, model and route", async () => {
    expect(await tenantA.monthUsage("2026-10")).toEqual([
      {
        company: "anthropic",
        model: "claude-sonnet-5-5",
        route: null,
        calls: 1,
        inputTokens: 100,
        outputTokens: 50,
        estimatedUsd: 0.25,
        unpricedCalls: 0,
      },
      {
        company: "anthropic",
        model: "claude-sonnet-5-5",
        route: "vertex-ai",
        calls: 4,
        inputTokens: 1_400,
        outputTokens: 650,
        estimatedUsd: 1.75,
        unpricedCalls: 1,
      },
      {
        company: "openai",
        model: "gpt-6-luna",
        route: "openai-api",
        calls: 1,
        inputTokens: 100,
        outputTokens: 50,
        estimatedUsd: 0.25,
        unpricedCalls: 0,
      },
    ]);
    expect(await tenantA.monthUsage("2026-09")).toHaveLength(1);
  });

  it("never sums another tenant's calls, and refuses a malformed month", async () => {
    const other = await tenantB.monthUsage("2026-10");

    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ calls: 1, estimatedUsd: 9 });
    await expect(tenantA.monthUsage("2026-13")).rejects.toThrow("YYYY-MM");
  });

  it("counts the plan step's calls once each, from the run's latest plan event", async () => {
    await seedRun(tenantC);
    const step = (name: string, provider: string, modelId: string, completedAt: string) => ({
      step: name,
      provider,
      modelId,
      route: provider === "openai" ? "openai-api" : "vertex-ai",
      inputTokens: 10,
      outputTokens: 5,
      estimatedUsd: 0.01,
      completedAt,
    });
    const plan = step("plan", "anthropic", "claude-sonnet-5-5", "2026-09-30T23:59:00.000Z");
    const review = step("review", "openai", "gpt-6-luna", "2026-10-01T00:01:00.000Z");
    // Each event holds every call of the step so far, so only the latest one is read.
    for (const [index, steps] of [[plan], [plan, review]].entries()) {
      await tenantC.appendAuditEvent({
        id: `plan-event-${index}`,
        workspaceId: "workspace-1",
        eventType: "run.application-plan",
        entityType: "run",
        entityId: "run-1",
        payload: { schemaVersion: 1, steps },
        createdAt: review.completedAt,
      });
    }
    await tenantC.saveExecution(execution({ estimatedUsd: 0.5 }));

    expect(await tenantC.monthUsage("2026-10")).toEqual([
      {
        company: "anthropic",
        model: "claude-sonnet-5-5",
        route: "vertex-ai",
        calls: 1,
        inputTokens: 100,
        outputTokens: 50,
        estimatedUsd: 0.5,
        unpricedCalls: 0,
      },
      {
        company: "openai",
        model: "gpt-6-luna",
        route: "openai-api",
        calls: 1,
        inputTokens: 10,
        outputTokens: 5,
        estimatedUsd: 0.01,
        unpricedCalls: 0,
      },
    ]);
    expect(await tenantC.monthUsage("2026-09")).toMatchObject([{ calls: 1, inputTokens: 10 }]);
  });

  it("counts each career interviewer call from its own event (#2758)", async () => {
    const tenantD = await schema.open("tenant-d");
    await tenantD.saveWorkspace({
      id: "workspace-1",
      state: "collecting",
      createdAt: at,
      updatedAt: at,
    });
    const call = (index: number, completedAt: string, extra: object = {}) =>
      tenantD.appendAuditEvent({
        id: `interview-call-${index}`,
        workspaceId: "workspace-1",
        eventType: "career-interview.model-call",
        entityType: "career-interview-session",
        entityId: "session-1",
        payload: {
          schemaVersion: 1,
          provider: "anthropic",
          modelId: "claude-sonnet-5-5",
          route: "vertex-ai",
          inputTokens: 1_000,
          outputTokens: 200,
          estimatedUsd: 0.006,
          completedAt,
          ...extra,
        },
        createdAt: completedAt,
      });
    try {
      await call(0, "2026-10-02T10:00:00.000Z");
      await call(1, "2026-10-02T10:01:00.000Z");
      // A billed failure carries no route; an unpriced call counts but adds no cost.
      await call(2, "2026-10-02T10:02:00.000Z", { route: null, inputTokens: 0, outputTokens: 0 });
      await call(3, "2026-10-02T10:03:00.000Z", { estimatedUsd: null });
      await call(4, "2026-11-01T00:00:00.000Z");

      expect(await tenantD.monthUsage("2026-10")).toEqual([
        {
          company: "anthropic",
          model: "claude-sonnet-5-5",
          route: null,
          calls: 1,
          inputTokens: 0,
          outputTokens: 0,
          estimatedUsd: 0.006,
          unpricedCalls: 0,
        },
        {
          company: "anthropic",
          model: "claude-sonnet-5-5",
          route: "vertex-ai",
          calls: 3,
          inputTokens: 3_000,
          outputTokens: 600,
          estimatedUsd: 0.012,
          unpricedCalls: 1,
        },
      ]);
      expect(await tenantA.monthUsage("2026-11")).toEqual([]);
    } finally {
      await tenantD.close();
    }
  });
});
