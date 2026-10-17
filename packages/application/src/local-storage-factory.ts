import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  openSqliteStorage,
  openSqliteStorageReadOnly,
  SqliteStorage,
  type WorkspaceHistoryStorage,
} from "@draft-loop/storage";

/**
 * The local driver's storage factory: the one application module that opens SQLite. Everything
 * else receives the storage ports it returns, so a server driver can supply another factory
 * without touching the application service.
 */
export interface StorageFactory {
  /** Opens a workspace's history for reading and writing, creating it when missing. */
  readonly open: (root: string) => Promise<WorkspaceHistoryStorage>;
}

const historyDirectory = ".draft-loop";
const historyFilename = "history.sqlite";

/** Where the local driver keeps a workspace's history. */
export function localHistoryPath(root: string): string {
  return join(root, historyDirectory, historyFilename);
}

/** Opens the history file at `path`, which may not exist yet; its directory must. */
export function openLocalHistory(path: string): WorkspaceHistoryStorage {
  return openSqliteStorage(path);
}

/** Opens an existing history file without writing to it. */
export function openLocalHistoryReadOnly(path: string): WorkspaceHistoryStorage {
  return openSqliteStorageReadOnly(path);
}

export const localStorageFactory: StorageFactory = {
  open: async (root) => {
    const path = localHistoryPath(root);
    await mkdir(dirname(path), { recursive: true });
    return openLocalHistory(path);
  },
};

/**
 * SQLite maintenance (backup, integrity, compaction, retention) stays local: the server relies on
 * its database's own backups. Only history compaction reaches it, through these.
 */
export type LocalMaintenanceStorage = SqliteStorage;

export function openLocalMaintenanceStorage(path: string): LocalMaintenanceStorage {
  return openSqliteStorage(path);
}

export function openLocalMaintenanceStorageReadOnly(path: string): LocalMaintenanceStorage {
  return openSqliteStorageReadOnly(path);
}

export function verifyLocalHistoryIntegrity(path: string): boolean {
  return SqliteStorage.verifyDatabaseIntegrity(path);
}
