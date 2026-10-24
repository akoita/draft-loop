import {
  type CandidateRecordErasure,
  RecordErasureError,
  requireErasedRecordId,
} from "@draft-loop/storage/record-erasure";
import type { SqlExecutor, SqlSession } from "./sql-client.js";

/** Run states in which a run is queued or executing without the person. */
export const activeRunStates = [
  "collecting",
  "ingesting",
  "drafting",
  "reviewing",
  "revising",
] as const;

/**
 * The object key a stored location names: an export's location is its workspace reference path,
 * whose key drops the leading slash, as `workspaceReferenceBlobs` maps it; a source version's
 * location is its key already.
 */
export function objectKeyOf(location: string): string {
  return location.startsWith("/") ? location.slice(1) : location;
}

async function objectKeys(executor: SqlExecutor, workspaceId: string): Promise<string[]> {
  const rows = await executor.query("SELECT candidate_record_blob_locations($1) AS location", [
    workspaceId,
  ]);
  return [...new Set(rows.map((row) => objectKeyOf(String(row.location))))].sort();
}

async function isMarked(executor: SqlExecutor, workspaceId: string): Promise<boolean> {
  const rows = await executor.query(
    "SELECT 1 FROM candidate_record_erasures WHERE workspace_id = $1",
    [workspaceId],
  );
  return rows.length > 0;
}

/** A record exists while its configuration does: the hosted reference's `workspace.json`. */
async function exists(executor: SqlExecutor, workspaceId: string): Promise<boolean> {
  const rows = await executor.query(
    `SELECT 1 FROM workspace_settings
     WHERE name = 'workspace.json'
       AND workspace_ref = '/tenants/' || current_setting('draft_loop.tenant_id', true)
         || '/workspaces/' || $1`,
    [workspaceId],
  );
  return rows.length > 0;
}

/** Whether any of the record's runs is, by its latest snapshot, queued or executing. */
async function hasActiveRun(executor: SqlExecutor, workspaceId: string): Promise<boolean> {
  const rows = await executor.query(
    `SELECT 1 FROM (
       SELECT DISTINCT ON (run_id) state FROM run_snapshots
       WHERE workspace_id = candidate_record_history_id($1)
       ORDER BY run_id, sequence DESC
     ) latest
     WHERE state = ANY($2::text[])
     LIMIT 1`,
    [workspaceId, activeRunStates],
  );
  return rows.length > 0;
}

/**
 * One tenant's candidate record erasure on Postgres (ADR 0011, D7). Closing is an ordinary insert;
 * erasing calls `erase_candidate_record`, the one function that may delete ledger and audit rows.
 */
export function createCandidateRecordErasure(client: SqlSession): CandidateRecordErasure {
  return {
    close: async (workspaceId) => {
      const id = requireErasedRecordId(workspaceId);
      return client.transaction(async (executor) => {
        // Serializes closing the same record, so two callers agree on who closed it.
        await executor.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
          "candidate-record-erasure",
          id,
        ]);
        if (await isMarked(executor, id)) {
          return { state: "closed", resumed: true, objectKeys: await objectKeys(executor, id) };
        }
        if (!(await exists(executor, id))) return { state: "missing" };
        if (await hasActiveRun(executor, id)) return { state: "run-active" };
        await executor.query("INSERT INTO candidate_record_erasures (workspace_id) VALUES ($1)", [
          id,
        ]);
        return { state: "closed", resumed: false, objectKeys: await objectKeys(executor, id) };
      });
    },

    isClosed: async (workspaceId) => {
      const id = requireErasedRecordId(workspaceId);
      return client.transaction((executor) => isMarked(executor, id), { readOnlySnapshot: true });
    },

    erase: async (workspaceId) => {
      const id = requireErasedRecordId(workspaceId);
      try {
        const [row] = await client.transaction((executor) =>
          executor.query("SELECT erase_candidate_record($1) AS erased", [id]),
        );
        const erased = row?.erased as
          | { readonly rowsRemoved: number; readonly blobLocations: readonly string[] }
          | undefined;
        if (erased === undefined) throw new Error("The erasure returned nothing");
        return {
          rowsRemoved: Number(erased.rowsRemoved),
          objectKeys: [...new Set(erased.blobLocations.map(objectKeyOf))].sort(),
        };
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "55000") {
          throw new RecordErasureError("not_closed", "The candidate record is not closed.");
        }
        throw error;
      }
    },
  };
}
