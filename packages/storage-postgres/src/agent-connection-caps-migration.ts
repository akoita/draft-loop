import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";
import { researchBriefsMigration } from "./research-briefs-migration.js";

/**
 * Spend caps of assistant connections (#2655): per workspace and assistant client, a monthly cap
 * in US cents and what the connection reserved this UTC month, with the keys it reserved under so
 * a retry reserves nothing more. One conditional UPDATE reserves atomically. A cap lives with the
 * candidate record, so erasing a record or an organisation removes it: the erasure functions are
 * redefined from version 36 with the table added.
 */
const table = `
    CREATE TABLE agent_connection_caps (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      client_id TEXT NOT NULL CHECK (client_id ~ '^[\\x21-\\x7e]{1,200}$'),
      monthly_cap_cents INTEGER NOT NULL CHECK (monthly_cap_cents BETWEEN 1 AND 50000),
      updated_at TEXT NOT NULL,
      spend_month TEXT CHECK (spend_month ~ '^[0-9]{4}-[0-9]{2}$'),
      spent_cents INTEGER NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
      spend_keys JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (tenant_id, workspace_id, client_id)
    );
    ALTER TABLE agent_connection_caps ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_connection_caps FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON agent_connection_caps
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(researchBriefsMigration.sql, "erase_candidate_record"),
  "            ['application_research_briefs', 'workspace_id = $2'],",
  ["            ['agent_connection_caps', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(researchBriefsMigration.sql, "erase_tenant_remainder"),
  "            'application_research_briefs',",
  ["            'agent_connection_caps',"],
);

export const agentConnectionCapsMigration: PostgresMigration = {
  version: 40,
  name: "assistant connection spend caps",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
