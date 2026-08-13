import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  type RetrievalOptions,
  type RetrievalPort,
  type ScoredEvidenceChunk,
  type WorkflowState,
  workflowStates,
} from "@draft-loop/domain";

export interface StoragePort {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
}

export interface WorkspaceBackupResult {
  readonly backupPath: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface WorkspaceRestoreOptions {
  readonly verifyIntegrity?: boolean;
}

export interface MigrationReport {
  readonly appliedCount: number;
  readonly appliedVersions: readonly number[];
  readonly latestVersion: number;
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

export type StoredRunState = WorkflowState | "provider-error";
export type StoredRunStep = "author" | "critic" | "revision" | null;
export type StoredApprovalStatus = "pending" | "approved" | "rejected";
export type StoredRoundState = Extract<
  StoredRunState,
  | "drafting"
  | "reviewing"
  | "revising"
  | "budget-exhausted"
  | "provider-error"
  | "paused"
  | "stopped"
  | "awaiting-approval"
>;
export type StoredExecutionStep = Exclude<StoredRunStep, null>;
export type StoredExecutionStatus = "completed" | "failed";
export type StoredFindingSeverity = "error" | "warning";
export type StoredDecisionType = "edit" | "accept-finding" | "reject-finding" | "approve";
export type StoredExportStatus = "prepared" | "completed" | "failed";

export interface RunRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly contextSnapshotId: string;
  readonly state: StoredRunState;
  readonly round: number;
  readonly currentStep: StoredRunStep;
  readonly budget: JsonValue;
  readonly artifactId: string | null;
  readonly approval: StoredApprovalStatus;
  readonly totalCostUsd: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RunRecord extends RunRecordInput {
  readonly checksum: string;
}

/**
 * Append-only lifecycle projection input. The full orchestration snapshot is
 * retained in `payload`; the duplicated columns keep current-state queries
 * cheap and independent of the orchestrator package.
 */
export interface RunSnapshotRecordInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly state: StoredRunState;
  readonly round: number;
  readonly currentStep: StoredRunStep;
  readonly budget: JsonValue;
  readonly artifactId: string | null;
  readonly approval: StoredApprovalStatus;
  readonly totalCostUsd: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RunSnapshotRecord extends RunSnapshotRecordInput {
  readonly id: string;
  readonly sequence: number;
  readonly checksum: string;
}

export interface RoundRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly number: number;
  readonly state: StoredRoundState;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly evaluation: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RoundRecord extends RoundRecordInput {
  readonly checksum: string;
}

export interface ExecutionRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string;
  readonly contextSnapshotId: string;
  readonly artifactId: string | null;
  readonly attempt: number;
  readonly step: StoredExecutionStep;
  readonly status: StoredExecutionStatus;
  readonly provider: string;
  readonly modelId: string;
  readonly providerRequestId: string | null;
  readonly outputChecksum: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedUsd: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly output: JsonValue | null;
  readonly payload: JsonValue;
}

export interface ExecutionRecord extends ExecutionRecordInput {
  readonly checksum: string;
}

export interface FindingRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string;
  readonly executionId: string | null;
  readonly artifactId: string | null;
  readonly code: string;
  readonly category: string;
  readonly severity: StoredFindingSeverity;
  readonly message: string;
  readonly claimId: string | null;
  readonly sectionId: string | null;
  readonly requirementId: string | null;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface FindingRecord extends FindingRecordInput {
  readonly checksum: string;
}

export interface DecisionRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string | null;
  readonly artifactId: string | null;
  readonly type: StoredDecisionType;
  readonly rationale: string;
  readonly actor: string;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface DecisionRecord extends DecisionRecordInput {
  readonly checksum: string;
}

export interface ExportRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly format: string;
  readonly status: StoredExportStatus;
  readonly outputPath: string | null;
  readonly outputChecksum: string | null;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface ExportRecord extends ExportRecordInput {
  readonly checksum: string;
}

export interface RetentionPlan {
  readonly before: string;
  readonly auditEventsEligible: number;
  readonly immutableBusinessRecords: true;
}

export interface RetentionPurgeOptions {
  readonly confirmed: boolean;
}

export interface RetentionPurgeResult {
  readonly before: string;
  readonly deletedAuditEventsCount: number;
  readonly executedAt: string;
}

export interface DiagnosticTelemetryReport {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly aggregates: {
    readonly workspacesCount: number;
    readonly totalRunsCount: number;
    readonly totalRoundsCount: number;
    readonly totalExecutionsCount: number;
    readonly executionsByStatus: Readonly<Record<string, number>>;
    readonly executionsByStep: Readonly<Record<string, number>>;
    readonly findingsCount: number;
    readonly findingsBySeverity: Readonly<Record<string, number>>;
    readonly decisionsCount: number;
    readonly totalCostUsd: number;
    readonly totalTokens: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
    };
    readonly providersDistribution: Readonly<Record<string, number>>;
  };
  readonly checksum: string;
}

