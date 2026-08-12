import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { type WorkflowState, workflowStates } from "@draft-loop/domain";

export interface StoragePort {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface WorkspaceRecord {
  readonly id: string;
  readonly state: WorkflowState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContextSnapshotInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface ContextSnapshotRecord extends ContextSnapshotInput {
  readonly checksum: string;
}

export interface EvidenceSourceRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly createdAt: string;
}

export interface EvidenceChunkRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly ordinal: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly checksum: string;
  readonly text: string;
  readonly createdAt: string;
}

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

export interface AuditEventInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly eventType: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: JsonValue;
  readonly createdAt: string;
}

export interface AuditEvent extends AuditEventInput {
  readonly sequence: number;
  readonly payloadChecksum: string;
  readonly previousEventChecksum: string | null;
  readonly eventChecksum: string;
}

export interface EvidenceSearchHit extends EvidenceChunkRecord {
  readonly rank: number;
}

export interface EvidenceSearchOptions {
  readonly workspaceId?: string;
  readonly limit?: number;
}

export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

export class StorageSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageSecurityError";
  }
}

export class StorageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConflictError";
  }
}

export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageValidationError";
  }
}

export const storageSchemaVersion = 1 as const;

interface SqliteStatement {
  readonly run: (...parameters: readonly unknown[]) => {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  };
  readonly get: <Row extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: readonly unknown[]
  ) => Row | undefined;
  readonly all: <Row extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: readonly unknown[]
  ) => readonly Row[];
}

interface SqliteHandle {
  readonly exec: (sql: string) => void;
  readonly pragma: (sql: string) => unknown;
  readonly prepare: (sql: string) => SqliteStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
  readonly backup: (destination: string) => Promise<unknown>;
  readonly close: () => void;
}

interface SqliteConstructor {
  new (filename: string): SqliteHandle;
}

interface Migration {
  readonly version: number;
  readonly sql: string;
}

const migrationOne: Migration = {
  version: storageSchemaVersion,
  sql: `
    CREATE TABLE IF NOT EXISTS key_value (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_sources (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, path, checksum)
    );

    CREATE TABLE IF NOT EXISTS evidence_chunks (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      source_id TEXT NOT NULL REFERENCES evidence_sources(id),
      ordinal INTEGER NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (source_id, ordinal)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS evidence_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      workspace_id UNINDEXED,
      source_id UNINDEXED,
      text
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      version INTEGER NOT NULL,
      parent_version_id TEXT REFERENCES artifact_versions(id),
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL,
      UNIQUE (workspace_id, version)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL,
      previous_event_checksum TEXT,
      event_checksum TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS context_snapshots_immutable_update
      BEFORE UPDATE ON context_snapshots
      BEGIN SELECT RAISE(ABORT, 'context snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS context_snapshots_immutable_delete
      BEFORE DELETE ON context_snapshots
      BEGIN SELECT RAISE(ABORT, 'context snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_sources_immutable_update
      BEFORE UPDATE ON evidence_sources
      BEGIN SELECT RAISE(ABORT, 'evidence sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_sources_immutable_delete
      BEFORE DELETE ON evidence_sources
      BEGIN SELECT RAISE(ABORT, 'evidence sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_chunks_immutable_update
      BEFORE UPDATE ON evidence_chunks
      BEGIN SELECT RAISE(ABORT, 'evidence chunks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_chunks_immutable_delete
      BEFORE DELETE ON evidence_chunks
      BEGIN SELECT RAISE(ABORT, 'evidence chunks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS artifact_versions_immutable_update
      BEFORE UPDATE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS artifact_versions_immutable_delete
      BEFORE DELETE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_immutable_update
      BEFORE UPDATE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_immutable_delete
      BEFORE DELETE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
  `.trim(),
};

const migrations: readonly Migration[] = [migrationOne];
const sensitiveKeyPattern = /(api(?:[-_ ]?key)|token|secret|password|credential|authorization)/iu;

function now(): string {
  return new Date().toISOString();
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function serialize(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

function assertSafePayload(value: JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafePayload);
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) {
      throw new StorageSecurityError(`Sensitive field ${key} is not persisted.`);
    }
    assertSafePayload(child);
  }
}

