import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";
import { recordNamesMigration } from "./record-names-migration.js";

/**
 * Feedback notes (#2828): what a member sends about DraftLoop, for the operator to read.
 *
 * - A member inserts only into their own organisation; the operator reads every organisation's
 *   notes, so reading is deployment-wide, like the waitlist.
 * - A note belongs to the organisation, so erasing it removes the notes: `erase_tenant_remainder`
 *   is redefined from version 44 with the table added.
 */
const table = `
    CREATE TABLE feedback_notes (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (length(tenant_id) BETWEEN 1 AND 128),
      id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
      member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 1 AND 128),
      category TEXT CHECK (category IN ('bug', 'idea', 'other')),
      screen TEXT NOT NULL CHECK (length(screen) BETWEEN 1 AND 80),
      body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
      sent_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX feedback_notes_sent ON feedback_notes (sent_at DESC);
    ALTER TABLE feedback_notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE feedback_notes FORCE ROW LEVEL SECURITY;
    CREATE POLICY operator_read ON feedback_notes FOR SELECT USING (true);
    CREATE POLICY member_send ON feedback_notes FOR INSERT
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
    CREATE POLICY tenant_erasure ON feedback_notes FOR DELETE
      USING (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const tenantErasure = withErasureSteps(
  erasureDefinition(recordNamesMigration.sql, "erase_tenant_remainder"),
  "            'candidate_record_names',",
  ["            'feedback_notes',"],
);

export const feedbackNotesMigration: PostgresMigration = {
  version: 49,
  name: "feedback notes",
  sql: `${table}
    DO $migration$
    BEGIN
      ${tenantErasure}
    END
    $migration$;
  `,
};
