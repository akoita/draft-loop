import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStorageRunStore,
  type ExecutionRecord,
  type RunSnapshot,
  resolveSnapshotPayload,
} from "@draft-loop/orchestrator";
import { type JsonValue, openSqliteStorage, type SqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { compactWorkspaceHistory, historyCompactedEventType } from "./history-compaction.js";

const workspaceId = "workspace-1";
const at = "2026-10-15T10:00:00.000Z";
const checksum = "a".repeat(64);

function artifact(runId: string, version: number, claims: number): unknown {
  return {
    schemaVersion: 1,
    id: `${runId}-artifact-${version}`,
    version,
    parentVersionId: version === 1 ? null : `${runId}-artifact-${version - 1}`,
    createdAt: at,
    language: "en",
    sections: [{ id: "section-1", title: "Summary", kind: "summary", order: 0, blocks: [] }],
    claims: Array.from({ length: claims }, (_, index) => ({
      id: `claim-${index}`,
      text: `Synthetic claim ${index}.`.padEnd(200, "x"),
      sectionId: "section-1",
      substantive: true,
      status: "verified",
      evidence: [{ sourcePath: "/local/source.md", sourceChecksum: checksum, excerpt: "Excerpt." }],
    })),
    decisions: [],
  };
}

function execution(runId: string, index: number): ExecutionRecord {
  return {
    id: `${runId}:1:step-${index}:attempt:1`,
    runId,
    contextSnapshotId: "context-1",
    round: 1,
    step: index % 2 === 0 ? "critic" : "author",
    status: "completed",
    output: index % 2 === 1 ? artifact(runId, 1, 20) : { findings: [] },
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
  } as unknown as ExecutionRecord;
}

function snapshot(runId: string, step: number, state = "reviewing"): RunSnapshot {
  return {
    schemaVersion: 1,
    runId,
    workspaceId,
    contextSnapshotId: "context-1",
    state,
    round: 1,
    currentStep: "critic",
    budget: { maxRounds: 3 },
    artifact: artifact(runId, 1, 250),
    findings: [],
    latestEvaluation: null,
    scoreHistory: [],
    executionHistory: Array.from({ length: step }, (_, index) => execution(runId, index + 1)),
    totalCostUsd: step / 100,
    approval: "pending",
    startedAt: at,
    updatedAt: `2026-10-15T10:00:${String(step).padStart(2, "0")}.000Z`,
    lastError: null,
    durationAccounting: null,
    adjudicationRuntime: null,
    readinessDecision: null,
    approvedArtifact: null,
  } as unknown as RunSnapshot;
}

interface RawDatabase {
  readonly exec: (sql: string) => void;
  readonly close: () => void;
}

function rawDatabase(filename: string): RawDatabase {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as { readonly default?: unknown };
  const Constructor = (loaded.default ?? loaded) as new (filename: string) => RawDatabase;
  return new Constructor(filename);
}

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

describe("compactWorkspaceHistory", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  /** A workspace written the way legacy builds did: full snapshot rows and full snapshot events. */
  async function legacyWorkspace(
    options: { state?: string; runs?: number; steps?: number } = {},
  ): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-compaction-"));
    roots.push(root);
    await mkdir(join(root, ".draft-loop"));
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
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
      await storage.set("unrelated:key", "kept as is");
      const store = createStorageRunStore(storage, { slimSnapshots: false });
      for (let run = 1; run <= (options.runs ?? 2); run += 1) {
        const runId = `run-${run}`;
        const steps = options.steps ?? 6;
        for (let step = 1; step <= steps; step += 1) {
          await store.saveExecution(execution(runId, step));
          const last = step === steps;
          await store.saveRun(
            snapshot(runId, step, last ? (options.state ?? "awaiting-approval") : "reviewing"),
          );
          await store.appendEvent({
            runId,
            workspaceId,
            type: "step.completed",
            createdAt: at,
            payload: { step },
          } as unknown as Parameters<typeof store.appendEvent>[0]);
        }
        const rows = await storage.listRunSnapshots(runId);
        await storage.saveRun({
          id: runId,
          workspaceId,
          contextSnapshotId: "context-1",
          state: "drafting",
          round: 1,
          currentStep: "author",
          budget: { maxRounds: 3 },
          artifactId: null,
          approval: "pending",
          totalCostUsd: 0,
          startedAt: at,
          updatedAt: at,
          lastError: null,
          payload: {},
        });
        // The legacy event carried the whole snapshot row, as the reference now points at it.
        for (const row of rows) {
          await storage.appendAuditEvent({
            id: `legacy:${row.id}`,
            workspaceId,
            eventType: "run-snapshot.appended",
            entityType: "run-snapshot",
            entityId: runId,
            payload: JSON.parse(JSON.stringify(row)) as JsonValue,
            createdAt: row.updatedAt,
          });
        }
      }
      await expect(storage.auditEvents.verifyAuditChain(workspaceId)).resolves.toMatchObject({
        ok: true,
      });
    } finally {
      await storage.close();
    }
    return root;
  }

  const dependencies = {
    readWorkspace: async () => ({ id: workspaceId }),
    now: () => "2026-10-16T08:30:00.000Z",
  };

  it("shrinks legacy history, keeps a backup and reads every run back equal", async () => {
    const root = await legacyWorkspace();
    const history = join(root, ".draft-loop", "history.sqlite");
    const original = await digest(history);
    const before = (await stat(history)).size;

    const result = await compactWorkspaceHistory({ root }, dependencies);

    expect(result.beforeBytes).toBe(before);
    expect(result.afterBytes).toBe((await stat(history)).size);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes / 2);
    expect(result.runsVerified).toBe(2);
    expect(result.backupFileName).toBe("history.sqlite.pre-compaction-20261016T083000Z");

    const backup = join(root, ".draft-loop", result.backupFileName);
    expect((await stat(backup)).size).toBe(before);
    expect(await readdir(join(root, ".draft-loop"))).toEqual(
      [result.backupFileName, "history.sqlite"].sort(),
    );

    const old = openSqliteStorage(backup);
    const compact = openSqliteStorage(history);
    try {
      expect(await digest(history)).not.toBe(original);
      for (const runId of ["run-1", "run-2"]) {
        const expected = await createStorageRunStore(old).loadRun(runId);
        expect(await createStorageRunStore(compact).loadRun(runId)).toStrictEqual(expected);
        const oldRows = await old.listRunSnapshots(runId);
        const rows = await compact.listRunSnapshots(runId);
        expect(rows).toHaveLength(oldRows.length);
        for (const [index, row] of rows.entries()) {
          expect(row.payload).toHaveProperty("snapshotShape", "run-snapshot-slim.v1");
          expect(await resolveSnapshotPayload(compact, row.payload)).toStrictEqual(
            await resolveSnapshotPayload(old, oldRows[index]?.payload),
          );
        }
      }
      expect(await compact.get("unrelated:key")).toBe("kept as is");

      const chain = await compact.auditEvents.verifyAuditChain(workspaceId);
      expect(chain).toMatchObject({ ok: true });
      const oldEvents = await old.listAuditEvents(workspaceId);
      const events = await compact.listAuditEvents(workspaceId);
      expect(events).toHaveLength(oldEvents.length + 1);
      expect(
        events
          .filter((event) => event.eventType === "run-snapshot.appended")
          .every(
            (event) => (event.payload as { kind?: string }).kind === "run-snapshot-reference.v1",
          ),
      ).toBe(true);
      const recorded = events.at(-1);
      expect(recorded).toMatchObject({
        eventType: historyCompactedEventType,
        payload: {
          previousHeadChecksum: oldEvents.at(-1)?.eventChecksum,
          previousEventCount: oldEvents.length,
          backupFileName: result.backupFileName,
          beforeBytes: before,
        },
      });
      // The old chain survives whole in the backup.
      await expect(old.auditEvents.verifyAuditChain(workspaceId)).resolves.toMatchObject({
        ok: true,
        eventCount: oldEvents.length,
      });
    } finally {
      await old.close();
      await compact.close();
    }
  });

  it("keeps writing to the compacted history", async () => {
    const root = await legacyWorkspace({ runs: 1, steps: 3 });
    await compactWorkspaceHistory({ root }, dependencies);
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const store = createStorageRunStore(storage);
      await store.saveExecution(execution("run-1", 4));
      await store.saveRun(snapshot("run-1", 4));
      await expect(storage.auditEvents.verifyAuditChain(workspaceId)).resolves.toMatchObject({
        ok: true,
      });
    } finally {
      await storage.close();
    }
  });

  it("refuses while a run is working and changes nothing", async () => {
    const root = await legacyWorkspace({ runs: 1, steps: 2, state: "drafting" });
    const history = join(root, ".draft-loop", "history.sqlite");
    const original = await digest(history);

    await expect(compactWorkspaceHistory({ root }, dependencies)).rejects.toThrow(/still working/u);
    expect(await digest(history)).toBe(original);
    expect(await readdir(join(root, ".draft-loop"))).toEqual(["history.sqlite"]);
  });

  it("refuses an audit chain that does not verify and changes nothing", async () => {
    const root = await legacyWorkspace({ runs: 1, steps: 2 });
    const history = join(root, ".draft-loop", "history.sqlite");
    const database = rawDatabase(history);
    database.exec("DROP TRIGGER audit_events_immutable_update");
    database.exec("UPDATE audit_events SET event_checksum = 'broken' WHERE sequence = 2");
    database.close();
    const original = await digest(history);

    const error = await compactWorkspaceHistory({ root }, dependencies).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CliUserError);
    expect((error as Error).message).toMatch(/did not verify/u);
    expect(await digest(history)).toBe(original);
    expect(await readdir(join(root, ".draft-loop"))).toEqual(["history.sqlite"]);
  });

  it("leaves the original intact and removes its working files when compaction fails", async () => {
    const root = await legacyWorkspace({ runs: 1, steps: 3 });
    const history = join(root, ".draft-loop", "history.sqlite");
    const original = await digest(history);

    await expect(
      compactWorkspaceHistory(
        { root },
        {
          ...dependencies,
          beforeSwap: async () => {
            throw new Error("interrupted");
          },
        },
      ),
    ).rejects.toThrow(/was not changed/u);
    expect(await digest(history)).toBe(original);
    expect(await readdir(join(root, ".draft-loop"))).toEqual(["history.sqlite"]);

    const storage: SqliteStorage = openSqliteStorage(history);
    try {
      await expect(storage.auditEvents.verifyAuditChain(workspaceId)).resolves.toMatchObject({
        ok: true,
      });
    } finally {
      await storage.close();
    }
  });

  it("explains a workspace without run history", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-compaction-"));
    roots.push(root);
    await expect(compactWorkspaceHistory({ root }, dependencies)).rejects.toThrow(
      /no run history/u,
    );
  });
});
