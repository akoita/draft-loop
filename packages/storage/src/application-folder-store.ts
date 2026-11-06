/**
 * Application folders on SQLite (#2281). A folder is a named section of a workspace's
 * applications; a placement puts one application in one folder. The default application is
 * derived, so placements key on the application id alone, as archives do.
 */

import { defaultApplicationId } from "@draft-loop/domain/application";
import {
  applicationFolderLimit,
  applicationFolderNameKey,
  isApplicationFolderId,
  normalizeApplicationFolderName,
} from "@draft-loop/domain/application-folder";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

export const applicationFolderMigration = {
  version: 38,
  sql: `
    CREATE TABLE IF NOT EXISTS application_folders (
      workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
      folder_id TEXT NOT NULL CHECK (folder_id GLOB 'fld_*'),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name = trim(name)),
      name_key TEXT NOT NULL CHECK (length(name_key) > 0),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, folder_id),
      UNIQUE (workspace_id, name_key)
    );
    CREATE TABLE IF NOT EXISTS application_folder_placements (
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0),
      folder_id TEXT NOT NULL,
      placed_at TEXT NOT NULL CHECK (julianday(placed_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, application_id),
      FOREIGN KEY (workspace_id, folder_id) REFERENCES application_folders(workspace_id, folder_id)
        ON DELETE CASCADE
    );
  `.trim(),
} as const;

