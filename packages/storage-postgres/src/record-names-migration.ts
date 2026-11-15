import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";
import { prepareCallMeterMigration } from "./prepare-call-meter-migration.js";

/**
 * The name people give a candidate record (#2737): one row per record, under the tenant's
 * row-level security. The record's id stays what routes and storage use; the name is what the
 * screens show. A record without a row is shown by its id. The name belongs to the record, so
 * erasing a record or an organisation removes it: the erasure functions are redefined from
 * version 42 with the table added.
 */
const table = `
    CREATE TABLE candidate_record_names (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (length(tenant_id) BETWEEN 1 AND 128),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, workspace_id)
    );
    ALTER TABLE candidate_record_names ENABLE ROW LEVEL SECURITY;
    ALTER TABLE candidate_record_names FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON candidate_record_names
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(prepareCallMeterMigration.sql, "erase_candidate_record"),
  "            ['prepare_call_counts', 'workspace_id = $2'],",
  ["            ['candidate_record_names', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(prepareCallMeterMigration.sql, "erase_tenant_remainder"),
  "            'prepare_call_counts',",
  ["            'candidate_record_names',"],
);

export const recordNamesMigration: PostgresMigration = {
  version: 44,
  name: "candidate record names",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
