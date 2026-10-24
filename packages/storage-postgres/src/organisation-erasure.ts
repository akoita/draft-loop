import type { OrganisationErasure } from "@draft-loop/storage/record-erasure";
import { activeRunStates } from "./record-erasure.js";
import type { SqlSession } from "./sql-client.js";

/**
 * One tenant's organisation erasure on Postgres (ADR 0011, D7). Reads run as the runtime role;
 * the final delete calls `erase_tenant_remainder`, which passes the immutability trigger.
 */
export function createOrganisationErasure(client: SqlSession): OrganisationErasure {
  return {
    organisationExists: async () => {
      const rows = await client.query(
        "SELECT 1 FROM organisations WHERE id = current_setting('draft_loop.tenant_id', true)",
      );
      return rows.length > 0;
    },

    hasActiveRun: async () => {
      const rows = await client.query(
        `SELECT 1 FROM (
           SELECT DISTINCT ON (run_id) state FROM run_snapshots ORDER BY run_id, sequence DESC
         ) latest
         WHERE state = ANY($1::text[])
         LIMIT 1`,
        [activeRunStates],
      );
      return rows.length > 0;
    },

    // A record is the hosted reference's configuration, `/tenants/<tenant>/workspaces/<id>`, or a
    // closing mark left by an interrupted erasure.
    listRecords: async () => {
      const rows = await client.query(
        `SELECT substr(workspace_ref, length(prefix) + 1) AS workspace_id
         FROM workspace_settings,
           LATERAL (SELECT '/tenants/' || current_setting('draft_loop.tenant_id', true)
             || '/workspaces/' AS prefix) AS reference
         WHERE name = 'workspace.json' AND starts_with(workspace_ref, prefix)
           AND strpos(substr(workspace_ref, length(prefix) + 1), '/') = 0
         UNION
         SELECT workspace_id FROM candidate_record_erasures
         ORDER BY workspace_id`,
      );
      return rows.map((row) => String(row.workspace_id));
    },

    eraseRemainder: async () => {
      const [row] = await client.transaction((executor) =>
        executor.query("SELECT erase_tenant_remainder() AS removed"),
      );
      return { rowsRemoved: Number(row?.removed ?? 0) };
    },
  };
}
