import { defaultApplicationId, normalizeApplicationName } from "@draft-loop/domain/application";
import {
  applicationIdSchema,
  applicationJobSourceSchema,
  applicationModelProfilesSchema,
} from "@draft-loop/schemas/application";
import {
  type ApplicationBindingInput,
  type ApplicationChosenRunRecord,
  type ApplicationStoragePort,
  applicationFromRow,
  jobSourceWithPage,
  maximumChosenRunReasonLength,
} from "@draft-loop/storage/application-store";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import { appendAuditEventRow } from "./audit-trail.js";
import type { SqlExecutor, SqlRow, SqlSession } from "./sql-client.js";

type BindingTable = "application_run_bindings" | "application_brief_bindings";
type BindingColumn = "run_id" | "brief_id";

const applicationSelect =
  "SELECT workspace_id, application_id, name, job_source_json, created_at, updated_at FROM applications";

/** The application a run or brief belongs to: its binding, or the derived default. */
const boundOwner = `COALESCE(b.application_id, '${defaultApplicationId}')`;

function text(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new StorageValidationError(`Invalid stored ${column}`);
  return value;
}

function requireIdentifier(value: string, field: string): string {
  if (value.trim() === "") throw new StorageValidationError(`${field} must not be empty`);
  return value;
}

async function requireStoredApplication(
  executor: SqlExecutor,
  workspaceId: string,
  applicationId: string,
): Promise<void> {
  const [stored] = await executor.query(
    "SELECT 1 AS present FROM applications WHERE workspace_id = $1 AND application_id = $2",
    [workspaceId, applicationId],
  );
  if (stored === undefined) {
    throw new StorageValidationError(`Application ${applicationId} was not found`);
  }
}

function chosenRunFromRow(row: SqlRow): ApplicationChosenRunRecord {
  return {
    runId: text(row, "run_id"),
    chosenAt: text(row, "chosen_at"),
    reason: row.reason === null ? null : text(row, "reason"),
  };
}

async function readChosenRun(
  executor: SqlExecutor,
  workspaceId: string,
  applicationId: string,
): Promise<ApplicationChosenRunRecord | undefined> {
  const [row] = await executor.query(
    "SELECT run_id, reason, chosen_at FROM application_chosen_runs WHERE workspace_id = $1 AND application_id = $2",
    [workspaceId, applicationId],
  );
  return row === undefined ? undefined : chosenRunFromRow(row);
}

/**
 * Applications inside a workspace on Postgres, with the same rules as the SQLite store: runs and
 * briefs are bound by immutable rows, and an unbound one belongs to the derived default
 * application. Text is ordered with the "C" collation so lists match SQLite's byte order.
 */
