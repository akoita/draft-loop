import type { PostgresMigration } from "./migrations.js";

/**
 * Interview preparation guides (#2615): saved application material gains the `interview-guide`
 * kind. Guides share the drafts table, its erasure and its tenant policy, so only the kind check
 * changes.
 */
export const interviewGuideMigration: PostgresMigration = {
  version: 39,
  name: "interview guide material kind",
  sql: `
    ALTER TABLE application_material_drafts
      DROP CONSTRAINT application_material_drafts_kind_check;
    ALTER TABLE application_material_drafts
      ADD CONSTRAINT application_material_drafts_kind_check
      CHECK (kind IN ('cover-letter', 'interview-questions', 'interview-guide'));
  `,
};
