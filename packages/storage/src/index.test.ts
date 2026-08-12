import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ArtifactVersionInput,
  type ContextSnapshotInput,
  type DecisionRecordInput,
  type EvidenceChunkRecord,
  type EvidenceSourceRecord,
  type ExecutionRecordInput,
  type ExportRecordInput,
  type FindingRecordInput,
  openSqliteStorage,
  type RoundRecordInput,
  type RunRecordInput,
  type SqliteStorage,
  StorageConflictError,
  StorageSecurityError,
  type WorkspaceRecord,
} from "./index.js";

const workspace: WorkspaceRecord = {
  id: "workspace-1",
  state: "collecting",
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
};

const contextSnapshot = (payload: ContextSnapshotInput["payload"]): ContextSnapshotInput => ({
  id: "context-1",
  workspaceId: workspace.id,
  schemaVersion: 1,
  createdAt: "2026-08-12T10:01:00.000Z",
  payload,
});

const source: EvidenceSourceRecord = {
  id: "source-1",
  workspaceId: workspace.id,
  path: "/local/evidence/resume.md",
  mediaType: "text/markdown",
  checksum: "a".repeat(64),
  createdAt: "2026-08-12T10:02:00.000Z",
};

const chunk = (id: string, text: string, ordinal: number): EvidenceChunkRecord => ({
  id,
  workspaceId: workspace.id,
  sourceId: source.id,
  ordinal,
  lineStart: ordinal + 1,
  lineEnd: ordinal + 1,
  checksum: `${String.fromCharCode(98 + ordinal)}${"0".repeat(63)}`,
  text,
  createdAt: "2026-08-12T10:03:00.000Z",
});

const artifact = (payload: ArtifactVersionInput["payload"]): ArtifactVersionInput => ({
  id: "artifact-1",
  workspaceId: workspace.id,
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-12T10:04:00.000Z",
  payload,
});

const run = (artifactId: string | null = "artifact-1"): RunRecordInput => ({
  id: "run-1",
  workspaceId: workspace.id,
  contextSnapshotId: "context-1",
  state: "drafting",
  round: 1,
  currentStep: "author",
  budget: { maxRounds: 3, maxCostUsd: 1 },
  artifactId,
  approval: "pending",
  totalCostUsd: 0.01,
  startedAt: "2026-08-12T10:10:00.000Z",
  updatedAt: "2026-08-12T10:10:01.000Z",
  lastError: null,
  payload: { stateReason: "fixture" },
});

const round = (): RoundRecordInput => ({
  id: "round-1",
  workspaceId: workspace.id,
  runId: "run-1",
  number: 1,
  state: "drafting",
  startedAt: "2026-08-12T10:10:00.000Z",
  completedAt: null,
  evaluation: null,
  payload: { source: "fixture" },
});

const execution = (): ExecutionRecordInput => ({
  id: "execution-1",
  workspaceId: workspace.id,
  runId: "run-1",
  roundId: "round-1",
  contextSnapshotId: "context-1",
  artifactId: "artifact-1",
  attempt: 1,
  step: "author",
  status: "completed",
  provider: "anthropic",
  modelId: "author-test",
  providerRequestId: "provider-request-1",
  outputChecksum: "b".repeat(64),
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  estimatedUsd: 0.01,
  startedAt: "2026-08-12T10:10:02.000Z",
  completedAt: "2026-08-12T10:10:03.000Z",
  errorCode: null,
  output: { artifactVersion: 1 },
  payload: { purpose: "author" },
});

const finding = (): FindingRecordInput => ({
  id: "finding-1",
  workspaceId: workspace.id,
  runId: "run-1",
  roundId: "round-1",
  executionId: "execution-1",
  artifactId: "artifact-1",
  code: "uncovered-requirement",
  category: "coverage",
  severity: "warning",
  message: "A requirement needs stronger evidence.",
  claimId: null,
  sectionId: null,
  requirementId: "requirement-1",
  createdAt: "2026-08-12T10:10:04.000Z",
  payload: { userVisible: true },
});

const decision = (): DecisionRecordInput => ({
  id: "decision-1",
  workspaceId: workspace.id,
  runId: "run-1",
  roundId: "round-1",
  artifactId: "artifact-1",
  type: "approve",
  rationale: "The user approved the current artifact.",
  actor: "user",
  createdAt: "2026-08-12T10:10:05.000Z",
  payload: { visible: true },
});