export function createApplications(client: SqlSession): ApplicationStoragePort {
  const bind = async (
    table: BindingTable,
    column: BindingColumn,
    entityId: string,
    input: ApplicationBindingInput,
  ): Promise<void> => {
    requireIdentifier(input.workspaceId, "workspace id");
    requireIdentifier(entityId, column);
    if (input.applicationId === defaultApplicationId) {
      throw new StorageValidationError("The default application is derived and never bound");
    }
    await client.transaction(async (executor) => {
      await requireStoredApplication(executor, input.workspaceId, input.applicationId);
      await executor.query(
        `INSERT INTO ${table} (workspace_id, ${column}, application_id, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, workspace_id, ${column}) DO NOTHING`,
        [input.workspaceId, entityId, input.applicationId, input.createdAt],
      );
      const [bound] = await executor.query(
        `SELECT application_id FROM ${table} WHERE workspace_id = $1 AND ${column} = $2`,
        [input.workspaceId, entityId],
      );
      if (bound?.application_id !== input.applicationId) {
        throw new StorageConflictError(`${column} is already bound to another application`);
      }
    });
  };
  const boundApplicationId = async (
    table: BindingTable,
    column: BindingColumn,
    workspaceId: string,
    entityId: string,
  ): Promise<string> => {
    const [row] = await client.query(
      `SELECT application_id FROM ${table} WHERE workspace_id = $1 AND ${column} = $2`,
      [workspaceId, entityId],
    );
    return row === undefined ? defaultApplicationId : text(row, "application_id");
  };

  return {
    insertApplication: async (input) => {
      requireIdentifier(input.workspaceId, "workspace id");
      const id = applicationIdSchema.safeParse(input.id);
      if (!id.success || id.data === defaultApplicationId) {
        throw new StorageValidationError("Application id is not a safe identifier");
      }
      const name = normalizeApplicationName(input.name);
      const jobSource = applicationJobSourceSchema.parse(input.jobSource);
      const inserted = await client.query(
        `INSERT INTO applications (workspace_id, application_id, name, job_source_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (tenant_id, workspace_id, application_id) DO NOTHING RETURNING application_id`,
        [input.workspaceId, id.data, name, JSON.stringify(jobSource), input.createdAt],
      );
      if (inserted.length === 0) {
        throw new StorageConflictError(`Application ${id.data} already exists`);
      }
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
      const [row] = await client.query(
        `${applicationSelect} WHERE workspace_id = $1 AND application_id = $2`,
        [workspaceId, applicationId],
      );
      return row === undefined ? undefined : applicationFromRow(row);
    },
    listApplications: async (workspaceId) =>
      (
        await client.query(
          `${applicationSelect} WHERE workspace_id = $1
           ORDER BY created_at COLLATE "C", application_id COLLATE "C"`,
          [workspaceId],
        )
      ).map(applicationFromRow),
    bindRun: (input) => bind("application_run_bindings", "run_id", input.runId, input),
    bindBrief: (input) => bind("application_brief_bindings", "brief_id", input.briefId, input),
    applicationIdForRun: (workspaceId, runId) =>
      boundApplicationId("application_run_bindings", "run_id", workspaceId, runId),
    applicationIdForBrief: (workspaceId, briefId) =>
      boundApplicationId("application_brief_bindings", "brief_id", workspaceId, briefId),
    listRuns: async (workspaceId, applicationId) =>
      // A run row is immutable and keeps the state it was appended with; its current state is
      // its latest snapshot, as the review reads it.
      (
        await client.query(
          `SELECT r.id, COALESCE(s.state, r.state) AS state, r.started_at,
             COALESCE(s.updated_at, r.updated_at) AS updated_at FROM runs r
           LEFT JOIN application_run_bindings b ON b.workspace_id = r.workspace_id AND b.run_id = r.id
           LEFT JOIN run_snapshots s ON s.sequence = (
             SELECT MAX(latest.sequence) FROM run_snapshots latest
             WHERE latest.workspace_id = r.workspace_id AND latest.run_id = r.id
           )
           WHERE r.workspace_id = $1 AND ${boundOwner} = $2
           ORDER BY r.started_at COLLATE "C", r.id COLLATE "C"`,
          [workspaceId, applicationId],
        )
      ).map((row) => ({
        id: text(row, "id"),
        state: text(row, "state"),
        startedAt: text(row, "started_at"),
        updatedAt: text(row, "updated_at"),
      })),
    listExports: async (workspaceId, applicationId) =>
      (
        await client.query(
          `SELECT e.id, e.run_id, e.format, e.status, e.created_at FROM exports e
           LEFT JOIN application_run_bindings b ON b.workspace_id = e.workspace_id AND b.run_id = e.run_id
           WHERE e.workspace_id = $1 AND ${boundOwner} = $2
           ORDER BY e.created_at COLLATE "C", e.id COLLATE "C"`,
          [workspaceId, applicationId],
        )
      ).map((row) => ({
        id: text(row, "id"),
        runId: text(row, "run_id"),
        format: text(row, "format"),
        status: text(row, "status"),
        createdAt: text(row, "created_at"),
      })),
    listBriefs: async (workspaceId, applicationId) =>
      (
        await client.query(
          `SELECT v.brief_id, v.version, v.status, v.created_at FROM opportunity_brief_versions v
           LEFT JOIN application_brief_bindings b ON b.workspace_id = v.workspace_id AND b.brief_id = v.brief_id
           WHERE v.workspace_id = $1 AND ${boundOwner} = $2
             AND v.version = (
               SELECT MAX(x.version) FROM opportunity_brief_versions x
               WHERE x.workspace_id = v.workspace_id AND x.brief_id = v.brief_id
             )
           ORDER BY v.created_at COLLATE "C", v.brief_id COLLATE "C"`,
          [workspaceId, applicationId],
        )
      ).map((row) => ({
        briefId: text(row, "brief_id"),
        latestVersion: Number(row.version),
        status: text(row, "status"),
        createdAt: text(row, "created_at"),
      })),
    setArchived: async (workspaceId, applicationId, archivedAt) => {
      requireIdentifier(workspaceId, "workspace id");
      requireIdentifier(applicationId, "application id");
      if (archivedAt === null) {
        await client.query(
          "DELETE FROM application_archives WHERE workspace_id = $1 AND application_id = $2",
          [workspaceId, applicationId],
        );
        return;
      }
      await client.query(
        `INSERT INTO application_archives (workspace_id, application_id, archived_at) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, workspace_id, application_id) DO NOTHING`,
        [workspaceId, applicationId, archivedAt],
      );
    },
    listArchived: async (workspaceId) =>
      new Map(
        (
          await client.query(
            "SELECT application_id, archived_at FROM application_archives WHERE workspace_id = $1",
            [workspaceId],
          )
        ).map((row) => [text(row, "application_id"), text(row, "archived_at")] as const),
      ),
    renameApplication: async (workspaceId, applicationId, nameInput, updatedAt) => {
      requireIdentifier(workspaceId, "workspace id");
      requireIdentifier(applicationId, "application id");
      let name: string;
      try {
        name = normalizeApplicationName(nameInput);
      } catch (error) {
        throw new StorageValidationError((error as Error).message);
      }
      if (applicationId === defaultApplicationId) {
        await client.query(
          `INSERT INTO default_application_names (workspace_id, name, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
          [workspaceId, name, updatedAt],
        );
        return;
      }
      const changed = await client.query(
        "UPDATE applications SET name = $1, updated_at = $2 WHERE workspace_id = $3 AND application_id = $4 RETURNING application_id",
        [name, updatedAt, workspaceId, applicationId],
      );
      if (changed.length === 0) {
        throw new StorageValidationError(`Application ${applicationId} was not found`);
      }
    },
    recordJobPage: async (workspaceId, applicationId, page, updatedAt) => {
      const [current] = await client.query(
        `${applicationSelect} WHERE workspace_id = $1 AND application_id = $2`,
        [workspaceId, applicationId],
      );
      const jobSource = jobSourceWithPage(
        current === undefined ? undefined : applicationFromRow(current),
        applicationId,
        page,
      );
      const [updated] = await client.query(
        `UPDATE applications SET job_source_json = $1, updated_at = $2
         WHERE workspace_id = $3 AND application_id = $4
         RETURNING workspace_id, application_id, name, job_source_json, created_at, updated_at`,
        [JSON.stringify(jobSource), updatedAt, workspaceId, applicationId],
      );
      if (updated === undefined) {
        throw new StorageValidationError(`Application ${applicationId} was not found`);
      }
      return applicationFromRow(updated);
    },
    getDefaultApplicationName: async (workspaceId) => {
      const [row] = await client.query(
        "SELECT name FROM default_application_names WHERE workspace_id = $1",
        [workspaceId],
      );
      return row === undefined ? undefined : text(row, "name");
    },
    setModelProfiles: async (workspaceId, applicationId, modelProfiles, updatedAt) => {
      requireIdentifier(workspaceId, "workspace id");
      if (applicationId === defaultApplicationId) {
        throw new StorageValidationError("The default application uses the workspace's models");
      }
      await client.transaction(async (executor) => {
        await requireStoredApplication(executor, workspaceId, applicationId);
        if (modelProfiles === null) {
          await executor.query(
            "DELETE FROM application_model_profiles WHERE workspace_id = $1 AND application_id = $2",
            [workspaceId, applicationId],
          );
          return;
        }
        const parsed = applicationModelProfilesSchema.safeParse(modelProfiles);
        if (!parsed.success) {
          throw new StorageValidationError("Invalid application model profiles");
        }
        await executor.query(
          `INSERT INTO application_model_profiles (workspace_id, application_id, model_profiles_json, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, workspace_id, application_id)
           DO UPDATE SET model_profiles_json = excluded.model_profiles_json, updated_at = excluded.updated_at`,
          [workspaceId, applicationId, JSON.stringify(parsed.data), updatedAt],
        );
      });
    },
    getModelProfiles: async (workspaceId, applicationId) => {
      const [row] = await client.query(
        "SELECT model_profiles_json FROM application_model_profiles WHERE workspace_id = $1 AND application_id = $2",
        [workspaceId, applicationId],
      );
      if (row === undefined) return undefined;
      const parsed = applicationModelProfilesSchema.safeParse(
        JSON.parse(text(row, "model_profiles_json")),
      );
      if (!parsed.success) {
        throw new StorageValidationError("Invalid stored application model profiles");
      }
      return parsed.data;
    },
    setChosenRun: async (workspaceId, applicationId, chosen, auditEvent) => {
      requireIdentifier(workspaceId, "workspace id");
      requireIdentifier(applicationId, "application id");
      requireIdentifier(chosen.runId, "run id");
      if (
        chosen.reason !== null &&
        (chosen.reason.length === 0 || chosen.reason.length > maximumChosenRunReasonLength)
      ) {
        throw new StorageValidationError(
          `The reason must be between 1 and ${maximumChosenRunReasonLength} characters`,
        );
      }
      await client.transaction(async (executor) => {
        const [owner] = await executor.query(
          `SELECT ${boundOwner} AS application_id FROM runs r
           LEFT JOIN application_run_bindings b ON b.workspace_id = r.workspace_id AND b.run_id = r.id
           WHERE r.workspace_id = $1 AND r.id = $2`,
          [workspaceId, chosen.runId],
        );
        if (owner === undefined || owner.application_id !== applicationId) {
          throw new StorageValidationError(`Run ${chosen.runId} is not a run of this application`);
        }
        await executor.query(
          `INSERT INTO application_chosen_runs (workspace_id, application_id, run_id, reason, chosen_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, workspace_id, application_id) DO UPDATE SET
             run_id = excluded.run_id, reason = excluded.reason, chosen_at = excluded.chosen_at`,
          [workspaceId, applicationId, chosen.runId, chosen.reason, chosen.chosenAt],
        );
        await appendAuditEventRow(executor, auditEvent);
      });
    },
    getChosenRun: (workspaceId, applicationId) => readChosenRun(client, workspaceId, applicationId),
    clearChosenRun: (workspaceId, applicationId, auditEvent) =>
      client.transaction(async (executor) => {
        const [row] = await executor.query(
          "DELETE FROM application_chosen_runs WHERE workspace_id = $1 AND application_id = $2 RETURNING run_id, reason, chosen_at",
          [workspaceId, applicationId],
        );
        if (row === undefined) return undefined;
        const cleared = chosenRunFromRow(row);
        await appendAuditEventRow(executor, auditEvent(cleared));
        return cleared;
      }),
    deleteApplication: async (workspaceId, applicationId) => {
      if (applicationId === defaultApplicationId) {
        throw new StorageValidationError("The default application is derived and never deleted");
      }
      await client.transaction(async (executor) => {
        const [stored] = await executor.query(
          "SELECT 1 AS present FROM applications WHERE workspace_id = $1 AND application_id = $2 FOR UPDATE",
          [workspaceId, applicationId],
        );
        if (stored === undefined) {
          throw new StorageValidationError(`Application ${applicationId} was not found`);
        }
        for (const table of ["application_run_bindings", "application_brief_bindings"] as const) {
          const [bound] = await executor.query(
            `SELECT 1 AS present FROM ${table} WHERE workspace_id = $1 AND application_id = $2 LIMIT 1`,
            [workspaceId, applicationId],
          );
          if (bound !== undefined) {
            throw new StorageConflictError(
              `Application ${applicationId} holds runs or briefs and can only be archived`,
            );
          }
        }
        for (const table of [
          "application_archives",
          "application_model_profiles",
          "application_chosen_runs",
          "applications",
        ] as const) {
          await executor.query(
            `DELETE FROM ${table} WHERE workspace_id = $1 AND application_id = $2`,
            [workspaceId, applicationId],
          );
        }
      });
    },
    // On Postgres the binding tables always exist, so no pre-application fallback is needed.
    listDefaultRunIds: async (workspaceId) =>
      (
        await client.query(
          `SELECT r.id FROM runs r
           LEFT JOIN application_run_bindings b ON b.workspace_id = r.workspace_id AND b.run_id = r.id
           WHERE r.workspace_id = $1 AND ${boundOwner} = '${defaultApplicationId}'
           ORDER BY r.updated_at COLLATE "C", r.id COLLATE "C"`,
          [workspaceId],
        )
      ).map((row) => text(row, "id")),
    listDefaultBriefIds: async (workspaceId) =>
      (
        await client.query(
          `SELECT v.brief_id FROM opportunity_brief_versions v
           LEFT JOIN application_brief_bindings b ON b.workspace_id = v.workspace_id AND b.brief_id = v.brief_id
           WHERE v.workspace_id = $1 AND ${boundOwner} = '${defaultApplicationId}'
           GROUP BY v.brief_id ORDER BY MIN(v.created_at COLLATE "C"), v.brief_id COLLATE "C"`,
          [workspaceId],
        )
      ).map((row) => text(row, "brief_id")),
  };
}
