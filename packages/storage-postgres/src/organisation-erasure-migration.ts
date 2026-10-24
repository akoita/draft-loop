import type { PostgresMigration } from "./migrations.js";

/**
 * Erasing a whole organisation (ADR 0011, D7): after each candidate record is erased as one,
 * `erase_tenant_remainder` removes every row the tenant still has, tenant-wide knowledge bases,
 * idempotency keys and the directory rows last. It is `SECURITY DEFINER`, owned by the migrating
 * role, with a fixed search path, and like `erase_candidate_record` it passes the immutability
 * trigger only while it runs. Every statement names the tenant, since the owning role's sign-in
 * policy reaches every organisation's members.
 */
export const organisationErasureMigration: PostgresMigration = {
  version: 18,
  name: "organisation erasure",
  sql: `
    DO $migration$
    BEGIN
      EXECUTE format($template$
        CREATE FUNCTION %1$I.erase_tenant_remainder() RETURNS BIGINT
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = %1$I, pg_temp
        AS $function$
        DECLARE
          prior_erasure TEXT := current_setting('draft_loop.erasure', true);
          tenant TEXT := current_setting('draft_loop.tenant_id', true);
          target TEXT;
          removed BIGINT := 0;
          affected BIGINT;
        BEGIN
          PERFORM set_config('draft_loop.erasure', 'on', true);
          IF coalesce(tenant, '') = '' THEN
            RAISE EXCEPTION 'An erasure needs the transaction''s tenant';
          END IF;
          FOREACH target IN ARRAY ARRAY[
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
          PERFORM set_config('draft_loop.erasure', coalesce(prior_erasure, ''), true);
          RETURN removed + affected;
        END;
        $function$
      $template$, current_schema());

      EXECUTE format(
        'REVOKE ALL ON FUNCTION %I.erase_tenant_remainder() FROM PUBLIC',
        current_schema()
      );
    END
    $migration$;
  `,
};

/** Lets the runtime role erase what a tenant has left through the function, and nothing more. */
export function organisationErasureGrant(schema: string, role: string): string {
  return `GRANT EXECUTE ON FUNCTION ${schema}.erase_tenant_remainder() TO ${role}`;
}
