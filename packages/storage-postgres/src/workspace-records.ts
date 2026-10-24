import { type WorkflowState, workflowStates } from "@draft-loop/domain";
import type {
  ArtifactVersionInput,
  ArtifactVersionRecord,
  ContextSnapshotInput,
  ContextSnapshotRecord,
  JsonValue,
  WorkspaceRecord,
} from "@draft-loop/storage";
import { payloadChecksum, serialize } from "@draft-loop/storage/audit-trail";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import { appendAuditEventRow } from "./audit-trail.js";
import type { SqlRow, SqlSession } from "./sql-client.js";

function requireNonEmpty(value: string, field: string): string {
  if (value.trim() === "") {
    throw new StorageValidationError(`${field} must not be empty`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

/** The record as the audit trail stores it: plain JSON, without class or undefined fields. */
function recordToJson(record: unknown): JsonValue {
  return JSON.parse(JSON.stringify(record)) as JsonValue;
}

function workspaceFromRow(row: SqlRow): WorkspaceRecord {
  return {
    id: String(row.id),
    state: String(row.state) as WorkflowState,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function contextSnapshotFromRow(row: SqlRow): ContextSnapshotRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    schemaVersion: Number(row.schema_version),
    createdAt: String(row.created_at),
    payload: JSON.parse(String(row.payload_json)) as JsonValue,
    checksum: String(row.payload_checksum),
  };
}

function artifactVersionFromRow(row: SqlRow): ArtifactVersionRecord {
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

/**
 * Workspaces and the immutable records every run points at. Each write appends its audit event in
 * the same transaction, with the same event ids and payloads as the SQLite implementation.
 */
export function createWorkspaceRecords(client: SqlSession) {
  return {
    saveWorkspace: async (record: WorkspaceRecord): Promise<void> => {
      requireNonEmpty(record.id, "workspace id");
      requireNonEmpty(record.createdAt, "workspace createdAt");
      requireNonEmpty(record.updatedAt, "workspace updatedAt");
      if (!workflowStates.includes(record.state)) {
        throw new StorageValidationError(`Unsupported workspace state: ${record.state}`);
      }
      await client.transaction(async (executor) => {
        await executor.query(
          `INSERT INTO workspaces (id, state, created_at, updated_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, id) DO UPDATE SET state = EXCLUDED.state, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
          [record.id, record.state, record.createdAt, record.updatedAt],
        );
        await appendAuditEventRow(executor, {
          id: `workspace:${record.id}:${record.updatedAt}`,
          workspaceId: record.id,
          eventType: "workspace.saved",
          entityType: "workspace",
          entityId: record.id,
          payload: recordToJson(record),
          createdAt: record.updatedAt,
        });
      });
    },

    getWorkspace: async (id: string): Promise<WorkspaceRecord | undefined> => {
      const [row] = await client.query(
        "SELECT id, state, created_at, updated_at FROM workspaces WHERE id = $1",
        [id],
      );
      return row === undefined ? undefined : workspaceFromRow(row);
    },

    saveContextSnapshot: async (input: ContextSnapshotInput): Promise<ContextSnapshotRecord> => {
      requireNonEmpty(input.id, "context snapshot id");
      requireNonEmpty(input.workspaceId, "context snapshot workspaceId");
      requireNonNegativeInteger(input.schemaVersion, "context snapshot schemaVersion");
      requireNonEmpty(input.createdAt, "context snapshot createdAt");
      const checksumValue = payloadChecksum(input.payload);
      const record: ContextSnapshotRecord = { ...input, checksum: checksumValue };
      await client.transaction(async (executor) => {
        const [inserted] = await executor.query(
          `INSERT INTO context_snapshots (id, workspace_id, schema_version, created_at, payload_json, payload_checksum)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, id) DO NOTHING RETURNING id`,
          [
            input.id,
            input.workspaceId,
            input.schemaVersion,
            input.createdAt,
            serialize(input.payload),
            checksumValue,
          ],
        );
        if (inserted === undefined) {
          const [existing] = await executor.query(
            "SELECT workspace_id, schema_version, created_at, payload_checksum FROM context_snapshots WHERE id = $1",
            [input.id],
          );
          if (
            existing === undefined ||
            existing.workspace_id !== input.workspaceId ||
            Number(existing.schema_version) !== input.schemaVersion ||
            existing.created_at !== input.createdAt ||
            existing.payload_checksum !== checksumValue
          ) {
            throw new StorageConflictError(`context snapshot ${input.id} is immutable`);
          }
          return;
        }
        await appendAuditEventRow(executor, {
          id: `context-snapshot:${input.id}:${checksumValue}`,
          workspaceId: input.workspaceId,
          eventType: "context-snapshot.appended",
          entityType: "context-snapshot",
          entityId: input.id,
          payload: recordToJson(record),
          createdAt: input.createdAt,
        });
      });
      return record;
    },

    getContextSnapshot: async (id: string): Promise<ContextSnapshotRecord | undefined> => {
      const [row] = await client.query(
        "SELECT id, workspace_id, schema_version, created_at, payload_json, payload_checksum FROM context_snapshots WHERE id = $1",
        [id],
      );
      return row === undefined ? undefined : contextSnapshotFromRow(row);
    },

    saveArtifactVersion: async (input: ArtifactVersionInput): Promise<ArtifactVersionRecord> => {
      requireNonEmpty(input.id, "artifact version id");
      requireNonEmpty(input.workspaceId, "artifact version workspaceId");
      if (!Number.isInteger(input.version) || input.version < 1) {
        throw new StorageValidationError("artifact version must be a positive integer");
      }
      requireNonEmpty(input.createdAt, "artifact version createdAt");
      const checksumValue = payloadChecksum(input.payload);
      const record: ArtifactVersionRecord = { ...input, checksum: checksumValue };
      await client.transaction(async (executor) => {
        const [inserted] = await executor.query(
          `INSERT INTO artifact_versions (id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, id) DO NOTHING RETURNING id`,
          [
            input.id,
            input.workspaceId,
            input.version,
            input.parentVersionId,
            input.createdAt,
            serialize(input.payload),
            checksumValue,
          ],
        );
        if (inserted === undefined) {
          const [existing] = await executor.query(
            "SELECT workspace_id, version, parent_version_id, created_at, payload_checksum FROM artifact_versions WHERE id = $1",
            [input.id],
          );
          if (
            existing === undefined ||
            existing.workspace_id !== input.workspaceId ||
            Number(existing.version) !== input.version ||
            (existing.parent_version_id ?? null) !== input.parentVersionId ||
            existing.created_at !== input.createdAt ||
            existing.payload_checksum !== checksumValue
          ) {
            throw new StorageConflictError(`artifact version ${input.id} is immutable`);
          }
          return;
        }
        await appendAuditEventRow(executor, {
          id: `artifact-version:${input.id}:${checksumValue}`,
          workspaceId: input.workspaceId,
          eventType: "artifact-version.appended",
          entityType: "artifact-version",
          entityId: input.id,
          payload: recordToJson(record),
          createdAt: input.createdAt,
        });
      });
      return record;
    },

    getArtifactVersion: async (id: string): Promise<ArtifactVersionRecord | undefined> => {
      const [row] = await client.query(
        "SELECT id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum FROM artifact_versions WHERE id = $1",
        [id],
      );
      return row === undefined ? undefined : artifactVersionFromRow(row);
    },
  };
}
