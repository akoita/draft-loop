import type { PostgresMigration } from "./migrations.js";

/**
 * The deployment's monthly spend pool (#2459): one row per run that drew on it, across every
 * organisation, so the public beta's total model spend stays under one ceiling.
 *
 * - A row is reserved when a run starts, for the run's own cost limit, and closed once with what
 *   the run actually cost. A month's committed amount is the sum of closed costs and open
 *   reservations, so concurrent runs can never take the pool past its ceiling.
 * - Rows hold no organisation id and no content: a run id, a UTC month and two amounts. Every
 *   tenant session reads and writes them, which is why the policy is deployment-wide. Erasing an
 *   organisation leaves them, so erasure cannot return spent money to the pool.
 */
export const spendPoolMigration: PostgresMigration = {
  version: 31,
  name: "deployment spend pool",
  sql: `
    CREATE TABLE spend_pool_entries (
      run_id TEXT PRIMARY KEY CHECK (length(run_id) BETWEEN 1 AND 256),
      month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      reserved_usd NUMERIC(12, 4) NOT NULL CHECK (reserved_usd > 0),
      spent_usd NUMERIC(12, 4) CHECK (spent_usd >= 0),
      reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      CHECK ((spent_usd IS NULL) = (closed_at IS NULL))
    );
    CREATE INDEX spend_pool_entries_month ON spend_pool_entries (month);
    ALTER TABLE spend_pool_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE spend_pool_entries FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON spend_pool_entries USING (true) WITH CHECK (true);
  `,
};
