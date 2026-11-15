import type { PostgresMigration } from "./migrations.js";

/**
 * A member's display preference (#2788): Guided, the standard simple view or Show everything, and
 * whether they hid the Getting started guide. Both live on the member's settings row, so erasing
 * a member or an organisation removes them with the rest of that row.
 */
export const memberDisplayPreferenceMigration: PostgresMigration = {
  version: 46,
  name: "member display preference",
  sql: `
    ALTER TABLE member_settings
      ADD COLUMN display_mode TEXT CHECK (display_mode IN ('guided', 'standard', 'everything')),
      ADD COLUMN guide_hidden BOOLEAN NOT NULL DEFAULT false;
  `,
};
