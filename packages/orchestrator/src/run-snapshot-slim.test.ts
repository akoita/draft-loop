import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DraftArtifact } from "@draft-loop/schemas";
import { type JsonValue, openSqliteStorage, type SqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  artifactStorageKey,
  createStorageRunStore,
  type ExecutionRecord,
  type RunSnapshot,
  RunSnapshotReferenceError,
  resolveSnapshotPayload,
} from "./index.js";

const workspaceId = "workspace-1";
const runId = "run-1";
const at = "2026-10-15T10:00:00.000Z";
const checksum = "a".repeat(64);

function artifact(version: number, claims = 120): DraftArtifact {
  return {
    schemaVersion: 1,
    id: `artifact-${version}`,
    version,
    parentVersionId: version === 1 ? null : `artifact-${version - 1}`,
    createdAt: at,
    language: "en",
    sections: [
      {
        id: `section-${version}`,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          { id: `block-${version}`, type: "paragraph", text: "Synthetic text.", claimIds: [] },
        ],
      },
    ],
    claims: Array.from({ length: claims }, (_, index) => ({
      id: `claim-${version}-${index}`,
      text: `Synthetic claim ${index} for version ${version}.`.padEnd(200, "x"),
      sectionId: `section-${version}`,
      blockId: `block-${version}`,
      substantive: true,
      status: "verified" as const,
      evidence: [{ sourcePath: "/local/source.md", sourceChecksum: checksum, excerpt: "Excerpt." }],
    })),
    decisions: [],
  } as unknown as DraftArtifact;
}

function execution(index: number, round: number, output: unknown): ExecutionRecord {
  return {
    id: `${runId}:${round}:step-${index}:attempt:1`,
    runId,
    contextSnapshotId: "context-1",
    round,
    step: index % 2 === 0 ? "author" : "critic",
    status: "completed",
    output,
    provider: "anthropic",
    modelId: "model-test",
    providerRequestId: `request-${index}`,
    outputChecksum: checksum,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    estimatedUsd: 0.01,
    completedAt: at,
    attempt: 1,
    maxAttempts: 3,
    retryable: false,
  } as ExecutionRecord;
}

/** Each step appends one execution; the draft changes at step 4 (a revision in round 2). */
function stepSnapshot(step: number): { snapshot: RunSnapshot; executions: ExecutionRecord[] } {
  const revised = step >= 4;
  const draft = artifact(revised ? 2 : 1);
  const executions = Array.from({ length: step }, (_, index) =>
    execution(
      index + 1,
      index + 1 >= 4 ? 2 : 1,
      index % 2 === 0 ? artifact(index + 1 >= 4 ? 2 : 1, 5) : { findings: [] },
    ),
  );
  const snapshot: RunSnapshot = {
    schemaVersion: 1,
    runId,
    workspaceId,
    contextSnapshotId: "context-1",
    state: "reviewing",
    round: revised ? 2 : 1,
    currentStep: "critic",
    budget: { maxRounds: 3 },
    artifact: draft,
    findings: [],
    latestEvaluation: null,
    scoreHistory: [],
    executionHistory: executions,
    totalCostUsd: step / 100,
    approval: "pending",
    startedAt: at,
    updatedAt: `2026-10-15T10:00:${String(step).padStart(2, "0")}.000Z`,
    lastError: null,
    durationAccounting: null,
    adjudicationRuntime: null,
    readinessDecision: null,
    approvedArtifact: null,
  } as RunSnapshot;
  return { snapshot, executions };
}

