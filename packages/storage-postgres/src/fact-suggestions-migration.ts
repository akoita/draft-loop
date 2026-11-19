import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import { feedbackNotesMigration } from "./feedback-notes-migration.js";
import type { PostgresMigration } from "./migrations.js";
import { recordNamesMigration } from "./record-names-migration.js";

/**
 * Fact suggestions (#3067): proposed career profile changes, each as the JSON the application
 * parsed, with the columns its queries need.
 *
 * - A dedupe key is unique per record and profile among suggestions that are not stale, so a
 *   rejected change is not filed again while a stale one can be.
 * - Quotes and proposed values are candidate material: erasing a record removes its suggestions
 *   and erasing an organisation removes all of them. `erase_candidate_record` is redefined from
 *   version 44 and `erase_tenant_remainder` from version 49, with the table added.
 */
const table = `
    CREATE TABLE fact_suggestions (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      id TEXT NOT NULL CHECK (id ~ '^fsg_[A-Za-z0-9_-]{8,64}$'),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      profile_id TEXT NOT NULL CHECK (length(profile_id) BETWEEN 1 AND 120),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'edited', 'rejected', 'stale')),
      dedupe_key TEXT NOT NULL CHECK (dedupe_key ~ '^fsk1-[a-z-]+-[0-9a-f]{16}$'),
      suggestion JSONB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id)
    );
    CREATE UNIQUE INDEX fact_suggestions_live_key
      ON fact_suggestions (tenant_id, workspace_id, profile_id, dedupe_key)
      WHERE status <> 'stale';
    CREATE INDEX fact_suggestions_workspace
      ON fact_suggestions (tenant_id, workspace_id, created_at DESC);
    ALTER TABLE fact_suggestions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fact_suggestions FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON fact_suggestions
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(recordNamesMigration.sql, "erase_candidate_record"),
  "            ['candidate_record_names', 'workspace_id = $2'],",
  ["            ['fact_suggestions', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(feedbackNotesMigration.sql, "erase_tenant_remainder"),
  "            'feedback_notes',",
  ["            'fact_suggestions',"],
);

export const factSuggestionsMigration: PostgresMigration = {
  version: 59,
  name: "fact suggestions",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
