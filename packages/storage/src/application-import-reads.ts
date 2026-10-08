import { defaultApplicationId } from "@draft-loop/domain/application";

/**
 * Reads used to import a workspace as an application. They tolerate a source database written
 * before applications existed: it has no binding tables, so everything it holds is the default
 * application's.
 */
export interface ApplicationImportReadsPort {
  /** Ids of the runs bound to no application, oldest update first. */
  readonly listDefaultRunIds: (workspaceId: string) => Promise<readonly string[]>;
  /** Ids of the opportunity briefs bound to no application. */
  readonly listDefaultBriefIds: (workspaceId: string) => Promise<readonly string[]>;
}

interface ImportReadStatement {
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

interface ImportReadDatabase {
  readonly prepare: (sql: string) => ImportReadStatement;
}

function tableExists(database: ImportReadDatabase, name: string): boolean {
  return (
    database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

function ids(rows: readonly Record<string, unknown>[], column: string): readonly string[] {
  return rows.map((row) => String(row[column]));
}

export function createApplicationImportReads(
  database: ImportReadDatabase,
  ensureOpen: () => void,
): ApplicationImportReadsPort {
  return {
    listDefaultRunIds: async (workspaceId) => {
      ensureOpen();
      if (!tableExists(database, "runs")) return [];
      if (!tableExists(database, "application_run_bindings")) {
        return ids(
          database
            .prepare("SELECT id FROM runs WHERE workspace_id = ? ORDER BY updated_at, id")
            .all(workspaceId),
          "id",
        );
      }
      return ids(
        database
          .prepare(
            `SELECT r.id FROM runs r
             LEFT JOIN application_run_bindings b ON b.workspace_id = r.workspace_id AND b.run_id = r.id
             WHERE r.workspace_id = ? AND COALESCE(b.application_id, '${defaultApplicationId}') = '${defaultApplicationId}'
             ORDER BY r.updated_at, r.id`,
          )
          .all(workspaceId),
        "id",
      );
    },
    listDefaultBriefIds: async (workspaceId) => {
      ensureOpen();
      if (!tableExists(database, "opportunity_brief_versions")) return [];
      if (!tableExists(database, "application_brief_bindings")) {
        return ids(
          database
            .prepare(
              "SELECT brief_id FROM opportunity_brief_versions WHERE workspace_id = ? GROUP BY brief_id ORDER BY MIN(created_at), brief_id",
            )
            .all(workspaceId),
          "brief_id",
        );
      }
      return ids(
        database
          .prepare(
            `SELECT v.brief_id FROM opportunity_brief_versions v
             LEFT JOIN application_brief_bindings b ON b.workspace_id = v.workspace_id AND b.brief_id = v.brief_id
             WHERE v.workspace_id = ? AND COALESCE(b.application_id, '${defaultApplicationId}') = '${defaultApplicationId}'
             GROUP BY v.brief_id ORDER BY MIN(v.created_at), v.brief_id`,
          )
          .all(workspaceId),
        "brief_id",
      );
    },
  };
}
