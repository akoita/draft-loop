import type { PostgresMigration } from "./migrations.js";

/**
 * Erasing a candidate record (ADR 0011, D7), the one way rows of the append-only consent ledger
 * and the audit chain are deleted.
 *
 * - `candidate_record_erasures` marks a record as erasing. The runtime role may insert and read a
 *   mark but never change or delete one, so a closed record never reopens.
 * - `erase_candidate_record` removes every row of a closed record in the transaction's tenant, its
 *   mark last. It is `SECURITY DEFINER`, owned by the migrating role, with a fixed search path,
 *   and it is the only delete the runtime role may make on `consent_events` and `audit_events`.
 * - The immutability trigger now lets a delete through only while that function runs: as its
 *   owning role, with the transaction-local `draft_loop.erasure` the function sets. Any other
 *   role, or the owner outside the function, is still refused.
 * - A record is the workspace's API id; its history rows carry the history id that its
 *   `workspace.json` setting holds, and its consent ledger is keyed by that history id.
 */
export const recordErasureMigration: PostgresMigration = {
  version: 17,
  name: "candidate record erasure",
  sql: `
    CREATE TABLE candidate_record_erasures (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 256),
      closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, workspace_id)
    );
    ALTER TABLE candidate_record_erasures ENABLE ROW LEVEL SECURITY;
    ALTER TABLE candidate_record_erasures FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON candidate_record_erasures
      USING (tenant_id = current_setting('draft_loop.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));

    CREATE TRIGGER candidate_record_erasures_immutable
      BEFORE UPDATE OR DELETE ON candidate_record_erasures
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    CREATE TRIGGER audit_events_undeletable BEFORE DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    CREATE TRIGGER consent_events_undeletable BEFORE DELETE ON consent_events
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

    DO $migration$
    BEGIN
      EXECUTE format($template$
        CREATE OR REPLACE FUNCTION %1$I.reject_immutable_change() RETURNS trigger
        LANGUAGE plpgsql AS $function$
        BEGIN
          IF TG_OP = 'DELETE' AND current_user = %2$L
            AND current_setting('draft_loop.erasure', true) = 'on' THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION '%% rows are immutable', TG_TABLE_NAME;
        END;
        $function$
      $template$, current_schema(), current_user);

      -- The history id the record's configuration names, or null without a readable one.
      EXECUTE format($template$
        CREATE FUNCTION %1$I.candidate_record_history_id(record_id TEXT) RETURNS TEXT
        LANGUAGE plpgsql STABLE SET search_path = %1$I, pg_temp
        AS $function$
        DECLARE
          tenant TEXT := current_setting('draft_loop.tenant_id', true);
          configuration TEXT;
        BEGIN
          SELECT s.content INTO configuration FROM %1$I.workspace_settings s
            WHERE s.tenant_id = tenant AND s.name = 'workspace.json'
              AND s.workspace_ref = '/tenants/' || tenant || '/workspaces/' || record_id;
          RETURN configuration::jsonb ->> 'id';
        EXCEPTION WHEN invalid_text_representation THEN
          RETURN NULL;
        END;
        $function$
      $template$, current_schema());

      -- Every blob location the record's rows name: its owned bases' source versions and its
      -- exports, as the rows hold them.
      EXECUTE format($template$
        CREATE FUNCTION %1$I.candidate_record_blob_locations(record_id TEXT) RETURNS SETOF TEXT
        LANGUAGE sql STABLE SET search_path = %1$I, pg_temp
        AS $function$
          SELECT m.blob_location FROM %1$I.candidate_knowledge_managed_source_versions m
            JOIN %1$I.candidate_knowledge_sources s
              ON s.tenant_id = m.tenant_id AND s.id = m.source_id
            JOIN %1$I.knowledge_base_owners o
              ON o.tenant_id = s.tenant_id AND o.knowledge_base_id = s.candidate_knowledge_base_id
            WHERE m.tenant_id = current_setting('draft_loop.tenant_id', true)
              AND o.workspace_id = record_id
          UNION
          SELECT e.output_path FROM %1$I.exports e
            WHERE e.tenant_id = current_setting('draft_loop.tenant_id', true)
              AND e.workspace_id = %1$I.candidate_record_history_id(record_id)
              AND e.output_path IS NOT NULL
          ORDER BY 1
        $function$
      $template$, current_schema());

      -- Children before parents; $1 tenant, $2 record id, $3 history id, $4 owned bases, $5 runs.
      EXECUTE format($template$
        CREATE FUNCTION %1$I.erase_candidate_record(record_id TEXT) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = %1$I, pg_temp SET draft_loop.erasure = 'on'
        AS $function$
        DECLARE
          tenant TEXT := current_setting('draft_loop.tenant_id', true);
          history_id TEXT;
          bases TEXT[];
          run_ids TEXT[];
          locations TEXT[];
          step TEXT[];
          removed BIGINT := 0;
          affected BIGINT;
        BEGIN
          IF coalesce(tenant, '') = '' THEN
            RAISE EXCEPTION 'An erasure needs the transaction''s tenant';
          END IF;
          PERFORM 1 FROM %1$I.candidate_record_erasures e
            WHERE e.tenant_id = tenant AND e.workspace_id = record_id FOR UPDATE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'The candidate record is not closed for erasure'
              USING ERRCODE = 'object_not_in_prerequisite_state';
          END IF;
          history_id := %1$I.candidate_record_history_id(record_id);
          locations := ARRAY(SELECT %1$I.candidate_record_blob_locations(record_id));
          bases := ARRAY(SELECT o.knowledge_base_id FROM %1$I.knowledge_base_owners o
            WHERE o.tenant_id = tenant AND o.workspace_id = record_id);
          run_ids := ARRAY(
            SELECT r.id FROM %1$I.runs r WHERE r.tenant_id = tenant AND r.workspace_id = history_id
            UNION
            SELECT s.run_id FROM %1$I.run_snapshots s
              WHERE s.tenant_id = tenant AND s.workspace_id = history_id
          );
          FOREACH step SLICE 1 IN ARRAY ARRAY[
            ['candidate_knowledge_vector_chunks', 'knowledge_base_id = ANY($4)'],
            ['candidate_knowledge_vector_indexes', 'knowledge_base_id = ANY($4)'],
            ['candidate_knowledge_lexical_chunks', 'knowledge_base_id = ANY($4)'],
            ['candidate_knowledge_lexical_indexes', 'knowledge_base_id = ANY($4)'],
            ['candidate_knowledge_managed_source_versions',
              'source_id IN (SELECT id FROM candidate_knowledge_sources '
              'WHERE tenant_id = $1 AND candidate_knowledge_base_id = ANY($4))'],
            ['candidate_knowledge_source_versions',
              'source_id IN (SELECT id FROM candidate_knowledge_sources '
              'WHERE tenant_id = $1 AND candidate_knowledge_base_id = ANY($4))'],
            ['candidate_knowledge_sources', 'candidate_knowledge_base_id = ANY($4)'],
            ['candidate_knowledge_source_sensitivity_rule_versions', 'knowledge_base_id = ANY($4)'],
            ['knowledge_base_owners', 'knowledge_base_id = ANY($4)'],
            ['candidate_knowledge_bases', 'id = ANY($4)'],
            ['findings', 'workspace_id = $3'],
            ['decisions', 'workspace_id = $3'],
            ['exports', 'workspace_id = $3'],
            ['executions', 'workspace_id = $3'],
            ['rounds', 'workspace_id = $3'],
            ['run_snapshots', 'workspace_id = $3'],
            ['runs', 'workspace_id = $3'],
            ['application_run_bindings', 'workspace_id = $3'],
            ['application_brief_bindings', 'workspace_id = $3'],
            ['application_model_profiles', 'workspace_id = $3'],
            ['application_archives', 'workspace_id = $3'],
            ['application_chosen_runs', 'workspace_id = $3'],
            ['default_application_names', 'workspace_id = $3'],
            ['applications', 'workspace_id = $3'],
            ['opportunity_brief_versions', 'workspace_id = $3'],
            ['canonical_candidate_profile_versions', 'workspace_id = $3'],
            ['writing_policy_versions', 'workspace_id = $3'],
            ['candidate_knowledge_retrieval_traces', 'workspace_id = $3'],
            ['artifact_versions', 'workspace_id = $3'],
            ['context_snapshots', 'workspace_id = $3'],
            ['audit_events', 'workspace_id = $3'],
            ['workspaces', 'id = $3'],
            ['run_state_entries',
              'starts_with(key, ''draft-loop:orchestration:'') AND split_part(key, '':'', 4) = ANY($5)'],
            ['consent_events', 'workspace_id = $3'],
            ['workspace_settings',
              '(workspace_ref = ''/tenants/'' || $1 || ''/workspaces/'' || $2 OR '
              'starts_with(workspace_ref, ''/tenants/'' || $1 || ''/workspaces/'' || $2 || ''/''))'],
            ['candidate_record_assignments', 'workspace_id = $2'],
            ['idempotency_keys', 'split_part(scope, '':'', 2) = $2'],
            ['candidate_record_erasures', 'workspace_id = $2']
          ] LOOP
            EXECUTE format('DELETE FROM %%I.%%I WHERE tenant_id = $1 AND %%s', %1$L, step[1], step[2])
              USING tenant, record_id, history_id, bases, run_ids;
            GET DIAGNOSTICS affected = ROW_COUNT;
            removed := removed + affected;
          END LOOP;
          RETURN jsonb_build_object('rowsRemoved', removed, 'blobLocations', to_jsonb(locations));
        END;
        $function$
      $template$, current_schema());

      EXECUTE format(
        'REVOKE ALL ON FUNCTION %I.erase_candidate_record(TEXT) FROM PUBLIC',
        current_schema()
      );
    END
    $migration$;
  `,
};

/**
 * Lets the runtime role close records and erase closed ones through the function, and never
 * change a mark or delete ledger and audit rows itself.
 */
export function recordErasureGrants(schema: string, role: string): readonly string[] {
  return [
    `GRANT EXECUTE ON FUNCTION ${schema}.erase_candidate_record(TEXT) TO ${role}`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON ${schema}.candidate_record_erasures FROM ${role}`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON ${schema}.audit_events FROM ${role}`,
  ];
}
