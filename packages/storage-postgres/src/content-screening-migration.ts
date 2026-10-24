import type { PostgresMigration } from "./migrations.js";

/**
 * Stored content-screening results and the releases that lift their quarantine (ADR 0011, phase
 * 2d). Both tables are append-only: the immutability trigger refuses every update and delete
 * except the erasure functions' (`contentScreeningGrants` also takes the privileges from the
 * runtime role).
 *
 * - `content_screening_results` holds one row per screening, content-free: closed signal codes
 *   and screener identity, never a quote of the text. A subject is a job source
 *   (`workspace_id`, `brief_id`, `brief_source_id`) or one knowledge source version
 *   (`knowledge_base_id`, `source_id`, `source_version_id`); the other columns are null. The
 *   job source's workspace is the history id, as the brief tables use, and the brief need not be
 *   saved yet. The knowledge columns reference the base, source and version, so a result cannot
 *   name a version of another source. The highest `sequence` of a subject is its latest result.
 * - `content_screening_releases` holds at most one member's release per result. The reason is a
 *   member-written note of at most 500 characters, not candidate material.
 * - Quarantine is not stored: a subject is quarantined while its latest result is flagged or
 *   unscreened and no release covers it.
 * - Erasing a record and erasing an organisation remove both tables' rows. `CREATE OR REPLACE`
 *   redefines the two functions of versions 17 and 18 with the new tables first, since a result
 *   references the rows that the functions delete after it. Their ownership, search path and
 *   grants carry over.
 */
export const contentScreeningMigration: PostgresMigration = {
  version: 20,
  name: "content screening results and releases",
  sql: `
    CREATE TABLE content_screening_results (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      sequence BIGSERIAL NOT NULL,
      id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('job-source', 'knowledge-source-version')),
      workspace_id TEXT CHECK (length(workspace_id) BETWEEN 1 AND 256),
      brief_id TEXT CHECK (length(brief_id) BETWEEN 1 AND 256),
      brief_source_id TEXT CHECK (length(brief_source_id) BETWEEN 1 AND 256),
      knowledge_base_id TEXT CHECK (length(knowledge_base_id) BETWEEN 1 AND 256),
      source_id TEXT CHECK (length(source_id) BETWEEN 1 AND 256),
      source_version_id TEXT CHECK (length(source_version_id) BETWEEN 1 AND 256),
      verdict TEXT NOT NULL CHECK (verdict IN ('clear', 'flagged', 'unscreened')),
      signals TEXT[] NOT NULL DEFAULT '{}' CHECK (
        cardinality(signals) <= 5
        AND signals <@ ARRAY['exfiltration-link', 'hidden-text', 'instruction-override',
          'role-change', 'screener-unavailable']
      ),
      screeners JSONB NOT NULL CHECK (jsonb_typeof(screeners) = 'array'),
      screened_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CHECK (
        (subject_kind = 'job-source'
          AND workspace_id IS NOT NULL AND brief_id IS NOT NULL AND brief_source_id IS NOT NULL
          AND knowledge_base_id IS NULL AND source_id IS NULL AND source_version_id IS NULL)
        OR (subject_kind = 'knowledge-source-version'
          AND knowledge_base_id IS NOT NULL AND source_id IS NOT NULL
          AND source_version_id IS NOT NULL
          AND workspace_id IS NULL AND brief_id IS NULL AND brief_source_id IS NULL)
      ),
      CONSTRAINT content_screening_results_source FOREIGN KEY
        (tenant_id, source_id, knowledge_base_id)
        REFERENCES candidate_knowledge_sources (tenant_id, id, candidate_knowledge_base_id),
      CONSTRAINT content_screening_results_source_version FOREIGN KEY
        (tenant_id, source_version_id, source_id)
        REFERENCES candidate_knowledge_source_versions (tenant_id, id, source_id)
    );
    CREATE INDEX content_screening_results_job_source
      ON content_screening_results (tenant_id, workspace_id, brief_id, brief_source_id, sequence)
      WHERE subject_kind = 'job-source';
    CREATE INDEX content_screening_results_knowledge_source
      ON content_screening_results
        (tenant_id, knowledge_base_id, source_id, source_version_id, sequence)
      WHERE subject_kind = 'knowledge-source-version';

    CREATE TABLE content_screening_releases (
      tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
        CHECK (tenant_id <> ''),
      result_id TEXT NOT NULL,
      member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 1 AND 128),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
      released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, result_id),
      FOREIGN KEY (tenant_id, result_id) REFERENCES content_screening_results (tenant_id, id)
    );

    DO $migration$
    DECLARE
      table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY['content_screening_results', 'content_screening_releases']
      LOOP
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I '
          'FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',
          table_name || '_immutable', table_name
        );
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
      -- Children before parents; $1 tenant, $2 record id, $3 history id, $4 owned bases, $5 runs.
      EXECUTE format($template$
        CREATE OR REPLACE FUNCTION %1$I.erase_candidate_record(record_id TEXT) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = %1$I, pg_temp
        AS $function$
        DECLARE
          prior_erasure TEXT := current_setting('draft_loop.erasure', true);
          tenant TEXT := current_setting('draft_loop.tenant_id', true);
          history_id TEXT;
          bases TEXT[];
          run_ids TEXT[];
          locations TEXT[];
          step TEXT[];
          removed BIGINT := 0;
          affected BIGINT;
        BEGIN
          PERFORM set_config('draft_loop.erasure', 'on', true);
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
            ['content_screening_releases',
              'result_id IN (SELECT id FROM content_screening_results WHERE tenant_id = $1 '
              'AND (workspace_id = $3 OR knowledge_base_id = ANY($4)))'],
            ['content_screening_results', '(workspace_id = $3 OR knowledge_base_id = ANY($4))'],
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
          PERFORM set_config('draft_loop.erasure', coalesce(prior_erasure, ''), true);
          RETURN jsonb_build_object('rowsRemoved', removed, 'blobLocations', to_jsonb(locations));
        END;
        $function$
      $template$, current_schema());

      EXECUTE format($template$
        CREATE OR REPLACE FUNCTION %1$I.erase_tenant_remainder() RETURNS BIGINT
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
    END
    $migration$;
  `,
};

/** Leaves the runtime role reading and appending screening rows, never changing or deleting them. */
export function contentScreeningGrants(schema: string, role: string): readonly string[] {
  return [
    `REVOKE UPDATE, DELETE, TRUNCATE ON ${schema}.content_screening_results FROM ${role}`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON ${schema}.content_screening_releases FROM ${role}`,
  ];
}
