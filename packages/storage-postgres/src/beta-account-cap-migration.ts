import type { PostgresMigration } from "./migrations.js";

/**
 * The beta's account cap as the operator set it at runtime (#2998): one deployment-wide row.
 * While the row is absent, the deployment's `DRAFT_LOOP_BETA_ACCOUNT_CAP` applies. Like the
 * invites, it belongs to no tenant, so its policy is deployment-wide.
 */
export const betaAccountCapMigration: PostgresMigration = {
  version: 56,
  name: "beta account cap",
  sql: `
    CREATE TABLE beta_account_cap (
      id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
      account_cap INTEGER NOT NULL CHECK (account_cap BETWEEN 0 AND 100000),
      updated_at TIMESTAMPTZ NOT NULL
    );
    ALTER TABLE beta_account_cap ENABLE ROW LEVEL SECURITY;
    ALTER TABLE beta_account_cap FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON beta_account_cap USING (true) WITH CHECK (true);
  `,
};