describe("slim run snapshot rows", () => {
  const directories: string[] = [];
  const stores: SqliteStorage[] = [];

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((storage) => storage.close()));
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function open(): Promise<SqliteStorage> {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-slim-snapshots-"));
    directories.push(directory);
    const storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    stores.push(storage);
    await storage.saveWorkspace({
      id: workspaceId,
      state: "collecting",
      createdAt: at,
      updatedAt: at,
    });
    await storage.saveContextSnapshot({
      id: "context-1",
      workspaceId,
      schemaVersion: 1,
      createdAt: at,
      payload: { job: "synthetic" },
    });
    return storage;
  }

  async function saveSteps(storage: SqliteStorage, slimSnapshots: boolean, steps: number) {
    const store = createStorageRunStore(storage, { slimSnapshots });
    let last: RunSnapshot | undefined;
    for (let step = 1; step <= steps; step += 1) {
      const { snapshot, executions } = stepSnapshot(step);
      await store.saveExecution(executions[step - 1] as ExecutionRecord);
      await store.saveRun(snapshot);
      last = snapshot;
    }
    return last as RunSnapshot;
  }

  /** A view of the storage where the full run copy is gone, so loadRun must use the snapshot row. */
  function withoutRunCopy(storage: SqliteStorage, hidden?: (key: string) => boolean) {
    return {
      get: async (key: string) =>
        key.startsWith("draft-loop:orchestration:run:") || hidden?.(key) === true
          ? undefined
          : storage.get(key),
      set: (key: string, value: string) => storage.set(key, value),
      appendAuditEvent: (input: Parameters<SqliteStorage["appendAuditEvent"]>[0]) =>
        storage.appendAuditEvent(input),
      listAuditEvents: (id: string) => storage.listAuditEvents(id),
      saveRunSnapshot: (input: Parameters<SqliteStorage["saveRunSnapshot"]>[0]) =>
        storage.saveRunSnapshot(input),
      getLatestRunSnapshot: (id: string) => storage.getLatestRunSnapshot(id),
    };
  }

  it("rebuilds the same run as the legacy embedding across rounds and a revision", async () => {
    const slimStorage = await open();
    const legacyStorage = await open();
    const expected = await saveSteps(slimStorage, true, 7);
    await saveSteps(legacyStorage, false, 7);

    const slimRow = await slimStorage.getLatestRunSnapshot(runId);
    const legacyRow = await legacyStorage.getLatestRunSnapshot(runId);
    expect(slimRow?.payload).toMatchObject({ snapshotShape: "run-snapshot-slim.v1" });
    expect(legacyRow?.payload).not.toHaveProperty("snapshotShape");

    const fromSlim = await resolveSnapshotPayload(slimStorage, slimRow?.payload);
    const fromLegacy = await resolveSnapshotPayload(legacyStorage, legacyRow?.payload);
    expect(fromSlim).toStrictEqual(JSON.parse(JSON.stringify(expected)));
    expect(fromSlim).toStrictEqual(fromLegacy);

    const loaded = await createStorageRunStore(withoutRunCopy(slimStorage)).loadRun(runId);
    expect(loaded).toStrictEqual(fromLegacy);
    expect(loaded?.artifact?.version).toBe(2);
    expect(loaded?.executionHistory).toHaveLength(7);
  });

  it("keeps each snapshot row small however many steps precede it", async () => {
    const slimStorage = await open();
    const legacyStorage = await open();
    const steps = 30;
    await saveSteps(slimStorage, true, steps);
    await saveSteps(legacyStorage, false, steps);

    const size = async (storage: SqliteStorage): Promise<number[]> =>
      (await storage.listRunSnapshots(runId)).map((row) => JSON.stringify(row.payload).length);
    const slim = await size(slimStorage);
    const legacy = await size(legacyStorage);

    expect(slim).toHaveLength(steps);
    // Only the execution id list grows, by well under 200 bytes a step.
    expect(((slim.at(-1) as number) - (slim[0] as number)) / (steps - 1)).toBeLessThan(200);
    expect(slim.at(-1)).toBeLessThan(10_000);
    expect(legacy.at(-1) as number).toBeGreaterThan(20 * (slim.at(-1) as number));
  });

  it("loads a legacy full snapshot row unchanged", async () => {
    const storage = await open();
    const { snapshot } = stepSnapshot(5);
    const payload = JSON.parse(JSON.stringify(snapshot)) as JsonValue;
    await storage.saveRunSnapshot({
      workspaceId,
      runId,
      contextSnapshotId: "context-1",
      state: "reviewing",
      round: snapshot.round,
      currentStep: "critic",
      budget: { maxRounds: 3 },
      artifactId: snapshot.artifact?.id ?? null,
      approval: "pending",
      totalCostUsd: snapshot.totalCostUsd,
      startedAt: at,
      updatedAt: snapshot.updatedAt,
      lastError: null,
      payload,
    });

    await expect(
      createStorageRunStore(withoutRunCopy(storage)).loadRun(runId),
    ).resolves.toStrictEqual(payload);
  });

  it("verifies an audit chain that mixes legacy and slim snapshot rows", async () => {
    const storage = await open();
    await saveSteps(storage, false, 3);
    const store = createStorageRunStore(storage, { slimSnapshots: true });
    for (let step = 4; step <= 6; step += 1) {
      const { snapshot, executions } = stepSnapshot(step);
      await store.saveExecution(executions[step - 1] as ExecutionRecord);
      await store.saveRun(snapshot);
    }

    const rows = await storage.listRunSnapshots(runId);
    expect(rows.map((row) => "snapshotShape" in (row.payload as object))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    await expect(storage.auditEvents.verifyAuditChain(workspaceId)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("fails with a content-free error when a referenced artifact or execution is missing", async () => {
    const storage = await open();
    await saveSteps(storage, true, 3);
    const payload = (await storage.getLatestRunSnapshot(runId))?.payload;

    const noArtifact = withoutRunCopy(
      storage,
      (key) => key === artifactStorageKey(runId, "artifact-1"),
    );
    const missing = await resolveSnapshotPayload(noArtifact, payload).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(RunSnapshotReferenceError);
    expect(missing).toMatchObject({ reference: "artifact", problem: "missing" });
    expect((missing as Error).message).not.toContain("artifact-1");

    const noExecution = withoutRunCopy(storage, (key) => key.includes(":execution:"));
    await expect(resolveSnapshotPayload(noExecution, payload)).rejects.toMatchObject({
      reference: "execution",
      problem: "missing",
    });

    const altered = {
      get: async (key: string) =>
        key === artifactStorageKey(runId, "artifact-1")
          ? JSON.stringify({ ...artifact(1), language: "fr" })
          : storage.get(key),
    };
    await expect(resolveSnapshotPayload(altered, payload)).rejects.toMatchObject({
      reference: "artifact",
      problem: "mismatch",
    });
  });

  it("keeps the full payload when the artifact key already holds different content", async () => {
    const storage = await open();
    await storage.set(artifactStorageKey(runId, "artifact-1"), JSON.stringify(artifact(1, 3)));
    await saveSteps(storage, true, 1);

    const payload = (await storage.getLatestRunSnapshot(runId))?.payload;
    expect(payload).not.toHaveProperty("snapshotShape");
    expect(payload).toHaveProperty("artifact.id", "artifact-1");
  });
});
