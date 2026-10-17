import type { SqlClient } from "./sql-client.js";

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
