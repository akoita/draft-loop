import type { PostgresMigration } from "./migrations.js";

/**
 * Cover letter writing kits (#3278): saved application material gains the `cover-letter-kit`
 * kind. Kits share the drafts table, its erasure and its tenant policy, so only the kind check
 * changes.
 */
export const coverLetterKitMigration: PostgresMigration = {
  version: 62,
  name: "cover letter kit material kind",
  sql: `
    ALTER TABLE application_material_drafts
      DROP CONSTRAINT application_material_drafts_kind_check;
    ALTER TABLE application_material_drafts
      ADD CONSTRAINT application_material_drafts_kind_check
      CHECK (kind IN ('cover-letter', 'interview-questions', 'interview-guide', 'cover-letter-kit'));
  `,
};
