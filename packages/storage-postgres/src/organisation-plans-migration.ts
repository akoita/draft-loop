import type { PostgresMigration } from "./migrations.js";

/**
 * Each organisation's plan assignment (ADR 0011, D13) and the history of every assignment.
 *
 * - `organisation_plans` holds the current assignment, one row per organisation. It is keyed by
 *   the tenant id, which is the organisation id as in the tenant directory, so a tenant can only
 *   ever see and change its own row, and the row references the organisation. The operator
 *   assigns on behalf of an organisation by opening that organisation's tenant.
 * - `organisation_plan_history` appends a row for every assignment, the current one included.
 *   The immutability trigger refuses every update and delete except the erasure function's
 *   (`organisationPlanGrants` also takes the privileges from the runtime role).
 * - Both tables are content-free: plan ids, the catalog version, entitlement overrides, seats and
 *   dates. Plans are data, so the database does not enumerate plan ids; the store validates the
 *   plan id and the overrides against the entitlement schemas on write and read.
 * - `period_start` is the UTC date the current credit period began, which the credit ledger
 *   (next migration) measures expiry from.
 * - Erasing an organisation removes both tables' rows. `CREATE OR REPLACE` redefines version 20's
 *   `erase_tenant_remainder` with the two tables added; ownership, search path and grants carry
 *   over. The tables come before the directory rows that they reference.
 */
export const organisationPlansMigration: PostgresMigration = {
  version: 21,
  name: "organisation plan assignments",
  sql: `
    CREATE TABLE organisation_plans (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        REFERENCES organisations (id),
      plan_id TEXT NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 64),
      catalog_version INTEGER NOT NULL CHECK (catalog_version >= 1),
      overrides JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(overrides) = 'object'),
      seats INTEGER CHECK (seats >= 1),
      period_start DATE NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id)
    );

    CREATE TABLE organisation_plan_history (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        REFERENCES organisations (id),
      sequence BIGSERIAL NOT NULL,
      plan_id TEXT NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 64),
      catalog_version INTEGER NOT NULL CHECK (catalog_version >= 1),
      overrides JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(overrides) = 'object'),
      seats INTEGER CHECK (seats >= 1),
      period_start DATE NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, sequence)
    );
    CREATE TRIGGER organisation_plan_history_immutable BEFORE UPDATE OR DELETE
      ON organisation_plan_history
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

    DO $migration$
    DECLARE
      table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY['organisation_plans', 'organisation_plan_history']
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

/** Leaves the runtime role reading and appending plan history, never changing or deleting it. */
export function organisationPlanGrants(schema: string, role: string): readonly string[] {
  return [`REVOKE UPDATE, DELETE, TRUNCATE ON ${schema}.organisation_plan_history FROM ${role}`];
}
