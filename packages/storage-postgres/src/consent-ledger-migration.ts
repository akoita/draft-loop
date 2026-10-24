import type { PostgresMigration } from "./migrations.js";

/**
 * Each candidate record's consent ledger (ADR 0011, D7), append-only.
 *
 * - `workspace_id` is the workspace's record id. It has no foreign key to `workspaces`: consent
 *   comes before material, and the history row is written only when a workspace first stores
 *   some, as with `workspace_settings`.
 * - The runtime role may only read and insert (`consentLedgerGrant`), and a trigger refuses every
 *   update. Deleting stays with the owning role, for a later erasure of a tenant's data.
 * - The recording member is kept as an id without a foreign key, so removing the member leaves
 *   the history whole.
 */
export const consentLedgerMigration: PostgresMigration = {
  version: 15,
  name: "consent ledger",
  sql: `
    CREATE TABLE consent_events (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      sequence BIGSERIAL NOT NULL,
      id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      kind TEXT NOT NULL CHECK (kind IN ('material-storage', 'provider-transmission')),
      action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
      basis TEXT NOT NULL CHECK (
        (kind = 'material-storage'
          AND basis IN ('candidate-consent', 'contract', 'legitimate-interest'))
        OR (kind = 'provider-transmission' AND basis = 'candidate-consent')
      ),
      recorded_by TEXT NOT NULL CHECK (recorded_by IN ('owner', 'member')),
      recorded_by_member_id TEXT CHECK (length(recorded_by_member_id) BETWEEN 1 AND 128),
      providers TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(providers) <= 8),
      note TEXT CHECK (length(note) BETWEEN 1 AND 500),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CHECK ((recorded_by = 'member') = (recorded_by_member_id IS NOT NULL)),
      CHECK (
        (kind = 'provider-transmission' AND action = 'granted') = (cardinality(providers) > 0)
      )
    );
    CREATE INDEX consent_events_workspace ON consent_events (tenant_id, workspace_id, sequence);
    CREATE TRIGGER consent_events_immutable BEFORE UPDATE ON consent_events
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    ALTER TABLE consent_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE consent_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON consent_events
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
  `,
};

/** Leaves the runtime role reading and appending to the ledger, never changing or deleting it. */
export function consentLedgerGrant(schema: string, role: string): string {
  return `REVOKE UPDATE, DELETE, TRUNCATE ON ${schema}.consent_events FROM ${role}`;
}
