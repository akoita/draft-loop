import type { PostgresMigration } from "./migrations.js";

/**
 * Daily quality digests (#2916): one row per UTC day, the content-free digest of that day's run
 * spans for the outer loop (#2914).
 *
 * - Rows belong to no tenant: a digest counts across the deployment, so the policy is
 *   deployment-wide, as for organisation activity. A digest holds codes, model ids, counts and
 *   run ids only, never candidate material.
 * - The worker claims a day by inserting its row first, so one worker builds each day's digest.
 */
export const qualityDigestsMigration: PostgresMigration = {
  version: 51,
  name: "quality digests",
  sql: `
    CREATE TABLE quality_digests (
      day TEXT PRIMARY KEY CHECK (day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
      claimed_at TIMESTAMPTZ NOT NULL,
      digest JSONB CHECK (
        digest IS NULL
        OR (jsonb_typeof(digest) = 'object' AND octet_length(digest::text) <= 65536)
      )
    );
    ALTER TABLE quality_digests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE quality_digests FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON quality_digests USING (true) WITH CHECK (true);
  `,
};
