import { defaultApplicationId, normalizeApplicationName } from "@draft-loop/domain/application";
import {
  type ApplicationJobSource,
  type ApplicationModelProfiles,
  applicationIdSchema,
  applicationJobSourceSchema,
  applicationModelProfilesSchema,
} from "@draft-loop/schemas/application";
import {
  type ApplicationImportReadsPort,
  createApplicationImportReads,
} from "./application-import-reads.js";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

/**
 * Applications inside a workspace (ADR 0010). Runs and opportunity briefs are bound to an
 * application by append-only side tables, so rows written before this migration stay valid and
 * unchanged: no binding means the default application, which is derived, never stored.
 */
export const applicationMigration = {
  version: 30,
  sql: `
    CREATE TABLE IF NOT EXISTS applications (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      application_id TEXT NOT NULL CHECK (
        length(trim(application_id)) > 0 AND application_id <> '${defaultApplicationId}'
      ),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
      job_source_json TEXT NOT NULL,
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, application_id)
    );

    CREATE TABLE IF NOT EXISTS application_run_bindings (
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL CHECK (length(trim(run_id)) > 0),
      application_id TEXT NOT NULL,
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, run_id),
      FOREIGN KEY (workspace_id, application_id) REFERENCES applications(workspace_id, application_id)
    );

    CREATE TABLE IF NOT EXISTS application_brief_bindings (
      workspace_id TEXT NOT NULL,
      brief_id TEXT NOT NULL CHECK (length(trim(brief_id)) > 0),
      application_id TEXT NOT NULL,
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, brief_id),
      FOREIGN KEY (workspace_id, application_id) REFERENCES applications(workspace_id, application_id)
    );

    CREATE INDEX IF NOT EXISTS application_run_bindings_application_idx
      ON application_run_bindings(workspace_id, application_id);
    CREATE INDEX IF NOT EXISTS application_brief_bindings_application_idx
      ON application_brief_bindings(workspace_id, application_id);

    CREATE TRIGGER IF NOT EXISTS application_run_bindings_immutable_update
      BEFORE UPDATE ON application_run_bindings
      BEGIN SELECT RAISE(ABORT, 'application run bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS application_run_bindings_immutable_delete
      BEFORE DELETE ON application_run_bindings
      BEGIN SELECT RAISE(ABORT, 'application run bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS application_brief_bindings_immutable_update
      BEFORE UPDATE ON application_brief_bindings
      BEGIN SELECT RAISE(ABORT, 'application brief bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS application_brief_bindings_immutable_delete
      BEFORE DELETE ON application_brief_bindings
      BEGIN SELECT RAISE(ABORT, 'application brief bindings are immutable'); END;
  `.trim(),
} as const;

/**
 * Archiving hides an application from the main list without touching what it holds. The default
 * application can be archived too, so its id is allowed here; restoring deletes the row.
 */
export const applicationArchiveMigration = {
  version: 31,
  sql: `
    CREATE TABLE IF NOT EXISTS application_archives (
      workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
      application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0),
      archived_at TEXT NOT NULL CHECK (julianday(archived_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, application_id)
    );
  `.trim(),
} as const;

/**
 * The model pair an application uses instead of the workspace's. One row per overridden
 * application; no row means the workspace's pair. Runs record the pair they used themselves.
 */
export const applicationModelProfilesMigration = {
  version: 32,
  sql: `
    CREATE TABLE IF NOT EXISTS application_model_profiles (
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      model_profiles_json TEXT NOT NULL,
      updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, application_id),
      FOREIGN KEY (workspace_id, application_id) REFERENCES applications(workspace_id, application_id)
    );
  `.trim(),
} as const;

/** The application migrations in the order they apply. */
export const applicationMigrations = [
  applicationMigration,
  applicationArchiveMigration,
  applicationModelProfilesMigration,
] as const;

