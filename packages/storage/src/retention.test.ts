import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteStorage, StorageValidationError } from "./index.js";

describe("User-Controlled Retention & Privacy-Preserving Diagnostic Telemetry", () => {
  let tempDir: string;
  let dbPath: string;
  let storage: SqliteStorage;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "draft-loop-retention-test-"));
    dbPath = join(tempDir, "workspace.db");
    storage = new SqliteStorage(dbPath);
  });

  afterEach(async () => {
    await storage.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("plans retention and executes confirmed purge cleanly", async () => {
    const workspaceId = "ws-retention-test";
    await storage.saveWorkspace({
      id: workspaceId,
      state: "drafting",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const cutoff = "2026-08-10T00:00:00.000Z";
    const plan = await storage.planRetention(cutoff);
    expect(plan.before).toBe(cutoff);
    expect(plan.auditEventsEligible).toBeGreaterThanOrEqual(1);
    expect(plan.immutableBusinessRecords).toBe(true);

    // Rejects unconfirmed purge
    await expect(storage.purgeRetention(cutoff, { confirmed: false })).rejects.toThrow(
      StorageValidationError,
    );

    // Executes confirmed purge
    const result = await storage.purgeRetention(cutoff, { confirmed: true });
    expect(result.before).toBe(cutoff);
    expect(result.deletedAuditEventsCount).toBeGreaterThanOrEqual(1);

    // Subsequent plan shows zero eligible events
    const planAfter = await storage.planRetention(cutoff);
    expect(planAfter.auditEventsEligible).toBe(0);
  });

  it("exports content-free diagnostic telemetry without leaking candidate text or prompts", async () => {
    const workspaceId = "ws-diag-test";
    await storage.saveWorkspace({
      id: workspaceId,
      state: "drafting",
      createdAt: "2026-08-13T10:00:00.000Z",
      updatedAt: "2026-08-13T10:00:00.000Z",
    });

    await storage.saveContextSnapshot({
      id: "snap-1",
      workspaceId,
      schemaVersion: 1,
      createdAt: "2026-08-13T10:00:30.000Z",
      payload: {},
    });

    const runId = "run-diag-1";
    await storage.saveRun({
      id: runId,
      workspaceId,
      contextSnapshotId: "snap-1",
      state: "drafting",
      round: 1,
      currentStep: "author",
      approval: "pending",
      budget: { maxRounds: 3 },
      artifactId: null,
      totalCostUsd: 0.045,
      startedAt: "2026-08-13T10:01:00.000Z",
      updatedAt: "2026-08-13T10:01:00.000Z",
      lastError: null,
      payload: {},
    });

    await storage.saveRound({
      id: "round-1",
      workspaceId,
      runId,
      number: 1,
      state: "drafting",
      startedAt: "2026-08-13T10:01:00.000Z",
      completedAt: null,
      evaluation: null,
      payload: {},
    });

    await storage.saveExecution({
      id: "exec-1",
      workspaceId,
      runId,
      roundId: "round-1",
      contextSnapshotId: "snap-1",
      artifactId: null,
      attempt: 1,
      step: "author",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      providerRequestId: "req-1",
      outputChecksum: "chk-1",
      status: "completed",
      inputTokens: 1200,
      outputTokens: 450,
      totalTokens: 1650,
      estimatedUsd: 0.045,
      startedAt: "2026-08-13T10:01:00.000Z",
      completedAt: "2026-08-13T10:02:00.000Z",
      errorCode: null,
      output: null,
      payload: {},
    });

    const report = await storage.exportDiagnosticTelemetry();

    // Verify aggregate statistics
    expect(report.schemaVersion).toBe(1);
    expect(report.aggregates.workspacesCount).toBe(1);
    expect(report.aggregates.totalRunsCount).toBe(1);
    expect(report.aggregates.totalExecutionsCount).toBe(1);
    expect(report.aggregates.totalTokens.totalTokens).toBe(1650);
    expect(report.aggregates.providersDistribution.anthropic).toBe(1);
    expect(report.checksum).toBeDefined();

    // Verify zero PII or raw prompt content (T-003)
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("candidate");
    expect(serialized).not.toContain("resume");
    expect(serialized).not.toContain("promptTemplate");
  });
});