/** Typed history boundary shared by CLI and future UI adapters. */
export interface HistoryStoragePort {
  readonly saveRun: (input: RunRecordInput) => Promise<RunRecord>;
  readonly getRun: (id: string) => Promise<RunRecord | undefined>;
  readonly listRuns: (workspaceId: string) => Promise<readonly RunRecord[]>;
  readonly saveRunSnapshot: (input: RunSnapshotRecordInput) => Promise<RunSnapshotRecord>;
  readonly getLatestRunSnapshot: (runId: string) => Promise<RunSnapshotRecord | undefined>;
  readonly listRunSnapshots: (runId: string) => Promise<readonly RunSnapshotRecord[]>;
  readonly saveRound: (input: RoundRecordInput) => Promise<RoundRecord>;
  readonly getRound: (id: string) => Promise<RoundRecord | undefined>;
  readonly listRounds: (runId: string) => Promise<readonly RoundRecord[]>;
  readonly saveExecution: (input: ExecutionRecordInput) => Promise<ExecutionRecord>;
  readonly getExecution: (id: string) => Promise<ExecutionRecord | undefined>;
  readonly listExecutions: (runId: string) => Promise<readonly ExecutionRecord[]>;
  readonly saveFinding: (input: FindingRecordInput) => Promise<FindingRecord>;
  readonly getFinding: (id: string) => Promise<FindingRecord | undefined>;
  readonly listFindings: (runId: string) => Promise<readonly FindingRecord[]>;
  readonly saveDecision: (input: DecisionRecordInput) => Promise<DecisionRecord>;
  readonly getDecision: (id: string) => Promise<DecisionRecord | undefined>;
  readonly listDecisions: (runId: string) => Promise<readonly DecisionRecord[]>;
  readonly saveExport: (input: ExportRecordInput) => Promise<ExportRecord>;
  readonly getExport: (id: string) => Promise<ExportRecord | undefined>;
  readonly listExports: (runId: string) => Promise<readonly ExportRecord[]>;
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

export type { RetrievalOptions, RetrievalPort, ScoredEvidenceChunk };
export type EvidenceSearchHit = ScoredEvidenceChunk;
export type EvidenceSearchOptions = RetrievalOptions;

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

export const storageSchemaVersion = 3 as const;

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
  version: 1,
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

const migrationTwo: Migration = {
  version: 2,
  sql: `
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
      state TEXT NOT NULL,
      round INTEGER NOT NULL CHECK (round >= 1),
      current_step TEXT,
      budget_json TEXT NOT NULL,
      artifact_id TEXT REFERENCES artifact_versions(id),
      approval TEXT NOT NULL CHECK (approval IN ('pending', 'approved', 'rejected')),
      total_cost_usd REAL NOT NULL CHECK (total_cost_usd >= 0),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error_json TEXT,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
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
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
      artifact_id TEXT REFERENCES artifact_versions(id),
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
      estimated_usd REAL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error_code TEXT,
      output_json TEXT,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      UNIQUE (run_id, round_id, step, attempt),
      UNIQUE (id, workspace_id),
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id),
      FOREIGN KEY (round_id, workspace_id) REFERENCES rounds(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      execution_id TEXT,
      artifact_id TEXT REFERENCES artifact_versions(id),
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
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id),
      FOREIGN KEY (round_id, workspace_id) REFERENCES rounds(id, workspace_id),
      FOREIGN KEY (execution_id, workspace_id) REFERENCES executions(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      round_id TEXT,
      artifact_id TEXT REFERENCES artifact_versions(id),
      type TEXT NOT NULL CHECK (type IN ('edit', 'accept-finding', 'reject-finding', 'approve')),
      rationale TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id),
      FOREIGN KEY (round_id, workspace_id) REFERENCES rounds(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES artifact_versions(id),
      format TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('prepared', 'completed', 'failed')),
      output_path TEXT,
      output_checksum TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id)
    );

    CREATE INDEX IF NOT EXISTS runs_workspace_updated_idx ON runs(workspace_id, updated_at, id);
    CREATE INDEX IF NOT EXISTS rounds_run_number_idx ON rounds(run_id, number, id);
    CREATE INDEX IF NOT EXISTS executions_run_started_idx ON executions(run_id, started_at, id);
    CREATE INDEX IF NOT EXISTS findings_run_created_idx ON findings(run_id, created_at, id);
    CREATE INDEX IF NOT EXISTS decisions_run_created_idx ON decisions(run_id, created_at, id);
    CREATE INDEX IF NOT EXISTS exports_run_created_idx ON exports(run_id, created_at, id);

    CREATE TRIGGER IF NOT EXISTS runs_immutable_update
      BEFORE UPDATE ON runs
      BEGIN SELECT RAISE(ABORT, 'runs are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS runs_immutable_delete
      BEFORE DELETE ON runs
      BEGIN SELECT RAISE(ABORT, 'runs are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS rounds_immutable_update
      BEFORE UPDATE ON rounds
      BEGIN SELECT RAISE(ABORT, 'rounds are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS rounds_immutable_delete
      BEFORE DELETE ON rounds
      BEGIN SELECT RAISE(ABORT, 'rounds are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS executions_immutable_update
      BEFORE UPDATE ON executions
      BEGIN SELECT RAISE(ABORT, 'executions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS executions_immutable_delete
      BEFORE DELETE ON executions
      BEGIN SELECT RAISE(ABORT, 'executions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS findings_immutable_update
      BEFORE UPDATE ON findings
      BEGIN SELECT RAISE(ABORT, 'findings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS findings_immutable_delete
      BEFORE DELETE ON findings
      BEGIN SELECT RAISE(ABORT, 'findings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS decisions_immutable_update
      BEFORE UPDATE ON decisions
      BEGIN SELECT RAISE(ABORT, 'decisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS decisions_immutable_delete
      BEFORE DELETE ON decisions
      BEGIN SELECT RAISE(ABORT, 'decisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS exports_immutable_update
      BEFORE UPDATE ON exports
      BEGIN SELECT RAISE(ABORT, 'exports are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS exports_immutable_delete
      BEFORE DELETE ON exports
      BEGIN SELECT RAISE(ABORT, 'exports are immutable'); END;
  `.trim(),
};

const migrationThree: Migration = {
  version: 3,
  sql: `
    CREATE TABLE IF NOT EXISTS run_snapshots (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
      state TEXT NOT NULL,
      round INTEGER NOT NULL CHECK (round >= 1),
      current_step TEXT,
      budget_json TEXT NOT NULL,
      artifact_id TEXT,
      approval TEXT NOT NULL CHECK (approval IN ('pending', 'approved', 'rejected')),
      total_cost_usd REAL NOT NULL CHECK (total_cost_usd >= 0),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error_json TEXT,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      UNIQUE (run_id, record_checksum)
    );

    CREATE INDEX IF NOT EXISTS run_snapshots_run_sequence_idx
      ON run_snapshots(run_id, sequence);

    CREATE TRIGGER IF NOT EXISTS run_snapshots_immutable_update
      BEFORE UPDATE ON run_snapshots
      BEGIN SELECT RAISE(ABORT, 'run snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS run_snapshots_immutable_delete
      BEFORE DELETE ON run_snapshots
      BEGIN SELECT RAISE(ABORT, 'run snapshots are immutable'); END;
  `.trim(),
};

const migrations: readonly Migration[] = [migrationOne, migrationTwo, migrationThree];
const sensitiveKeyPattern =
  /(?:api(?:[-_ ]?key)|(?:api|access|refresh|provider|auth)[-_ ]?token|(?:^|[-_.])token$|secret|password|credential|authorization)/iu;
const hiddenContentKeyPattern =
  /(?:^|[-_.])(?:prompt|response|raw[-_ ]?response|chain[-_ ]?of[-_ ]?thought|reasoning)(?:$|[-_ ])/iu;

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
    if (hiddenContentKeyPattern.test(key)) {
      throw new StorageSecurityError(`Raw model content field ${key} is not persisted.`);
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

function moduleRequire(): NodeRequire {
  try {
    return createRequire(import.meta.url);
  } catch {
    // Electron Forge emits the main bundle as CommonJS. In that bundle Vite
    // can leave import.meta.url undefined, so use an absolute cwd anchor.
    return createRequire(join(process.cwd(), "package.json"));
  }
}

function loadSqlite(filename: string): SqliteHandle {
  let loaded: unknown;
  const require = moduleRequire();
  try {
    loaded = require("better-sqlite3");
  } catch (error) {
    const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string })
      .resourcesPath;
    if (resourcesPath === undefined) {
      throw new StorageUnavailableError(
        "SQLite storage requires the optional better-sqlite3 dependency.",
        { cause: error },
      );
    }
    try {
      loaded = require(join(resourcesPath, "better-sqlite3"));
    } catch {
      throw new StorageUnavailableError(
        "SQLite storage requires the optional better-sqlite3 dependency.",
        { cause: error },
      );
    }
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

function rowNullableJson(row: Record<string, unknown>, field: string): JsonValue | null {
  const value = row[field];
  return value === null || value === undefined ? null : parse(String(value));
}

function rowNullableNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  return value === null || value === undefined ? null : Number(value);
}

function recordChecksum(input: unknown): string {
  return checksum(serialize(recordToJson(input)));
}

function assertSafeRecordFields(input: unknown, fields: readonly string[]): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return;
  const record = input as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (value !== null && value !== undefined) {
      payloadChecksum(recordToJson(value));
    }
  }
}

