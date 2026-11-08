import type { PostgresMigration } from "./migrations.js";

/**
 * Each organisation's model calls outside runs, per UTC day (#2487): one counter row per tenant
 * and day, under the tenant's row-level security. It holds a date and a number, no content.
 */
export const modelCallMeterMigration: PostgresMigration = {
  version: 34,
  name: "model calls outside runs per day",
  sql: `
    CREATE TABLE model_call_counts (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (length(tenant_id) BETWEEN 1 AND 128),
      day DATE NOT NULL,
      calls INTEGER NOT NULL CHECK (calls > 0),
      PRIMARY KEY (tenant_id, day)
    );
    ALTER TABLE model_call_counts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE model_call_counts FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON model_call_counts
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
  `,
};
