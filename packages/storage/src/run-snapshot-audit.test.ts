import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type JsonValue, openSqliteStorage, type SqliteStorage } from "./index.js";
import { runSnapshotReferenceKind } from "./run-snapshot-audit.js";

const workspaceId = "workspace-1";
const at = "2026-10-15T10:00:00.000Z";

interface RawDatabase {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => { readonly get: () => { readonly bytes: number } };
  readonly close: () => void;
}

function rawDatabase(filename: string): RawDatabase {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as { readonly default?: unknown };
  const Constructor = (loaded.default ?? loaded) as new (filename: string) => RawDatabase;
  return new Constructor(filename);
}

function snapshotInput(index: number, payload: JsonValue = { index }) {
  return {
    workspaceId,
    runId: "run-1",
    contextSnapshotId: "context-1",
    state: "drafting" as const,
    round: 1,
    currentStep: "author" as const,
    budget: { maxRounds: 3 },
    artifactId: null,
    approval: "pending" as const,
    totalCostUsd: index / 100,
    startedAt: at,
    updatedAt: `2026-10-15T10:00:${String(index).padStart(2, "0")}.000Z`,
    lastError: null,
    payload,
  };
}

describe("run snapshot audit events", () => {
  const directories: string[] = [];
  const stores: SqliteStorage[] = [];

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((storage) => storage.close()));
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function open(): Promise<{ storage: SqliteStorage; filename: string }> {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-snapshot-audit-"));
    directories.push(directory);
    const filename = join(directory, "workspace.sqlite");
    const storage = openSqliteStorage(filename);
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
    return { storage, filename };
  }

  async function tamper(storage: SqliteStorage, filename: string, sql: string): Promise<void> {
    await storage.close();
    const database = rawDatabase(filename);
    try {
      database.exec(sql);
    } finally {
      database.close();
    }
  }

  it("records a reference to the snapshot instead of a second copy", async () => {
    const { storage } = await open();
    const saved = await storage.saveRunSnapshot(snapshotInput(1, { draft: "x".repeat(5_000) }));

    const events = (await storage.listAuditEvents(workspaceId)).filter(
      (event) => event.eventType === "run-snapshot.appended",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe("run-1");
    expect(events[0]?.payload).toEqual({
      kind: runSnapshotReferenceKind,
      snapshotId: saved.id,
      sequence: saved.sequence,
      runId: "run-1",
      checksum: saved.checksum,
    });
    await expect(storage.auditEvents.verifyAuditChain(workspaceId)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("keeps snapshot events small however large the snapshots are", async () => {
    const { storage, filename } = await open();
    const snapshots = 20;
    for (let index = 1; index <= snapshots; index += 1) {
      await storage.saveRunSnapshot(snapshotInput(index, { draft: "x".repeat(50_000), index }));
    }
    await storage.close();

    const database = rawDatabase(filename);
    try {
      const read = (sql: string): number => {
        return database.prepare(sql).get().bytes;
      };
      const eventBytes = read(
        "SELECT SUM(LENGTH(payload_json)) AS bytes FROM audit_events WHERE event_type = 'run-snapshot.appended'",
      );
      const snapshotBytes = read("SELECT SUM(LENGTH(payload_json)) AS bytes FROM run_snapshots");
      expect(eventBytes / snapshots).toBeLessThan(1_000);
      expect(snapshotBytes).toBeGreaterThan(snapshots * 50_000);
    } finally {
      database.close();
    }
  });

  it("verifies a chain that mixes legacy full events with reference events", async () => {
    const { storage } = await open();
    const first = await storage.saveRunSnapshot(snapshotInput(1));
    const { sequence: _sequence, ...legacyPayload } = first;
    await storage.appendAuditEvent({
      id: "legacy-full-copy",
      workspaceId,
      eventType: "run-snapshot.appended",
      entityType: "run-snapshot",
      entityId: "run-1",
      payload: JSON.parse(JSON.stringify(legacyPayload)) as JsonValue,
      createdAt: at,
    });
    await storage.saveRunSnapshot(snapshotInput(2));

    const result = await storage.auditEvents.verifyAuditChain(workspaceId);
    expect(result).toMatchObject({ ok: true, problems: [] });
    const snapshotEvents = (await storage.listAuditEvents(workspaceId)).filter(
      (event) => event.eventType === "run-snapshot.appended",
    );
    expect(snapshotEvents).toHaveLength(3);
    expect(snapshotEvents.map((event) => "kind" in (event.payload as object))).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("detects a tampered snapshot row", async () => {
    const { storage, filename } = await open();
    const saved = await storage.saveRunSnapshot(snapshotInput(1));
    await tamper(
      storage,
      filename,
      `DROP TRIGGER run_snapshots_immutable_update; UPDATE run_snapshots SET payload_json = '{"index":99}' WHERE id = '${saved.id}'`,
    );

    const reopened = openSqliteStorage(filename);
    stores.push(reopened);
    const result = await reopened.auditEvents.verifyAuditChain(workspaceId);
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toEqual(["snapshot-checksum"]);
  });

  it("detects a snapshot row whose stored checksum was also rewritten", async () => {
    const { storage, filename } = await open();
    const saved = await storage.saveRunSnapshot(snapshotInput(1));
    await tamper(
      storage,
      filename,
      `DROP TRIGGER run_snapshots_immutable_update; UPDATE run_snapshots SET payload_json = '{"index":99}', record_checksum = '${"0".repeat(64)}' WHERE id = '${saved.id}'`,
    );

    const reopened = openSqliteStorage(filename);
    stores.push(reopened);
    const result = await reopened.auditEvents.verifyAuditChain(workspaceId);
    expect(result.problems.map((problem) => problem.code)).toEqual(["snapshot-checksum"]);
  });

  it("detects a deleted snapshot row", async () => {
    const { storage, filename } = await open();
    const saved = await storage.saveRunSnapshot(snapshotInput(1));
    await tamper(
      storage,
      filename,
      `DROP TRIGGER run_snapshots_immutable_delete; DELETE FROM run_snapshots WHERE id = '${saved.id}'`,
    );

    const reopened = openSqliteStorage(filename);
    stores.push(reopened);
    const result = await reopened.auditEvents.verifyAuditChain(workspaceId);
    expect(result.problems.map((problem) => problem.code)).toEqual(["snapshot-missing"]);
  });

  it("detects a tampered reference event", async () => {
    const { storage, filename } = await open();
    await storage.saveRunSnapshot(snapshotInput(1));
    await storage.saveRunSnapshot(snapshotInput(2));
    await tamper(
      storage,
      filename,
      `DROP TRIGGER audit_events_immutable_update; UPDATE audit_events SET payload_json = REPLACE(payload_json, '"sequence":1', '"sequence":7') WHERE event_type = 'run-snapshot.appended' AND payload_json LIKE '%"sequence":1,%'`,
    );

    const reopened = openSqliteStorage(filename);
    stores.push(reopened);
    const result = await reopened.auditEvents.verifyAuditChain(workspaceId);
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toContain("payload-checksum");
  });

  it("detects a removed event through the chain link", async () => {
    const { storage, filename } = await open();
    for (const index of [1, 2, 3]) await storage.saveRunSnapshot(snapshotInput(index));
    await tamper(
      storage,
      filename,
      "DROP TRIGGER audit_events_immutable_delete; DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE event_type = 'run-snapshot.appended' ORDER BY sequence LIMIT 1 OFFSET 1)",
    );

    const reopened = openSqliteStorage(filename);
    stores.push(reopened);
    const result = await reopened.auditEvents.verifyAuditChain(workspaceId);
    expect(result.problems.map((problem) => problem.code)).toEqual(["chain-link"]);
  });
});
