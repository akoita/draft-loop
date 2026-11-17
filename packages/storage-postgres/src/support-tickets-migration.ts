import type { PostgresMigration } from "./migrations.js";

/**
 * Support tickets (#2883): when the support assistant cannot help, the member hands the
 * conversation to a person. A ticket is a feedback note of kind `support`, so the operator reads
 * it with the notes and the organisation's erasure already removes it.
 *
 * - `kind` tells a ticket from a note; every existing row is a note.
 * - `transcript` holds the turns the member agreed to share, as a bounded JSON array.
 * - Tickets go 90 days after they were sent: the worker's sweep deletes them across
 *   organisations, which the `support_retention` policy allows for those rows only.
 */
export const supportTicketsMigration: PostgresMigration = {
  version: 50,
  name: "support tickets",
  sql: `
    ALTER TABLE feedback_notes
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'support'));
    ALTER TABLE feedback_notes
      ADD COLUMN transcript JSONB CHECK (
        transcript IS NULL
        OR (jsonb_typeof(transcript) = 'array' AND octet_length(transcript::text) <= 65536)
      );
    CREATE INDEX feedback_notes_support_sent ON feedback_notes (sent_at) WHERE kind = 'support';
    CREATE POLICY support_retention ON feedback_notes FOR DELETE
      USING (kind = 'support' AND sent_at < now() - interval '90 days');
  `,
};
