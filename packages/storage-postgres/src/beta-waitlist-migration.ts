import type { PostgresMigration } from "./migrations.js";

/**
 * The public beta's waitlist (#2566): one row per email that asked to join.
 *
 * - Rows belong to no tenant: a visitor joins before any organisation exists, and the operator
 *   reads the list across the deployment, so the policy is deployment-wide.
 * - Each row records the consent text's version and the day it was given.
 * - A row is deleted when its email is invited, and after six months otherwise (#2568).
 */
export const betaWaitlistMigration: PostgresMigration = {
  version: 37,
  name: "beta waitlist",
  sql: `
    CREATE TABLE beta_waitlist (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
      email TEXT NOT NULL UNIQUE
        CHECK (email = lower(btrim(email)) AND length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
      consent_version TEXT NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 64),
      joined_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX beta_waitlist_joined ON beta_waitlist (joined_at);
    ALTER TABLE beta_waitlist ENABLE ROW LEVEL SECURITY;
    ALTER TABLE beta_waitlist FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON beta_waitlist USING (true) WITH CHECK (true);
  `,
};
