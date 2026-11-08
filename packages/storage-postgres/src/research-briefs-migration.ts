import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";
import { savedApplicationMaterialMigration } from "./saved-application-material-migration.js";

/**
 * Research briefs (#2542): each brief a research run keeps with its application, as the JSON the
 * application parsed, with the columns its queries need. A brief lives with the candidate record,
 * so erasing a record or an organisation removes it: the erasure functions are redefined from
 * version 33 with the table added.
 */
const table = `
    CREATE TABLE application_research_briefs (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      id TEXT NOT NULL CHECK (id ~ '^rbr_[A-Za-z0-9_-]{8,64}$'),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0),
      brief JSONB NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX application_research_briefs_application
      ON application_research_briefs (tenant_id, workspace_id, application_id, created_at DESC);
    ALTER TABLE application_research_briefs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE application_research_briefs FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON application_research_briefs
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(savedApplicationMaterialMigration.sql, "erase_candidate_record"),
  "            ['application_material_drafts', 'workspace_id = $2'],",
  ["            ['application_research_briefs', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(savedApplicationMaterialMigration.sql, "erase_tenant_remainder"),
  "            'application_material_drafts',",
  ["            'application_research_briefs',"],
);

export const researchBriefsMigration: PostgresMigration = {
  version: 36,
  name: "research briefs",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
