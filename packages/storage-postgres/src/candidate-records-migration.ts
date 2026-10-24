import type { PostgresMigration } from "./migrations.js";

/**
 * Members assigned to candidate records (ADR 0011, D6). A candidate record is a workspace in the
 * tenant, named by the id the API uses for it. That id has no row of its own until the workspace
 * stores material, so the record id has no foreign key; the API checks the workspace exists.
 * Both keys carry the tenant, so an assignment never reaches across tenants, and removing the
 * member deletes their assignments.
 */
export const candidateRecordsMigration: PostgresMigration = {
  version: 14,
  name: "candidate record assignments",
  sql: `
    CREATE TABLE candidate_record_assignments (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      workspace_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, workspace_id, member_id),
      CONSTRAINT candidate_record_assignments_member FOREIGN KEY (tenant_id, member_id)
        REFERENCES organisation_members (tenant_id, id) ON DELETE CASCADE
    );
    CREATE INDEX candidate_record_assignments_by_member
      ON candidate_record_assignments (tenant_id, member_id);
    ALTER TABLE candidate_record_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE candidate_record_assignments FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON candidate_record_assignments
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
  `,
};
