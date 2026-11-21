import type { PostgresMigration } from "./migrations.js";

/**
 * Operator replies to feedback notes (#2878): `replies` holds each emailed reply's text and time,
 * oldest first, as a bounded JSON array. Every existing note has none. Only the operator's path
 * writes it, through the `operator_triage` update policy.
 */
export const feedbackRepliesMigration: PostgresMigration = {
  version: 61,
  name: "feedback replies",
  sql: `
    ALTER TABLE feedback_notes
      ADD COLUMN replies JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(replies) = 'array'
        AND jsonb_array_length(replies) <= 20
        AND octet_length(replies::text) <= 65536
      );
  `,
};
