import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";
import { workJournalMigration } from "./work-journal-migration.js";

/**
 * Evidence-kind overrides on the hosted service (#2022): the kind a writer or the candidate set
 * for a source, so an approved work-journal note is extracted as `work-journal` and not by
 * detection. Rows are append-only per source; the latest sequence wins and a `NULL` kind clears
 * the override, as in the local SQLite store. Erasing a record or an organisation removes them:
 * the two erasure functions are redefined from version 23's with the table added.
 */
const table = `
    CREATE TABLE candidate_knowledge_source_evidence_kind_overrides (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      knowledge_base_id TEXT NOT NULL CHECK (length(knowledge_base_id) BETWEEN 1 AND 256),
      source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 256),
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      kind TEXT CHECK (kind IS NULL OR kind IN ('cv', 'linkedin-export', 'performance-review', 'notes', 'transcript', 'work-journal', 'other')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, knowledge_base_id, source_id, sequence)
    );
    ALTER TABLE candidate_knowledge_source_evidence_kind_overrides ENABLE ROW LEVEL SECURITY;
    ALTER TABLE candidate_knowledge_source_evidence_kind_overrides FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON candidate_knowledge_source_evidence_kind_overrides
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(workJournalMigration.sql, "erase_candidate_record"),
  "            ['candidate_knowledge_sources', 'candidate_knowledge_base_id = ANY($4)'],",
  [
    "            ['candidate_knowledge_source_evidence_kind_overrides', 'knowledge_base_id = ANY($4)'],",
  ],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(workJournalMigration.sql, "erase_tenant_remainder"),
  "            'candidate_knowledge_sources',",
  ["            'candidate_knowledge_source_evidence_kind_overrides',"],
);

export const sourceEvidenceKindsMigration: PostgresMigration = {
  version: 24,
  name: "source evidence kind overrides",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
