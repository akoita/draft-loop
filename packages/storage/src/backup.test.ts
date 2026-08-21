import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  openSqliteStorage,
  SqliteStorage,
  StorageValidationError,
  type WorkspaceRecord,
} from "./index.js";

const testWorkspace: WorkspaceRecord = {
  id: "workspace-backup-test",
  state: "collecting",
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

describe("SqliteStorage Atomic Backup, Restore and Integrity Verification", () => {
  it("backs up managed markers as SQLite metadata without claiming a complete blob backup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "draft-loop-backup-test-"));
    const dbPath = join(tempDir, "source.sqlite");
    const backupPath = join(tempDir, "backups", "2026-08-13T100000.sqlite");
    const restoredPath = join(tempDir, "restored.sqlite");

    try {
      const storage = openSqliteStorage(dbPath);
      await storage.saveWorkspace(testWorkspace);
      await storage.set("test-config-key", "test-config-value");
      const defaultKnowledgeBase = await storage.ensureDefaultCandidateKnowledgeBase({
        id: "ckb-default",
        displayName: "Career evidence",
        description: "Sanitized evidence fixture",
        createdAt: "2026-08-13T09:00:00.000Z",
      });
      const additionalKnowledgeBase = await storage.createCandidateKnowledgeBase({
        id: "ckb-additional",
        displayName: "Public projects",
        description: "Sanitized public evidence fixture",
        isDefault: false,
        createdAt: "2026-08-13T09:01:00.000Z",
      });
      await storage.archiveCandidateKnowledgeBase(
        additionalKnowledgeBase.id,
        "2026-08-13T09:02:00.000Z",
      );
      const source = await storage.createCandidateKnowledgeSource(
        {
          id: "source-1",
          knowledgeBaseId: defaultKnowledgeBase.id,
          kind: "file",
          displayName: "Career notes.md",
          createdAt: "2026-08-13T09:03:00.000Z",
        },
        {
          id: "source-version-1",
          mediaType: "text/markdown",
          checksum: "a".repeat(64),
          sizeBytes: 128,
          createdAt: "2026-08-13T09:03:00.000Z",
        },
      );
      await storage.prepareManagedCandidateKnowledgeWrite({
        operationId: "backup-materialization",
        knowledgeBaseId: defaultKnowledgeBase.id,
        sourceId: source.source.id,
        requestedVersionId: "backup-materialization-request",
        kind: "append",
        createdAt: "2026-08-13T09:03:00.000Z",
      });
      await storage.recordManagedCandidateKnowledgeWriteEvent(
        "backup-materialization",
        "targeted",
        source.version.id,
        "2026-08-13T09:03:00.000Z",
      );
      await storage.recordManagedCandidateKnowledgeWriteEvent(
        "backup-materialization",
        "published",
        source.version.id,
        "2026-08-13T09:03:00.000Z",
      );
      await storage.commitManagedCandidateKnowledgeWrite({
        kind: "append",
        operationId: "backup-materialization",
        version: {
          id: "backup-materialization-request",
          mediaType: source.version.mediaType,
          checksum: source.version.checksum,
          sizeBytes: source.version.sizeBytes,
          createdAt: source.version.createdAt,
        },
      });
      const sourceVersion = await storage.appendCandidateKnowledgeSourceVersion(
        defaultKnowledgeBase.id,
        source.source.id,
        {
          id: "source-version-2",
          mediaType: "text/markdown",
          checksum: "b".repeat(64),
          sizeBytes: 256,
          createdAt: "2026-08-13T09:04:00.000Z",
        },
      );

      // Verify migration versions are present
      const migrations = storage.appliedMigrationVersions();
      expect(migrations.length).toBeGreaterThanOrEqual(3);
      expect(migrations).toContain(1);

      // Create atomic backup
      const backupResult = await storage.createBackup(backupPath);
      expect(backupResult.backupPath).toBe(backupPath);
      expect(backupResult.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(backupResult.sizeBytes).toBeGreaterThan(0);

      // Verify backup integrity
      expect(SqliteStorage.verifyDatabaseIntegrity(backupPath)).toBe(true);

      // Restore to new target
      const restoredStorage = await SqliteStorage.restore(backupPath, restoredPath);
      const restoredWorkspace = await restoredStorage.getWorkspace(testWorkspace.id);
      expect(restoredWorkspace?.id).toBe(testWorkspace.id);
      expect(restoredWorkspace?.state).toBe("collecting");

      const restoredVal = await restoredStorage.get("test-config-key");
      expect(restoredVal).toBe("test-config-value");
      await expect(
        restoredStorage.getCandidateKnowledgeBase(defaultKnowledgeBase.id),
      ).resolves.toEqual(defaultKnowledgeBase);
      await expect(restoredStorage.listCandidateKnowledgeBases()).resolves.toMatchObject([
        { id: "ckb-default", state: "active", isDefault: true },
        {
          id: "ckb-additional",
          state: "archived",
          isDefault: false,
          archivedAt: "2026-08-13T09:02:00.000Z",
        },
      ]);
      await expect(
        restoredStorage.listCandidateKnowledgeSources(defaultKnowledgeBase.id),
      ).resolves.toEqual([source.source]);
      await expect(
        restoredStorage.listCandidateKnowledgeSourceVersions(
          defaultKnowledgeBase.id,
          source.source.id,
        ),
      ).resolves.toEqual([source.version, sourceVersion.version]);
      await expect(
        restoredStorage.isCandidateKnowledgeSourceVersionManaged(
          defaultKnowledgeBase.id,
          source.source.id,
          source.version.id,
        ),
      ).resolves.toBe(true);
      // SqliteStorage intentionally knows nothing about a portable store's sources/ directory.
      // A complete candidate knowledge-store backup must bundle and verify those blobs separately.

      await storage.close();
      await restoredStorage.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects corrupted SQLite backup files and rejects restore", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "draft-loop-corrupt-test-"));
    const corruptBackupPath = join(tempDir, "corrupted.sqlite");
    const restoredPath = join(tempDir, "restored.sqlite");

    try {
      // Write non-sqlite garbage
      await writeFile(corruptBackupPath, "CORRUPTED_NON_SQLITE_DATA_PAYLOAD");

      expect(SqliteStorage.verifyDatabaseIntegrity(corruptBackupPath)).toBe(false);

      await expect(SqliteStorage.restore(corruptBackupPath, restoredPath)).rejects.toThrow(
        StorageValidationError,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