function requirePositive(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new StorageValidationError(`${field} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

function requireNonNegativeNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a finite non-negative number`);
  }
  return value;
}

function requireStoredRunState(state: StoredRunState, field: string): void {
  if (state !== "provider-error" && !workflowStates.includes(state)) {
    throw new StorageValidationError(`Unsupported ${field}: ${state}`);
  }
}

function requireStoredStep(step: StoredRunStep, field: string): void {
  if (step !== null && step !== "author" && step !== "critic" && step !== "revision") {
    throw new StorageValidationError(`Unsupported ${field}: ${step}`);
  }
}

export class SqliteStorage implements StoragePort, HistoryStoragePort, RetrievalPort {
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

  public async saveRun(input: RunRecordInput): Promise<RunRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "run id");
    requireNonEmpty(input.workspaceId, "run workspaceId");
    requireNonEmpty(input.contextSnapshotId, "run contextSnapshotId");
    requireStoredRunState(input.state, "run state");
    requirePositive(input.round, "run round");
    requireStoredStep(input.currentStep, "run currentStep");
    requireNonEmpty(input.startedAt, "run startedAt");
    requireNonEmpty(input.updatedAt, "run updatedAt");
    requireNonNegativeNumber(input.totalCostUsd, "run totalCostUsd");
    assertSafeRecordFields(input, ["budget", "lastError", "payload"]);
    const checksumValue = recordChecksum(input);
    const record: RunRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM runs WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`run ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO runs (id, workspace_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.contextSnapshotId,
          input.state,
          input.round,
          input.currentStep,
          serialize(input.budget),
          input.artifactId,
          input.approval,
          input.totalCostUsd,
          input.startedAt,
          input.updatedAt,
          input.lastError === null ? null : serialize(input.lastError),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `run:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "run.appended",
        entityType: "run",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.updatedAt,
      });
    })();
    return record;
  }

  public async getRun(id: string): Promise<RunRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM runs WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : runFromRow(row);
  }

  public async listRuns(workspaceId: string): Promise<readonly RunRecord[]> {
    this.ensureOpen();
    requireNonEmpty(workspaceId, "run workspaceId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM runs WHERE workspace_id = ? ORDER BY updated_at, id",
      )
      .all(workspaceId)
      .map((row) => runFromRow(row));
  }

  public async saveRunSnapshot(input: RunSnapshotRecordInput): Promise<RunSnapshotRecord> {
    this.ensureOpen();
    requireNonEmpty(input.workspaceId, "run snapshot workspaceId");
    requireNonEmpty(input.runId, "run snapshot runId");
    requireNonEmpty(input.contextSnapshotId, "run snapshot contextSnapshotId");
    requireStoredRunState(input.state, "run snapshot state");
    requirePositive(input.round, "run snapshot round");
    requireStoredStep(input.currentStep, "run snapshot currentStep");
    requireNonEmpty(input.startedAt, "run snapshot startedAt");
    requireNonEmpty(input.updatedAt, "run snapshot updatedAt");
    requireNonNegativeNumber(input.totalCostUsd, "run snapshot totalCostUsd");
    assertSafeRecordFields(input, ["budget", "lastError", "payload"]);
    const checksumValue = recordChecksum(input);
    const id = `run-snapshot:${input.runId}:${checksumValue}`;
    const recordWithoutSequence = { ...input, id, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT sequence, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE id = ?",
        )
        .get(id);
      if (existing !== undefined) {
        const existingRecord = runSnapshotFromRow(existing);
        if (existingRecord.checksum !== checksumValue) {
          throw new StorageConflictError(`run snapshot ${id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO run_snapshots (id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.workspaceId,
          input.runId,
          input.contextSnapshotId,
          input.state,
          input.round,
          input.currentStep,
          serialize(input.budget),
          input.artifactId,
          input.approval,
          input.totalCostUsd,
          input.startedAt,
          input.updatedAt,
          input.lastError === null ? null : serialize(input.lastError),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `${id}:audit`,
        workspaceId: input.workspaceId,
        eventType: "run-snapshot.appended",
        entityType: "run-snapshot",
        entityId: input.runId,
        payload: recordToJson(recordWithoutSequence),
        createdAt: input.updatedAt,
      });
    })();
    const saved = await this.getRunSnapshotById(id);
    if (saved === undefined) {
      throw new StorageConflictError(`run snapshot ${id} could not be read after insert`);
    }
    return saved;
  }

  public async getLatestRunSnapshot(runId: string): Promise<RunSnapshotRecord | undefined> {
    this.ensureOpen();
    requireNonEmpty(runId, "run snapshot runId");
    const row = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE run_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(runId);
    return row === undefined ? undefined : runSnapshotFromRow(row);
  }

  public async listRunSnapshots(runId: string): Promise<readonly RunSnapshotRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "run snapshot runId");
    return this.database
      .prepare(
        "SELECT sequence, id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE run_id = ? ORDER BY sequence, id",
      )
      .all(runId)
      .map((row) => runSnapshotFromRow(row));
  }

  private async getRunSnapshotById(id: string): Promise<RunSnapshotRecord | undefined> {
    const row = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : runSnapshotFromRow(row);
  }

  public async saveRound(input: RoundRecordInput): Promise<RoundRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "round id");
    requireNonEmpty(input.workspaceId, "round workspaceId");
    requireNonEmpty(input.runId, "round runId");
    requirePositive(input.number, "round number");
    requireStoredRunState(input.state, "round state");
    requireNonEmpty(input.startedAt, "round startedAt");
    if (input.completedAt !== null) requireNonEmpty(input.completedAt, "round completedAt");
    assertSafeRecordFields(input, ["evaluation", "payload"]);
    const checksumValue = recordChecksum(input);
    const record: RoundRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM rounds WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`round ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO rounds (id, workspace_id, run_id, number, state, started_at, completed_at, evaluation_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.number,
          input.state,
          input.startedAt,
          input.completedAt,
          input.evaluation === null ? null : serialize(input.evaluation),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `round:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "round.appended",
        entityType: "round",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.startedAt,
      });
    })();
    return record;
  }

  public async getRound(id: string): Promise<RoundRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, number, state, started_at, completed_at, evaluation_json, payload_json, record_checksum FROM rounds WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : roundFromRow(row);
  }

  public async listRounds(runId: string): Promise<readonly RoundRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "round runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, number, state, started_at, completed_at, evaluation_json, payload_json, record_checksum FROM rounds WHERE run_id = ? ORDER BY number, id",
      )
      .all(runId)
      .map((row) => roundFromRow(row));
  }

  public async saveExecution(input: ExecutionRecordInput): Promise<ExecutionRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "execution id");
    requireNonEmpty(input.workspaceId, "execution workspaceId");
    requireNonEmpty(input.runId, "execution runId");
    requireNonEmpty(input.roundId, "execution roundId");
    requireNonEmpty(input.contextSnapshotId, "execution contextSnapshotId");
    requirePositive(input.attempt, "execution attempt");
    requireNonEmpty(input.provider, "execution provider");
    requireNonEmpty(input.modelId, "execution modelId");
    requireNonNegativeInteger(input.inputTokens, "execution inputTokens");
    requireNonNegativeInteger(input.outputTokens, "execution outputTokens");
    requireNonNegativeInteger(input.totalTokens, "execution totalTokens");
    if (input.estimatedUsd !== null)
      requireNonNegativeNumber(input.estimatedUsd, "execution estimatedUsd");
    requireNonEmpty(input.startedAt, "execution startedAt");
    if (input.completedAt !== null) requireNonEmpty(input.completedAt, "execution completedAt");
    assertSafeRecordFields(input, ["output", "payload"]);
    const checksumValue = recordChecksum(input);
    const record: ExecutionRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM executions WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`execution ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO executions (id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, provider_request_id, output_checksum, input_tokens, output_tokens, total_tokens, estimated_usd, started_at, completed_at, error_code, output_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.roundId,
          input.contextSnapshotId,
          input.artifactId,
          input.attempt,
          input.step,
          input.status,
          input.provider,
          input.modelId,
          input.providerRequestId,
          input.outputChecksum,
          input.inputTokens,
          input.outputTokens,
          input.totalTokens,
          input.estimatedUsd,
          input.startedAt,
          input.completedAt,
          input.errorCode,
          input.output === null ? null : serialize(input.output),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `execution:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "execution.appended",
        entityType: "execution",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.completedAt ?? input.startedAt,
      });
    })();
    return record;
  }

  public async getExecution(id: string): Promise<ExecutionRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, provider_request_id, output_checksum, input_tokens, output_tokens, total_tokens, estimated_usd, started_at, completed_at, error_code, output_json, payload_json, record_checksum FROM executions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : executionFromRow(row);
  }

  public async listExecutions(runId: string): Promise<readonly ExecutionRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "execution runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, provider_request_id, output_checksum, input_tokens, output_tokens, total_tokens, estimated_usd, started_at, completed_at, error_code, output_json, payload_json, record_checksum FROM executions WHERE run_id = ? ORDER BY started_at, id",
      )
      .all(runId)
      .map((row) => executionFromRow(row));
  }

  public async saveFinding(input: FindingRecordInput): Promise<FindingRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "finding id");
    requireNonEmpty(input.workspaceId, "finding workspaceId");
    requireNonEmpty(input.runId, "finding runId");
    requireNonEmpty(input.roundId, "finding roundId");
    requireNonEmpty(input.code, "finding code");
    requireNonEmpty(input.category, "finding category");
    requireNonEmpty(input.message, "finding message");
    requireNonEmpty(input.createdAt, "finding createdAt");
    assertSafeRecordFields(input, ["payload"]);
    const checksumValue = recordChecksum(input);
    const record: FindingRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM findings WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`finding ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO findings (id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, claim_id, section_id, requirement_id, created_at, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.roundId,
          input.executionId,
          input.artifactId,
          input.code,
          input.category,
          input.severity,
          input.message,
          input.claimId,
          input.sectionId,
          input.requirementId,
          input.createdAt,
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `finding:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "finding.appended",
        entityType: "finding",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.createdAt,
      });
    })();
    return record;
  }

  public async getFinding(id: string): Promise<FindingRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, claim_id, section_id, requirement_id, created_at, payload_json, record_checksum FROM findings WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : findingFromRow(row);
  }

  public async listFindings(runId: string): Promise<readonly FindingRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "finding runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, claim_id, section_id, requirement_id, created_at, payload_json, record_checksum FROM findings WHERE run_id = ? ORDER BY created_at, id",
      )
      .all(runId)
      .map((row) => findingFromRow(row));
  }

  public async saveDecision(input: DecisionRecordInput): Promise<DecisionRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "decision id");
    requireNonEmpty(input.workspaceId, "decision workspaceId");
    requireNonEmpty(input.runId, "decision runId");
    requireNonEmpty(input.rationale, "decision rationale");
    requireNonEmpty(input.actor, "decision actor");
    requireNonEmpty(input.createdAt, "decision createdAt");
    assertSafeRecordFields(input, ["payload"]);
    const checksumValue = recordChecksum(input);
    const record: DecisionRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM decisions WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`decision ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO decisions (id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.roundId,
          input.artifactId,
          input.type,
          input.rationale,
          input.actor,
          input.createdAt,
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `decision:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "decision.appended",
        entityType: "decision",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.createdAt,
      });
    })();
    return record;
  }

  public async getDecision(id: string): Promise<DecisionRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum FROM decisions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : decisionFromRow(row);
  }

  public async listDecisions(runId: string): Promise<readonly DecisionRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "decision runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum FROM decisions WHERE run_id = ? ORDER BY created_at, id",
      )
      .all(runId)
      .map((row) => decisionFromRow(row));
  }

  public async saveExport(input: ExportRecordInput): Promise<ExportRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "export id");
    requireNonEmpty(input.workspaceId, "export workspaceId");
    requireNonEmpty(input.runId, "export runId");
    requireNonEmpty(input.artifactId, "export artifactId");
    requireNonEmpty(input.format, "export format");
    requireNonEmpty(input.createdAt, "export createdAt");
    assertSafeRecordFields(input, ["payload"]);
    const checksumValue = recordChecksum(input);
    const record: ExportRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM exports WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`export ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO exports (id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.artifactId,
          input.format,
          input.status,
          input.outputPath,
          input.outputChecksum,
          input.createdAt,
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `export:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "export.appended",
        entityType: "export",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.createdAt,
      });
    })();
    return record;
  }

  public async getExport(id: string): Promise<ExportRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum FROM exports WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : exportFromRow(row);
  }

  public async listExports(runId: string): Promise<readonly ExportRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "export runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum FROM exports WHERE run_id = ? ORDER BY created_at, id",
      )
      .all(runId)
      .map((row) => exportFromRow(row));
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
    const rawTokens = query.trim().match(/[\p{L}\p{N}_-]+/gu);
    if (!rawTokens || rawTokens.length === 0) {
      return [];
    }
    const terms = rawTokens.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
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

  public async queryEvidence(
    query: string,
    options?: RetrievalOptions,
  ): Promise<readonly ScoredEvidenceChunk[]> {
    return this.searchEvidence(query, options);
  }

  public async backup(destination: string): Promise<void> {
    await this.createBackup(destination);
  }

  public async createBackup(destinationPath: string): Promise<WorkspaceBackupResult> {
    this.ensureOpen();
    requireNonEmpty(destinationPath, "backup destination");
    const parentDir = dirname(destinationPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    await this.database.backup(destinationPath);
    const content = readFileSync(destinationPath);
    const stat = statSync(destinationPath);
    const hash = createHash("sha256").update(content).digest("hex");
    return {
      backupPath: destinationPath,
      checksum: hash,
      sizeBytes: stat.size,
      createdAt: now(),
    };
  }

  public static verifyDatabaseIntegrity(databasePath: string): boolean {
    requireNonEmpty(databasePath, "database path");
    if (!existsSync(databasePath)) {
      return false;
    }
    try {
      const db = loadSqlite(databasePath);
      try {
        const quickCheck = db.pragma("quick_check") as
          | readonly { readonly quick_check?: string }[]
          | { readonly quick_check?: string };
        const integrityCheck = db.pragma("integrity_check") as
          | readonly { readonly integrity_check?: string }[]
          | { readonly integrity_check?: string };
        const isOk = (res: unknown): boolean => {
          if (Array.isArray(res)) {
            return (
              res.length === 1 && (res[0]?.quick_check === "ok" || res[0]?.integrity_check === "ok")
            );
          }
          if (typeof res === "object" && res !== null) {
            const r = res as Record<string, unknown>;
            return r.quick_check === "ok" || r.integrity_check === "ok";
          }
          return res === "ok";
        };
        return isOk(quickCheck) && isOk(integrityCheck);
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  public static async restore(
    backupPath: string,
    destinationPath: string,
    options: WorkspaceRestoreOptions = {},
  ): Promise<SqliteStorage> {
    requireNonEmpty(backupPath, "backup path");
    requireNonEmpty(destinationPath, "destination path");
    if (!existsSync(backupPath)) {
      throw new StorageValidationError(`Backup file not found at: ${backupPath}`);
    }
    if (options.verifyIntegrity !== false) {
      const valid = SqliteStorage.verifyDatabaseIntegrity(backupPath);
      if (!valid) {
        throw new StorageValidationError(
          `Backup file at ${backupPath} failed SQLite integrity check.`,
        );
      }
    }
    const destDir = dirname(destinationPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(backupPath, destinationPath);
    return new SqliteStorage(destinationPath);
  }

  /**
   * Returns an external-archive plan without deleting local immutable history.
   * Retention deletion is intentionally outside this v1 storage boundary.
   */
  public async planRetention(before: string): Promise<RetentionPlan> {
    this.ensureOpen();
    requireNonEmpty(before, "retention before");
    if (Number.isNaN(Date.parse(before))) {
      throw new StorageValidationError("retention before must be a valid timestamp");
    }
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE created_at < ?")
      .get<{ readonly count: number }>(before);
    return {
      before,
      auditEventsEligible: Number(row?.count ?? 0),
      immutableBusinessRecords: true,
    };
  }

  public async purgeRetention(
    before: string,
    options: RetentionPurgeOptions,
  ): Promise<RetentionPurgeResult> {
    this.ensureOpen();
    requireNonEmpty(before, "retention before");
    if (Number.isNaN(Date.parse(before))) {
      throw new StorageValidationError("retention before must be a valid timestamp");
    }
    if (options?.confirmed !== true) {
      throw new StorageValidationError(
        "Explicit user confirmation (options.confirmed = true) is required to purge retention records.",
      );
    }
    const executedAt = now();
    const countRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE created_at < ?")
      .get<{ readonly count: number }>(before);
    const eligibleCount = Number(countRow?.count ?? 0);

    const purgeTx = this.database.transaction(() => {
      this.database.prepare("DROP TRIGGER IF EXISTS audit_events_immutable_delete").run();
      this.database.prepare("DELETE FROM audit_events WHERE created_at < ?").run(before);
      this.database
        .prepare(
          "CREATE TRIGGER IF NOT EXISTS audit_events_immutable_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;",
        )
        .run();
    });
    purgeTx();

    return {
      before,
      deletedAuditEventsCount: eligibleCount,
      executedAt,
    };
  }

  public async exportDiagnosticTelemetry(): Promise<DiagnosticTelemetryReport> {
    this.ensureOpen();
    const workspacesCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM workspaces")
        .get<{ readonly count: number }>()?.count ?? 0,
    );
    const totalRunsCount = Number(
      this.database.prepare("SELECT COUNT(*) AS count FROM runs").get<{ readonly count: number }>()
        ?.count ?? 0,
    );
    const totalRoundsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM rounds")
        .get<{ readonly count: number }>()?.count ?? 0,
    );
    const totalExecutionsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM executions")
        .get<{ readonly count: number }>()?.count ?? 0,
    );

    const execStatusRows = this.database
      .prepare("SELECT status, COUNT(*) AS count FROM executions GROUP BY status")
      .all<{ readonly status: string; readonly count: number }>();
    const executionsByStatus: Record<string, number> = {};
    for (const row of execStatusRows) {
      executionsByStatus[row.status] = Number(row.count);
    }

    const execStepRows = this.database
      .prepare("SELECT step, COUNT(*) AS count FROM executions GROUP BY step")
      .all<{ readonly step: string; readonly count: number }>();
    const executionsByStep: Record<string, number> = {};
    for (const row of execStepRows) {
      executionsByStep[row.step] = Number(row.count);
    }

    const findingsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM findings")
        .get<{ readonly count: number }>()?.count ?? 0,
    );
    const findingSeverityRows = this.database
      .prepare("SELECT severity, COUNT(*) AS count FROM findings GROUP BY severity")
      .all<{ readonly severity: string; readonly count: number }>();
    const findingsBySeverity: Record<string, number> = {};
    for (const row of findingSeverityRows) {
      findingsBySeverity[row.severity] = Number(row.count);
    }

    const decisionsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM decisions")
        .get<{ readonly count: number }>()?.count ?? 0,
    );

    const tokenRow = this.database
      .prepare(
        "SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens, SUM(estimated_usd) AS total_cost_usd FROM executions",
      )
      .get<{
        readonly input_tokens?: number | null;
        readonly output_tokens?: number | null;
        readonly total_tokens?: number | null;
        readonly total_cost_usd?: number | null;
      }>();

    const providerRows = this.database
      .prepare("SELECT provider, COUNT(*) AS count FROM executions GROUP BY provider")
      .all<{ readonly provider: string; readonly count: number }>();
    const providersDistribution: Record<string, number> = {};
    for (const row of providerRows) {
      providersDistribution[row.provider] = Number(row.count);
    }

    const aggregates = {
      workspacesCount,
      totalRunsCount,
      totalRoundsCount,
      totalExecutionsCount,
      executionsByStatus: Object.freeze(executionsByStatus),
      executionsByStep: Object.freeze(executionsByStep),
      findingsCount,
      findingsBySeverity: Object.freeze(findingsBySeverity),
      decisionsCount,
      totalCostUsd: Number(tokenRow?.total_cost_usd ?? 0),
      totalTokens: Object.freeze({
        inputTokens: Number(tokenRow?.input_tokens ?? 0),
        outputTokens: Number(tokenRow?.output_tokens ?? 0),
        totalTokens: Number(tokenRow?.total_tokens ?? 0),
      }),
      providersDistribution: Object.freeze(providersDistribution),
    };

    const generatedAt = now();
    const payloadStr = JSON.stringify({ aggregates, generatedAt, schemaVersion: 1 });
    const checksum = createHash("sha256").update(payloadStr).digest("hex");

    return Object.freeze({
      generatedAt,
      schemaVersion: 1,
      aggregates: Object.freeze(aggregates),
      checksum,
    });
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

function recordToJson(record: unknown): JsonValue {
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

function runFromRow(row: Record<string, unknown>): RunRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    state: rowString(row, "state") as StoredRunState,
    round: rowNumber(row, "round"),
    currentStep: rowNullableString(row, "current_step") as StoredRunStep,
    budget: parse(rowString(row, "budget_json")),
    artifactId: rowNullableString(row, "artifact_id"),
    approval: rowString(row, "approval") as StoredApprovalStatus,
    totalCostUsd: rowNumber(row, "total_cost_usd"),
    startedAt: rowString(row, "started_at"),
    updatedAt: rowString(row, "updated_at"),
    lastError: rowNullableJson(row, "last_error_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function runSnapshotFromRow(row: Record<string, unknown>): RunSnapshotRecord {
  return {
    sequence: rowNumber(row, "sequence"),
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    state: rowString(row, "state") as StoredRunState,
    round: rowNumber(row, "round"),
    currentStep: rowNullableString(row, "current_step") as StoredRunStep,
    budget: parse(rowString(row, "budget_json")),
    artifactId: rowNullableString(row, "artifact_id"),
    approval: rowString(row, "approval") as StoredApprovalStatus,
    totalCostUsd: rowNumber(row, "total_cost_usd"),
    startedAt: rowString(row, "started_at"),
    updatedAt: rowString(row, "updated_at"),
    lastError: rowNullableJson(row, "last_error_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function roundFromRow(row: Record<string, unknown>): RoundRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    number: rowNumber(row, "number"),
    state: rowString(row, "state") as StoredRoundState,
    startedAt: rowString(row, "started_at"),
    completedAt: rowNullableString(row, "completed_at"),
    evaluation: rowNullableJson(row, "evaluation_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function executionFromRow(row: Record<string, unknown>): ExecutionRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowString(row, "round_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    attempt: rowNumber(row, "attempt"),
    step: rowString(row, "step") as StoredExecutionStep,
    status: rowString(row, "status") as StoredExecutionStatus,
    provider: rowString(row, "provider"),
    modelId: rowString(row, "model_id"),
    providerRequestId: rowNullableString(row, "provider_request_id"),
    outputChecksum: rowNullableString(row, "output_checksum"),
    inputTokens: rowNumber(row, "input_tokens"),
    outputTokens: rowNumber(row, "output_tokens"),
    totalTokens: rowNumber(row, "total_tokens"),
    estimatedUsd: rowNullableNumber(row, "estimated_usd"),
    startedAt: rowString(row, "started_at"),
    completedAt: rowNullableString(row, "completed_at"),
    errorCode: rowNullableString(row, "error_code"),
    output: rowNullableJson(row, "output_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function findingFromRow(row: Record<string, unknown>): FindingRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowString(row, "round_id"),
    executionId: rowNullableString(row, "execution_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    code: rowString(row, "code"),
    category: rowString(row, "category"),
    severity: rowString(row, "severity") as StoredFindingSeverity,
    message: rowString(row, "message"),
    claimId: rowNullableString(row, "claim_id"),
    sectionId: rowNullableString(row, "section_id"),
    requirementId: rowNullableString(row, "requirement_id"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function decisionFromRow(row: Record<string, unknown>): DecisionRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowNullableString(row, "round_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    type: rowString(row, "type") as StoredDecisionType,
    rationale: rowString(row, "rationale"),
    actor: rowString(row, "actor"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function exportFromRow(row: Record<string, unknown>): ExportRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    artifactId: rowString(row, "artifact_id"),
    format: rowString(row, "format"),
    status: rowString(row, "status") as StoredExportStatus,
    outputPath: rowNullableString(row, "output_path"),
    outputChecksum: rowNullableString(row, "output_checksum"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
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
