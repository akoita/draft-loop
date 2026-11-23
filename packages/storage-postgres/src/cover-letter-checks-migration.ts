import type { PostgresMigration } from "./migrations.js";

/**
 * Check my letter's daily count (#3282), for the quality digest. The check stores no letter, so
 * this is the only trace it leaves: a date and a number, no tenant, member, text or id.
 *
 * - Rows belong to no tenant: the count is deployment-wide, as the digest is.
 * - One row per UTC day; the digest reads yesterday's row.
 */
export const coverLetterChecksMigration: PostgresMigration = {
  version: 63,
  name: "cover letter check daily count",
  sql: `
    CREATE TABLE cover_letter_check_counts (
      day DATE PRIMARY KEY,
      checks INTEGER NOT NULL CHECK (checks > 0)
    );
    ALTER TABLE cover_letter_check_counts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cover_letter_check_counts FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON cover_letter_check_counts USING (true) WITH CHECK (true);
  `,
};
