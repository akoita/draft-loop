import type { PostgresMigration } from "./migrations.js";

/**
 * Agent token expiry (the agent token audit, `docs/security/agent-token-audit.md`): each token
 * now stops working at its `expires_at`. Rows stored before keep a null column, which the store
 * reads as the default 90 days after the token was issued, so no backfill crosses row-level
 * security.
 */
export const agentTokenExpiryMigration: PostgresMigration = {
  version: 27,
  name: "agent token expiry",
  sql: `
    ALTER TABLE agent_tokens ADD COLUMN expires_at TEXT;
  `,
};