const exportRecord = (): ExportRecordInput => ({
  id: "export-1",
  workspaceId: workspace.id,
  runId: "run-1",
  artifactId: "artifact-1",
  format: "markdown",
  status: "completed",
  outputPath: "/local/exports/cv.md",
  outputChecksum: "c".repeat(64),
  createdAt: "2026-08-12T10:10:06.000Z",
  payload: { approved: true },
});

async function seedHistory(storage: SqliteStorage): Promise<void> {
  await storage.saveWorkspace(workspace);
  await storage.saveContextSnapshot(contextSnapshot({ job: "fixture" }));
  await storage.saveArtifactVersion(artifact({ version: "one" }));
  await storage.saveRun(run());
  await storage.saveRound(round());
  await storage.saveExecution(execution());
  await storage.saveFinding(finding());
  await storage.saveDecision(decision());
  await storage.saveExport(exportRecord());
}

interface RawSqliteDatabase {
  readonly exec: (sql: string) => void;
  readonly close: () => void;
}

interface RawSqliteConstructor {
  new (filename: string): RawSqliteDatabase;
}

function removeMigrationTwo(filename: string): void {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  const database = new (Constructor as RawSqliteConstructor)(filename);
  database.exec(
    "PRAGMA foreign_keys = OFF; DROP TABLE run_snapshots; DROP TABLE exports; DROP TABLE decisions; DROP TABLE findings; DROP TABLE executions; DROP TABLE rounds; DROP TABLE runs; DELETE FROM schema_migrations WHERE version IN (2, 3);",
  );
  database.close();
}

