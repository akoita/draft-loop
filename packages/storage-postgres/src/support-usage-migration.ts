import type { PostgresMigration } from "./migrations.js";

/**
 * The support assistant's daily use (#2882 follow-up), shared by every API instance so a restart
 * or a second instance never resets a limit.
 *
 * - `support_question_counts`: questions per member per UTC day. It holds an opaque member id, a
 *   date and a number, no words, and rows older than yesterday are swept.
 * - `support_daily_spend`: the estimated model cost of all members per UTC day, kept 90 days.
 * - Rows belong to no tenant: the cost cap is deployment-wide, so the policy is too.
 */
export const supportUsageMigration: PostgresMigration = {
  version: 57,
  name: "support assistant daily use",
  sql: `
    CREATE TABLE support_question_counts (
      day DATE NOT NULL,
      member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 1 AND 128),
      questions INTEGER NOT NULL CHECK (questions > 0),
      PRIMARY KEY (day, member_id)
    );
    ALTER TABLE support_question_counts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE support_question_counts FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON support_question_counts USING (true) WITH CHECK (true);

    CREATE TABLE support_daily_spend (
      day DATE PRIMARY KEY,
      estimated_usd NUMERIC(12, 6) NOT NULL CHECK (estimated_usd >= 0)
    );
    ALTER TABLE support_daily_spend ENABLE ROW LEVEL SECURITY;
    ALTER TABLE support_daily_spend FORCE ROW LEVEL SECURITY;
    CREATE POLICY deployment_wide ON support_daily_spend USING (true) WITH CHECK (true);
  `,
};
