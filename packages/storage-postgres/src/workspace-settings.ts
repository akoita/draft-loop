import {
  type WorkspaceSettingName,
  type WorkspaceSettingsPort,
  workspaceSettingNames,
} from "@draft-loop/storage";
import { StorageValidationError } from "@draft-loop/storage/errors";
import type { SqlClient } from "./sql-client.js";

const maximumWorkspaceReferenceLength = 1_024;

function requireReference(workspace: string): string {
  if (workspace === "" || workspace.length > maximumWorkspaceReferenceLength) {
    throw new StorageValidationError("Workspace reference must be 1 to 1,024 characters");
  }
  return workspace;
}

function requireName(name: WorkspaceSettingName): WorkspaceSettingName {
  if (!workspaceSettingNames.includes(name)) {
    throw new StorageValidationError("Unknown workspace setting");
  }
  return name;
}

/**
 * Workspace settings as rows of one tenant, keyed by the driver's workspace reference and the
 * document name. A write is one upsert, so readers see the old or the new text.
 */
export function createWorkspaceSettings(client: SqlClient): WorkspaceSettingsPort {
  return {
    read: async (workspace, name) => {
      const [row] = await client.query(
        "SELECT content FROM workspace_settings WHERE workspace_ref = $1 AND name = $2",
        [requireReference(workspace), requireName(name)],
      );
      return row === undefined ? undefined : String(row.content);
    },
    write: async (workspace, name, content) => {
      // Postgres text cannot hold NUL; refuse it rather than store something else.
      if (content.includes("\0")) {
        throw new StorageValidationError("Workspace setting content must not contain NUL");
      }
      await client.query(
        `INSERT INTO workspace_settings (workspace_ref, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, workspace_ref, name)
         DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        [requireReference(workspace), requireName(name), content],
      );
    },
    remove: async (workspace, name) => {
      const rows = await client.query(
        "DELETE FROM workspace_settings WHERE workspace_ref = $1 AND name = $2 RETURNING name",
        [requireReference(workspace), requireName(name)],
      );
      return rows.length > 0;
    },
  };
}