describe("SQLite storage", () => {
  it("applies migration v1 idempotently and rejects sensitive key persistence", async () => {
    const storage = openSqliteStorage(":memory:");

    expect(storage.appliedMigrationVersions()).toEqual([1, 2, 3]);
    storage.migrate();
    expect(storage.appliedMigrationVersions()).toEqual([1, 2, 3]);

    await storage.set("ui.language", "en");
    await expect(storage.get("ui.language")).resolves.toBe("en");
    await expect(storage.set("provider.apiKey", "not-persisted")).rejects.toThrow(
      StorageSecurityError,
    );
    await expect(storage.get("provider.apiKey")).resolves.toBeUndefined();
    await storage.saveWorkspace(workspace);
    await expect(
      storage.saveContextSnapshot(contextSnapshot({ apiKey: "not-persisted" })),
    ).rejects.toThrow(StorageSecurityError);
    await storage.close();
  });

  it("upgrades a persisted v1 database without losing workspace history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-migration-"));
    const filename = join(directory, "workspace.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.saveWorkspace(workspace);
    await initial.close();

    removeMigrationTwo(filename);
    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([1, 2, 3]);
    await expect(upgraded.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    upgraded.migrate();
    expect(upgraded.appliedMigrationVersions()).toEqual([1, 2, 3]);
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips local records after close and reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-storage-"));
    const filename = join(directory, "workspace.sqlite");
    const first = openSqliteStorage(filename);

    await first.saveWorkspace(workspace);
    const snapshot = await first.saveContextSnapshot(
      contextSnapshot({
        a: 1,
        b: "local-only",
      }),
    );
    await first.saveEvidenceSource(source);
    await first.saveEvidenceChunk(chunk("chunk-1", "Built local-first systems.", 0));
    const savedArtifact = await first.saveArtifactVersion(
      artifact({
        claims: [{ id: "claim-1", text: "Built local-first systems." }],
      }),
    );
    await first.saveRun(run(savedArtifact.id));
    await first.saveRunSnapshot({
      workspaceId: workspace.id,
      runId: "run-1",
      contextSnapshotId: "context-1",
      state: "drafting",
      round: 1,
      currentStep: "author",
      budget: { maxRounds: 3 },
      artifactId: savedArtifact.id,
      approval: "pending",
      totalCostUsd: 0.01,
      startedAt: "2026-08-12T10:10:00.000Z",
      updatedAt: "2026-08-12T10:10:01.000Z",
      lastError: null,
      payload: { state: "drafting" },
    });
    await first.saveRound(round());
    await first.saveExecution(execution());
    await first.saveFinding(finding());
    await first.saveDecision(decision());
    await first.saveExport(exportRecord());
    await first.close();

    const second = openSqliteStorage(filename);
    await expect(second.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    await expect(second.getContextSnapshot(snapshot.id)).resolves.toEqual(snapshot);
    await expect(second.getEvidenceSource(source.id)).resolves.toEqual(source);
    await expect(second.getArtifactVersion(savedArtifact.id)).resolves.toEqual(savedArtifact);
    await expect(second.getRun("run-1")).resolves.toMatchObject(run(savedArtifact.id));
    await expect(second.getLatestRunSnapshot("run-1")).resolves.toMatchObject({
      runId: "run-1",
      state: "drafting",
      payload: { state: "drafting" },
    });
    await expect(second.listRunSnapshots("run-1")).resolves.toHaveLength(1);
    await expect(second.listRounds("run-1")).resolves.toHaveLength(1);
    await expect(second.getExecution("execution-1")).resolves.toMatchObject(execution());
    await expect(second.listFindings("run-1")).resolves.toHaveLength(1);
    await expect(second.listDecisions("run-1")).resolves.toHaveLength(1);
    await expect(second.listExports("run-1")).resolves.toHaveLength(1);
    await expect(second.searchEvidence("local-first")).resolves.toMatchObject([
      { id: "chunk-1", sourceId: "source-1", text: "Built local-first systems." },
    ]);
    await second.close();

    await expect(readFile(filename)).resolves.toBeInstanceOf(Buffer);
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps run history idempotent and rejects conflicting immutable records", async () => {
    const storage = openSqliteStorage(":memory:");
    await seedHistory(storage);

    await expect(storage.saveRun(run())).resolves.toMatchObject(run());
    await expect(storage.saveRound(round())).resolves.toMatchObject(round());
    await expect(storage.saveExecution(execution())).resolves.toMatchObject(execution());
    await expect(storage.saveFinding(finding())).resolves.toMatchObject(finding());
    await expect(storage.saveDecision(decision())).resolves.toMatchObject(decision());
    await expect(storage.saveExport(exportRecord())).resolves.toMatchObject(exportRecord());

    await expect(storage.saveRun({ ...run(), state: "reviewing" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveRound({ ...round(), state: "reviewing" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveExecution({ ...execution(), attempt: 2 })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveFinding({ ...finding(), message: "changed" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveDecision({ ...decision(), rationale: "changed" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveExport({ ...exportRecord(), status: "failed" })).rejects.toThrow(
      StorageConflictError,
    );
    await storage.close();
  });

  it("appends distinct lifecycle snapshots and returns the latest projection", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace);
    await storage.saveContextSnapshot(contextSnapshot({ fixture: true }));

    const base = {
      workspaceId: workspace.id,
      runId: "run-1",
      contextSnapshotId: "context-1",
      round: 1,
      currentStep: "author" as const,
      budget: { maxRounds: 3 },
      artifactId: null,
      approval: "pending" as const,
      totalCostUsd: 0,
      startedAt: "2026-08-12T10:10:00.000Z",
      lastError: null,
    };

    const first = await storage.saveRunSnapshot({
      ...base,
      state: "drafting",
      updatedAt: "2026-08-12T10:10:01.000Z",
      payload: { state: "drafting" },
    });
    const duplicate = await storage.saveRunSnapshot({
      ...base,
      state: "drafting",
      updatedAt: "2026-08-12T10:10:01.000Z",
      payload: { state: "drafting" },
    });
    const second = await storage.saveRunSnapshot({
      ...base,
      state: "paused",
      currentStep: null,
      updatedAt: "2026-08-12T10:10:02.000Z",
      payload: { state: "paused" },
    });

    expect(duplicate).toEqual(first);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    await expect(storage.getLatestRunSnapshot("run-1")).resolves.toEqual(second);
    await expect(storage.listRunSnapshots("run-1")).resolves.toHaveLength(2);
    await storage.close();
  });

  it("enforces relational ownership and rejects sensitive structured payloads", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace);
    await expect(storage.saveRun(run())).rejects.toThrow();
    await storage.saveContextSnapshot(contextSnapshot({ fixture: true }));
    await expect(storage.saveRound(round())).rejects.toThrow();
    await storage.saveRun(run(null));
    await expect(storage.saveExecution(execution())).rejects.toThrow();

    await storage.saveRound(round());
    await expect(
      storage.saveExecution({ ...execution(), output: { apiKey: "never-persisted" } }),
    ).rejects.toThrow(StorageSecurityError);
    await expect(
      storage.saveExecution({ ...execution(), output: { prompt: "raw prompt" } }),
    ).rejects.toThrow(StorageSecurityError);
    await expect(
      storage.saveFinding({ ...finding(), payload: { providerToken: "never-persisted" } }),
    ).rejects.toThrow(StorageSecurityError);
    await storage.close();
  });

  it("keeps immutable records idempotent and rejects changed payloads", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace);
    await expect(storage.planRetention("not-a-timestamp")).rejects.toThrow();
    await expect(storage.planRetention("2026-08-12T10:05:30.000Z")).resolves.toMatchObject({
      immutableBusinessRecords: true,
    });

    const first = await storage.saveContextSnapshot(contextSnapshot({ b: 2, a: 1 }));
    const equivalent = await storage.saveContextSnapshot(contextSnapshot({ a: 1, b: 2 }));
    expect(equivalent).toEqual(first);
    await expect(storage.saveContextSnapshot(contextSnapshot({ a: 3 }))).rejects.toThrow(
      StorageConflictError,
    );

    await expect(
      storage.saveArtifactVersion({
        ...artifact({ value: "child" }),
        id: "artifact-child",
        version: 2,
        parentVersionId: "missing-parent",
      }),
    ).rejects.toThrow();
    await storage.close();
  });

  it("requires workspace and source foreign keys and indexes evidence safely", async () => {
    const storage = openSqliteStorage(":memory:");
    await expect(storage.saveContextSnapshot(contextSnapshot({ value: true }))).rejects.toThrow();
    await storage.saveWorkspace(workspace);
    await expect(storage.saveEvidenceChunk(chunk("orphan", "orphan", 0))).rejects.toThrow();

    await storage.saveEvidenceSource(source);
    await storage.saveEvidenceChunk(chunk("chunk-1", "TypeScript platform engineer.", 0));
    await storage.saveEvidenceChunk(chunk("chunk-2", "Local persistence and testing.", 1));

    const results = await storage.searchEvidence("platform", 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("chunk-1");
    await expect(storage.searchEvidence("' OR 1=1")).resolves.toEqual([]);
    await expect(storage.searchEvidence("platform", 0)).rejects.toThrow();
    await storage.close();
  });

  it("chains audit events and creates a reopenable backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-backup-"));
    const filename = join(directory, "workspace.sqlite");
    const backupFilename = join(directory, "workspace-backup.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.saveWorkspace(workspace);
    const first = await storage.appendAuditEvent({
      id: "event-1",
      workspaceId: workspace.id,
      eventType: "test.first",
      entityType: "test",
      entityId: "one",
      payload: { value: 1 },
      createdAt: "2026-08-12T10:05:00.000Z",
    });
    await expect(
      storage.appendAuditEvent({
        id: "event-1",
        workspaceId: workspace.id,
        eventType: "test.first",
        entityType: "test",
        entityId: "one",
        payload: { value: 1 },
        createdAt: "2026-08-12T10:05:00.000Z",
      }),
    ).resolves.toEqual(first);
    await expect(
      storage.appendAuditEvent({
        id: "event-1",
        workspaceId: workspace.id,
        eventType: "test.first",
        entityType: "test",
        entityId: "one",
        payload: { value: 9 },
        createdAt: "2026-08-12T10:05:00.000Z",
      }),
    ).rejects.toThrow(StorageConflictError);
    const second = await storage.appendAuditEvent({
      id: "event-2",
      workspaceId: workspace.id,
      eventType: "test.second",
      entityType: "test",
      entityId: "two",
      payload: { value: 2 },
      createdAt: "2026-08-12T10:06:00.000Z",
    });

    expect(first.previousEventChecksum).not.toBeNull();
    expect(second.previousEventChecksum).toBe(first.eventChecksum);
    expect((await storage.listAuditEvents(workspace.id)).at(-1)?.eventChecksum).toBe(
      second.eventChecksum,
    );
    await storage.backup(backupFilename);
    await storage.close();

    const backup = openSqliteStorage(backupFilename);
    await expect(backup.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    await expect(backup.listAuditEvents(workspace.id)).resolves.toHaveLength(3);
    await backup.close();
    await rm(directory, { recursive: true, force: true });
  });
});
