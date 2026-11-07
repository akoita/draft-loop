import type { PostgresMigration } from "./migrations.js";

/**
 * Agent token scopes (ADR 0011 D17, #2438): each token now names what it may do, as a
 * comma-separated list. Rows stored before keep a null column, which the store reads as the
 * work journal only, so no older token gains a scope and no backfill crosses row-level security.
 */
export const agentTokenScopesMigration: PostgresMigration = {
  version: 30,
  name: "agent token scopes",
  sql: `
    ALTER TABLE agent_tokens ADD COLUMN scopes TEXT;
  `,
};
