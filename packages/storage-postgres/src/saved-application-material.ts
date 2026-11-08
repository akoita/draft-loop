import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";
import {
  requireSavedApplicationMaterial,
  type SavedApplicationMaterialStore,
  SavedApplicationMaterialStoreError,
  savedApplicationMaterialListLimit,
} from "@draft-loop/storage/saved-application-material";
import type { SqlSession } from "./sql-client.js";

function draftOf(row: Record<string, unknown>): SavedApplicationMaterial {
  const value = typeof row.draft === "string" ? JSON.parse(row.draft) : row.draft;
  return requireSavedApplicationMaterial(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

/** One tenant's saved application material on Postgres; row-level security confines it. */
export function createSavedApplicationMaterialStore(
  client: SqlSession,
): SavedApplicationMaterialStore {
  return {
    insert: async (input) => {
      const material = requireSavedApplicationMaterial(input);
      try {
        await client.query(
          `INSERT INTO application_material_drafts
             (id, workspace_id, application_id, kind, draft, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            material.id,
            material.workspace_id,
            material.application_id,
            material.kind,
            JSON.stringify(material),
            material.created_at,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new SavedApplicationMaterialStoreError(
            "duplicate_material",
            "The saved application material already exists.",
          );
        }
        throw error;
      }
    },
    get: async (workspaceId, id) => {
      const [row] = await client.query(
        "SELECT draft FROM application_material_drafts WHERE workspace_id = $1 AND id = $2",
        [workspaceId, id],
      );
      return row === undefined ? undefined : draftOf(row);
    },
    list: async (workspaceId, applicationId, options = {}) => {
      const rows = await client.query(
        `SELECT draft FROM application_material_drafts
         WHERE workspace_id = $1 AND application_id = $2 AND ($3::text IS NULL OR kind = $3)
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [
          workspaceId,
          applicationId,
          options.kind ?? null,
          options.limit ?? savedApplicationMaterialListLimit,
        ],
      );
      return rows.map(draftOf);
    },
    delete: async (workspaceId, id) => {
      const rows = await client.query(
        "DELETE FROM application_material_drafts WHERE workspace_id = $1 AND id = $2 RETURNING id",
        [workspaceId, id],
      );
      return rows.length > 0;
    },
  };
}