export interface ApplicationStoreRecord {
  readonly workspaceId: string;
  readonly id: string;
  readonly name: string;
  readonly jobSource: ApplicationJobSource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationStoreInput {
  readonly workspaceId: string;
  readonly id: string;
  readonly name: string;
  readonly jobSource: ApplicationJobSource;
  readonly createdAt: string;
}

export interface ApplicationBindingInput {
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly createdAt: string;
}

export interface ApplicationRunSummary {
  readonly id: string;
  readonly state: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface ApplicationExportSummary {
  readonly id: string;
  readonly runId: string;
  readonly format: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface ApplicationBriefSummary {
  readonly briefId: string;
  readonly latestVersion: number;
  readonly status: string;
  readonly createdAt: string;
}

export interface ApplicationStoragePort extends ApplicationImportReadsPort {
  /** A second application with the same id is a conflict; the default id is reserved. */
  readonly insertApplication: (input: ApplicationStoreInput) => Promise<ApplicationStoreRecord>;
  readonly getApplication: (
    workspaceId: string,
    applicationId: string,
  ) => Promise<ApplicationStoreRecord | undefined>;
  /** Stored applications only, oldest first; the derived default application is not included. */
  readonly listApplications: (workspaceId: string) => Promise<readonly ApplicationStoreRecord[]>;
  /** Idempotent for the same application; binding a run elsewhere is a conflict. */
  readonly bindRun: (input: ApplicationBindingInput & { readonly runId: string }) => Promise<void>;
  readonly bindBrief: (
    input: ApplicationBindingInput & { readonly briefId: string },
  ) => Promise<void>;
  /** The default application id when the run has no binding, such as every pre-migration run. */
  readonly applicationIdForRun: (workspaceId: string, runId: string) => Promise<string>;
  readonly applicationIdForBrief: (workspaceId: string, briefId: string) => Promise<string>;
  readonly listRuns: (
    workspaceId: string,
    applicationId: string,
  ) => Promise<readonly ApplicationRunSummary[]>;
  readonly listExports: (
    workspaceId: string,
    applicationId: string,
  ) => Promise<readonly ApplicationExportSummary[]>;
  readonly listBriefs: (
    workspaceId: string,
    applicationId: string,
  ) => Promise<readonly ApplicationBriefSummary[]>;
  /** Archives with `archivedAt`, or restores with `null`; idempotent either way. */
  readonly setArchived: (
    workspaceId: string,
    applicationId: string,
    archivedAt: string | null,
  ) => Promise<void>;
  /** When each archived application of the workspace was archived, by application id. */
  readonly listArchived: (workspaceId: string) => Promise<ReadonlyMap<string, string>>;
  /** Sets a created application's model pair, or clears it with `null`. */
  readonly setModelProfiles: (
    workspaceId: string,
    applicationId: string,
    modelProfiles: ApplicationModelProfiles | null,
    updatedAt: string,
  ) => Promise<void>;
  /** The application's own model pair, or `undefined` when it uses the workspace's. */
  readonly getModelProfiles: (
    workspaceId: string,
    applicationId: string,
  ) => Promise<ApplicationModelProfiles | undefined>;
  /**
   * Deletes a stored application that holds nothing. Runs and briefs are bound by append-only
   * rows, so an application with any of them is a conflict: archive it instead.
   */
  readonly deleteApplication: (workspaceId: string, applicationId: string) => Promise<void>;
}

interface ApplicationStatement {
  readonly run: (...parameters: readonly unknown[]) => unknown;
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

export interface ApplicationStoreDatabase {
  readonly prepare: (sql: string) => ApplicationStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
}

type BindingTable = "application_run_bindings" | "application_brief_bindings";
type BindingColumn = "run_id" | "brief_id";

const applicationSelect =
  "SELECT workspace_id, application_id, name, job_source_json, created_at, updated_at FROM applications";

function text(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new StorageValidationError(`Invalid stored ${column}`);
  return value;
}

function applicationFromRow(row: Record<string, unknown>): ApplicationStoreRecord {
  const jobSource = applicationJobSourceSchema.safeParse(JSON.parse(text(row, "job_source_json")));
  if (!jobSource.success) throw new StorageValidationError("Invalid stored application job source");
  return {
    workspaceId: text(row, "workspace_id"),
    id: text(row, "application_id"),
    name: text(row, "name"),
    jobSource: jobSource.data,
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function requireIdentifier(value: string, field: string): string {
  if (value.trim() === "") throw new StorageValidationError(`${field} must not be empty`);
  return value;
}

/** Builds the application port over a database handle; `ensureOpen` guards each call. */
export function createApplicationStorage(
  database: ApplicationStoreDatabase,
  ensureOpen: () => void,
): ApplicationStoragePort {
  const bind = (
    table: BindingTable,
    column: BindingColumn,
    entityId: string,
    input: ApplicationBindingInput,
  ): void => {
    ensureOpen();
    requireIdentifier(input.workspaceId, "workspace id");
    requireIdentifier(entityId, column);
    if (input.applicationId === defaultApplicationId) {
      throw new StorageValidationError("The default application is derived and never bound");
    }
    database.transaction(() => {
      const stored = database
        .prepare(
          "SELECT 1 AS present FROM applications WHERE workspace_id = ? AND application_id = ?",
        )
        .get(input.workspaceId, input.applicationId);
      if (stored === undefined) {
        throw new StorageValidationError(`Application ${input.applicationId} was not found`);
      }
      const existing = database
        .prepare(`SELECT application_id FROM ${table} WHERE workspace_id = ? AND ${column} = ?`)
        .get(input.workspaceId, entityId);
      if (existing !== undefined) {
        if (existing.application_id !== input.applicationId) {
          throw new StorageConflictError(`${column} is already bound to another application`);
        }
        return;
      }
      database
        .prepare(
          `INSERT INTO ${table} (workspace_id, ${column}, application_id, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(input.workspaceId, entityId, input.applicationId, input.createdAt);
    })();
  };
  const boundApplicationId = (
    table: BindingTable,
    column: BindingColumn,
    workspaceId: string,
    entityId: string,
  ): string => {
    ensureOpen();
    const row = database
      .prepare(`SELECT application_id FROM ${table} WHERE workspace_id = ? AND ${column} = ?`)
      .get(workspaceId, entityId);
    return row === undefined ? defaultApplicationId : text(row, "application_id");
  };

  return {
    ...createApplicationImportReads(database, ensureOpen),
    insertApplication: async (input) => {
      ensureOpen();
      requireIdentifier(input.workspaceId, "workspace id");
      const id = applicationIdSchema.safeParse(input.id);
      if (!id.success || id.data === defaultApplicationId) {
        throw new StorageValidationError("Application id is not a safe identifier");
      }
      const name = normalizeApplicationName(input.name);
      const jobSource = applicationJobSourceSchema.parse(input.jobSource);
      database.transaction(() => {
        const existing = database
          .prepare(`${applicationSelect} WHERE workspace_id = ? AND application_id = ?`)
          .get(input.workspaceId, id.data);
        if (existing !== undefined) {
          throw new StorageConflictError(`Application ${id.data} already exists`);
        }
        database
          .prepare(
            "INSERT INTO applications (workspace_id, application_id, name, job_source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            input.workspaceId,
            id.data,
            name,
            JSON.stringify(jobSource),
            input.createdAt,
            input.createdAt,
          );
      })();
      return {
        workspaceId: input.workspaceId,
        id: id.data,
        name,
        jobSource,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
    },
    getApplication: async (workspaceId, applicationId) => {
      ensureOpen();
      const row = database
        .prepare(`${applicationSelect} WHERE workspace_id = ? AND application_id = ?`)
        .get(workspaceId, applicationId);
      return row === undefined ? undefined : applicationFromRow(row);
    },
    listApplications: async (workspaceId) => {
      ensureOpen();
      return database
        .prepare(`${applicationSelect} WHERE workspace_id = ? ORDER BY created_at, application_id`)
        .all(workspaceId)
        .map(applicationFromRow);
    },
    bindRun: async (input) => bind("application_run_bindings", "run_id", input.runId, input),
    bindBrief: async (input) =>
      bind("application_brief_bindings", "brief_id", input.briefId, input),
    applicationIdForRun: async (workspaceId, runId) =>
      boundApplicationId("application_run_bindings", "run_id", workspaceId, runId),
    applicationIdForBrief: async (workspaceId, briefId) =>
      boundApplicationId("application_brief_bindings", "brief_id", workspaceId, briefId),
    listRuns: async (workspaceId, applicationId) => {
      ensureOpen();
      return database
        .prepare(
          `SELECT r.id, r.state, r.started_at, r.updated_at FROM runs r
           LEFT JOIN application_run_bindings b ON b.workspace_id = r.workspace_id AND b.run_id = r.id
           WHERE r.workspace_id = ? AND COALESCE(b.application_id, '${defaultApplicationId}') = ?
           ORDER BY r.started_at, r.id`,
        )
        .all(workspaceId, applicationId)
        .map((row) => ({
          id: text(row, "id"),
          state: text(row, "state"),
          startedAt: text(row, "started_at"),
          updatedAt: text(row, "updated_at"),
        }));
    },
    listExports: async (workspaceId, applicationId) => {
      ensureOpen();
      return database
        .prepare(
          `SELECT e.id, e.run_id, e.format, e.status, e.created_at FROM exports e
           LEFT JOIN application_run_bindings b ON b.workspace_id = e.workspace_id AND b.run_id = e.run_id
           WHERE e.workspace_id = ? AND COALESCE(b.application_id, '${defaultApplicationId}') = ?
           ORDER BY e.created_at, e.id`,
        )
        .all(workspaceId, applicationId)
        .map((row) => ({
          id: text(row, "id"),
          runId: text(row, "run_id"),
          format: text(row, "format"),
          status: text(row, "status"),
          createdAt: text(row, "created_at"),
        }));
    },
    listBriefs: async (workspaceId, applicationId) => {
      ensureOpen();
      return database
        .prepare(
          `SELECT v.brief_id, v.version, v.status, v.created_at FROM opportunity_brief_versions v
           LEFT JOIN application_brief_bindings b ON b.workspace_id = v.workspace_id AND b.brief_id = v.brief_id
           WHERE v.workspace_id = ? AND COALESCE(b.application_id, '${defaultApplicationId}') = ?
             AND v.version = (
               SELECT MAX(x.version) FROM opportunity_brief_versions x
               WHERE x.workspace_id = v.workspace_id AND x.brief_id = v.brief_id
             )
           ORDER BY v.created_at, v.brief_id`,
        )
        .all(workspaceId, applicationId)
        .map((row) => ({
          briefId: text(row, "brief_id"),
          latestVersion: Number(row.version),
          status: text(row, "status"),
          createdAt: text(row, "created_at"),
        }));
    },
    setArchived: async (workspaceId, applicationId, archivedAt) => {
      ensureOpen();
      requireIdentifier(workspaceId, "workspace id");
      requireIdentifier(applicationId, "application id");
      if (archivedAt === null) {
        database
          .prepare("DELETE FROM application_archives WHERE workspace_id = ? AND application_id = ?")
          .run(workspaceId, applicationId);
        return;
      }
      database
        .prepare(
          `INSERT INTO application_archives (workspace_id, application_id, archived_at) VALUES (?, ?, ?)
           ON CONFLICT (workspace_id, application_id) DO NOTHING`,
        )
        .run(workspaceId, applicationId, archivedAt);
    },
    listArchived: async (workspaceId) => {
      ensureOpen();
      return new Map(
        database
          .prepare(
            "SELECT application_id, archived_at FROM application_archives WHERE workspace_id = ?",
          )
          .all(workspaceId)
          .map((row) => [text(row, "application_id"), text(row, "archived_at")] as const),
      );
    },
    setModelProfiles: async (workspaceId, applicationId, modelProfiles, updatedAt) => {
      ensureOpen();
      requireIdentifier(workspaceId, "workspace id");
      if (applicationId === defaultApplicationId) {
        throw new StorageValidationError("The default application uses the workspace's models");
      }
      database.transaction(() => {
        const stored = database
          .prepare(
            "SELECT 1 AS present FROM applications WHERE workspace_id = ? AND application_id = ?",
          )
          .get(workspaceId, applicationId);
        if (stored === undefined) {
          throw new StorageValidationError(`Application ${applicationId} was not found`);
        }
        if (modelProfiles === null) {
          database
            .prepare(
              "DELETE FROM application_model_profiles WHERE workspace_id = ? AND application_id = ?",
            )
            .run(workspaceId, applicationId);
          return;
        }
        const parsed = applicationModelProfilesSchema.safeParse(modelProfiles);
        if (!parsed.success) {
          throw new StorageValidationError("Invalid application model profiles");
        }
        database
          .prepare(
            `INSERT INTO application_model_profiles (workspace_id, application_id, model_profiles_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (workspace_id, application_id)
             DO UPDATE SET model_profiles_json = excluded.model_profiles_json, updated_at = excluded.updated_at`,
          )
          .run(workspaceId, applicationId, JSON.stringify(parsed.data), updatedAt);
      })();
    },
    getModelProfiles: async (workspaceId, applicationId) => {
      ensureOpen();
      const row = database
        .prepare(
          "SELECT model_profiles_json FROM application_model_profiles WHERE workspace_id = ? AND application_id = ?",
        )
        .get(workspaceId, applicationId);
      if (row === undefined) return undefined;
      const parsed = applicationModelProfilesSchema.safeParse(
        JSON.parse(text(row, "model_profiles_json")),
      );
      if (!parsed.success) {
        throw new StorageValidationError("Invalid stored application model profiles");
      }
      return parsed.data;
    },
    deleteApplication: async (workspaceId, applicationId) => {
      ensureOpen();
      if (applicationId === defaultApplicationId) {
        throw new StorageValidationError("The default application is derived and never deleted");
      }
      database.transaction(() => {
        const stored = database
          .prepare(
            "SELECT 1 AS present FROM applications WHERE workspace_id = ? AND application_id = ?",
          )
          .get(workspaceId, applicationId);
        if (stored === undefined) {
          throw new StorageValidationError(`Application ${applicationId} was not found`);
        }
        for (const table of ["application_run_bindings", "application_brief_bindings"] as const) {
          const bound = database
            .prepare(
              `SELECT 1 AS present FROM ${table} WHERE workspace_id = ? AND application_id = ?`,
            )
            .get(workspaceId, applicationId);
          if (bound !== undefined) {
            throw new StorageConflictError(
              `Application ${applicationId} holds runs or briefs and can only be archived`,
            );
          }
        }
        database
          .prepare("DELETE FROM application_archives WHERE workspace_id = ? AND application_id = ?")
          .run(workspaceId, applicationId);
        database
          .prepare(
            "DELETE FROM application_model_profiles WHERE workspace_id = ? AND application_id = ?",
          )
          .run(workspaceId, applicationId);
        database
          .prepare("DELETE FROM applications WHERE workspace_id = ? AND application_id = ?")
          .run(workspaceId, applicationId);
      })();
    },
  };
}
