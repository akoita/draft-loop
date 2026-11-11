import type { RunSpanAttributes, RunSpanName, RunSpanStatus } from "@draft-loop/domain/run-span";
import {
  type RunSpanRecord,
  type RunSpanStore,
  requireRunSpanRecord,
} from "@draft-loop/storage/run-spans";
import type { SqlSession } from "./sql-client.js";

function spanOf(row: Record<string, unknown>): RunSpanRecord {
  const attributes =
    typeof row.attributes === "string" ? JSON.parse(row.attributes) : row.attributes;
  return {
    workspaceId: String(row.workspace_id),
    runId: String(row.run_id),
    spanId: String(row.span_id),
    parentSpanId: row.parent_span_id === null ? null : String(row.parent_span_id),
    name: String(row.name) as RunSpanName,
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null ? null : String(row.ended_at),
    status: row.status === null ? null : (String(row.status) as RunSpanStatus),
    attributes: attributes as RunSpanAttributes,
  };
}

/** One tenant's run spans on Postgres; row-level security confines them to the tenant. */
export function createRunSpanStore(client: SqlSession): RunSpanStore {
  return {
    put: async (input) => {
      const span = requireRunSpanRecord(input);
      await client.query(
        `INSERT INTO run_spans
           (workspace_id, run_id, span_id, parent_span_id, name, started_at, ended_at, status, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (tenant_id, workspace_id, run_id, span_id)
           DO UPDATE SET parent_span_id = EXCLUDED.parent_span_id,
                         name = EXCLUDED.name,
                         started_at = EXCLUDED.started_at,
                         ended_at = EXCLUDED.ended_at,
                         status = EXCLUDED.status,
                         attributes = EXCLUDED.attributes`,
        [
          span.workspaceId,
          span.runId,
          span.spanId,
          span.parentSpanId,
          span.name,
          span.startedAt,
          span.endedAt,
          span.status,
          JSON.stringify(span.attributes),
        ],
      );
    },
    list: async (workspaceId, runId) => {
      const rows = await client.query(
        `SELECT workspace_id, run_id, span_id, parent_span_id, name, started_at, ended_at, status,
                attributes
           FROM run_spans WHERE workspace_id = $1 AND run_id = $2
          ORDER BY started_at COLLATE "C", span_id COLLATE "C"`,
        [workspaceId, runId],
      );
      return rows.map(spanOf);
    },
    removeRun: async (workspaceId, runId) => {
      const rows = await client.query(
        `DELETE FROM run_spans WHERE workspace_id = $1 AND run_id = $2 RETURNING 1`,
        [workspaceId, runId],
      );
      return rows.length;
    },
  };
}