function parse(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function payloadChecksum(payload: JsonValue): string {
  assertSafePayload(payload);
  return checksum(serialize(payload));
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim() === "") {
    throw new StorageValidationError(`${field} must not be empty`);
  }
  return value;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

function loadSqlite(filename: string): SqliteHandle {
  let loaded: unknown;
  try {
    loaded = createRequire(import.meta.url)("better-sqlite3");
  } catch (error) {
    throw new StorageUnavailableError(
      "SQLite storage requires the optional better-sqlite3 dependency.",
      { cause: error },
    );
  }
  const Constructor = (loaded as { readonly default?: unknown }).default ?? loaded;
  if (typeof Constructor !== "function") {
    throw new StorageUnavailableError("The better-sqlite3 module did not expose a constructor.");
  }
  return new (Constructor as SqliteConstructor)(filename);
}

function rowString(row: Record<string, unknown>, field: string): string {
  return String(row[field]);
}

function rowNumber(row: Record<string, unknown>, field: string): number {
  return Number(row[field]);
}

function rowNullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return value === null || value === undefined ? null : String(value);
}

export class SqliteStorage implements StoragePort {
  private readonly database: SqliteHandle;
  private closed = false;

  public constructor(filename: string) {
    this.database = loadSqlite(requireNonEmpty(filename, "filename"));
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  public migrate(): void {
    this.ensureOpen();
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    for (const migration of migrations) {
      const migrationChecksum = checksum(migration.sql);
      const applied = this.database
        .prepare("SELECT checksum FROM schema_migrations WHERE version = ?")
        .get<{ readonly checksum: string }>(migration.version);
      if (applied !== undefined) {
        if (applied.checksum !== migrationChecksum) {
          throw new StorageConflictError(
            `migration ${migration.version} has changed after it was applied`,
          );
        }
        continue;
      }
      const apply = this.database.transaction(() => {
        this.database.exec(migration.sql);
        this.database
          .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migrationChecksum, now());
      });
      apply();
    }
  }

  public appliedMigrationVersions(): readonly number[] {
    this.ensureOpen();
    return this.database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all<{ readonly version: number }>()
      .map((row) => row.version);
  }

  public async get(key: string): Promise<string | undefined> {
    this.ensureOpen();
    requireNonEmpty(key, "key");
    const row = this.database
      .prepare("SELECT value FROM key_value WHERE key = ?")
      .get<{ readonly value: string }>(key);
    return row?.value;
  }

  public async set(key: string, value: string): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(key, "key");
    if (sensitiveKeyPattern.test(key)) {
      throw new StorageSecurityError("Sensitive provider or credential values are not persisted.");
    }
    this.database
      .prepare(
        "INSERT INTO key_value (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, value, now());
  }

