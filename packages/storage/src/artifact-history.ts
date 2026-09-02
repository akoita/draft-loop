type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ArtifactVersionInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly parentVersionId: string | null;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface ArtifactVersionRecord extends ArtifactVersionInput {
  readonly checksum: string;
}

/**
 * Migration 26 removes the workspace-wide version uniqueness boundary. The
 * artifact ID is the immutable identity for one lineage, so each lineage may
 * start at version 1 in the same workspace.
 */
export const artifactHistoryMigration = {
  version: 26,
  requiresForeignKeyRebuild: true,
  sql: `
    PRAGMA defer_foreign_keys = ON;
    PRAGMA legacy_alter_table = ON;

    DROP TRIGGER IF EXISTS artifact_versions_immutable_update;
    DROP TRIGGER IF EXISTS artifact_versions_immutable_delete;

    ALTER TABLE artifact_versions RENAME TO artifact_versions_legacy;

    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      version INTEGER NOT NULL,
      parent_version_id TEXT REFERENCES artifact_versions(id),
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL
    );

    INSERT INTO artifact_versions (
      id,
      workspace_id,
      version,
      parent_version_id,
      created_at,
      payload_json,
      payload_checksum
    )
    SELECT
      id,
      workspace_id,
      version,
      parent_version_id,
      created_at,
      payload_json,
      payload_checksum
    FROM artifact_versions_legacy;

    DROP TABLE artifact_versions_legacy;

    CREATE TRIGGER artifact_versions_immutable_update
      BEFORE UPDATE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
    CREATE TRIGGER artifact_versions_immutable_delete
      BEFORE DELETE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
  `.trim(),
} as const;

export function artifactVersionFromRow(row: Record<string, unknown>): ArtifactVersionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    version: Number(row.version),
    parentVersionId:
      row.parent_version_id === null || row.parent_version_id === undefined
        ? null
        : String(row.parent_version_id),
    createdAt: String(row.created_at),
    payload: JSON.parse(String(row.payload_json)) as JsonValue,
    checksum: String(row.payload_checksum),
  };
}
