import type { PostgresMigration } from "./migrations.js";

/**
 * When each organisation was last active (#2538), for the public beta's retention (#2463).
 *
 * - One row per organisation: when a member last made a request, and when its owners were warned
 *   that the organisation will be erased for inactivity. No content, no member, no request.
 * - The retention job reads every organisation's row, so the policy is deployment-wide, as for
 *   the beta invites. Erasing an organisation deletes its row.
 */
export const organisationActivityMigration: PostgresMigration = {
  version: 35,
  name: "organisation activity",
  sql: `
    CREATE TABLE organisation_activity (
      organisation_id TEXT PRIMARY KEY CHECK (length(organisation_id) BETWEEN 1 AND 128),
      last_active_at TIMESTAMPTZ NOT NULL,
      warned_at TIMESTAMPTZ
    );
    CREATE INDEX organisation_activity_last_active ON organisation_activity (last_active_at);
    ALTER TABLE organisation_activity ENABLE ROW LEVEL SECURITY;
    ALTER TABLE organisation_activity FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON organisation_activity USING (true) WITH CHECK (true);
  `,
};
