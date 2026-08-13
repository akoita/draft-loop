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
  it("creates an atomic backup with SHA-256 checksum and restores state cleanly", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "draft-loop-backup-test-"));
    const dbPath = join(tempDir, "source.sqlite");
    const backupPath = join(tempDir, "backups", "2026-08-13T100000.sqlite");
    const restoredPath = join(tempDir, "restored.sqlite");

    try {
      const storage = openSqliteStorage(dbPath);
      await storage.saveWorkspace(testWorkspace);
      await storage.set("test-config-key", "test-config-value");

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
