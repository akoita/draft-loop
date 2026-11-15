import type { PostgresMigration } from "./migrations.js";

/**
 * The member an agent token acts as (#2784). On the hosted service a signed-in member issues the
 * token, and each request it makes acts as that member, so it stops when the member leaves. A
 * token the self-hosted owner issued holds none.
 */
export const agentTokenMemberMigration: PostgresMigration = {
  version: 46,
  name: "agent token member",
  sql: `
    ALTER TABLE agent_tokens
      ADD COLUMN member_id TEXT CHECK (length(member_id) BETWEEN 1 AND 256);
  `,
};
