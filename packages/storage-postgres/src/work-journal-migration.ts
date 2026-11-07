import { contentScreeningMigration } from "./content-screening-migration.js";
import { creditLedgerMigration } from "./credit-ledger-migration.js";
import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";

/**
 * The work journal (#2021): notes an agent filed, pending the candidate's review.
 *
 * - `work_journal_notes` holds each note as the stored-note JSON the application parsed, with the
 *   columns its queries need. A dedupe key is unique per tenant among notes not discarded.
 * - `work_journal_forgotten_keys` keeps only the key and id of a discarded note whose text aged
 *   out after 30 days, so the agent is still told the candidate discarded that work.
 * - `work_journal_intake` is each workspace's "Accept notes from agents" switch.
 * - `workspace_id` is the API's workspace (candidate record) id. Erasing a record removes its
 *   rows, and erasing an organisation removes all of them: `CREATE OR REPLACE` redefines version
 *   20's `erase_candidate_record` and version 22's `erase_tenant_remainder` with the three tables
 *   added, keeping their ownership, search path and grants.
 */
const tables = `
    CREATE TABLE work_journal_notes (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      id TEXT NOT NULL CHECK (id ~ '^wjn_[A-Za-z0-9_-]{8,64}$'),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'merged', 'discarded')),
      dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 400),
      project TEXT NOT NULL CHECK (length(project) BETWEEN 1 AND 120),
      note JSONB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE UNIQUE INDEX work_journal_notes_live_key ON work_journal_notes (tenant_id, dedupe_key)
      WHERE status <> 'discarded';
    CREATE INDEX work_journal_notes_workspace
      ON work_journal_notes (tenant_id, workspace_id, created_at DESC);

    CREATE TABLE work_journal_forgotten_keys (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 400),
      note_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      forgotten_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, dedupe_key)
    );

    CREATE TABLE work_journal_intake (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      enabled BOOLEAN NOT NULL,
      changed_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, workspace_id)
    );

    DO $migration$
    DECLARE
      table_name TEXT;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'work_journal_notes', 'work_journal_forgotten_keys', 'work_journal_intake'
      ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I '
          'USING (tenant_id = current_setting(''draft_loop.tenant_id'', true)) '
          'WITH CHECK (tenant_id = current_setting(''draft_loop.tenant_id'', true))',
          table_name
        );
      END LOOP;
    END
    $migration$;
`;

const recordErasure = withErasureSteps(
  erasureDefinition(contentScreeningMigration.sql, "erase_candidate_record"),
  "            ['candidate_record_assignments', 'workspace_id = $2'],",
  [
    "            ['work_journal_notes', 'workspace_id = $2'],",
    "            ['work_journal_forgotten_keys', 'workspace_id = $2'],",
    "            ['work_journal_intake', 'workspace_id = $2'],",
  ],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(creditLedgerMigration.sql, "erase_tenant_remainder"),
  "            'workspace_settings',",
  [
    "            'work_journal_notes',",
    "            'work_journal_forgotten_keys',",
    "            'work_journal_intake',",
  ],
);

/** The erasure definitions this migration writes, for the next migration that adds a table. */
export const workJournalErasure = { recordErasure, tenantErasure };

export const workJournalMigration: PostgresMigration = {
  version: 23,
  name: "work journal notes",
  sql: `${tables}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
