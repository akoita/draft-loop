import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ArtifactVersionInput,
  type ContextSnapshotInput,
  type EvidenceChunkRecord,
  type EvidenceSourceRecord,
  openSqliteStorage,
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

describe("SQLite storage", () => {
  it("applies migration v1 idempotently and rejects sensitive key persistence", async () => {
    const storage = openSqliteStorage(":memory:");

    expect(storage.appliedMigrationVersions()).toEqual([1]);
    storage.migrate();
    expect(storage.appliedMigrationVersions()).toEqual([1]);

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
    await first.close();

    const second = openSqliteStorage(filename);
    await expect(second.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    await expect(second.getContextSnapshot(snapshot.id)).resolves.toEqual(snapshot);
    await expect(second.getEvidenceSource(source.id)).resolves.toEqual(source);
    await expect(second.getArtifactVersion(savedArtifact.id)).resolves.toEqual(savedArtifact);
    await expect(second.searchEvidence("local-first")).resolves.toMatchObject([
      { id: "chunk-1", sourceId: "source-1", text: "Built local-first systems." },
    ]);
    await second.close();

    await expect(readFile(filename)).resolves.toBeInstanceOf(Buffer);
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps immutable records idempotent and rejects changed payloads", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace);

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
