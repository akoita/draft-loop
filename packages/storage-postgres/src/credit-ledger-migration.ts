import type { PostgresMigration } from "./migrations.js";

/**
 * The credit ledger (ADR 0011, D13): what an organisation may spend on runs and what it has.
 *
 * - `credit_ledger` is append-only and holds whole credits. `amount` is always positive and
 *   `kind` gives the direction, so a balance is a sum by kind and no row needs a sign:
 *   - `grant` adds credits to a bucket: `allowance` (the plan's credits for one period, with its
 *     `period_start`, expiring when the period ends) or `grant` (an operator grant with a
 *     content-free `reason` code, expiring 12 months after it is made).
 *   - `reserve` holds credits for a run, `settle` spends them, `refund` returns them, and
 *     `expire` forfeits what remains of a grant after its expiry. A reservation writes one
 *     `reserve` row per grant row that it draws on, naming it in `grant_sequence`, so a refund
 *     returns each credit to the grant it came from. `grant_sequence` is null only for the
 *     unlimited internal plan, which has no allowance grants but still records its reservations.
 *   - For each grant row, amount = available + held + spent + expired, where available is
 *     amount - reserved + refunded - expired, held is reserved - settled - refunded and spent is
 *     settled. A refund into a grant that has already expired is followed by an `expire` row
 *     for the same credits, so expired credits never come back.
 * - `credit_balances` holds one row per organisation. Every mutating operation locks it with
 *   `SELECT ... FOR UPDATE` first, which serialises reservations, settlements, refunds, grants
 *   and the period roll per organisation. It holds no amounts: the ledger is the only source of
 *   truth, and a balance is computed from it.
 * - Unique indexes back the lock: one allowance grant per organisation and period start, one
 *   `reserve` row per run and grant, and one `settle` or `refund` row per reserved row.
 * - Rows are content-free: ids, codes, numbers and dates. The immutability trigger refuses every
 *   update and delete except the erasure function's, and `creditLedgerGrants` also takes the
 *   privileges from the runtime role.
 * - Erasing an organisation removes both tables' rows. `CREATE OR REPLACE` redefines version
 *   21's `erase_tenant_remainder` with the two tables added before the directory rows that they
 *   reference; ownership, search path and grants carry over.
 */