export interface ApplicationFolderRecord {
  readonly workspaceId: string;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationFolderInput {
  readonly workspaceId: string;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface ApplicationFolderStoragePort {
  /** The workspace's folders, oldest first. */
  readonly listFolders: (workspaceId: string) => Promise<readonly ApplicationFolderRecord[]>;
  /** A name that collides with another folder's, ignoring case and accents, is a conflict. */
  readonly createFolder: (input: ApplicationFolderInput) => Promise<ApplicationFolderRecord>;
  readonly renameFolder: (
    workspaceId: string,
    folderId: string,
    name: string,
    updatedAt: string,
  ) => Promise<ApplicationFolderRecord>;
  /** Deletes the folder and its placements; its applications go back to no folder. */
  readonly deleteFolder: (
    workspaceId: string,
    folderId: string,
  ) => Promise<{ readonly movedApplications: number }>;
  /** Puts an application in a folder, or in none with `null`; idempotent. */
  readonly setApplicationFolder: (
    workspaceId: string,
    applicationId: string,
    folderId: string | null,
    placedAt: string,
  ) => Promise<void>;
  /** The folder of each placed application, by application id. */
  readonly listFolderPlacements: (workspaceId: string) => Promise<ReadonlyMap<string, string>>;
}

interface FolderStatement {
  readonly run: (...parameters: readonly unknown[]) => unknown;
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

export interface ApplicationFolderDatabase {
  readonly prepare: (sql: string) => FolderStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
}

function text(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new StorageValidationError(`Invalid stored ${column}`);
  return value;
}

export function applicationFolderFromRow(row: Record<string, unknown>): ApplicationFolderRecord {
  return {
    workspaceId: text(row, "workspace_id"),
    id: text(row, "folder_id"),
    name: text(row, "name"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

/** The checked name and its collision key, or a validation error a person can read. */
export function checkedFolderName(name: string): { readonly name: string; readonly key: string } {
  try {
    return { name: normalizeApplicationFolderName(name), key: applicationFolderNameKey(name) };
  } catch (error) {
    throw new StorageValidationError((error as Error).message);
  }
}

export function requireFolderId(folderId: string): string {
  if (!isApplicationFolderId(folderId)) {
    throw new StorageValidationError("Folder id must be fld_ and 8 to 64 characters");
  }
  return folderId;
}

export function requireWorkspaceIdentifier(value: string, field: string): string {
  if (value.trim() === "") throw new StorageValidationError(`${field} must not be empty`);
  return value;
}

export const folderNameConflictMessage = "A folder with this name already exists";
export const folderLimitMessage = `A workspace can hold at most ${applicationFolderLimit} folders`;
export const folderNotFoundMessage = (folderId: string) => `Folder ${folderId} was not found`;

const folderSelect =
  "SELECT workspace_id, folder_id, name, created_at, updated_at FROM application_folders";

export function createApplicationFolderStorage(
  database: ApplicationFolderDatabase,
  ensureOpen: () => void,
): ApplicationFolderStoragePort {
  const getFolder = (workspaceId: string, folderId: string) =>
    database
      .prepare(`${folderSelect} WHERE workspace_id = ? AND folder_id = ?`)
      .get(workspaceId, folderId);
  const nameTaken = (workspaceId: string, key: string, exceptFolderId: string | null) =>
    database
      .prepare(
        "SELECT 1 AS present FROM application_folders WHERE workspace_id = ? AND name_key = ? AND folder_id <> ?",
      )
      .get(workspaceId, key, exceptFolderId ?? "") !== undefined;
  return {
    listFolders: async (workspaceId) => {
      ensureOpen();
      return database
        .prepare(`${folderSelect} WHERE workspace_id = ? ORDER BY created_at, folder_id`)
        .all(workspaceId)
        .map(applicationFolderFromRow);
    },
    createFolder: async (input) => {
      ensureOpen();
      requireWorkspaceIdentifier(input.workspaceId, "workspace id");
      requireFolderId(input.id);
      const { name, key } = checkedFolderName(input.name);
      return database.transaction(() => {
        const count = Number(
          database
            .prepare("SELECT COUNT(*) AS count FROM application_folders WHERE workspace_id = ?")
            .get(input.workspaceId)?.count ?? 0,
        );
        if (count >= applicationFolderLimit) throw new StorageConflictError(folderLimitMessage);
        if (nameTaken(input.workspaceId, key, null)) {
          throw new StorageConflictError(folderNameConflictMessage);
        }
        if (getFolder(input.workspaceId, input.id) !== undefined) {
          throw new StorageConflictError(`Folder ${input.id} already exists`);
        }
        database
          .prepare(
            `INSERT INTO application_folders (workspace_id, folder_id, name, name_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(input.workspaceId, input.id, name, key, input.createdAt, input.createdAt);
        return {
          workspaceId: input.workspaceId,
          id: input.id,
          name,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        };
      })();
    },
    renameFolder: async (workspaceId, folderId, nameInput, updatedAt) => {
      ensureOpen();
      requireFolderId(folderId);
      const { name, key } = checkedFolderName(nameInput);
      return database.transaction(() => {
        const stored = getFolder(workspaceId, folderId);
        if (stored === undefined) {
          throw new StorageValidationError(folderNotFoundMessage(folderId));
        }
        if (nameTaken(workspaceId, key, folderId)) {
          throw new StorageConflictError(folderNameConflictMessage);
        }
        database
          .prepare(
            "UPDATE application_folders SET name = ?, name_key = ?, updated_at = ? WHERE workspace_id = ? AND folder_id = ?",
          )
          .run(name, key, updatedAt, workspaceId, folderId);
        return { ...applicationFolderFromRow(stored), name, updatedAt };
      })();
    },
    deleteFolder: async (workspaceId, folderId) => {
      ensureOpen();
      requireFolderId(folderId);
      return database.transaction(() => {
        if (getFolder(workspaceId, folderId) === undefined) {
          throw new StorageValidationError(folderNotFoundMessage(folderId));
        }
        const moved = Number(
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM application_folder_placements WHERE workspace_id = ? AND folder_id = ?",
            )
            .get(workspaceId, folderId)?.count ?? 0,
        );
        database
          .prepare(
            "DELETE FROM application_folder_placements WHERE workspace_id = ? AND folder_id = ?",
          )
          .run(workspaceId, folderId);
        database
          .prepare("DELETE FROM application_folders WHERE workspace_id = ? AND folder_id = ?")
          .run(workspaceId, folderId);
        return { movedApplications: moved };
      })();
    },
    setApplicationFolder: async (workspaceId, applicationId, folderId, placedAt) => {
      ensureOpen();
      requireWorkspaceIdentifier(workspaceId, "workspace id");
      requireWorkspaceIdentifier(applicationId, "application id");
      database.transaction(() => {
        if (applicationId !== defaultApplicationId) {
          const stored = database
            .prepare(
              "SELECT 1 AS present FROM applications WHERE workspace_id = ? AND application_id = ?",
            )
            .get(workspaceId, applicationId);
          if (stored === undefined) {
            throw new StorageValidationError(`Application ${applicationId} was not found`);
          }
        }
        if (folderId === null) {
          database
            .prepare(
              "DELETE FROM application_folder_placements WHERE workspace_id = ? AND application_id = ?",
            )
            .run(workspaceId, applicationId);
          return;
        }
        requireFolderId(folderId);
        if (getFolder(workspaceId, folderId) === undefined) {
          throw new StorageValidationError(folderNotFoundMessage(folderId));
        }
        database
          .prepare(
            `INSERT INTO application_folder_placements (workspace_id, application_id, folder_id, placed_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (workspace_id, application_id) DO UPDATE SET folder_id = excluded.folder_id, placed_at = excluded.placed_at`,
          )
          .run(workspaceId, applicationId, folderId, placedAt);
      })();
    },
    listFolderPlacements: async (workspaceId) => {
      ensureOpen();
      return new Map(
        database
          .prepare(
            "SELECT application_id, folder_id FROM application_folder_placements WHERE workspace_id = ?",
          )
          .all(workspaceId)
          .map((row) => [text(row, "application_id"), text(row, "folder_id")] as const),
      );
    },
  };
}
