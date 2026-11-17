import type { PostgresMigration } from "./migrations.js";

/**
 * Widens the evidence-kind overrides with `project` (#2894), the kind an approved project card's
 * source carries. The new check accepts every row the old one did, so the previous release keeps
 * working against this schema.
 */
export const projectEvidenceKindMigration: PostgresMigration = {
  version: 53,
  name: "project evidence kind",
  sql: `
    ALTER TABLE candidate_knowledge_source_evidence_kind_overrides
      DROP CONSTRAINT IF EXISTS candidate_knowledge_source_evidence_kind_overrides_kind_check;
    ALTER TABLE candidate_knowledge_source_evidence_kind_overrides
      ADD CONSTRAINT candidate_knowledge_source_evidence_kind_overrides_kind_check
      CHECK (kind IS NULL OR kind IN ('cv', 'linkedin-export', 'performance-review', 'notes', 'transcript', 'work-journal', 'project', 'other'));
  `,
};
