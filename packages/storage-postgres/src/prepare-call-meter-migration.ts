import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";
import { runSpansMigration } from "./run-spans-migration.js";

/**
 * Each application's Prepare model calls under its credit (#2680): one counter row per candidate
 * record and application, under the tenant's row-level security. It holds ids and a number, no
 * content. The counter belongs to a candidate record, so erasing a record or an organisation
 * removes it: the erasure functions are redefined from version 41 with the table added.
 */
const table = `
    CREATE TABLE prepare_call_counts (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (length(tenant_id) BETWEEN 1 AND 128),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      application_id TEXT NOT NULL CHECK (length(application_id) BETWEEN 1 AND 256),
      calls INTEGER NOT NULL CHECK (calls > 0),
      PRIMARY KEY (tenant_id, workspace_id, application_id)
    );
    ALTER TABLE prepare_call_counts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prepare_call_counts FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON prepare_call_counts
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(runSpansMigration.sql, "erase_candidate_record"),
  "            ['run_spans', 'workspace_id = $2'],",
  ["            ['prepare_call_counts', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(runSpansMigration.sql, "erase_tenant_remainder"),
  "            'run_spans',",
  ["            'prepare_call_counts',"],
);

export const prepareCallMeterMigration: PostgresMigration = {
  version: 42,
  name: "prepare calls per credited application",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
