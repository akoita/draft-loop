import type { PostgresMigration } from "./migrations.js";

/**
 * Assistants waiting for a spend limit (#2785): an assistant that asks to spend before the
 * person set its limit is kept with no cap, so the Agents section lists it and the person sets
 * the limit on its row instead of typing its client id. A row without a cap reserves nothing.
 */
export const agentConnectionNotedMigration: PostgresMigration = {
  version: 47,
  name: "assistants waiting for a spend limit",
  sql: `
    ALTER TABLE agent_connection_caps ALTER COLUMN monthly_cap_cents DROP NOT NULL;
  `,
};
