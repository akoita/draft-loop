/**
 * Application folders on Postgres (#2281), the same contract as the SQLite store. Rows carry the
 * tenant from the session setting, as every candidate-record table does.
 */
import { defaultApplicationId } from "@draft-loop/domain/application";
import { applicationFolderLimit } from "@draft-loop/domain/application-folder";
import {
  type ApplicationFolderStoragePort,
  applicationFolderFromRow,
  checkedFolderName,
  folderLimitMessage,
  folderNameConflictMessage,
  folderNotFoundMessage,
  requireFolderId,
  requireWorkspaceIdentifier,
} from "@draft-loop/storage/application-folder-store";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import type { SqlExecutor, SqlSession } from "./sql-client.js";

const folderSelect =
  "SELECT workspace_id, folder_id, name, created_at, updated_at FROM application_folders";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

async function lockedFolder(executor: SqlExecutor, workspaceId: string, folderId: string) {
  const [row] = await executor.query(
    `${folderSelect} WHERE workspace_id = $1 AND folder_id = $2 FOR UPDATE`,
    [workspaceId, folderId],
  );
  return row;
}

async function nameTaken(
  executor: SqlExecutor,
  workspaceId: string,
  key: string,
  exceptFolderId: string,
): Promise<boolean> {
  const [row] = await executor.query(
    "SELECT 1 AS present FROM application_folders WHERE workspace_id = $1 AND name_key = $2 AND folder_id <> $3",
    [workspaceId, key, exceptFolderId],
  );
  return row !== undefined;
}

export function createApplicationFolders(client: SqlSession): ApplicationFolderStoragePort {
  return {
    listFolders: async (workspaceId) =>
      (
        await client.query(
          `${folderSelect} WHERE workspace_id = $1 ORDER BY created_at COLLATE "C", folder_id COLLATE "C"`,
          [workspaceId],
        )
      ).map(applicationFolderFromRow),
    createFolder: async (input) => {
      requireWorkspaceIdentifier(input.workspaceId, "workspace id");
      requireFolderId(input.id);
      const { name, key } = checkedFolderName(input.name);
      try {
        return await client.transaction(async (executor) => {
          // Serializes folder writes of one workspace, so the limit and the name check hold.
          await executor.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('application_folders:' || $1, 0))",
            [input.workspaceId],
          );
          const [counted] = await executor.query(
            "SELECT COUNT(*)::int AS count FROM application_folders WHERE workspace_id = $1",
            [input.workspaceId],
          );
          if (Number(counted?.count ?? 0) >= applicationFolderLimit) {
            throw new StorageConflictError(folderLimitMessage);
          }
          if (await nameTaken(executor, input.workspaceId, key, "")) {
            throw new StorageConflictError(folderNameConflictMessage);
          }
          const [inserted] = await executor.query(
            `INSERT INTO application_folders (workspace_id, folder_id, name, name_key, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $5)
             RETURNING workspace_id, folder_id, name, created_at, updated_at`,
            [input.workspaceId, input.id, name, key, input.createdAt],
          );
          if (inserted === undefined) throw new StorageValidationError("Folder was not stored");
          return applicationFolderFromRow(inserted);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new StorageConflictError(folderNameConflictMessage);
        throw error;
      }
    },
    renameFolder: async (workspaceId, folderId, nameInput, updatedAt) => {
      requireFolderId(folderId);
      const { name, key } = checkedFolderName(nameInput);
      try {
        return await client.transaction(async (executor) => {
          if ((await lockedFolder(executor, workspaceId, folderId)) === undefined) {
            throw new StorageValidationError(folderNotFoundMessage(folderId));
          }
          if (await nameTaken(executor, workspaceId, key, folderId)) {
            throw new StorageConflictError(folderNameConflictMessage);
          }
          const [updated] = await executor.query(
            `UPDATE application_folders SET name = $3, name_key = $4, updated_at = $5
             WHERE workspace_id = $1 AND folder_id = $2
             RETURNING workspace_id, folder_id, name, created_at, updated_at`,
            [workspaceId, folderId, name, key, updatedAt],
          );
          if (updated === undefined)
            throw new StorageValidationError(folderNotFoundMessage(folderId));
          return applicationFolderFromRow(updated);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new StorageConflictError(folderNameConflictMessage);
        throw error;
      }
    },
    deleteFolder: async (workspaceId, folderId) => {
      requireFolderId(folderId);
      return client.transaction(async (executor) => {
        if ((await lockedFolder(executor, workspaceId, folderId)) === undefined) {
          throw new StorageValidationError(folderNotFoundMessage(folderId));
        }
        const moved = await executor.query(
          "DELETE FROM application_folder_placements WHERE workspace_id = $1 AND folder_id = $2 RETURNING application_id",
          [workspaceId, folderId],
        );
        await executor.query(
          "DELETE FROM application_folders WHERE workspace_id = $1 AND folder_id = $2",
          [workspaceId, folderId],
        );
        return { movedApplications: moved.length };
      });
    },
    setApplicationFolder: async (workspaceId, applicationId, folderId, placedAt) => {
      requireWorkspaceIdentifier(workspaceId, "workspace id");
      requireWorkspaceIdentifier(applicationId, "application id");
      await client.transaction(async (executor) => {
        if (applicationId !== defaultApplicationId) {
          const [stored] = await executor.query(
            "SELECT 1 AS present FROM applications WHERE workspace_id = $1 AND application_id = $2",
            [workspaceId, applicationId],
          );
          if (stored === undefined) {
            throw new StorageValidationError(`Application ${applicationId} was not found`);
          }
        }
        if (folderId === null) {
          await executor.query(
            "DELETE FROM application_folder_placements WHERE workspace_id = $1 AND application_id = $2",
            [workspaceId, applicationId],
          );
          return;
        }
        requireFolderId(folderId);
        if ((await lockedFolder(executor, workspaceId, folderId)) === undefined) {
          throw new StorageValidationError(folderNotFoundMessage(folderId));
        }
        await executor.query(
          `INSERT INTO application_folder_placements (workspace_id, application_id, folder_id, placed_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, workspace_id, application_id)
           DO UPDATE SET folder_id = EXCLUDED.folder_id, placed_at = EXCLUDED.placed_at`,
          [workspaceId, applicationId, folderId, placedAt],
        );
      });
    },
    listFolderPlacements: async (workspaceId) =>
      new Map(
        (
          await client.query(
            "SELECT application_id, folder_id FROM application_folder_placements WHERE workspace_id = $1",
            [workspaceId],
          )
        ).map((row) => [String(row.application_id), String(row.folder_id)] as const),
      ),
  };
}
