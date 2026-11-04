import { erasureDefinition, withErasureSteps } from "./erasure-redefinition.js";
import type { PostgresMigration } from "./migrations.js";
import { sourceEvidenceKindsMigration } from "./source-evidence-kinds-migration.js";

/**
 * Agent tokens (#2147, #2158): credentials a coding agent holds instead of the owner token, each
 * reaching only one workspace's work journal. Only a SHA-256 hash of the secret is kept, unique
 * across tenants so a presented token finds exactly one row. Erasing a record removes its tokens,
 * and erasing an organisation removes all of them: the two erasure functions are redefined from
 * version 24's with the table added.
 */
const table = `
    CREATE TABLE agent_tokens (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      id TEXT NOT NULL CHECK (id ~ '^dlat_[A-Za-z0-9_-]{8,64}$'),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
      secret_hash TEXT NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX agent_tokens_workspace ON agent_tokens (tenant_id, workspace_id, created_at DESC);
    ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_tokens FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON agent_tokens
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
`;

const recordErasure = withErasureSteps(
  erasureDefinition(sourceEvidenceKindsMigration.sql, "erase_candidate_record"),
  "            ['work_journal_intake', 'workspace_id = $2'],",
  ["            ['agent_tokens', 'workspace_id = $2'],"],
);

const tenantErasure = withErasureSteps(
  erasureDefinition(sourceEvidenceKindsMigration.sql, "erase_tenant_remainder"),
  "            'work_journal_intake',",
  ["            'agent_tokens',"],
);

export const agentTokensMigration: PostgresMigration = {
  version: 25,
  name: "agent tokens",
  sql: `${table}
    DO $migration$
    BEGIN
      ${recordErasure}

      ${tenantErasure}
    END
    $migration$;
  `,
};
