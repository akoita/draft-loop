import type { PostgresMigration } from "./migrations.js";

/**
 * The outer loop's insight ledger (#2917): one row per failure pattern the daily quality digests
 * show, keyed by its mechanism (codes and model ids only), with its status. Deployment-wide like
 * the digests, and never holds candidate material.
 */
export const qualityInsightsMigration: PostgresMigration = {
  version: 52,
  name: "quality insights",
  sql: `
    CREATE TABLE quality_insights (
      key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][A-Za-z0-9._:/@-]{0,255}$'),
      first_seen TEXT NOT NULL CHECK (first_seen ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
      last_seen TEXT NOT NULL CHECK (last_seen ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
      days_seen INTEGER NOT NULL CHECK (days_seen >= 0),
      occurrences INTEGER NOT NULL CHECK (occurrences >= 0),
      run_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(run_ids) = 'array' AND jsonb_array_length(run_ids) <= 3
      ),
      status TEXT NOT NULL CHECK (status IN ('new', 'recurring', 'resolved', 'dismissed')),
      issue INTEGER CHECK (issue > 0)
    );
    ALTER TABLE quality_insights ENABLE ROW LEVEL SECURITY;
    ALTER TABLE quality_insights FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON quality_insights USING (true) WITH CHECK (true);
  `,
};
