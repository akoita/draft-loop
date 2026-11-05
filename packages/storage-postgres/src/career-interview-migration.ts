import { agentTokensMigration } from "./agent-tokens-migration.js";
import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";

/**
 * Guided career interview sessions (#1030, #2175): each session as the JSON the application parsed,
 * with the columns its queries need. Turns are candidate material, so erasing a record removes its
 * sessions and erasing an organisation removes all of them: the two erasure functions are
 * redefined from version 25's with the table added.
 */
const table = `
    CREATE TABLE career_interview_sessions (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      id TEXT NOT NULL CHECK (id ~ '^cis_[A-Za-z0-9_-]{8,64}$'),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      status TEXT NOT NULL CHECK (status IN ('open', 'paused', 'closed')),
      session JSONB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX career_interview_sessions_workspace
      ON career_interview_sessions (tenant_id, workspace_id, created_at DESC);
    ALTER TABLE career_interview_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE career_interview_sessions FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON career_interview_sessions
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(agentTokensMigration.sql, "erase_candidate_record"),
  "            ['agent_tokens', 'workspace_id = $2'],",
  ["            ['career_interview_sessions', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(agentTokensMigration.sql, "erase_tenant_remainder"),
  "            'agent_tokens',",
  ["            'career_interview_sessions',"],
);

export const careerInterviewMigration: PostgresMigration = {
  version: 26,
  name: "career interview sessions",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
