import { careerInterviewMigration } from "./career-interview-migration.js";
import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";

/**
 * Application folders (#2281): named sections of a workspace's applications and the placement of
 * each application in one. A folder name is the person's own label inside their record, so erasing
 * a record or an organisation removes both tables: the erasure functions are redefined from
 * version 26's with them added.
 */
const tables = `
    CREATE TABLE application_folders (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
      folder_id TEXT NOT NULL CHECK (folder_id ~ '^fld_[A-Za-z0-9_-]{8,64}$'),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name = trim(name)),
      name_key TEXT NOT NULL CHECK (length(name_key) > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, workspace_id, folder_id),
      UNIQUE (tenant_id, workspace_id, name_key)
    );
    ALTER TABLE application_folders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE application_folders FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON application_folders
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));

    CREATE TABLE application_folder_placements (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0),
      folder_id TEXT NOT NULL,
      placed_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, workspace_id, application_id),
      FOREIGN KEY (tenant_id, workspace_id, folder_id)
        REFERENCES application_folders (tenant_id, workspace_id, folder_id) ON DELETE CASCADE
    );
    CREATE INDEX application_folder_placements_folder
      ON application_folder_placements (tenant_id, workspace_id, folder_id);
    ALTER TABLE application_folder_placements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE application_folder_placements FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON application_folder_placements
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(careerInterviewMigration.sql, "erase_candidate_record"),
  "            ['career_interview_sessions', 'workspace_id = $2'],",
  [
    "            ['application_folder_placements', 'workspace_id = $3'],",
    "            ['application_folders', 'workspace_id = $3'],",
  ],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(careerInterviewMigration.sql, "erase_tenant_remainder"),
  "            'career_interview_sessions',",
  ["            'application_folder_placements',", "            'application_folders',"],
);

export const applicationFoldersMigration: PostgresMigration = {
  version: 28,
  name: "application folders",
  sql: `${tables}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
