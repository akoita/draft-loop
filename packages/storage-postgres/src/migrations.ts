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
