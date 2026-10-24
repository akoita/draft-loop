import { candidateRecordsMigration } from "./candidate-records-migration.js";
import { consentLedgerMigration } from "./consent-ledger-migration.js";
import { knowledgeBaseOwnersMigration } from "./knowledge-base-owners-migration.js";
import { organisationErasureMigration } from "./organisation-erasure-migration.js";
import { recordErasureMigration } from "./record-erasure-migration.js";
import type { SqlClient } from "./sql-client.js";
import { tenantDirectoryMigration } from "./tenant-directory-migration.js";

/** One forward-only schema change. Versions are applied in order and never edited once released. */
export interface PostgresMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Text columns keep timestamps and payloads exactly as the application wrote them, so checksums
 * computed over the canonical payload text match SQLite's byte for byte.
 */
export const postgresMigrations: readonly PostgresMigration[] = [
  {
    version: 1,
    name: "workspaces, context snapshots, artifact versions and the audit trail",
    sql: `
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE context_snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_checksum TEXT NOT NULL
      );

      CREATE TABLE artifact_versions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        version INTEGER NOT NULL CHECK (version >= 1),
        parent_version_id TEXT REFERENCES artifact_versions (id),
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_checksum TEXT NOT NULL
      );

      CREATE TABLE audit_events (
        sequence BIGSERIAL PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_checksum TEXT NOT NULL,
        previous_event_checksum TEXT,
        event_checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_events_workspace_sequence ON audit_events (workspace_id, sequence);

      CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
      END;
      $$;
      CREATE TRIGGER context_snapshots_immutable BEFORE UPDATE OR DELETE ON context_snapshots
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER artifact_versions_immutable BEFORE UPDATE OR DELETE ON artifact_versions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER audit_events_immutable BEFORE UPDATE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    `,
  },
  {
    version: 2,
    name: "run history: runs, snapshots, rounds, executions, findings, decisions and exports",
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots (id),
        state TEXT NOT NULL,
        round INTEGER NOT NULL CHECK (round >= 1),
        current_step TEXT,
        budget_json TEXT NOT NULL,
        artifact_id TEXT REFERENCES artifact_versions (id),
        approval TEXT NOT NULL CHECK (approval IN ('pending', 'approved', 'rejected')),
        total_cost_usd DOUBLE PRECISION NOT NULL CHECK (total_cost_usd >= 0),
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error_json TEXT,
        payload_json TEXT NOT NULL,
        record_checksum TEXT NOT NULL,
        UNIQUE (id, workspace_id)
      );
      CREATE INDEX runs_workspace_updated ON runs (workspace_id, updated_at, id);

      CREATE TABLE run_snapshots (
        sequence BIGSERIAL PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        run_id TEXT NOT NULL,
        context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots (id),
        state TEXT NOT NULL,
        round INTEGER NOT NULL CHECK (round >= 1),
        current_step TEXT,
        budget_json TEXT NOT NULL,
        artifact_id TEXT,
        approval TEXT NOT NULL CHECK (approval IN ('pending', 'approved', 'rejected')),
        total_cost_usd DOUBLE PRECISION NOT NULL CHECK (total_cost_usd >= 0),
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error_json TEXT,
        payload_json TEXT NOT NULL,
        record_checksum TEXT NOT NULL,
        UNIQUE (run_id, record_checksum)
      );
      CREATE INDEX run_snapshots_run_sequence ON run_snapshots (run_id, sequence);

      CREATE TABLE rounds (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        run_id TEXT NOT NULL,
        number INTEGER NOT NULL CHECK (number >= 1),
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        evaluation_json TEXT,
        payload_json TEXT NOT NULL,
        record_checksum TEXT NOT NULL,
        UNIQUE (run_id, number),
        UNIQUE (id, workspace_id),
        FOREIGN KEY (run_id, workspace_id) REFERENCES runs (id, workspace_id)
      );
      CREATE INDEX rounds_run_number ON rounds (run_id, number, id);

      CREATE TABLE executions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        run_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots (id),
        artifact_id TEXT REFERENCES artifact_versions (id),
        attempt INTEGER NOT NULL CHECK (attempt >= 1),
        step TEXT NOT NULL CHECK (step IN ('author', 'critic', 'revision')),
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        provider_request_id TEXT,
        output_checksum TEXT,
        input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
        output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
        total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
        estimated_usd DOUBLE PRECISION,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        output_json TEXT,
        payload_json TEXT NOT NULL,
        record_checksum TEXT NOT NULL,
        UNIQUE (run_id, round_id, step, attempt),
        UNIQUE (id, workspace_id),
        FOREIGN KEY (run_id, workspace_id) REFERENCES runs (id, workspace_id),
        FOREIGN KEY (round_id, workspace_id) REFERENCES rounds (id, workspace_id)
      );
      CREATE INDEX executions_run_started ON executions (run_id, started_at, id);

      CREATE TABLE findings (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        run_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        execution_id TEXT,
        artifact_id TEXT REFERENCES artifact_versions (id),
        code TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('error', 'warning')),
        message TEXT NOT NULL,
        claim_id TEXT,
        section_id TEXT,
        requirement_id TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        record_checksum TEXT NOT NULL,
        FOREIGN KEY (run_id, workspace_id) REFERENCES runs (id, workspace_id),
        FOREIGN KEY (round_id, workspace_id) REFERENCES rounds (id, workspace_id),
        FOREIGN KEY (execution_id, workspace_id) REFERENCES executions (id, workspace_id)
      );
      CREATE INDEX findings_run_created ON findings (run_id, created_at, id);

      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        run_id TEXT NOT NULL,
        round_id TEXT,
        artifact_id TEXT REFERENCES artifact_versions (id),
        type TEXT NOT NULL CHECK (type IN ('edit', 'accept-finding', 'reject-finding', 'approve')),
        rationale TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        record_checksum TEXT NOT NULL,
        FOREIGN KEY (run_id, workspace_id) REFERENCES runs (id, workspace_id),
        FOREIGN KEY (round_id, workspace_id) REFERENCES rounds (id, workspace_id)
      );
      CREATE INDEX decisions_run_created ON decisions (run_id, created_at, id);

      CREATE TABLE exports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        run_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL REFERENCES artifact_versions (id),
        format TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('prepared', 'completed', 'failed')),
        output_path TEXT,
        output_checksum TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        record_checksum TEXT NOT NULL,
        FOREIGN KEY (run_id, workspace_id) REFERENCES runs (id, workspace_id)
      );
      CREATE INDEX exports_run_created ON exports (run_id, created_at, id);

      CREATE TRIGGER runs_immutable BEFORE UPDATE ON runs
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER run_snapshots_immutable BEFORE UPDATE ON run_snapshots
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER rounds_immutable BEFORE UPDATE ON rounds
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER executions_immutable BEFORE UPDATE ON executions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER findings_immutable BEFORE UPDATE ON findings
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER decisions_immutable BEFORE UPDATE ON decisions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER exports_immutable BEFORE UPDATE ON exports
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    `,
  },
  {
    version: 3,
    name: "versioned records: opportunity briefs, canonical profiles and writing policies",
    sql: `
      CREATE TABLE opportunity_brief_versions (
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        brief_id TEXT NOT NULL CHECK (length(trim(brief_id)) > 0),
        version INTEGER NOT NULL CHECK (version >= 1),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        prior_version INTEGER,
        status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed')),
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        payload_json TEXT NOT NULL,
        payload_checksum TEXT NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
        PRIMARY KEY (workspace_id, brief_id, version),
        FOREIGN KEY (workspace_id, brief_id, prior_version)
          REFERENCES opportunity_brief_versions (workspace_id, brief_id, version),
        CHECK ((version = 1 AND prior_version IS NULL) OR (version > 1 AND prior_version = version - 1)),
        CHECK ((status = 'draft' AND reviewed_at IS NULL) OR (status = 'reviewed' AND reviewed_at IS NOT NULL))
      );

      CREATE TABLE canonical_candidate_profile_versions (
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        profile_id TEXT NOT NULL CHECK (length(trim(profile_id)) > 0),
        version INTEGER NOT NULL CHECK (version >= 1),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        parent_version INTEGER,
        status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewed_at TEXT,
        payload_json TEXT NOT NULL,
        payload_checksum TEXT NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
        PRIMARY KEY (workspace_id, profile_id, version),
        FOREIGN KEY (workspace_id, profile_id, parent_version)
          REFERENCES canonical_candidate_profile_versions (workspace_id, profile_id, version),
        CHECK ((version = 1 AND parent_version IS NULL) OR (version > 1 AND parent_version = version - 1)),
        CHECK ((status = 'draft' AND reviewed_at IS NULL) OR (status = 'reviewed' AND reviewed_at IS NOT NULL))
      );

      CREATE TABLE writing_policy_versions (
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        policy_checksum TEXT NOT NULL CHECK (policy_checksum ~ '^[0-9a-f]{64}$'),
        version TEXT NOT NULL CHECK (length(trim(version)) > 0),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        created_at TEXT NOT NULL,
        prior_checksum TEXT,
        payload_json TEXT NOT NULL,
        payload_checksum TEXT NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
        PRIMARY KEY (workspace_id, policy_checksum),
        UNIQUE (workspace_id, version),
        FOREIGN KEY (workspace_id, prior_checksum)
          REFERENCES writing_policy_versions (workspace_id, policy_checksum),
        CHECK (prior_checksum IS NULL OR prior_checksum <> policy_checksum)
      );

      CREATE TRIGGER opportunity_brief_versions_immutable
        BEFORE UPDATE OR DELETE ON opportunity_brief_versions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER canonical_candidate_profile_versions_immutable
        BEFORE UPDATE OR DELETE ON canonical_candidate_profile_versions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER writing_policy_versions_immutable
        BEFORE UPDATE OR DELETE ON writing_policy_versions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    `,
  },
  {
    version: 4,
    name: "applications, their bindings, archives, model pairs, names and chosen runs",
    sql: `
      CREATE TABLE applications (
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0 AND application_id <> 'default'),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
        job_source_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, application_id)
      );

      CREATE TABLE application_run_bindings (
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL CHECK (length(trim(run_id)) > 0),
        application_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, run_id),
        FOREIGN KEY (workspace_id, application_id) REFERENCES applications (workspace_id, application_id)
      );
      CREATE INDEX application_run_bindings_application ON application_run_bindings (workspace_id, application_id);

      CREATE TABLE application_brief_bindings (
        workspace_id TEXT NOT NULL,
        brief_id TEXT NOT NULL CHECK (length(trim(brief_id)) > 0),
        application_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, brief_id),
        FOREIGN KEY (workspace_id, application_id) REFERENCES applications (workspace_id, application_id)
      );
      CREATE INDEX application_brief_bindings_application ON application_brief_bindings (workspace_id, application_id);

      CREATE TABLE application_archives (
        workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
        application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0),
        archived_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, application_id)
      );

      CREATE TABLE application_model_profiles (
        workspace_id TEXT NOT NULL,
        application_id TEXT NOT NULL,
        model_profiles_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, application_id),
        FOREIGN KEY (workspace_id, application_id) REFERENCES applications (workspace_id, application_id)
      );

      CREATE TABLE default_application_names (
        workspace_id TEXT PRIMARY KEY CHECK (length(trim(workspace_id)) > 0),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE application_chosen_runs (
        workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
        application_id TEXT NOT NULL CHECK (length(trim(application_id)) > 0),
        run_id TEXT NOT NULL CHECK (length(trim(run_id)) > 0),
        reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
        chosen_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, application_id)
      );

      CREATE TRIGGER application_run_bindings_immutable
        BEFORE UPDATE OR DELETE ON application_run_bindings
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER application_brief_bindings_immutable
        BEFORE UPDATE OR DELETE ON application_brief_bindings
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    `,
  },
  {
    version: 5,
    name: "candidate knowledge bases, sources and immutable source versions",
    sql: `
      CREATE TABLE candidate_knowledge_bases (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
        is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        CHECK (
          (state = 'active' AND archived_at IS NULL) OR
          (state = 'archived' AND archived_at IS NOT NULL)
        ),
        CHECK (is_default = 0 OR state = 'active')
      );
      CREATE UNIQUE INDEX candidate_knowledge_bases_one_default
        ON candidate_knowledge_bases (is_default) WHERE is_default = 1;

      CREATE TABLE candidate_knowledge_sources (
        id TEXT PRIMARY KEY,
        candidate_knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases (id),
        kind TEXT NOT NULL CHECK (kind IN ('file', 'url')),
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        created_at TEXT NOT NULL,
        UNIQUE (id, candidate_knowledge_base_id)
      );
      CREATE INDEX candidate_knowledge_sources_base_created
        ON candidate_knowledge_sources (candidate_knowledge_base_id, created_at, id);

      CREATE TABLE candidate_knowledge_source_versions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES candidate_knowledge_sources (id),
        version INTEGER NOT NULL CHECK (version >= 1),
        parent_version_id TEXT,
        media_type TEXT NOT NULL CHECK (length(trim(media_type)) > 0),
        checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
        created_at TEXT NOT NULL,
        UNIQUE (source_id, version),
        UNIQUE (id, source_id),
        FOREIGN KEY (parent_version_id, source_id)
          REFERENCES candidate_knowledge_source_versions (id, source_id),
        CHECK (
          (version = 1 AND parent_version_id IS NULL) OR
          (version > 1 AND parent_version_id IS NOT NULL)
        )
      );

      CREATE TRIGGER candidate_knowledge_sources_immutable
        BEFORE UPDATE OR DELETE ON candidate_knowledge_sources
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER candidate_knowledge_source_versions_immutable
        BEFORE UPDATE OR DELETE ON candidate_knowledge_source_versions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    `,
  },
  {
    version: 6,
    name: "candidate knowledge lexical index, its tokenized chunks and retrieval traces",
    sql: `
      CREATE TABLE candidate_knowledge_lexical_indexes (
        store_id TEXT NOT NULL CHECK (length(trim(store_id)) > 0),
        knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases (id),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        indexer_id TEXT NOT NULL CHECK (length(trim(indexer_id)) > 0),
        manifest_checksum TEXT NOT NULL CHECK (manifest_checksum ~ '^[0-9a-f]{64}$'),
        scope_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
        PRIMARY KEY (store_id, knowledge_base_id)
      );

      -- tokens holds the text as FTS5's unicode61 tokenizer splits it, so BM25 ranks match SQLite.
      CREATE TABLE candidate_knowledge_lexical_chunks (
        store_id TEXT NOT NULL,
        knowledge_base_id TEXT NOT NULL,
        source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
        version_id TEXT NOT NULL CHECK (length(trim(version_id)) > 0),
        chunk_id TEXT NOT NULL CHECK (length(trim(chunk_id)) > 0),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        line_start INTEGER NOT NULL CHECK (line_start >= 0),
        line_end INTEGER NOT NULL CHECK (line_end >= line_start),
        text TEXT NOT NULL CHECK (length(trim(text)) > 0),
        metadata_json TEXT NOT NULL,
        tokens TEXT[] NOT NULL,
        PRIMARY KEY (store_id, knowledge_base_id, chunk_id),
        UNIQUE (store_id, knowledge_base_id, source_id, version_id, ordinal),
        FOREIGN KEY (store_id, knowledge_base_id)
          REFERENCES candidate_knowledge_lexical_indexes (store_id, knowledge_base_id),
        FOREIGN KEY (source_id, knowledge_base_id)
          REFERENCES candidate_knowledge_sources (id, candidate_knowledge_base_id),
        FOREIGN KEY (version_id, source_id)
          REFERENCES candidate_knowledge_source_versions (id, source_id)
      );
      CREATE INDEX candidate_knowledge_lexical_chunks_tokens
        ON candidate_knowledge_lexical_chunks USING GIN (tokens);

      CREATE TABLE candidate_knowledge_retrieval_traces (
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        trace_id TEXT NOT NULL CHECK (length(trim(trace_id)) > 0),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        operation_id TEXT NOT NULL CHECK (length(trim(operation_id)) > 0),
        purpose TEXT NOT NULL CHECK (
          purpose IN (
            'opportunity-requirements',
            'achievement-recall',
            'factual-checks',
            'contradiction-detection',
            'critic-review'
          )
        ),
        query_checksum TEXT NOT NULL CHECK (query_checksum ~ '^[0-9a-f]{64}$'),
        payload_json TEXT NOT NULL,
        payload_checksum TEXT NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, trace_id)
      );
      CREATE INDEX candidate_knowledge_retrieval_traces_operation
        ON candidate_knowledge_retrieval_traces (workspace_id, operation_id, created_at, trace_id);
      CREATE TRIGGER candidate_knowledge_retrieval_traces_immutable
        BEFORE UPDATE OR DELETE ON candidate_knowledge_retrieval_traces
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    `,
  },
  {
    version: 7,
    name: "candidate knowledge vector index on pgvector",
    sql: `
      -- One extension per database, in public, so every tenant schema reaches the same type.
      CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

      -- Derived from the lexical projection: a lexical rebuild, chunk replacement or source
      -- version deletion cascades the vectors away, as on SQLite.
      CREATE TABLE candidate_knowledge_vector_indexes (
        store_id TEXT NOT NULL,
        knowledge_base_id TEXT NOT NULL,
        model_id TEXT NOT NULL CHECK (length(trim(model_id)) > 0),
        model_revision TEXT NOT NULL CHECK (length(trim(model_revision)) > 0),
        model_sha256 TEXT NOT NULL CHECK (model_sha256 ~ '^[0-9a-f]{64}$'),
        dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 4096),
        pooling TEXT NOT NULL CHECK (length(trim(pooling)) > 0),
        runtime TEXT NOT NULL CHECK (length(trim(runtime)) > 0),
        lexical_manifest_checksum TEXT NOT NULL CHECK (lexical_manifest_checksum ~ '^[0-9a-f]{64}$'),
        created_at TEXT NOT NULL,
        PRIMARY KEY (store_id, knowledge_base_id),
        FOREIGN KEY (store_id, knowledge_base_id)
          REFERENCES candidate_knowledge_lexical_indexes (store_id, knowledge_base_id)
          ON DELETE CASCADE
      );

      CREATE TABLE candidate_knowledge_vector_chunks (
        store_id TEXT NOT NULL,
        knowledge_base_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        vector public.vector NOT NULL,
        PRIMARY KEY (store_id, knowledge_base_id, chunk_id),
        FOREIGN KEY (store_id, knowledge_base_id, chunk_id)
          REFERENCES candidate_knowledge_lexical_chunks (store_id, knowledge_base_id, chunk_id)
          ON DELETE CASCADE,
        FOREIGN KEY (store_id, knowledge_base_id)
          REFERENCES candidate_knowledge_vector_indexes (store_id, knowledge_base_id)
          ON DELETE CASCADE
      );
    `,
  },
  {
    version: 8,
    name: "tenant column on every table, tenant-scoped keys and row-level security",
    sql: `
      DO $migration$
      DECLARE
        target record;
        constraint_row record;
        foreign_keys text[] := '{}';
        definition text;
      BEGIN
        -- Foreign keys reference the keys rebuilt below, so they go first and come back last.
        FOR constraint_row IN
          SELECT c.conrelid::regclass AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relnamespace = current_schema()::regnamespace AND c.contype = 'f'
        LOOP
          foreign_keys := foreign_keys || format(
            'ALTER TABLE %s ADD CONSTRAINT %I %s',
            constraint_row.table_name,
            constraint_row.conname,
            regexp_replace(
              regexp_replace(constraint_row.def, '^FOREIGN KEY \\(', 'FOREIGN KEY (tenant_id, '),
              'REFERENCES ([^(]+)\\(',
              'REFERENCES \\1(tenant_id, '
            )
          );
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', constraint_row.table_name, constraint_row.conname);
        END LOOP;

        FOR target IN
          SELECT c.oid::regclass AS table_name
          FROM pg_class c
          WHERE c.relnamespace = current_schema()::regnamespace
            AND c.relkind = 'r'
            AND c.relname <> 'schema_migrations'
        LOOP
          -- Rows take their tenant from the transaction's setting; an empty or missing one fails.
          EXECUTE format(
            'ALTER TABLE %s ADD COLUMN tenant_id TEXT NOT NULL '
            'DEFAULT current_setting(''draft_loop.tenant_id'', true) CHECK (tenant_id <> '''')',
            target.table_name
          );
          FOR constraint_row IN
            SELECT c.conname, pg_get_constraintdef(c.oid) AS def
            FROM pg_constraint c
            WHERE c.conrelid = target.table_name AND c.contype IN ('p', 'u')
          LOOP
            definition := regexp_replace(constraint_row.def, '^(PRIMARY KEY|UNIQUE) \\(', '\\1 (tenant_id, ');
            EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target.table_name, constraint_row.conname);
            EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', target.table_name, constraint_row.conname, definition);
          END LOOP;
          EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target.table_name);
          EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target.table_name);
          EXECUTE format(
            'CREATE POLICY tenant_isolation ON %s '
            'USING (tenant_id = current_setting(''draft_loop.tenant_id'', true)) '
            'WITH CHECK (tenant_id = current_setting(''draft_loop.tenant_id'', true))',
            target.table_name
          );
        END LOOP;

        FOREACH definition IN ARRAY foreign_keys LOOP
          EXECUTE definition;
        END LOOP;
      END
      $migration$;

      -- One default knowledge base per tenant, not per database.
      DROP INDEX candidate_knowledge_bases_one_default;
      CREATE UNIQUE INDEX candidate_knowledge_bases_one_default
        ON candidate_knowledge_bases (tenant_id, is_default) WHERE is_default = 1;
    `,
  },
  {
    version: 9,
    name: "workspace settings documents",
    sql: `
      -- No foreign key to workspaces: a workspace's configuration is a setting, written before
      -- its history record exists, and the reference is the driver's, not the workspace id.
      CREATE TABLE workspace_settings (
        tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
          CHECK (tenant_id <> ''),
        workspace_ref TEXT NOT NULL CHECK (workspace_ref <> ''),
        name TEXT NOT NULL CHECK (name <> ''),
        content TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, workspace_ref, name)
      );
      ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE workspace_settings FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON workspace_settings
        USING (tenant_id = current_setting('draft_loop.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
    `,
  },
  {
    version: 10,
    name: "candidate knowledge stores, managed source versions and sensitivity rules",
    sql: `
      CREATE TABLE candidate_knowledge_stores (
        tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
          CHECK (tenant_id <> ''),
        id TEXT NOT NULL CHECK (length(trim(id)) > 0),
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );

      -- A version whose bytes the service holds in blob storage, at this location.
      CREATE TABLE candidate_knowledge_managed_source_versions (
        tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
          CHECK (tenant_id <> ''),
        version_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        blob_location TEXT NOT NULL CHECK (length(trim(blob_location)) > 0),
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, version_id),
        FOREIGN KEY (tenant_id, version_id, source_id)
          REFERENCES candidate_knowledge_source_versions (tenant_id, id, source_id)
      );
      CREATE INDEX candidate_knowledge_managed_source_versions_source
        ON candidate_knowledge_managed_source_versions (tenant_id, source_id);

      CREATE TABLE candidate_knowledge_source_sensitivity_rule_versions (
        tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
          CHECK (tenant_id <> ''),
        knowledge_base_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        rules_json TEXT NOT NULL,
        checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, knowledge_base_id, version),
        FOREIGN KEY (tenant_id, knowledge_base_id)
          REFERENCES candidate_knowledge_bases (tenant_id, id)
      );

      CREATE TRIGGER candidate_knowledge_stores_immutable
        BEFORE UPDATE OR DELETE ON candidate_knowledge_stores
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER candidate_knowledge_managed_source_versions_immutable
        BEFORE UPDATE OR DELETE ON candidate_knowledge_managed_source_versions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
      CREATE TRIGGER candidate_knowledge_source_sensitivity_rule_versions_immutable
        BEFORE UPDATE OR DELETE ON candidate_knowledge_source_sensitivity_rule_versions
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

      DO $migration$
      DECLARE
        table_name text;
      BEGIN
        FOREACH table_name IN ARRAY ARRAY[
          'candidate_knowledge_stores',
          'candidate_knowledge_managed_source_versions',
          'candidate_knowledge_source_sensitivity_rule_versions'
        ] LOOP
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
    `,
  },
  {
    version: 11,
    name: "run state entries",
    sql: `
      -- The orchestrator's run snapshots, step executions and artifacts, as the local key-value
      -- table keeps them. Keys carry run ids, so one tenant's workspaces share the table.
      CREATE TABLE run_state_entries (
        tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
          CHECK (tenant_id <> ''),
        key TEXT NOT NULL CHECK (length(trim(key)) > 0),
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, key)
      );
      ALTER TABLE run_state_entries ENABLE ROW LEVEL SECURITY;
      ALTER TABLE run_state_entries FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON run_state_entries
        USING (tenant_id = current_setting('draft_loop.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
    `,
  },
  {
    version: 12,
    name: "idempotency keys",
    sql: `
      -- What a command produced under a client's Idempotency-Key, shared by every API instance
      -- (ADR 0011, D10). A row without a result is a command still running under its lease.
      CREATE TABLE idempotency_keys (
        tenant_id TEXT NOT NULL DEFAULT current_setting('draft_loop.tenant_id', true)
          CHECK (tenant_id <> ''),
        scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 256),
        key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 256),
        fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
        result_json TEXT,
        lease_until TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (tenant_id, scope, key)
      );
      CREATE INDEX idempotency_keys_expiry ON idempotency_keys (tenant_id, expires_at);
      ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
      ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON idempotency_keys
        USING (tenant_id = current_setting('draft_loop.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('draft_loop.tenant_id', true));
    `,
  },
  tenantDirectoryMigration,
  candidateRecordsMigration,
  consentLedgerMigration,
  knowledgeBaseOwnersMigration,
  recordErasureMigration,
  organisationErasureMigration,
];

/** Serializes concurrent migrators on one database; any constant shared by all of them works. */
const migrationLockKey = 0x64726166;

/**
 * Applies the pending migrations in order, in one transaction, and returns the versions
 * it applied. Concurrent callers wait on an advisory lock, so each version is applied once.
 */
export async function migratePostgres(
  client: SqlClient,
  migrations: readonly PostgresMigration[] = postgresMigrations,
): Promise<readonly number[]> {
  return client.transaction(async (executor) => {
    await executor.query("SELECT pg_advisory_xact_lock($1)", [migrationLockKey]);
    await executor.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (await executor.query("SELECT version FROM schema_migrations")).map((row) =>
        Number(row.version),
      ),
    );
    const appliedNow: number[] = [];
    for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
      if (applied.has(migration.version)) continue;
      await executor.query(migration.sql);
      await executor.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [
        migration.version,
        migration.name,
      ]);
      appliedNow.push(migration.version);
    }
    return appliedNow;
  });
}