  public async saveWorkspace(record: WorkspaceRecord): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(record.id, "workspace id");
    requireNonEmpty(record.createdAt, "workspace createdAt");
    requireNonEmpty(record.updatedAt, "workspace updatedAt");
    if (!workflowStates.includes(record.state)) {
      throw new StorageValidationError(`Unsupported workspace state: ${record.state}`);
    }
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT state, created_at, updated_at FROM workspaces WHERE id = ?")
        .get<{ readonly state: string; readonly created_at: string; readonly updated_at: string }>(
          record.id,
        );
      if (existing === undefined) {
        this.database
          .prepare("INSERT INTO workspaces (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)")
          .run(record.id, record.state, record.createdAt, record.updatedAt);
      } else if (
        existing.state !== record.state ||
        existing.created_at !== record.createdAt ||
        existing.updated_at !== record.updatedAt
      ) {
        this.database
          .prepare("UPDATE workspaces SET state = ?, created_at = ?, updated_at = ? WHERE id = ?")
          .run(record.state, record.createdAt, record.updatedAt, record.id);
      }
      this.insertAuditEvent({
        id: `workspace:${record.id}:${record.updatedAt}`,
        workspaceId: record.id,
        eventType: "workspace.saved",
        entityType: "workspace",
        entityId: record.id,
        payload: recordToJson(record),
        createdAt: record.updatedAt,
      });
    })();
  }

  public async getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT id, state, created_at, updated_at FROM workspaces WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : workspaceFromRow(row);
  }

  public async saveContextSnapshot(input: ContextSnapshotInput): Promise<ContextSnapshotRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "context snapshot id");
    requireNonEmpty(input.workspaceId, "context snapshot workspaceId");
    requirePositiveInteger(input.schemaVersion, "context snapshot schemaVersion");
    requireNonEmpty(input.createdAt, "context snapshot createdAt");
    const checksumValue = payloadChecksum(input.payload);
    const record: ContextSnapshotRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, schema_version, created_at, payload_checksum FROM context_snapshots WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly schema_version: number;
          readonly created_at: string;
          readonly payload_checksum: string;
        }>(input.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== input.workspaceId ||
          existing.schema_version !== input.schemaVersion ||
          existing.created_at !== input.createdAt ||
          existing.payload_checksum !== checksumValue
        ) {
          throw new StorageConflictError(`context snapshot ${input.id} is immutable`);
        }
      } else {
        this.database
          .prepare(
            "INSERT INTO context_snapshots (id, workspace_id, schema_version, created_at, payload_json, payload_checksum) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            input.id,
            input.workspaceId,
            input.schemaVersion,
            input.createdAt,
            serialize(input.payload),
            checksumValue,
          );
        this.insertAuditEvent({
          id: `context-snapshot:${input.id}:${checksumValue}`,
          workspaceId: input.workspaceId,
          eventType: "context-snapshot.appended",
          entityType: "context-snapshot",
          entityId: input.id,
          payload: recordToJson(record),
          createdAt: input.createdAt,
        });
      }
    })();
    return record;
  }

  public async getContextSnapshot(id: string): Promise<ContextSnapshotRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, schema_version, created_at, payload_json, payload_checksum FROM context_snapshots WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : contextFromRow(row);
  }

  public async saveEvidenceSource(record: EvidenceSourceRecord): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(record.id, "evidence source id");
    requireNonEmpty(record.workspaceId, "evidence source workspaceId");
    requireNonEmpty(record.path, "evidence source path");
    requireNonEmpty(record.mediaType, "evidence source mediaType");
    requireNonEmpty(record.checksum, "evidence source checksum");
    requireNonEmpty(record.createdAt, "evidence source createdAt");
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, path, media_type, checksum, created_at FROM evidence_sources WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly path: string;
          readonly media_type: string;
          readonly checksum: string;
          readonly created_at: string;
        }>(record.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== record.workspaceId ||
          existing.path !== record.path ||
          existing.media_type !== record.mediaType ||
          existing.checksum !== record.checksum ||
          existing.created_at !== record.createdAt
        ) {
          throw new StorageConflictError(`evidence source ${record.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO evidence_sources (id, workspace_id, path, media_type, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          record.workspaceId,
          record.path,
          record.mediaType,
          record.checksum,
          record.createdAt,
        );
      this.insertAuditEvent({
        id: `evidence-source:${record.id}:${record.checksum}`,
        workspaceId: record.workspaceId,
        eventType: "evidence-source.appended",
        entityType: "evidence-source",
        entityId: record.id,
        payload: recordToJson(record),
        createdAt: record.createdAt,
      });
    })();
  }

  public async getEvidenceSource(id: string): Promise<EvidenceSourceRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, path, media_type, checksum, created_at FROM evidence_sources WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : evidenceSourceFromRow(row);
  }

  public async saveEvidenceChunk(record: EvidenceChunkRecord): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(record.id, "evidence chunk id");
    requireNonEmpty(record.workspaceId, "evidence chunk workspaceId");
    requireNonEmpty(record.sourceId, "evidence chunk sourceId");
    requirePositiveInteger(record.ordinal, "evidence chunk ordinal");
    requirePositiveInteger(record.lineStart, "evidence chunk lineStart");
    requirePositiveInteger(record.lineEnd, "evidence chunk lineEnd");
    if (record.lineEnd < record.lineStart) {
      throw new StorageValidationError("evidence chunk lineEnd must not precede lineStart");
    }
    requireNonEmpty(record.checksum, "evidence chunk checksum");
    requireNonEmpty(record.text, "evidence chunk text");
    requireNonEmpty(record.createdAt, "evidence chunk createdAt");
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, source_id, ordinal, line_start, line_end, checksum, text, created_at FROM evidence_chunks WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly source_id: string;
          readonly ordinal: number;
          readonly line_start: number;
          readonly line_end: number;
          readonly checksum: string;
          readonly text: string;
          readonly created_at: string;
        }>(record.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== record.workspaceId ||
          existing.source_id !== record.sourceId ||
          existing.ordinal !== record.ordinal ||
          existing.line_start !== record.lineStart ||
          existing.line_end !== record.lineEnd ||
          existing.checksum !== record.checksum ||
          existing.text !== record.text ||
          existing.created_at !== record.createdAt
        ) {
          throw new StorageConflictError(`evidence chunk ${record.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO evidence_chunks (id, workspace_id, source_id, ordinal, line_start, line_end, checksum, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          record.workspaceId,
          record.sourceId,
          record.ordinal,
          record.lineStart,
          record.lineEnd,
          record.checksum,
          record.text,
          record.createdAt,
        );
      this.database
        .prepare(
          "INSERT INTO evidence_chunks_fts (chunk_id, workspace_id, source_id, text) VALUES (?, ?, ?, ?)",
        )
        .run(record.id, record.workspaceId, record.sourceId, record.text);
      this.insertAuditEvent({
        id: `evidence-chunk:${record.id}:${record.checksum}`,
        workspaceId: record.workspaceId,
        eventType: "evidence-chunk.appended",
        entityType: "evidence-chunk",
        entityId: record.id,
        payload: recordToJson(record),
        createdAt: record.createdAt,
      });
    })();
  }

  public async saveArtifactVersion(input: ArtifactVersionInput): Promise<ArtifactVersionRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "artifact version id");
    requireNonEmpty(input.workspaceId, "artifact version workspaceId");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new StorageValidationError("artifact version must be a positive integer");
    }
    requireNonEmpty(input.createdAt, "artifact version createdAt");
    const checksumValue = payloadChecksum(input.payload);
    const record: ArtifactVersionRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, version, parent_version_id, created_at, payload_checksum FROM artifact_versions WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly version: number;
          readonly parent_version_id: string | null;
          readonly created_at: string;
          readonly payload_checksum: string;
        }>(input.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== input.workspaceId ||
          existing.version !== input.version ||
          existing.parent_version_id !== input.parentVersionId ||
          existing.created_at !== input.createdAt ||
          existing.payload_checksum !== checksumValue
        ) {
          throw new StorageConflictError(`artifact version ${input.id} is immutable`);
        }
      } else {
        this.database
          .prepare(
            "INSERT INTO artifact_versions (id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            input.id,
            input.workspaceId,
            input.version,
            input.parentVersionId,
            input.createdAt,
            serialize(input.payload),
            checksumValue,
          );
        this.insertAuditEvent({
          id: `artifact-version:${input.id}:${checksumValue}`,
          workspaceId: input.workspaceId,
          eventType: "artifact-version.appended",
          entityType: "artifact-version",
          entityId: input.id,
          payload: recordToJson(record),
          createdAt: input.createdAt,
        });
      }
    })();
    return record;
  }

  public async getArtifactVersion(id: string): Promise<ArtifactVersionRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum FROM artifact_versions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : artifactFromRow(row);
  }

  public async appendAuditEvent(input: AuditEventInput): Promise<AuditEvent> {
    this.ensureOpen();
    requireNonEmpty(input.id, "audit event id");
    requireNonEmpty(input.workspaceId, "audit event workspaceId");
    requireNonEmpty(input.eventType, "audit event type");
    requireNonEmpty(input.entityType, "audit event entityType");
    requireNonEmpty(input.entityId, "audit event entityId");
    requireNonEmpty(input.createdAt, "audit event createdAt");
    let result: AuditEvent | undefined;
    this.database.transaction(() => {
      result = this.insertAuditEvent(input);
    })();
    return result as AuditEvent;
  }

  public async listAuditEvents(workspaceId: string): Promise<readonly AuditEvent[]> {
    this.ensureOpen();
    return this.database
      .prepare(
        "SELECT sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE workspace_id = ? ORDER BY sequence",
      )
      .all(workspaceId)
      .map((row) => auditFromRow(row));
  }

  public async searchEvidence(
    query: string,
    optionsOrLimit: EvidenceSearchOptions | number = {},
  ): Promise<readonly EvidenceSearchHit[]> {
    this.ensureOpen();
    const options = typeof optionsOrLimit === "number" ? { limit: optionsOrLimit } : optionsOrLimit;
    const limit = options.limit ?? 20;
    const terms = query
      .trim()
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" AND ");
    if (terms === undefined || terms === "") {
      throw new StorageValidationError("evidence search query must contain a token");
    }
    if (options.workspaceId !== undefined) {
      requireNonEmpty(options.workspaceId, "evidence search workspaceId");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new StorageValidationError("evidence search limit must be an integer from 1 to 100");
    }
    return this.database
      .prepare(
        "SELECT c.id, c.workspace_id, c.source_id, c.ordinal, c.line_start, c.line_end, c.checksum, c.text, c.created_at, bm25(evidence_chunks_fts) AS rank FROM evidence_chunks_fts JOIN evidence_chunks AS c ON c.id = evidence_chunks_fts.chunk_id WHERE evidence_chunks_fts MATCH ? AND (? IS NULL OR c.workspace_id = ?) ORDER BY rank, c.id LIMIT ?",
      )
      .all(terms, options.workspaceId ?? null, options.workspaceId ?? null, limit)
      .map((row) => ({ ...evidenceChunkFromRow(row), rank: Number(row.rank) }));
  }

  public async backup(destination: string): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(destination, "backup destination");
    await this.database.backup(destination);
  }

  public async close(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  private insertAuditEvent(input: AuditEventInput): AuditEvent {
    requireNonEmpty(input.id, "audit event id");
    const payloadChecksumValue = payloadChecksum(input.payload);
    const existing = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE id = ?",
      )
      .get(input.id);
    if (existing !== undefined) {
      const existingEvent = auditFromRow(existing);
      if (
        existingEvent.workspaceId !== input.workspaceId ||
        existingEvent.eventType !== input.eventType ||
        existingEvent.entityType !== input.entityType ||
        existingEvent.entityId !== input.entityId ||
        existingEvent.payloadChecksum !== payloadChecksumValue ||
        existingEvent.createdAt !== input.createdAt
      ) {
        throw new StorageConflictError(`audit event ${input.id} is immutable`);
      }
      return existingEvent;
    }
    const previousEventChecksum =
      this.database
        .prepare(
          "SELECT event_checksum FROM audit_events WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get<{ readonly event_checksum: string }>(input.workspaceId)?.event_checksum ?? null;
    const eventChecksum = checksum(
      serialize({
        createdAt: input.createdAt,
        entityId: input.entityId,
        entityType: input.entityType,
        eventType: input.eventType,
        id: input.id,
        payloadChecksum: payloadChecksumValue,
        previousEventChecksum,
        workspaceId: input.workspaceId,
      }),
    );
    this.database
      .prepare(
        "INSERT INTO audit_events (id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id,
        input.workspaceId,
        input.eventType,
        input.entityType,
        input.entityId,
        serialize(input.payload),
        payloadChecksumValue,
        previousEventChecksum,
        eventChecksum,
        input.createdAt,
      );
    const row = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE id = ?",
      )
      .get(input.id);
    if (row === undefined) {
      throw new StorageConflictError(`audit event ${input.id} could not be read after insert`);
    }
    return auditFromRow(row);
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new StorageValidationError("SQLite storage is closed");
    }
  }
}

