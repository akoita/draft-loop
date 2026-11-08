import { applicationFoldersMigration } from "./application-folders-migration.js";
import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import { memberSettingsMigration } from "./member-settings-migration.js";
import type { PostgresMigration } from "./migrations.js";

/**
 * Saved application material (#2477): each cover letter or interview question set a candidate
 * keeps, as the JSON the application parsed, with the columns its queries need. A draft is
 * candidate material, so erasing a record or an organisation removes it: the erasure functions
 * are redefined from versions 28 and 29 with the table added.
 */
const table = `
    CREATE TABLE application_material_drafts (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      id TEXT NOT NULL CHECK (id ~ '^amd_[A-Za-z0-9_-]{8,64}$'),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0),
      kind TEXT NOT NULL CHECK (kind IN ('cover-letter', 'interview-questions')),
      draft JSONB NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX application_material_drafts_application
      ON application_material_drafts (tenant_id, workspace_id, application_id, created_at DESC);
    ALTER TABLE application_material_drafts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE application_material_drafts FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON application_material_drafts
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(applicationFoldersMigration.sql, "erase_candidate_record"),
  "            ['career_interview_sessions', 'workspace_id = $2'],",
  ["            ['application_material_drafts', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(memberSettingsMigration.sql, "erase_tenant_remainder"),
  "            'career_interview_sessions',",
  ["            'application_material_drafts',"],
);

export const savedApplicationMaterialMigration: PostgresMigration = {
  version: 33,
  name: "saved application material",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
