import type { PostgresMigration } from "./migrations.js";

/**
 * Agent token spend caps (#2599): a token with `runs:start` holds a monthly cap in US cents and
 * what it reserved this UTC month, with the keys it reserved under so a retry reserves nothing
 * more. The columns live on the token's own row, so erasing the token erases its spend, and one
 * conditional UPDATE reserves atomically.
 */
export const agentTokenSpendMigration: PostgresMigration = {
  version: 38,
  name: "agent token spend caps",
  sql: `
    ALTER TABLE agent_tokens
      ADD COLUMN monthly_cap_cents INTEGER CHECK (monthly_cap_cents BETWEEN 1 AND 50000),
      ADD COLUMN spend_month TEXT CHECK (spend_month ~ '^[0-9]{4}-[0-9]{2}$'),
      ADD COLUMN spent_cents INTEGER NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
      ADD COLUMN spend_keys JSONB NOT NULL DEFAULT '{}'::jsonb;
  `,
};
