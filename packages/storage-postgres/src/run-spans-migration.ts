import { agentConnectionCapsMigration } from "./agent-connection-caps-migration.js";
import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";

/**
 * Stored run spans (#1103): one row per span of a run, with its parent, name, times, status and
 * content-free attributes. The store refuses any attribute outside the allowed set before a row is
 * written, and the name check here keeps a row that bypassed it from holding free text as a name.
 * Spans belong to a run of a candidate record, so erasing a record or an organisation removes
 * them: the erasure functions are redefined from version 40 with the table added.
 */
const table = `
    CREATE TABLE run_spans (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 1 AND 256),
      span_id TEXT NOT NULL CHECK (span_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
      parent_span_id TEXT CHECK (parent_span_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
      name TEXT NOT NULL CHECK (name ~ '^[a-z][a-z_]{0,63}$'),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT CHECK (status IN ('ok', 'error')),
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
      PRIMARY KEY (tenant_id, workspace_id, run_id, span_id)
    );
    ALTER TABLE run_spans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE run_spans FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON run_spans
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(agentConnectionCapsMigration.sql, "erase_candidate_record"),
  "            ['agent_connection_caps', 'workspace_id = $2'],",
  ["            ['run_spans', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(agentConnectionCapsMigration.sql, "erase_tenant_remainder"),
  "            'agent_connection_caps',",
  ["            'run_spans',"],
);

export const runSpansMigration: PostgresMigration = {
  version: 41,
  name: "stored run spans",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
