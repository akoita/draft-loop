import type { PostgresMigration } from "./migrations.js";

/**
 * The candidate record that owns each knowledge base (ADR 0011, D6). The record id is the
 * workspace's API id, with no foreign key: its `workspaces` history row is written only when the
 * workspace first stores material, so the API checks the workspace exists. The base key carries
 * the tenant, so an owner never reaches across tenants, and deleting the base deletes its owner.
 */
export const knowledgeBaseOwnersMigration: PostgresMigration = {
  version: 16,
  name: "knowledge base owners",
  sql: `
    CREATE TABLE knowledge_base_owners (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      knowledge_base_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, knowledge_base_id),
      CONSTRAINT knowledge_base_owners_base FOREIGN KEY (tenant_id, knowledge_base_id)
        REFERENCES candidate_knowledge_bases (tenant_id, id) ON DELETE CASCADE
    );
    CREATE INDEX knowledge_base_owners_by_workspace
      ON knowledge_base_owners (tenant_id, workspace_id);
    ALTER TABLE knowledge_base_owners ENABLE ROW LEVEL SECURITY;
    ALTER TABLE knowledge_base_owners FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON knowledge_base_owners
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
  `,
};