function recordToJson(
  record:
    | WorkspaceRecord
    | ContextSnapshotRecord
    | EvidenceSourceRecord
    | EvidenceChunkRecord
    | ArtifactVersionRecord,
): JsonValue {
  return JSON.parse(JSON.stringify(record)) as JsonValue;
}

function workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: rowString(row, "id"),
    state: rowString(row, "state") as WorkflowState,
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function contextFromRow(row: Record<string, unknown>): ContextSnapshotRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    schemaVersion: rowNumber(row, "schema_version"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "payload_checksum"),
  };
}

function evidenceSourceFromRow(row: Record<string, unknown>): EvidenceSourceRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    path: rowString(row, "path"),
    mediaType: rowString(row, "media_type"),
    checksum: rowString(row, "checksum"),
    createdAt: rowString(row, "created_at"),
  };
}

function evidenceChunkFromRow(row: Record<string, unknown>): EvidenceChunkRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    sourceId: rowString(row, "source_id"),
    ordinal: rowNumber(row, "ordinal"),
    lineStart: rowNumber(row, "line_start"),
    lineEnd: rowNumber(row, "line_end"),
    checksum: rowString(row, "checksum"),
    text: rowString(row, "text"),
    createdAt: rowString(row, "created_at"),
  };
}

function artifactFromRow(row: Record<string, unknown>): ArtifactVersionRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    version: rowNumber(row, "version"),
    parentVersionId: rowNullableString(row, "parent_version_id"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "payload_checksum"),
  };
}

function auditFromRow(row: Record<string, unknown>): AuditEvent {
  return {
    sequence: rowNumber(row, "sequence"),
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    eventType: rowString(row, "event_type"),
    entityType: rowString(row, "entity_type"),
    entityId: rowString(row, "entity_id"),
    payload: parse(rowString(row, "payload_json")),
    payloadChecksum: rowString(row, "payload_checksum"),
    previousEventChecksum: rowNullableString(row, "previous_event_checksum"),
    eventChecksum: rowString(row, "event_checksum"),
    createdAt: rowString(row, "created_at"),
  };
}

export function openSqliteStorage(filename: string): SqliteStorage {
  return new SqliteStorage(filename);
}