export const creditLedgerMigration: PostgresMigration = {
  version: 22,
  name: "credit ledger",
  sql: `
    CREATE TABLE credit_balances (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        REFERENCES organisations (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id)
    );

    CREATE TABLE credit_ledger (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        REFERENCES organisations (id),
      sequence BIGSERIAL NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('grant', 'reserve', 'settle', 'refund', 'expire')),
      amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 1000000000000),
      bucket TEXT NOT NULL CHECK (bucket IN ('allowance', 'grant')),
      run_id TEXT CHECK (length(run_id) BETWEEN 1 AND 256),
      grant_sequence BIGINT,
      estimate_version INTEGER CHECK (estimate_version >= 1),
      expires_at TIMESTAMPTZ,
      period_start DATE,
      reason TEXT CHECK (reason ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, sequence),
      FOREIGN KEY (tenant_id, grant_sequence) REFERENCES credit_ledger (tenant_id, sequence),
      CHECK ((kind = 'grant') = (expires_at IS NOT NULL)),
      CHECK ((kind IN ('reserve', 'settle', 'refund')) = (run_id IS NOT NULL)),
      CHECK ((kind = 'reserve') = (estimate_version IS NOT NULL)),
      CHECK (kind <> 'grant' OR grant_sequence IS NULL),
      CHECK (kind <> 'expire' OR grant_sequence IS NOT NULL),
      CHECK (bucket = 'allowance' OR kind = 'grant' OR grant_sequence IS NOT NULL),
      CHECK (bucket = 'allowance' OR period_start IS NULL),
      CHECK (kind <> 'grant' OR (bucket = 'allowance') = (period_start IS NOT NULL)),
      CHECK ((kind = 'grant' AND bucket = 'grant') = (reason IS NOT NULL))
    );
    CREATE UNIQUE INDEX credit_ledger_allowance_period ON credit_ledger (tenant_id, period_start)
      WHERE kind = 'grant' AND bucket = 'allowance';
    CREATE UNIQUE INDEX credit_ledger_reserved_once ON credit_ledger
      (tenant_id, run_id, (COALESCE(grant_sequence, 0))) WHERE kind = 'reserve';
    CREATE UNIQUE INDEX credit_ledger_closed_once ON credit_ledger
      (tenant_id, run_id, (COALESCE(grant_sequence, 0))) WHERE kind IN ('settle', 'refund');
    CREATE INDEX credit_ledger_grant ON credit_ledger (tenant_id, grant_sequence)
      WHERE grant_sequence IS NOT NULL;
    CREATE INDEX credit_ledger_run ON credit_ledger (tenant_id, run_id) WHERE run_id IS NOT NULL;
    CREATE INDEX credit_ledger_reserved_at ON credit_ledger (tenant_id, created_at)
      WHERE kind = 'reserve';
    CREATE TRIGGER credit_ledger_immutable BEFORE UPDATE OR DELETE ON credit_ledger
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

    DO $migration$
    DECLARE
      table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY['credit_balances', 'credit_ledger']
      LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I '
          'USING (tenant_id = current_setting(''draft_loop.tenant_id'', true)) '
          'WITH CHECK (tenant_id = current_setting(''draft_loop.tenant_id'', true))',
          table_name
        );
      END LOOP;
    END
    $migration$;

    DO $migration$
    BEGIN
      EXECUTE format($template$
        CREATE OR REPLACE FUNCTION %1$I.erase_tenant_remainder() RETURNS BIGINT
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = %1$I, pg_temp SET draft_loop.erasure = 'on'
        AS $function$
        DECLARE
          tenant TEXT := current_setting('draft_loop.tenant_id', true);
          target TEXT;
          removed BIGINT := 0;
          affected BIGINT;
        BEGIN
          IF coalesce(tenant, '') = '' THEN
            RAISE EXCEPTION 'An erasure needs the transaction''s tenant';
          END IF;
          FOREACH target IN ARRAY ARRAY[
            'content_screening_releases',
            'content_screening_results',
            'candidate_knowledge_vector_chunks',
            'candidate_knowledge_vector_indexes',
            'candidate_knowledge_lexical_chunks',
            'candidate_knowledge_lexical_indexes',
            'candidate_knowledge_managed_source_versions',
            'candidate_knowledge_source_versions',
            'candidate_knowledge_sources',
            'candidate_knowledge_source_sensitivity_rule_versions',
            'knowledge_base_owners',
            'candidate_knowledge_bases',
            'candidate_knowledge_stores',
            'findings',
            'decisions',
            'exports',
            'executions',
            'rounds',
            'run_snapshots',
            'runs',
            'application_run_bindings',
            'application_brief_bindings',
            'application_model_profiles',
            'application_archives',
            'application_chosen_runs',
            'default_application_names',
            'applications',
            'opportunity_brief_versions',
            'canonical_candidate_profile_versions',
            'writing_policy_versions',
            'candidate_knowledge_retrieval_traces',
            'artifact_versions',
            'context_snapshots',
            'audit_events',
            'workspaces',
            'run_state_entries',
            'consent_events',
            'credit_ledger',
            'credit_balances',
            'organisation_plan_history',
            'organisation_plans',
            'workspace_settings',
            'candidate_record_assignments',
            'idempotency_keys',
            'candidate_record_erasures',
            'organisation_members'
          ] LOOP
            EXECUTE format('DELETE FROM %%I.%%I WHERE tenant_id = $1', %1$L, target) USING tenant;
            GET DIAGNOSTICS affected = ROW_COUNT;
            removed := removed + affected;
          END LOOP;
          DELETE FROM %1$I.organisations WHERE id = tenant;
          GET DIAGNOSTICS affected = ROW_COUNT;
          RETURN removed + affected;
        END;
        $function$
      $template$, current_schema());
    END
    $migration$;
  `,
};

/** Leaves the runtime role reading and appending to the ledger, never changing or deleting it. */
export function creditLedgerGrants(schema: string, role: string): readonly string[] {
  return [`REVOKE UPDATE, DELETE, TRUNCATE ON ${schema}.credit_ledger FROM ${role}`];
}
