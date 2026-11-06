import { applicationFoldersMigration } from "./application-folders-migration.js";
import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";

/**
 * Member settings (#2373): each member's own choices, such as the screen language, so they follow
 * the person to every device. A row goes with its member, and erasing an organisation removes the
 * table's rows: the tenant erasure function is redefined from version 28's with it added. A
 * member's settings are not part of any candidate record, so record erasure is unchanged.
 */
const table = `
    CREATE TABLE member_settings (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      member_id TEXT NOT NULL,
      screen_language TEXT CHECK (screen_language IN ('en', 'fr')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, member_id),
      FOREIGN KEY (tenant_id, member_id)
        REFERENCES organisation_members (tenant_id, id) ON DELETE CASCADE
    );
    ALTER TABLE member_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE member_settings FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON member_settings
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const tenantErasure = withErasureSteps(
  erasureDefinition(applicationFoldersMigration.sql, "erase_tenant_remainder"),
  "            'organisation_members'",
  ["            'member_settings',"],
);

export const memberSettingsMigration: PostgresMigration = {
  version: 29,
  name: "member settings",
  sql: `${table}
    DO $migration$
    BEGIN
      ${tenantErasure}
    END
    $migration$;
  `,
};
