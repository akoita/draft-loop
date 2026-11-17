import type { PostgresMigration } from "./migrations.js";

/**
 * Feedback context and triage (#2875, #2877).
 *
 * - `context` holds the technical facts sent with a note, as a bounded JSON object; older notes
 *   and support tickets have none.
 * - `status`, `issue_url` and `triaged_at` record the operator's triage; every existing note is
 *   `new`. An issue link is an https GitHub issue address.
 * - Only the operator's path updates a note: the `operator_triage` policy admits an update only
 *   in a transaction that set `draft_loop.operator`, which the store's triage alone does. Members
 *   still only insert into their own organisation.
 */
export const feedbackTriageMigration: PostgresMigration = {
  version: 54,
  name: "feedback context and triage",
  sql: `
    ALTER TABLE feedback_notes
      ADD COLUMN context JSONB CHECK (
        context IS NULL
        OR (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 8192)
      );
    ALTER TABLE feedback_notes
      ADD COLUMN status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'triaged', 'issue', 'closed'));
    ALTER TABLE feedback_notes
      ADD COLUMN issue_url TEXT CHECK (
        issue_url IS NULL
        OR (length(issue_url) <= 300 AND issue_url ~ '^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+$')
      );
    ALTER TABLE feedback_notes ADD COLUMN triaged_at TIMESTAMPTZ;
    CREATE INDEX feedback_notes_status_sent ON feedback_notes (status, sent_at DESC);
    CREATE POLICY operator_triage ON feedback_notes FOR UPDATE
      USING (current_setting('draft_loop.operator', true) = 'on')
      WITH CHECK (current_setting('draft_loop.operator', true) = 'on');
  `,
};
