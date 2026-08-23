import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  type CandidateKnowledgeBaseState,
  type EvidenceRetrievalInspection,
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

export interface CandidateKnowledgeBaseInput {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
}

export interface CandidateKnowledgeBaseRecord {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly state: CandidateKnowledgeBaseState;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export type CandidateKnowledgeSourceKind = "file" | "url";

export interface CandidateKnowledgeSourceInput {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly kind: CandidateKnowledgeSourceKind;
  readonly displayName: string;
  readonly createdAt: string;
}

export type CandidateKnowledgeSourceRecord = CandidateKnowledgeSourceInput;

/** Sensitive local-only state remembered for a successfully managed file import. */
export interface CandidateKnowledgeSourceOriginBindingRecord {
  readonly sourceId: string;
  readonly originPath: string;
  readonly boundAt: string;
}

export interface CandidateKnowledgeDirectoryBindingInput {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly rootPath: string;
  readonly boundAt: string;
  /** Ordered source IDs whose existing file bindings define membership. */
  readonly sourceIds: readonly string[];
}

export interface CandidateKnowledgeDirectoryBindingRecord {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly rootPath: string;
  readonly boundAt: string;
}

export interface CandidateKnowledgeDirectoryMemberRecord {
  readonly directoryId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly relativePathHash: string;
}

export type CandidateKnowledgeDirectoryMemberOriginRelation =
  | "same-member"
  | "other-member"
  | "unmatched"
  | "outside-root"
  | "unbound";

export interface CandidateKnowledgeDirectoryMemberOriginRelationRecord {
  readonly directoryId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly relation: CandidateKnowledgeDirectoryMemberOriginRelation;
  /** Present only when the source currently has an origin binding. */
  readonly originBoundAt?: string;
}

export type CandidateKnowledgeDirectoryRefreshObservationStatus = Extract<
  CandidateKnowledgeSourceRefreshObservationStatus,
  "current" | "changed" | "missing"
>;

export interface CandidateKnowledgeDirectoryRefreshObservationInput {
  readonly sourceId: string;
  readonly observedVersionId: string;
  readonly status: CandidateKnowledgeDirectoryRefreshObservationStatus;
  readonly expectedOriginBoundAt: string;
}

export interface CandidateKnowledgeDirectoryRefreshObservationBatchInput {
  readonly checkedAt: string;
  readonly entries: readonly CandidateKnowledgeDirectoryRefreshObservationInput[];
}

export interface CandidateKnowledgeSourceVersionInput {
  readonly id: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface CandidateKnowledgeSourceVersionRecord
  extends CandidateKnowledgeSourceVersionInput {
  readonly sourceId: string;
  readonly version: number;
  readonly parentVersionId: string | null;
}

export const candidateKnowledgeSourceUrlKinds = [
  "github",
  "certification",
  "profile",
  "portfolio",
  "job-description",
  "generic",
] as const;
export type CandidateKnowledgeSourceUrlKind = (typeof candidateKnowledgeSourceUrlKinds)[number];

export interface CandidateKnowledgeSourceUrlProvenanceInput {
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly kind: CandidateKnowledgeSourceUrlKind;
}

export interface CandidateKnowledgeSourceUrlProvenanceRecord
  extends CandidateKnowledgeSourceUrlProvenanceInput {
  readonly sourceId: string;
  readonly versionId: string;
}

export type CandidateKnowledgeSourceRefreshObservationStatus =
  | "current"
  | "changed"
  | "missing"
  | "inaccessible"
  | "unbound";

export interface CandidateKnowledgeSourceRefreshObservationInput {
  readonly observedVersionId: string;
  readonly status: CandidateKnowledgeSourceRefreshObservationStatus;
  readonly checkedAt: string;
  readonly lastRefreshedVersionId?: string | null;
  readonly lastRefreshedAt?: string | null;
}

export interface CandidateKnowledgeSourceRefreshObservationRecord
  extends CandidateKnowledgeSourceRefreshObservationInput {
  readonly sourceId: string;
  readonly lastRefreshedVersionId: string | null;
  readonly lastRefreshedAt: string | null;
  /** Derived from the source's current latest version; never persisted. */
  readonly stale: boolean;
}

export const candidateKnowledgeSourceRetirementReasons = ["user-requested"] as const;
export type CandidateKnowledgeSourceRetirementReason =
  (typeof candidateKnowledgeSourceRetirementReasons)[number];

export interface CandidateKnowledgeSourceRetirementInput {
  readonly retiredAt: string;
  readonly reason: CandidateKnowledgeSourceRetirementReason;
}

export interface CandidateKnowledgeSourceRetirementRecord
  extends CandidateKnowledgeSourceRetirementInput {
  readonly sourceId: string;
}

export interface CandidateKnowledgeSourceVersionWriteResult {
  readonly source: CandidateKnowledgeSourceRecord;
  readonly version: CandidateKnowledgeSourceVersionRecord;
  readonly created: boolean;
}

export interface ManagedCandidateKnowledgeSourceVersionRecord
  extends CandidateKnowledgeSourceVersionRecord {
  readonly knowledgeBaseId: string;
  readonly kind: CandidateKnowledgeSourceKind;
}

export type ManagedCandidateKnowledgeWriteKind = "create" | "append";
export type ManagedCandidateKnowledgeWriteEventState =
  | "targeted"
  | "published"
  | "committed"
  | "completed"
  | "aborted"
  | "noop";

export interface ManagedCandidateKnowledgeWriteOperationInput {
  readonly operationId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly requestedVersionId: string;
  readonly kind: ManagedCandidateKnowledgeWriteKind;
  readonly createdAt: string;
}

type ManagedCandidateKnowledgeWriteOperationRecord = ManagedCandidateKnowledgeWriteOperationInput;

export type ManagedCandidateKnowledgeWriteCommitInput =
  | {
      readonly kind: "create";
      readonly operationId: string;
      readonly source: CandidateKnowledgeSourceInput;
      readonly version: CandidateKnowledgeSourceVersionInput;
      /** Canonical physical path returned by the verified managed-file capture. */
      readonly originPath?: string;
      readonly urlProvenance?: CandidateKnowledgeSourceUrlProvenanceInput;
    }
  | {
      readonly kind: "append";
      readonly operationId: string;
      readonly version: CandidateKnowledgeSourceVersionInput;
      /** Required for URL appends; forbidden for file appends. */
      readonly urlProvenance?: CandidateKnowledgeSourceUrlProvenanceInput;
      /** Runtime lineage guard used by URL refresh; never persisted. */
      readonly expectedCurrentVersionId?: string;
    };

export interface CandidateKnowledgeBaseStoragePort {
  readonly ensureDefaultCandidateKnowledgeBase: (
    input: Omit<CandidateKnowledgeBaseInput, "isDefault">,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly createCandidateKnowledgeBase: (
    input: CandidateKnowledgeBaseInput,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly getCandidateKnowledgeBase: (
    id: string,
  ) => Promise<CandidateKnowledgeBaseRecord | undefined>;
  readonly listCandidateKnowledgeBases: () => Promise<readonly CandidateKnowledgeBaseRecord[]>;
  readonly renameCandidateKnowledgeBase: (
    id: string,
    displayName: string,
    updatedAt: string,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly archiveCandidateKnowledgeBase: (
    id: string,
    archivedAt: string,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly createCandidateKnowledgeSource: (
    source: CandidateKnowledgeSourceInput,
    initialVersion: CandidateKnowledgeSourceVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly appendCandidateKnowledgeSourceVersion: (
    knowledgeBaseId: string,
    sourceId: string,
    version: CandidateKnowledgeSourceVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly getCandidateKnowledgeSource: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceRecord | undefined>;
  readonly listCandidateKnowledgeSources: (
    knowledgeBaseId: string,
  ) => Promise<readonly CandidateKnowledgeSourceRecord[]>;
  readonly listCandidateKnowledgeSourceVersions: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<readonly CandidateKnowledgeSourceVersionRecord[]>;
  readonly createCandidateKnowledgeDirectoryBinding: (
    input: CandidateKnowledgeDirectoryBindingInput,
  ) => Promise<CandidateKnowledgeDirectoryBindingRecord>;
  readonly getCandidateKnowledgeDirectoryBinding: (
    knowledgeBaseId: string,
    directoryId: string,
  ) => Promise<CandidateKnowledgeDirectoryBindingRecord | undefined>;
  readonly findCandidateKnowledgeDirectoryBinding: (
    knowledgeBaseId: string,
    rootPath: string,
  ) => Promise<CandidateKnowledgeDirectoryBindingRecord | undefined>;
  readonly listCandidateKnowledgeDirectoryMembers: (
    knowledgeBaseId: string,
    directoryId: string,
  ) => Promise<readonly CandidateKnowledgeDirectoryMemberRecord[]>;
  readonly findCandidateKnowledgeDirectoryMemberByPath: (
    knowledgeBaseId: string,
    directoryId: string,
    sourcePath: string,
  ) => Promise<CandidateKnowledgeDirectoryMemberRecord | undefined>;
  readonly getCandidateKnowledgeDirectoryMemberOriginRelation: (
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeDirectoryMemberOriginRelationRecord>;
  readonly upsertCandidateKnowledgeDirectoryRefreshObservations: (
    knowledgeBaseId: string,
    directoryId: string,
    input: CandidateKnowledgeDirectoryRefreshObservationBatchInput,
  ) => Promise<readonly CandidateKnowledgeSourceRefreshObservationRecord[]>;
  readonly getCandidateKnowledgeSourceUrlProvenance: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<CandidateKnowledgeSourceUrlProvenanceRecord | undefined>;
  readonly getCandidateKnowledgeSourceRefreshObservation: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceRefreshObservationRecord | undefined>;
  readonly upsertCandidateKnowledgeSourceRefreshObservation: (
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRefreshObservationInput,
  ) => Promise<CandidateKnowledgeSourceRefreshObservationRecord>;
  readonly getCandidateKnowledgeSourceRetirement: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceRetirementRecord | undefined>;
  readonly retireCandidateKnowledgeSource: (
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRetirementInput,
  ) => Promise<CandidateKnowledgeSourceRetirementRecord>;
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

const maximumEvidenceQueryTerms = 48;
const evidenceQueryStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "will",
  "with",
  "you",
  "your",
]);

function evidenceQueryTerms(query: string): readonly string[] {
  const rawTokens = query.trim().match(/[\p{L}\p{N}_-]+/gu);
  if (rawTokens === null) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of rawTokens) {
    const normalized = token.toLocaleLowerCase("en-US");
    if (normalized.length < 2 || evidenceQueryStopWords.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(token);
    if (terms.length === maximumEvidenceQueryTerms) break;
  }
  return terms;
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

export const storageSchemaVersion = 13 as const;

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

const migrationFour: Migration = {
  version: 4,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_bases (
      id TEXT PRIMARY KEY NOT NULL,
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

    CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_bases_one_default_idx
      ON candidate_knowledge_bases(is_default)
      WHERE is_default = 1;
  `.trim(),
};

const migrationFive: Migration = {
  version: 5,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_sources (
      id TEXT PRIMARY KEY NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases(id),
      kind TEXT NOT NULL CHECK (kind IN ('file', 'url')),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      created_at TEXT NOT NULL,
      UNIQUE (id, candidate_knowledge_base_id)
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_versions (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT NOT NULL REFERENCES candidate_knowledge_sources(id),
      version INTEGER NOT NULL CHECK (version >= 1),
      parent_version_id TEXT,
      media_type TEXT NOT NULL CHECK (length(trim(media_type)) > 0),
      checksum TEXT NOT NULL CHECK (
        length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'
      ),
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND typeof(size_bytes) = 'integer'),
      created_at TEXT NOT NULL,
      UNIQUE (source_id, version),
      UNIQUE (id, source_id),
      FOREIGN KEY (parent_version_id, source_id)
        REFERENCES candidate_knowledge_source_versions(id, source_id),
      CHECK (
        (version = 1 AND parent_version_id IS NULL) OR
        (version > 1 AND parent_version_id IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS candidate_knowledge_sources_ckb_created_idx
      ON candidate_knowledge_sources(candidate_knowledge_base_id, created_at, id);
    CREATE INDEX IF NOT EXISTS candidate_knowledge_source_versions_source_version_idx
      ON candidate_knowledge_source_versions(source_id, version, id);

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_sources_immutable_update
      BEFORE UPDATE ON candidate_knowledge_sources
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_sources_immutable_delete
      BEFORE DELETE ON candidate_knowledge_sources
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_versions_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_versions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_versions_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_versions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source versions are immutable'); END;
  `.trim(),
};

const migrationSix: Migration = {
  version: 6,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_source_versions (
      version_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_source_versions(id)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_require_file
      BEFORE INSERT ON candidate_knowledge_managed_source_versions
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_source_versions AS v
        JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
        WHERE v.id = NEW.version_id AND s.kind = 'file'
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions require a file source'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_source_versions
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_source_versions
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions are immutable'); END;
  `.trim(),
};

const migrationSeven: Migration = {
  version: 7,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_write_operations (
      operation_id TEXT PRIMARY KEY NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases(id),
      source_id TEXT NOT NULL,
      requested_version_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('create', 'append')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_write_events (
      operation_id TEXT NOT NULL
        REFERENCES candidate_knowledge_managed_write_operations(operation_id),
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      state TEXT NOT NULL CHECK (
        state IN ('targeted', 'published', 'committed', 'completed', 'aborted', 'noop')
      ),
      target_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (operation_id, sequence)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_operations_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_write_operations
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write operations are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_operations_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_write_operations
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write operations are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_write_events
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_write_events
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write events are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_contiguous_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NEW.sequence <> COALESCE((
        SELECT MAX(sequence) + 1
        FROM candidate_knowledge_managed_write_events
        WHERE operation_id = NEW.operation_id
      ), 1)
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event sequence is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_target_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN (
        EXISTS (
          SELECT 1 FROM candidate_knowledge_managed_write_events
          WHERE operation_id = NEW.operation_id AND target_version_id <> NEW.target_version_id
        ) OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_managed_write_operations AS operation
          WHERE operation.operation_id = NEW.operation_id
            AND (
              operation.requested_version_id = NEW.target_version_id OR
              (
                operation.kind = 'append' AND EXISTS (
                  SELECT 1 FROM candidate_knowledge_source_versions AS version
                  WHERE version.id = NEW.target_version_id
                    AND version.source_id = operation.source_id
                )
              )
            )
        )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event target is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_timestamp_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN julianday(NEW.created_at) IS NULL OR EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        WHERE operation.operation_id = NEW.operation_id
          AND julianday(NEW.created_at) < julianday(operation.created_at)
      ) OR EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_events AS event
        WHERE event.operation_id = NEW.operation_id
          AND julianday(NEW.created_at) < julianday(event.created_at)
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event timestamp is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_transition_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NOT (
        (NEW.sequence = 1 AND NEW.state IN ('targeted', 'noop')) OR
        (
          NEW.sequence > 1 AND EXISTS (
            SELECT 1
            FROM candidate_knowledge_managed_write_events AS previous
            WHERE previous.operation_id = NEW.operation_id
              AND previous.sequence = NEW.sequence - 1
              AND (
                (previous.state = 'targeted' AND NEW.state IN ('published', 'aborted')) OR
                (previous.state = 'published' AND NEW.state IN ('committed', 'aborted')) OR
                (previous.state = 'committed' AND NEW.state = 'completed')
              )
          )
        )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event transition is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_commit_target_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NEW.state IN ('committed', 'completed') AND NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        JOIN candidate_knowledge_sources AS source
          ON source.id = operation.source_id
         AND source.candidate_knowledge_base_id = operation.candidate_knowledge_base_id
        JOIN candidate_knowledge_source_versions AS version
          ON version.id = NEW.target_version_id
         AND version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE operation.operation_id = NEW.operation_id
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write commit target is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_noop_target_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NEW.state = 'noop' AND NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        JOIN candidate_knowledge_sources AS source
          ON source.id = operation.source_id
         AND source.candidate_knowledge_base_id = operation.candidate_knowledge_base_id
        JOIN candidate_knowledge_source_versions AS version
          ON version.id = NEW.target_version_id
         AND version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE operation.operation_id = NEW.operation_id
          AND operation.kind = 'append'
          AND version.version = (
            SELECT MAX(current.version)
            FROM candidate_knowledge_source_versions AS current
            WHERE current.source_id = source.id
          )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write noop target is invalid'); END;
  `.trim(),
};

const migrationEight: Migration = {
  version: 8,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_origin_bindings (
      source_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      origin_path TEXT NOT NULL CHECK (length(trim(origin_path)) > 0),
      bound_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_require_managed_file
      BEFORE INSERT ON candidate_knowledge_source_origin_bindings
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_sources AS source
        JOIN candidate_knowledge_source_versions AS version
          ON version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE source.id = NEW.source_id AND source.kind = 'file'
      )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin bindings require a managed file source'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_origin_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_origin_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin bindings are immutable'); END;
  `.trim(),
};

const migrationNine: Migration = {
  version: 9,
  sql: `
    DROP TRIGGER IF EXISTS candidate_knowledge_source_origin_bindings_immutable_update;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_guarded_update
      BEFORE UPDATE ON candidate_knowledge_source_origin_bindings
      WHEN NEW.source_id <> OLD.source_id
        OR length(trim(NEW.origin_path)) = 0
        OR julianday(NEW.bound_at) IS NULL
        OR julianday(OLD.bound_at) IS NULL
        OR julianday(NEW.bound_at) < julianday(OLD.bound_at)
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_sources AS source
          JOIN candidate_knowledge_source_versions AS version
            ON version.source_id = source.id
          JOIN candidate_knowledge_managed_source_versions AS managed
            ON managed.version_id = version.id
          WHERE source.id = NEW.source_id AND source.kind = 'file'
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin binding replacement is invalid'); END;
  `.trim(),
};

const migrationTen: Migration = {
  version: 10,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_refresh_observations (
      source_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      observed_version_id TEXT NOT NULL
        REFERENCES candidate_knowledge_source_versions(id),
      status TEXT NOT NULL CHECK (status IN ('current', 'changed', 'missing', 'inaccessible', 'unbound')),
      checked_at TEXT NOT NULL,
      last_refreshed_version_id TEXT NULL
        REFERENCES candidate_knowledge_source_versions(id),
      last_refreshed_at TEXT NULL,
      CHECK ((last_refreshed_version_id IS NULL) = (last_refreshed_at IS NULL))
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_refresh_observations_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_source_refresh_observations
      WHEN julianday(NEW.checked_at) IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_source_versions AS version
          WHERE version.id = NEW.observed_version_id
            AND version.source_id = NEW.source_id
        )
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_versions AS version
            WHERE version.id = NEW.last_refreshed_version_id
              AND version.source_id = NEW.source_id
          )
        )
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) IS NULL
        )
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) > julianday(NEW.checked_at)
        )
        OR ((NEW.last_refreshed_version_id IS NULL) <> (NEW.last_refreshed_at IS NULL))
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND (
            NEW.status <> 'current'
            OR NEW.observed_version_id <> NEW.last_refreshed_version_id
            OR julianday(NEW.checked_at) <> julianday(NEW.last_refreshed_at)
          )
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source refresh observation is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_refresh_observations_guarded_update
      BEFORE UPDATE ON candidate_knowledge_source_refresh_observations
      WHEN NEW.source_id <> OLD.source_id
        OR julianday(NEW.checked_at) IS NULL
        OR julianday(OLD.checked_at) IS NULL
        OR julianday(NEW.checked_at) < julianday(OLD.checked_at)
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_source_versions AS version
          WHERE version.id = NEW.observed_version_id
            AND version.source_id = NEW.source_id
        )
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_versions AS version
            WHERE version.id = NEW.last_refreshed_version_id
              AND version.source_id = NEW.source_id
          )
        )
        OR ((NEW.last_refreshed_version_id IS NULL) <> (NEW.last_refreshed_at IS NULL))
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) IS NULL
        )
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) > julianday(NEW.checked_at)
        )
        OR (
          OLD.last_refreshed_at IS NOT NULL
          AND (
            NEW.last_refreshed_at IS NULL
            OR julianday(NEW.last_refreshed_at) < julianday(OLD.last_refreshed_at)
          )
        )
        OR (
          OLD.last_refreshed_version_id IS NOT NULL
          AND NEW.last_refreshed_version_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_versions AS old_version
            JOIN candidate_knowledge_source_versions AS new_version
              ON new_version.id = NEW.last_refreshed_version_id
             AND new_version.source_id = NEW.source_id
            WHERE old_version.id = OLD.last_refreshed_version_id
              AND old_version.source_id = OLD.source_id
              AND new_version.version >= old_version.version
          )
        )
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND (
            OLD.last_refreshed_version_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM candidate_knowledge_source_versions AS old_version
              JOIN candidate_knowledge_source_versions AS new_version
                ON new_version.id = NEW.last_refreshed_version_id
               AND new_version.source_id = NEW.source_id
              WHERE old_version.id = OLD.last_refreshed_version_id
                AND old_version.source_id = OLD.source_id
                AND new_version.version > old_version.version
            )
          )
          AND (
            NEW.status <> 'current'
            OR NEW.observed_version_id <> NEW.last_refreshed_version_id
            OR julianday(NEW.checked_at) <> julianday(NEW.last_refreshed_at)
          )
        )
        OR (
          OLD.last_refreshed_version_id IS NOT NULL
          AND NEW.last_refreshed_version_id = OLD.last_refreshed_version_id
          AND julianday(NEW.last_refreshed_at) <> julianday(OLD.last_refreshed_at)
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source refresh observation replacement is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_refresh_observations_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_refresh_observations
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source refresh observations are immutable'); END;
  `.trim(),
};

const migrationEleven: Migration = {
  version: 11,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_retirements (
      source_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      retired_at TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason = 'user-requested')
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_retirements_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_source_retirements
      WHEN julianday(NEW.retired_at) IS NULL
        OR NEW.reason <> 'user-requested'
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_sources AS source
          JOIN candidate_knowledge_bases AS knowledge_base
            ON knowledge_base.id = source.candidate_knowledge_base_id
           AND knowledge_base.state = 'active'
          WHERE source.id = NEW.source_id
            AND julianday(NEW.retired_at) >= julianday(source.created_at)
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source retirement is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_retirements_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_retirements
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source retirements are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_retirements_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_retirements
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source retirements are immutable'); END;
  `.trim(),
};

const migrationTwelve: Migration = {
  version: 12,
  sql: `
    DROP TRIGGER IF EXISTS candidate_knowledge_managed_source_versions_require_file;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_require_supported_source
      BEFORE INSERT ON candidate_knowledge_managed_source_versions
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_source_versions AS version
        JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
        WHERE version.id = NEW.version_id
          AND source.kind IN ('file', 'url')
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions require a supported source'); END;

    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_url_provenance (
      version_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_source_versions(id),
      source_id TEXT NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      original_url TEXT NOT NULL CHECK (length(trim(original_url)) > 0),
      final_url TEXT NOT NULL CHECK (length(trim(final_url)) > 0),
      fetched_at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('github', 'certification', 'profile', 'portfolio', 'job-description', 'generic')),
      UNIQUE (source_id, version_id)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_url_provenance_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_source_url_provenance
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_source_versions AS version
        JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE version.id = NEW.version_id
          AND version.source_id = NEW.source_id
          AND source.kind = 'url'
          AND julianday(NEW.fetched_at) IS NOT NULL
          AND julianday(NEW.fetched_at) = julianday(version.created_at)
      )
        OR lower(NEW.original_url) NOT LIKE 'https://%'
        OR lower(NEW.final_url) NOT LIKE 'https://%'
        OR instr(NEW.original_url, '#') > 0
        OR instr(NEW.final_url, '#') > 0
        OR (
          instr(substr(NEW.original_url, 9), '@') > 0
          AND instr(substr(NEW.original_url, 9), '@') < min(
            CASE WHEN instr(substr(NEW.original_url, 9), '/') = 0
              THEN length(substr(NEW.original_url, 9)) + 1
              ELSE instr(substr(NEW.original_url, 9), '/') END,
            CASE WHEN instr(substr(NEW.original_url, 9), '?') = 0
              THEN length(substr(NEW.original_url, 9)) + 1
              ELSE instr(substr(NEW.original_url, 9), '?') END
          )
        )
        OR (
          instr(substr(NEW.final_url, 9), '@') > 0
          AND instr(substr(NEW.final_url, 9), '@') < min(
            CASE WHEN instr(substr(NEW.final_url, 9), '/') = 0
              THEN length(substr(NEW.final_url, 9)) + 1
              ELSE instr(substr(NEW.final_url, 9), '/') END,
            CASE WHEN instr(substr(NEW.final_url, 9), '?') = 0
              THEN length(substr(NEW.final_url, 9)) + 1
              ELSE instr(substr(NEW.final_url, 9), '?') END
          )
        )
        OR EXISTS (
          SELECT 1
          FROM candidate_knowledge_source_url_provenance AS prior
          WHERE prior.source_id = NEW.source_id
            AND prior.original_url <> NEW.original_url
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source URL provenance is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_url_provenance_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_url_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source URL provenance is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_url_provenance_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_url_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source URL provenance is immutable'); END;
  `.trim(),
};

const migrationThirteen: Migration = {
  version: 13,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_directory_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL
        REFERENCES candidate_knowledge_bases(id),
      root_path TEXT NOT NULL CHECK (length(trim(root_path)) > 0),
      bound_at TEXT NOT NULL,
      UNIQUE (id, candidate_knowledge_base_id),
      UNIQUE (candidate_knowledge_base_id, root_path)
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_directory_members (
      directory_id TEXT NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      relative_path_hash TEXT NOT NULL CHECK (
        length(relative_path_hash) = 64
        AND relative_path_hash NOT GLOB '*[^0-9a-f]*'
      ),
      PRIMARY KEY (directory_id, relative_path_hash),
      UNIQUE (source_id),
      FOREIGN KEY (directory_id, candidate_knowledge_base_id)
        REFERENCES candidate_knowledge_directory_bindings(id, candidate_knowledge_base_id),
      FOREIGN KEY (source_id, candidate_knowledge_base_id)
        REFERENCES candidate_knowledge_sources(id, candidate_knowledge_base_id)
    );

    CREATE INDEX IF NOT EXISTS candidate_knowledge_directory_members_scope_idx
      ON candidate_knowledge_directory_members(candidate_knowledge_base_id, directory_id);

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_bindings_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_directory_bindings
      WHEN length(trim(NEW.id)) = 0
        OR julianday(NEW.bound_at) IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_bases AS knowledge_base
          WHERE knowledge_base.id = NEW.candidate_knowledge_base_id
            AND knowledge_base.state = 'active'
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory binding is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_members_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_directory_members
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_sources AS source
        JOIN candidate_knowledge_source_origin_bindings AS binding
          ON binding.source_id = source.id
        JOIN candidate_knowledge_source_versions AS version
          ON version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE source.id = NEW.source_id
          AND source.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
          AND source.kind = 'file'
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_retirements AS retirement
            WHERE retirement.source_id = source.id
          )
      )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory member source is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_bindings_immutable_update
      BEFORE UPDATE ON candidate_knowledge_directory_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_bindings_immutable_delete
      BEFORE DELETE ON candidate_knowledge_directory_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_members_immutable_update
      BEFORE UPDATE ON candidate_knowledge_directory_members
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory members are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_members_immutable_delete
      BEFORE DELETE ON candidate_knowledge_directory_members
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory members are immutable'); END;
  `.trim(),
};

const migrations: readonly Migration[] = [
  migrationOne,
  migrationTwo,
  migrationThree,
  migrationFour,
  migrationFive,
  migrationSix,
  migrationSeven,
  migrationEight,
  migrationNine,
  migrationTen,
  migrationEleven,
  migrationTwelve,
  migrationThirteen,
];
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

function requireAbsolutePath(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (!isAbsolute(normalized)) {
    throw new StorageValidationError(`${field} must be an absolute path`);
  }
  return normalized;
}

function requireCanonicalAbsolutePath(value: string, field: string): string {
  const absolutePath = requireAbsolutePath(value, field);
  const canonicalPath = resolve(absolutePath);
  if (canonicalPath !== absolutePath) {
    throw new StorageValidationError(`${field} must be canonical`);
  }
  return canonicalPath;
}

function directoryMemberRelativePathSegments(
  rootPath: string,
  originPath: string,
): readonly string[] | undefined {
  const canonicalRoot = requireCanonicalAbsolutePath(
    rootPath,
    "candidate knowledge directory root path",
  );
  const canonicalOrigin = requireCanonicalAbsolutePath(
    originPath,
    "candidate knowledge source origin path",
  );
  const memberRelativePath = relative(canonicalRoot, canonicalOrigin);
  if (memberRelativePath === "" || isAbsolute(memberRelativePath)) return undefined;
  const segments = memberRelativePath.split(sep);
  if (segments[0] === ".." || segments.some((segment) => segment === "" || segment === ".")) {
    return undefined;
  }
  return segments;
}

function directoryMemberRelativePathHash(rootPath: string, originPath: string): string {
  const segments = directoryMemberRelativePathSegments(rootPath, originPath);
  if (segments === undefined) {
    throw new StorageValidationError(
      "candidate knowledge directory member origin must be strictly inside its root",
    );
  }
  return checksum(segments.join("/"));
}

function directoryMemberOriginRelation(
  rootPath: string,
  originPath: string,
  memberRelativePathHash: string,
  memberRelativePathHashes: ReadonlySet<string>,
): CandidateKnowledgeDirectoryMemberOriginRelation {
  const segments = directoryMemberRelativePathSegments(rootPath, originPath);
  if (segments === undefined) return "outside-root";
  const originRelativePathHash = checksum(segments.join("/"));
  if (originRelativePathHash === memberRelativePathHash) return "same-member";
  return memberRelativePathHashes.has(originRelativePathHash) ? "other-member" : "unmatched";
}

function requireTimestamp(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    throw new StorageValidationError(`${field} must be a valid ISO timestamp`);
  }
  return normalized;
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

export class SqliteStorage
  implements StoragePort, HistoryStoragePort, RetrievalPort, CandidateKnowledgeBaseStoragePort
{
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

  public async ensureDefaultCandidateKnowledgeBase(
    input: Omit<CandidateKnowledgeBaseInput, "isDefault">,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeBaseInput({ ...input, isDefault: true });
    let result: CandidateKnowledgeBaseRecord | undefined;
    this.database.transaction(() => {
      const existingDefault = this.database
        .prepare(
          "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases WHERE is_default = 1",
        )
        .get();
      if (existingDefault !== undefined) {
        result = candidateKnowledgeBaseFromRow(existingDefault);
        return;
      }
      const conflictingId = this.database
        .prepare("SELECT id FROM candidate_knowledge_bases WHERE id = ?")
        .get(normalized.id);
      if (conflictingId !== undefined) {
        throw new StorageConflictError(
          `candidate knowledge base ${normalized.id} already exists and is not the default`,
        );
      }
      this.insertCandidateKnowledgeBase(normalized);
      result = normalized;
    })();
    return result as CandidateKnowledgeBaseRecord;
  }

  public async createCandidateKnowledgeBase(
    input: CandidateKnowledgeBaseInput,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeBaseInput(input);
    this.database.transaction(() => {
      if (
        this.database
          .prepare("SELECT id FROM candidate_knowledge_bases WHERE id = ?")
          .get(normalized.id) !== undefined
      ) {
        throw new StorageConflictError(`candidate knowledge base ${normalized.id} already exists`);
      }
      if (
        normalized.isDefault &&
        this.database
          .prepare("SELECT id FROM candidate_knowledge_bases WHERE is_default = 1")
          .get() !== undefined
      ) {
        throw new StorageConflictError("a default candidate knowledge base already exists");
      }
      this.insertCandidateKnowledgeBase(normalized);
    })();
    return normalized;
  }

  public async getCandidateKnowledgeBase(
    id: string,
  ): Promise<CandidateKnowledgeBaseRecord | undefined> {
    this.ensureOpen();
    const normalizedId = requireNonEmpty(id, "candidate knowledge base id").trim();
    const row = this.database
      .prepare(
        "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases WHERE id = ?",
      )
      .get(normalizedId);
    return row === undefined ? undefined : candidateKnowledgeBaseFromRow(row);
  }

  public async listCandidateKnowledgeBases(): Promise<readonly CandidateKnowledgeBaseRecord[]> {
    this.ensureOpen();
    return this.database
      .prepare(
        "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases ORDER BY is_default DESC, created_at, id",
      )
      .all()
      .map(candidateKnowledgeBaseFromRow);
  }

  public async renameCandidateKnowledgeBase(
    id: string,
    displayName: string,
    updatedAt: string,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalizedId = requireNonEmpty(id, "candidate knowledge base id").trim();
    const normalizedName = requireNonEmpty(
      displayName,
      "candidate knowledge base displayName",
    ).trim();
    const normalizedUpdatedAt = requireTimestamp(updatedAt, "candidate knowledge base updatedAt");
    let result: CandidateKnowledgeBaseRecord | undefined;
    this.database.transaction(() => {
      const current = this.requireCandidateKnowledgeBase(normalizedId);
      if (Date.parse(normalizedUpdatedAt) < Date.parse(current.updatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge base updatedAt must not precede its current updatedAt",
        );
      }
      this.database
        .prepare(
          "UPDATE candidate_knowledge_bases SET display_name = ?, updated_at = ? WHERE id = ?",
        )
        .run(normalizedName, normalizedUpdatedAt, normalizedId);
      result = {
        ...current,
        displayName: normalizedName,
        updatedAt: normalizedUpdatedAt,
      };
    })();
    return result as CandidateKnowledgeBaseRecord;
  }

  public async archiveCandidateKnowledgeBase(
    id: string,
    archivedAt: string,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalizedId = requireNonEmpty(id, "candidate knowledge base id").trim();
    const normalizedArchivedAt = requireTimestamp(
      archivedAt,
      "candidate knowledge base archivedAt",
    );
    let result: CandidateKnowledgeBaseRecord | undefined;
    this.database.transaction(() => {
      const current = this.requireCandidateKnowledgeBase(normalizedId);
      if (current.isDefault) {
        throw new StorageConflictError("the default candidate knowledge base cannot be archived");
      }
      if (current.state === "archived") {
        throw new StorageConflictError(
          `candidate knowledge base ${normalizedId} is already archived`,
        );
      }
      if (Date.parse(normalizedArchivedAt) < Date.parse(current.updatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge base archivedAt must not precede its current updatedAt",
        );
      }
      this.database
        .prepare(
          "UPDATE candidate_knowledge_bases SET state = 'archived', updated_at = ?, archived_at = ? WHERE id = ?",
        )
        .run(normalizedArchivedAt, normalizedArchivedAt, normalizedId);
      result = {
        ...current,
        state: "archived",
        updatedAt: normalizedArchivedAt,
        archivedAt: normalizedArchivedAt,
      };
    })();
    return result as CandidateKnowledgeBaseRecord;
  }

  public async createCandidateKnowledgeSource(
    sourceInput: CandidateKnowledgeSourceInput,
    initialVersionInput: CandidateKnowledgeSourceVersionInput,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const source = normalizeCandidateKnowledgeSourceInput(sourceInput);
    const initialVersion = normalizeCandidateKnowledgeSourceVersionInput(initialVersionInput);
    if (Date.parse(initialVersion.createdAt) < Date.parse(source.createdAt)) {
      throw new StorageValidationError(
        "candidate knowledge source version createdAt must not precede its source createdAt",
      );
    }
    const version: CandidateKnowledgeSourceVersionRecord = {
      ...initialVersion,
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
    };
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(source.knowledgeBaseId);
      if (
        this.database
          .prepare("SELECT id FROM candidate_knowledge_sources WHERE id = ?")
          .get(source.id) !== undefined
      ) {
        throw new StorageConflictError(`candidate knowledge source ${source.id} already exists`);
      }
      this.insertCandidateKnowledgeSource(source);
      this.insertCandidateKnowledgeSourceVersion(version);
    })();
    return { source, version, created: true };
  }

  public async appendCandidateKnowledgeSourceVersion(
    knowledgeBaseId: string,
    sourceId: string,
    versionInput: CandidateKnowledgeSourceVersionInput,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedVersion = normalizeCandidateKnowledgeSourceVersionInput(versionInput);
    let result: CandidateKnowledgeSourceVersionWriteResult | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
      );
      this.requireCandidateKnowledgeSourceActive(normalizedSourceId);
      const currentRow = this.database
        .prepare(
          "SELECT id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(normalizedSourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${normalizedSourceId} has no versions`,
        );
      }
      const current = candidateKnowledgeSourceVersionFromRow(currentRow);
      if (Date.parse(normalizedVersion.createdAt) < Date.parse(current.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source version createdAt must not precede the current version createdAt",
        );
      }
      if (current.checksum === normalizedVersion.checksum) {
        if (
          current.mediaType !== normalizedVersion.mediaType ||
          current.sizeBytes !== normalizedVersion.sizeBytes
        ) {
          throw new StorageConflictError(
            "candidate knowledge source version checksum conflicts with its integrity metadata",
          );
        }
        result = { source, version: current, created: false };
        return;
      }
      const version: CandidateKnowledgeSourceVersionRecord = {
        ...normalizedVersion,
        sourceId: normalizedSourceId,
        version: current.version + 1,
        parentVersionId: current.id,
      };
      this.insertCandidateKnowledgeSourceVersion(version);
      result = { source, version, created: true };
    })();
    return result as CandidateKnowledgeSourceVersionWriteResult;
  }

  public async prepareManagedCandidateKnowledgeWrite(
    input: ManagedCandidateKnowledgeWriteOperationInput,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      input.operationId,
      "managed candidate knowledge write operation id",
    ).trim();
    const knowledgeBaseId = requireNonEmpty(
      input.knowledgeBaseId,
      "managed candidate knowledge write candidate knowledge base id",
    ).trim();
    const sourceId = requireNonEmpty(
      input.sourceId,
      "managed candidate knowledge write source id",
    ).trim();
    const requestedVersionId = requireNonEmpty(
      input.requestedVersionId,
      "managed candidate knowledge write requested version id",
    ).trim();
    if (input.kind !== "create" && input.kind !== "append") {
      throw new StorageValidationError(
        `Unsupported managed candidate knowledge write kind: ${input.kind}`,
      );
    }
    const createdAt = requireTimestamp(
      input.createdAt,
      "managed candidate knowledge write createdAt",
    );
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(knowledgeBaseId);
      const existingOperation = this.database
        .prepare(
          "SELECT operation_id FROM candidate_knowledge_managed_write_operations WHERE operation_id = ?",
        )
        .get(operationId);
      if (existingOperation !== undefined) {
        throw new StorageConflictError(
          `managed candidate knowledge write operation ${operationId} already exists`,
        );
      }
      const existingSource = this.database
        .prepare(
          "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE id = ?",
        )
        .get(sourceId);
      if (input.kind === "create") {
        if (existingSource !== undefined) {
          throw new StorageConflictError(`candidate knowledge source ${sourceId} already exists`);
        }
      } else {
        const source = this.requireCandidateKnowledgeSource(knowledgeBaseId, sourceId);
        if (source.kind !== "file" && source.kind !== "url") {
          throw new StorageValidationError(
            "managed candidate knowledge source versions require a supported source",
          );
        }
        this.requireCandidateKnowledgeSourceActive(sourceId);
      }
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_managed_write_operations (operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(operationId, knowledgeBaseId, sourceId, requestedVersionId, input.kind, createdAt);
    })();
  }

  public async recordManagedCandidateKnowledgeWriteEvent(
    operationIdInput: string,
    state: Exclude<ManagedCandidateKnowledgeWriteEventState, "committed" | "noop">,
    targetVersionIdInput: string,
    createdAtInput: string,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      operationIdInput,
      "managed candidate knowledge write operation id",
    ).trim();
    const targetVersionId = requireNonEmpty(
      targetVersionIdInput,
      "managed candidate knowledge write target version id",
    ).trim();
    if (
      state !== "targeted" &&
      state !== "published" &&
      state !== "completed" &&
      state !== "aborted"
    ) {
      throw new StorageValidationError(
        `Unsupported managed candidate knowledge write event state: ${state}`,
      );
    }
    const createdAt = requireTimestamp(
      createdAtInput,
      "managed candidate knowledge write event createdAt",
    );
    this.database.transaction(() => {
      this.insertManagedCandidateKnowledgeWriteEvent(
        operationId,
        state,
        targetVersionId,
        createdAt,
      );
    })();
  }

  public async recordManagedCandidateKnowledgeWriteNoop(
    operationIdInput: string,
    versionInput: CandidateKnowledgeSourceVersionInput,
    expectedCurrentVersionId?: string,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      operationIdInput,
      "managed candidate knowledge write operation id",
    ).trim();
    const requestedVersion = normalizeCandidateKnowledgeSourceVersionInput(versionInput);
    let result: CandidateKnowledgeSourceVersionWriteResult | undefined;
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      if (operation.kind !== "append" || requestedVersion.id !== operation.requestedVersionId) {
        throw new StorageConflictError(
          "managed candidate knowledge write noop does not match its intent",
        );
      }
      this.requireManagedCandidateKnowledgeWriteState(operationId, undefined, undefined);
      this.requireActiveCandidateKnowledgeBase(operation.knowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        operation.knowledgeBaseId,
        operation.sourceId,
      );
      if (source.kind !== "file" && source.kind !== "url") {
        throw new StorageValidationError(
          "managed candidate knowledge source versions require a supported source",
        );
      }
      this.requireCandidateKnowledgeSourceActive(operation.sourceId);
      const currentRow = this.database
        .prepare(
          "SELECT id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(operation.sourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${operation.sourceId} has no versions`,
        );
      }
      const current = candidateKnowledgeSourceVersionFromRow(currentRow);
      if (expectedCurrentVersionId !== undefined && current.id !== expectedCurrentVersionId) {
        throw new StorageConflictError(
          "managed candidate knowledge write current version changed during publication",
        );
      }
      if (source.kind === "url") {
        const provenance = this.database
          .prepare(
            "SELECT version_id FROM candidate_knowledge_source_url_provenance WHERE source_id = ? AND version_id = ?",
          )
          .get(operation.sourceId, current.id);
        if (provenance === undefined) {
          throw new StorageValidationError(
            "managed candidate knowledge URL noop requires URL provenance",
          );
        }
      }
      if (
        current.checksum !== requestedVersion.checksum ||
        current.mediaType !== requestedVersion.mediaType ||
        current.sizeBytes !== requestedVersion.sizeBytes ||
        !this.hasManagedCandidateKnowledgeSourceVersion(current.id)
      ) {
        throw new StorageConflictError(
          "managed candidate knowledge write noop no longer matches the current managed version",
        );
      }
      if (Date.parse(requestedVersion.createdAt) < Date.parse(current.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source version createdAt must not precede the current version createdAt",
        );
      }
      this.insertManagedCandidateKnowledgeWriteEvent(
        operationId,
        "noop",
        current.id,
        requestedVersion.createdAt,
      );
      result = { source, version: current, created: false };
    })();
    return result as CandidateKnowledgeSourceVersionWriteResult;
  }

  public async commitManagedCandidateKnowledgeWrite(
    input: ManagedCandidateKnowledgeWriteCommitInput,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      input.operationId,
      "managed candidate knowledge write operation id",
    ).trim();
    const requestedVersion = normalizeCandidateKnowledgeSourceVersionInput(input.version);
    const originPath =
      input.kind === "create" && input.source.kind === "file"
        ? requireAbsolutePath(
            input.originPath ?? "",
            "managed candidate knowledge source origin path",
          )
        : undefined;
    const urlProvenance =
      input.urlProvenance === undefined
        ? undefined
        : normalizeCandidateKnowledgeSourceUrlProvenance(input.urlProvenance);
    let result: CandidateKnowledgeSourceVersionWriteResult | undefined;
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      if (operation.kind !== input.kind) {
        throw new StorageConflictError(
          "managed candidate knowledge write operation kind does not match its commit",
        );
      }
      if (requestedVersion.id !== operation.requestedVersionId) {
        throw new StorageConflictError(
          "managed candidate knowledge write requested version does not match its intent",
        );
      }
      this.requireActiveCandidateKnowledgeBase(operation.knowledgeBaseId);

      if (input.kind === "create") {
        const source = normalizeCandidateKnowledgeSourceInput(input.source);
        if (
          source.id !== operation.sourceId ||
          source.knowledgeBaseId !== operation.knowledgeBaseId
        ) {
          throw new StorageConflictError(
            "managed candidate knowledge write source does not match its intent",
          );
        }
        if (source.kind !== "file" && source.kind !== "url") {
          throw new StorageValidationError(
            "managed candidate knowledge source versions require a supported source",
          );
        }
        if (Date.parse(requestedVersion.createdAt) < Date.parse(source.createdAt)) {
          throw new StorageValidationError(
            "candidate knowledge source version createdAt must not precede its source createdAt",
          );
        }
        if (
          this.database
            .prepare("SELECT id FROM candidate_knowledge_sources WHERE id = ?")
            .get(source.id) !== undefined
        ) {
          throw new StorageConflictError(`candidate knowledge source ${source.id} already exists`);
        }
        this.requireManagedCandidateKnowledgeWriteState(
          operationId,
          "published",
          requestedVersion.id,
        );
        const version: CandidateKnowledgeSourceVersionRecord = {
          ...requestedVersion,
          sourceId: source.id,
          version: 1,
          parentVersionId: null,
        };
        this.insertCandidateKnowledgeSource(source);
        this.insertCandidateKnowledgeSourceVersion(version);
        this.insertManagedCandidateKnowledgeSourceVersion(version.id);
        if (source.kind === "file") {
          if (urlProvenance !== undefined) {
            throw new StorageValidationError(
              "Candidate knowledge source URL provenance is forbidden for file sources",
            );
          }
          this.insertCandidateKnowledgeSourceOriginBinding({
            sourceId: source.id,
            originPath: originPath as string,
            boundAt: requestedVersion.createdAt,
          });
        } else {
          if (urlProvenance === undefined) {
            throw new StorageValidationError(
              "Candidate knowledge source URL provenance is required",
            );
          }
          this.insertCandidateKnowledgeSourceUrlProvenance({
            sourceId: source.id,
            versionId: version.id,
            ...urlProvenance,
          });
        }
        this.insertManagedCandidateKnowledgeWriteEvent(
          operationId,
          "committed",
          version.id,
          requestedVersion.createdAt,
        );
        result = { source, version, created: true };
        return;
      }

      const source = this.requireCandidateKnowledgeSource(
        operation.knowledgeBaseId,
        operation.sourceId,
      );
      if (source.kind !== "file" && source.kind !== "url") {
        throw new StorageValidationError(
          "managed candidate knowledge source versions require a supported source",
        );
      }
      if (source.kind === "file" && urlProvenance !== undefined) {
        throw new StorageValidationError(
          "Candidate knowledge source URL provenance is forbidden for file sources",
        );
      }
      if (source.kind === "url" && urlProvenance === undefined) {
        throw new StorageValidationError("Candidate knowledge source URL provenance is required");
      }
      this.requireCandidateKnowledgeSourceActive(operation.sourceId);
      const currentRow = this.database
        .prepare(
          "SELECT id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(operation.sourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${operation.sourceId} has no versions`,
        );
      }
      const current = candidateKnowledgeSourceVersionFromRow(currentRow);
      if (
        input.expectedCurrentVersionId !== undefined &&
        input.expectedCurrentVersionId !== current.id
      ) {
        throw new StorageConflictError(
          "managed candidate knowledge write current version changed during publication",
        );
      }
      if (Date.parse(requestedVersion.createdAt) < Date.parse(current.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source version createdAt must not precede the current version createdAt",
        );
      }
      if (current.checksum === requestedVersion.checksum) {
        if (
          current.mediaType !== requestedVersion.mediaType ||
          current.sizeBytes !== requestedVersion.sizeBytes
        ) {
          throw new StorageConflictError(
            "candidate knowledge source version checksum conflicts with its integrity metadata",
          );
        }
        if (source.kind === "url") {
          throw new StorageConflictError(
            "managed candidate knowledge URL write must use the non-owning noop path",
          );
        }
        this.requireManagedCandidateKnowledgeWriteState(operationId, "published", current.id);
        if (this.hasManagedCandidateKnowledgeSourceVersion(current.id)) {
          throw new StorageConflictError(
            "managed candidate knowledge write must use the non-owning noop path",
          );
        }
        this.insertManagedCandidateKnowledgeSourceVersion(current.id);
        this.insertManagedCandidateKnowledgeWriteEvent(
          operationId,
          "committed",
          current.id,
          requestedVersion.createdAt,
        );
        result = { source, version: current, created: false };
        return;
      }

      this.requireManagedCandidateKnowledgeWriteState(
        operationId,
        "published",
        requestedVersion.id,
      );
      const version: CandidateKnowledgeSourceVersionRecord = {
        ...requestedVersion,
        sourceId: operation.sourceId,
        version: current.version + 1,
        parentVersionId: current.id,
      };
      this.insertCandidateKnowledgeSourceVersion(version);
      this.insertManagedCandidateKnowledgeSourceVersion(version.id);
      if (source.kind === "url") {
        this.insertCandidateKnowledgeSourceUrlProvenance({
          sourceId: source.id,
          versionId: version.id,
          ...(urlProvenance as CandidateKnowledgeSourceUrlProvenanceInput),
        });
      }
      this.insertManagedCandidateKnowledgeWriteEvent(
        operationId,
        "committed",
        version.id,
        requestedVersion.createdAt,
      );
      result = { source, version, created: true };
    })();
    return result as CandidateKnowledgeSourceVersionWriteResult;
  }

  public async isCandidateKnowledgeSourceVersionManaged(
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ): Promise<boolean> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedVersionId = requireNonEmpty(
      versionId,
      "candidate knowledge source version id",
    ).trim();
    const row = this.database
      .prepare(
        `SELECT m.version_id
         FROM candidate_knowledge_managed_source_versions AS m
         JOIN candidate_knowledge_source_versions AS v ON v.id = m.version_id
         JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
         WHERE s.candidate_knowledge_base_id = ? AND v.source_id = ? AND v.id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId, normalizedVersionId);
    return row !== undefined;
  }

  public listManagedCandidateKnowledgeSourceVersions(): readonly ManagedCandidateKnowledgeSourceVersionRecord[] {
    this.ensureOpen();
    return this.database
      .prepare(
        `SELECT s.candidate_knowledge_base_id, s.kind,
                v.id, v.source_id, v.version, v.parent_version_id, v.media_type,
                v.checksum, v.size_bytes, v.created_at
         FROM candidate_knowledge_managed_source_versions AS m
         JOIN candidate_knowledge_source_versions AS v ON v.id = m.version_id
         JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
         ORDER BY s.candidate_knowledge_base_id, v.source_id, v.version, v.id`,
      )
      .all()
      .map((row) => ({
        ...candidateKnowledgeSourceVersionFromRow(row),
        knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
        kind: rowString(row, "kind") as CandidateKnowledgeSourceKind,
      }));
  }

  public async getCandidateKnowledgeSourceUrlProvenance(
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ): Promise<CandidateKnowledgeSourceUrlProvenanceRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedVersionId = requireNonEmpty(
      versionId,
      "candidate knowledge source version id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT provenance.source_id, provenance.version_id, provenance.original_url,
                provenance.final_url, provenance.fetched_at, provenance.kind
         FROM candidate_knowledge_source_url_provenance AS provenance
         JOIN candidate_knowledge_sources AS source ON source.id = provenance.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND provenance.source_id = ?
           AND provenance.version_id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId, normalizedVersionId);
    return row === undefined ? undefined : candidateKnowledgeSourceUrlProvenanceFromRow(row);
  }

  public async getCandidateKnowledgeSource(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ? AND id = ?",
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    return row === undefined ? undefined : candidateKnowledgeSourceFromRow(row);
  }

  public async getCandidateKnowledgeSourceOriginBinding(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceOriginBindingRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT binding.source_id, binding.origin_path, binding.bound_at
         FROM candidate_knowledge_source_origin_bindings AS binding
         JOIN candidate_knowledge_sources AS source ON source.id = binding.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND source.id = ?
           AND source.kind = 'file'
           AND EXISTS (
             SELECT 1
             FROM candidate_knowledge_source_versions AS version
             JOIN candidate_knowledge_managed_source_versions AS managed
               ON managed.version_id = version.id
             WHERE version.source_id = source.id
           )`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    return row === undefined ? undefined : candidateKnowledgeSourceOriginBindingFromRow(row);
  }

  public async createCandidateKnowledgeDirectoryBinding(
    input: CandidateKnowledgeDirectoryBindingInput,
  ): Promise<CandidateKnowledgeDirectoryBindingRecord> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeDirectoryBindingInput(input);
    let result: CandidateKnowledgeDirectoryBindingRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalized.knowledgeBaseId);
      const existingRoot = this.database
        .prepare(
          "SELECT id FROM candidate_knowledge_directory_bindings WHERE candidate_knowledge_base_id = ? AND root_path = ?",
        )
        .get(normalized.knowledgeBaseId, normalized.rootPath);
      if (existingRoot !== undefined) {
        throw new StorageConflictError(
          "candidate knowledge directory root is already bound in this candidate knowledge base",
        );
      }
      const existingId = this.database
        .prepare("SELECT id FROM candidate_knowledge_directory_bindings WHERE id = ?")
        .get(normalized.id);
      if (existingId !== undefined) {
        throw new StorageConflictError("candidate knowledge directory id already exists");
      }

      const members = normalized.sourceIds.map((sourceId) => {
        const source = this.requireCandidateKnowledgeSource(normalized.knowledgeBaseId, sourceId);
        if (source.kind !== "file") {
          throw new StorageValidationError(
            "candidate knowledge directory members require file sources",
          );
        }
        this.requireCandidateKnowledgeSourceActive(sourceId);
        requireTimestamp(source.createdAt, `candidate knowledge source ${sourceId} createdAt`);

        const originRow = this.database
          .prepare(
            "SELECT source_id, origin_path, bound_at FROM candidate_knowledge_source_origin_bindings WHERE source_id = ?",
          )
          .get(sourceId);
        if (originRow === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory members require an origin binding",
          );
        }
        const origin = candidateKnowledgeSourceOriginBindingFromRow(originRow);
        const managed = this.database
          .prepare(
            `SELECT version.id
             FROM candidate_knowledge_source_versions AS version
             JOIN candidate_knowledge_managed_source_versions AS managed
               ON managed.version_id = version.id
             WHERE version.source_id = ?
             LIMIT 1`,
          )
          .get(sourceId);
        if (managed === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory members require managed file sources",
          );
        }
        const latestRow = this.database
          .prepare(
            `SELECT version.id, version.created_at
             FROM candidate_knowledge_source_versions AS version
             WHERE version.source_id = ?
             ORDER BY version.version DESC, version.id DESC
             LIMIT 1`,
          )
          .get(sourceId);
        if (latestRow === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory members require source versions",
          );
        }
        const latestCreatedAt = requireTimestamp(
          rowString(latestRow, "created_at"),
          `candidate knowledge source ${sourceId} latest version createdAt`,
        );
        const originBoundAt = requireTimestamp(
          origin.boundAt,
          `candidate knowledge source ${sourceId} origin binding boundAt`,
        );
        if (
          Date.parse(source.createdAt) > Date.parse(normalized.boundAt) ||
          Date.parse(originBoundAt) > Date.parse(normalized.boundAt) ||
          Date.parse(latestCreatedAt) > Date.parse(normalized.boundAt)
        ) {
          throw new StorageValidationError(
            "candidate knowledge directory boundAt must not precede its member source state",
          );
        }
        return {
          directoryId: normalized.id,
          knowledgeBaseId: normalized.knowledgeBaseId,
          sourceId,
          relativePathHash: directoryMemberRelativePathHash(normalized.rootPath, origin.originPath),
        } satisfies CandidateKnowledgeDirectoryMemberRecord;
      });
      if (new Set(members.map((member) => member.relativePathHash)).size !== members.length) {
        throw new StorageConflictError(
          "candidate knowledge directory members must have unique relative paths",
        );
      }

      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_directory_bindings (id, candidate_knowledge_base_id, root_path, bound_at) VALUES (?, ?, ?, ?)",
        )
        .run(normalized.id, normalized.knowledgeBaseId, normalized.rootPath, normalized.boundAt);
      const insertMember = this.database.prepare(
        "INSERT INTO candidate_knowledge_directory_members (directory_id, candidate_knowledge_base_id, source_id, relative_path_hash) VALUES (?, ?, ?, ?)",
      );
      for (const member of members) {
        insertMember.run(
          member.directoryId,
          member.knowledgeBaseId,
          member.sourceId,
          member.relativePathHash,
        );
      }
      result = {
        id: normalized.id,
        knowledgeBaseId: normalized.knowledgeBaseId,
        rootPath: normalized.rootPath,
        boundAt: normalized.boundAt,
      };
    })();
    return result as CandidateKnowledgeDirectoryBindingRecord;
  }

  public async getCandidateKnowledgeDirectoryBinding(
    knowledgeBaseId: string,
    directoryId: string,
  ): Promise<CandidateKnowledgeDirectoryBindingRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_bindings
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    return row === undefined ? undefined : candidateKnowledgeDirectoryBindingFromRow(row);
  }

  public async findCandidateKnowledgeDirectoryBinding(
    knowledgeBaseId: string,
    rootPath: string,
  ): Promise<CandidateKnowledgeDirectoryBindingRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedRootPath = requireCanonicalAbsolutePath(
      rootPath,
      "candidate knowledge directory root path",
    );
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_bindings
         WHERE candidate_knowledge_base_id = ? AND root_path = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedRootPath);
    return row === undefined ? undefined : candidateKnowledgeDirectoryBindingFromRow(row);
  }

  public async listCandidateKnowledgeDirectoryMembers(
    knowledgeBaseId: string,
    directoryId: string,
  ): Promise<readonly CandidateKnowledgeDirectoryMemberRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const binding = this.database
      .prepare(
        "SELECT id FROM candidate_knowledge_directory_bindings WHERE candidate_knowledge_base_id = ? AND id = ?",
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    return this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_members
         WHERE candidate_knowledge_base_id = ? AND directory_id = ?
         ORDER BY relative_path_hash`,
      )
      .all(normalizedKnowledgeBaseId, normalizedDirectoryId)
      .map(candidateKnowledgeDirectoryMemberFromRow);
  }

  public async findCandidateKnowledgeDirectoryMemberByPath(
    knowledgeBaseId: string,
    directoryId: string,
    sourcePath: string,
  ): Promise<CandidateKnowledgeDirectoryMemberRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalizedSourcePath = requireCanonicalAbsolutePath(
      sourcePath,
      "candidate knowledge directory member source path",
    );
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const binding = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path
         FROM candidate_knowledge_directory_bindings
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    const rootPath = requireCanonicalAbsolutePath(
      rowString(binding, "root_path"),
      "candidate knowledge directory root path",
    );
    const relativePathHash = directoryMemberRelativePathHash(rootPath, normalizedSourcePath);
    const row = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_members
         WHERE candidate_knowledge_base_id = ?
           AND directory_id = ?
           AND relative_path_hash = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId, relativePathHash);
    return row === undefined ? undefined : candidateKnowledgeDirectoryMemberFromRow(row);
  }

  public async getCandidateKnowledgeDirectoryMemberOriginRelation(
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeDirectoryMemberOriginRelationRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    return this.readCandidateKnowledgeDirectoryMemberOriginRelation(
      normalizedKnowledgeBaseId,
      normalizedDirectoryId,
      normalizedSourceId,
    );
  }

  public async upsertCandidateKnowledgeDirectoryRefreshObservations(
    knowledgeBaseId: string,
    directoryId: string,
    input: CandidateKnowledgeDirectoryRefreshObservationBatchInput,
  ): Promise<readonly CandidateKnowledgeSourceRefreshObservationRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalized = normalizeCandidateKnowledgeDirectoryRefreshObservationBatchInput(input);
    let result: readonly CandidateKnowledgeSourceRefreshObservationRecord[] | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const binding = this.database
        .prepare(
          `SELECT id, candidate_knowledge_base_id, root_path, bound_at
           FROM candidate_knowledge_directory_bindings
           WHERE candidate_knowledge_base_id = ? AND id = ?`,
        )
        .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
      if (binding === undefined) {
        throw new StorageValidationError("candidate knowledge directory binding was not found");
      }
      if (rowString(binding, "candidate_knowledge_base_id") !== normalizedKnowledgeBaseId) {
        throw new StorageValidationError("candidate knowledge directory binding is malformed");
      }
      requireCanonicalAbsolutePath(
        rowString(binding, "root_path"),
        "candidate knowledge directory root path",
      );
      if (rowString(binding, "id") !== normalizedDirectoryId) {
        throw new StorageValidationError("candidate knowledge directory binding is malformed");
      }
      const directoryBoundAt = requireTimestamp(
        rowString(binding, "bound_at"),
        `candidate knowledge directory ${normalizedDirectoryId} boundAt`,
      );
      if (Date.parse(normalized.checkedAt) < Date.parse(directoryBoundAt)) {
        throw new StorageValidationError(
          "candidate knowledge directory refresh checkedAt must not precede directory binding",
        );
      }

      const pending = [...normalized.entries]
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
        .map((entry) => {
          const member = this.database
            .prepare(
              `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
               FROM candidate_knowledge_directory_members
               WHERE candidate_knowledge_base_id = ?
                 AND directory_id = ?
                 AND source_id = ?`,
            )
            .get(normalizedKnowledgeBaseId, normalizedDirectoryId, entry.sourceId);
          if (member === undefined) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observation source is not a member",
            );
          }
          const memberRecord = candidateKnowledgeDirectoryMemberFromRow(member);
          if (
            memberRecord.directoryId !== normalizedDirectoryId ||
            memberRecord.knowledgeBaseId !== normalizedKnowledgeBaseId ||
            !/^[0-9a-f]{64}$/.test(memberRecord.relativePathHash)
          ) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh membership is malformed",
            );
          }
          const source = this.requireCandidateKnowledgeSource(
            normalizedKnowledgeBaseId,
            entry.sourceId,
          );
          if (source.kind !== "file") {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observations require file sources",
            );
          }
          this.requireCandidateKnowledgeSourceActive(entry.sourceId);
          const managed = this.database
            .prepare(
              `SELECT version.id
               FROM candidate_knowledge_source_versions AS version
               JOIN candidate_knowledge_managed_source_versions AS managed
                 ON managed.version_id = version.id
               WHERE version.source_id = ?
               LIMIT 1`,
            )
            .get(entry.sourceId);
          if (managed === undefined) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observations require managed files",
            );
          }
          const latestRow = this.database
            .prepare(
              `SELECT id, version, created_at
               FROM candidate_knowledge_source_versions
               WHERE source_id = ?
               ORDER BY version DESC, id DESC
               LIMIT 1`,
            )
            .get(entry.sourceId);
          if (latestRow === undefined || rowString(latestRow, "id") !== entry.observedVersionId) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observed version is not latest",
            );
          }
          const sourceCreatedAt = requireTimestamp(
            source.createdAt,
            `candidate knowledge source ${entry.sourceId} createdAt`,
          );
          const latestVersionCreatedAt = requireTimestamp(
            rowString(latestRow, "created_at"),
            `candidate knowledge source ${entry.sourceId} latest version createdAt`,
          );
          if (Date.parse(normalized.checkedAt) < Date.parse(sourceCreatedAt)) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh checkedAt must not precede source creation",
            );
          }
          if (Date.parse(normalized.checkedAt) < Date.parse(latestVersionCreatedAt)) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh checkedAt must not precede latest version",
            );
          }
          const observedVersion = this.database
            .prepare(
              "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
            )
            .get(entry.observedVersionId, entry.sourceId);
          if (observedVersion === undefined) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observed version does not belong to its source",
            );
          }
          const relation = this.readCandidateKnowledgeDirectoryMemberOriginRelation(
            normalizedKnowledgeBaseId,
            normalizedDirectoryId,
            entry.sourceId,
          );
          if (
            relation.relation !== "same-member" ||
            relation.originBoundAt !== entry.expectedOriginBoundAt
          ) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh origin revision is no longer current",
            );
          }
          if (
            relation.originBoundAt !== undefined &&
            Date.parse(normalized.checkedAt) < Date.parse(relation.originBoundAt)
          ) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh checkedAt must not precede origin binding",
            );
          }

          const currentRow = this.database
            .prepare(
              `SELECT source_id, observed_version_id, status, checked_at,
                      last_refreshed_version_id, last_refreshed_at
               FROM candidate_knowledge_source_refresh_observations
               WHERE source_id = ?`,
            )
            .get(entry.sourceId);
          const current =
            currentRow === undefined
              ? undefined
              : candidateKnowledgeSourceRefreshObservationFromRow(
                  currentRow,
                  rowString(latestRow, "id"),
                );
          if (current !== undefined) {
            requireCandidateKnowledgeSourceRefreshObservationStatus(current.status);
            requireTimestamp(
              current.checkedAt,
              `candidate knowledge source ${entry.sourceId} refresh checkedAt`,
            );
            if (current.sourceId !== entry.sourceId) {
              throw new StorageValidationError(
                "candidate knowledge source refresh observation is malformed",
              );
            }
            if (Date.parse(normalized.checkedAt) < Date.parse(current.checkedAt)) {
              throw new StorageValidationError(
                "candidate knowledge directory refresh checkedAt must not precede current observation",
              );
            }
            const currentObserved = this.database
              .prepare(
                "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
              )
              .get(current.observedVersionId, entry.sourceId);
            if (currentObserved === undefined) {
              throw new StorageValidationError(
                "candidate knowledge source refresh observed version is malformed",
              );
            }
            if (current.lastRefreshedVersionId !== null) {
              const refreshed = this.database
                .prepare(
                  "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
                )
                .get(current.lastRefreshedVersionId, entry.sourceId);
              if (refreshed === undefined || current.lastRefreshedAt === null) {
                throw new StorageValidationError(
                  "candidate knowledge source refresh last-refreshed state is malformed",
                );
              }
              requireTimestamp(
                current.lastRefreshedAt,
                `candidate knowledge source ${entry.sourceId} lastRefreshedAt`,
              );
              if (Date.parse(current.lastRefreshedAt) > Date.parse(current.checkedAt)) {
                throw new StorageValidationError(
                  "candidate knowledge source refresh lastRefreshedAt must not follow checkedAt",
                );
              }
            } else if (current.lastRefreshedAt !== null) {
              throw new StorageValidationError(
                "candidate knowledge source refresh last-refreshed state is malformed",
              );
            }
          }
          return {
            sourceId: entry.sourceId,
            observedVersionId: entry.observedVersionId,
            status: entry.status,
            checkedAt: normalized.checkedAt,
            lastRefreshedVersionId: current?.lastRefreshedVersionId ?? null,
            lastRefreshedAt: current?.lastRefreshedAt ?? null,
            hasExisting: current !== undefined,
          } satisfies Omit<CandidateKnowledgeSourceRefreshObservationRecord, "stale"> & {
            readonly hasExisting: boolean;
          };
        });

      const insert = this.database.prepare(
        `INSERT INTO candidate_knowledge_source_refresh_observations
           (source_id, observed_version_id, status, checked_at,
            last_refreshed_version_id, last_refreshed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const update = this.database.prepare(
        `UPDATE candidate_knowledge_source_refresh_observations
         SET observed_version_id = ?, status = ?, checked_at = ?,
             last_refreshed_version_id = ?, last_refreshed_at = ?
         WHERE source_id = ?`,
      );
      for (const entry of pending) {
        const values = [
          entry.observedVersionId,
          entry.status,
          entry.checkedAt,
          entry.lastRefreshedVersionId,
          entry.lastRefreshedAt,
        ];
        if (entry.hasExisting) {
          update.run(...values, entry.sourceId);
        } else {
          insert.run(entry.sourceId, ...values);
        }
      }
      result = pending.map((entry) =>
        candidateKnowledgeSourceRefreshObservationFromRow(
          {
            source_id: entry.sourceId,
            observed_version_id: entry.observedVersionId,
            status: entry.status,
            checked_at: entry.checkedAt,
            last_refreshed_version_id: entry.lastRefreshedVersionId,
            last_refreshed_at: entry.lastRefreshedAt,
          },
          entry.observedVersionId,
        ),
      );
    })();
    return result as readonly CandidateKnowledgeSourceRefreshObservationRecord[];
  }

  public async getCandidateKnowledgeSourceRetirement(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceRetirementRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT retirement.source_id, retirement.retired_at, retirement.reason
         FROM candidate_knowledge_source_retirements AS retirement
         JOIN candidate_knowledge_sources AS source ON source.id = retirement.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND source.id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    return row === undefined ? undefined : candidateKnowledgeSourceRetirementFromRow(row);
  }

  public async retireCandidateKnowledgeSource(
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRetirementInput,
  ): Promise<CandidateKnowledgeSourceRetirementRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const retiredAt = requireTimestamp(
      input.retiredAt,
      "candidate knowledge source retirement retiredAt",
    );
    const reason = requireCandidateKnowledgeSourceRetirementReason(input.reason);
    let result: CandidateKnowledgeSourceRetirementRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
      );
      if (Date.parse(retiredAt) < Date.parse(source.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source retirement retiredAt must not precede source createdAt",
        );
      }
      const currentRow = this.database
        .prepare(
          "SELECT source_id, retired_at, reason FROM candidate_knowledge_source_retirements WHERE source_id = ?",
        )
        .get(normalizedSourceId);
      if (currentRow !== undefined) {
        const current = candidateKnowledgeSourceRetirementFromRow(currentRow);
        if (current.retiredAt !== retiredAt || current.reason !== reason) {
          throw new StorageConflictError(
            "candidate knowledge source retirement conflicts with its existing marker",
          );
        }
        result = current;
        return;
      }
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_source_retirements (source_id, retired_at, reason) VALUES (?, ?, ?)",
        )
        .run(normalizedSourceId, retiredAt, reason);
      result = { sourceId: normalizedSourceId, retiredAt, reason };
    })();
    return result as CandidateKnowledgeSourceRetirementRecord;
  }

  public async getCandidateKnowledgeSourceRefreshObservation(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceRefreshObservationRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT observation.source_id, observation.observed_version_id, observation.status,
                observation.checked_at, observation.last_refreshed_version_id,
                observation.last_refreshed_at
         FROM candidate_knowledge_source_refresh_observations AS observation
         JOIN candidate_knowledge_sources AS source
           ON source.id = observation.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND source.id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    if (row === undefined) return undefined;
    const latestRow = this.database
      .prepare(
        "SELECT id FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC, id DESC LIMIT 1",
      )
      .get(normalizedSourceId);
    if (latestRow === undefined) {
      throw new StorageValidationError(
        `candidate knowledge source ${normalizedSourceId} has no versions`,
      );
    }
    return candidateKnowledgeSourceRefreshObservationFromRow(row, rowString(latestRow, "id"));
  }

  public async upsertCandidateKnowledgeSourceRefreshObservation(
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRefreshObservationInput,
  ): Promise<CandidateKnowledgeSourceRefreshObservationRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const observedVersionId = requireNonEmpty(
      input.observedVersionId,
      "candidate knowledge source refresh observed version id",
    ).trim();
    const status = requireCandidateKnowledgeSourceRefreshObservationStatus(input.status);
    const checkedAt = requireTimestamp(
      input.checkedAt,
      "candidate knowledge source refresh checkedAt",
    );
    const hasLastRefreshedVersion = input.lastRefreshedVersionId !== undefined;
    const hasLastRefreshedAt = input.lastRefreshedAt !== undefined;
    if (hasLastRefreshedVersion !== hasLastRefreshedAt) {
      throw new StorageValidationError(
        "candidate knowledge source refresh last-refreshed version and timestamp must be paired",
      );
    }
    const requestedLastRefreshedVersion = hasLastRefreshedVersion
      ? input.lastRefreshedVersionId === null
        ? null
        : requireNonEmpty(
            input.lastRefreshedVersionId as string,
            "candidate knowledge source refresh last-refreshed version id",
          ).trim()
      : undefined;
    const requestedLastRefreshedAt = hasLastRefreshedAt
      ? input.lastRefreshedAt === null
        ? null
        : requireTimestamp(
            input.lastRefreshedAt as string,
            "candidate knowledge source refresh lastRefreshedAt",
          )
      : undefined;
    if (
      requestedLastRefreshedAt !== undefined &&
      requestedLastRefreshedAt !== null &&
      Date.parse(requestedLastRefreshedAt) > Date.parse(checkedAt)
    ) {
      throw new StorageValidationError(
        "candidate knowledge source refresh lastRefreshedAt must not follow checkedAt",
      );
    }

    let result: CandidateKnowledgeSourceRefreshObservationRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      this.requireCandidateKnowledgeSource(normalizedKnowledgeBaseId, normalizedSourceId);
      this.requireCandidateKnowledgeSourceActive(normalizedSourceId);
      const latestRow = this.database
        .prepare(
          "SELECT id, version FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC, id DESC LIMIT 1",
        )
        .get(normalizedSourceId);
      if (latestRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${normalizedSourceId} has no versions`,
        );
      }
      const observed = this.database
        .prepare(
          "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
        )
        .get(observedVersionId, normalizedSourceId);
      if (observed === undefined) {
        throw new StorageValidationError(
          "candidate knowledge source refresh observed version does not belong to its source",
        );
      }
      if (requestedLastRefreshedVersion !== undefined && requestedLastRefreshedVersion !== null) {
        const refreshed = this.database
          .prepare(
            "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
          )
          .get(requestedLastRefreshedVersion, normalizedSourceId);
        if (refreshed === undefined) {
          throw new StorageValidationError(
            "candidate knowledge source refresh last-refreshed version does not belong to its source",
          );
        }
      }
      const currentRow = this.database
        .prepare(
          `SELECT source_id, observed_version_id, status, checked_at,
                  last_refreshed_version_id, last_refreshed_at
           FROM candidate_knowledge_source_refresh_observations
           WHERE source_id = ?`,
        )
        .get(normalizedSourceId);
      const current =
        currentRow === undefined
          ? undefined
          : candidateKnowledgeSourceRefreshObservationFromRow(
              currentRow,
              rowString(latestRow, "id"),
            );
      const lastRefreshedVersion =
        requestedLastRefreshedVersion === undefined
          ? (current?.lastRefreshedVersionId ?? null)
          : requestedLastRefreshedVersion;
      const lastRefreshedAt =
        requestedLastRefreshedAt === undefined
          ? (current?.lastRefreshedAt ?? null)
          : requestedLastRefreshedAt;
      if (requestedLastRefreshedVersion !== undefined && requestedLastRefreshedVersion !== null) {
        const currentRefreshVersion =
          current?.lastRefreshedVersionId === null || current?.lastRefreshedVersionId === undefined
            ? undefined
            : this.database
                .prepare(
                  "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
                )
                .get(current.lastRefreshedVersionId, normalizedSourceId);
        const requestedRefreshVersion = this.database
          .prepare(
            "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
          )
          .get(requestedLastRefreshedVersion, normalizedSourceId);
        const advances =
          currentRefreshVersion === undefined ||
          (requestedRefreshVersion !== undefined &&
            rowNumber(requestedRefreshVersion, "version") >
              rowNumber(currentRefreshVersion, "version"));
        if (
          advances &&
          (status !== "current" ||
            observedVersionId !== requestedLastRefreshedVersion ||
            lastRefreshedAt !== checkedAt)
        ) {
          throw new StorageValidationError(
            "candidate knowledge source refresh success must observe its refreshed version at its refresh time",
          );
        }
      }
      if (current !== undefined) {
        if (Date.parse(checkedAt) < Date.parse(current.checkedAt)) {
          throw new StorageValidationError(
            "candidate knowledge source refresh checkedAt must not precede its current checkedAt",
          );
        }
        if (current.lastRefreshedAt !== null) {
          if (lastRefreshedAt === null) {
            throw new StorageValidationError(
              "candidate knowledge source refresh cannot drop its last successful refresh",
            );
          }
          if (Date.parse(lastRefreshedAt) < Date.parse(current.lastRefreshedAt)) {
            throw new StorageValidationError(
              "candidate knowledge source refresh lastRefreshedAt must not precede its current value",
            );
          }
          if (
            current.lastRefreshedVersionId === lastRefreshedVersion &&
            Date.parse(lastRefreshedAt) !== Date.parse(current.lastRefreshedAt)
          ) {
            throw new StorageValidationError(
              "candidate knowledge source refresh cannot change the time of its last successful refresh",
            );
          }
          if (current.lastRefreshedVersionId !== null && lastRefreshedVersion !== null) {
            const currentRefreshVersion = this.database
              .prepare(
                "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
              )
              .get(current.lastRefreshedVersionId, normalizedSourceId);
            const nextRefreshVersion = this.database
              .prepare(
                "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
              )
              .get(lastRefreshedVersion, normalizedSourceId);
            if (
              currentRefreshVersion !== undefined &&
              nextRefreshVersion !== undefined &&
              rowNumber(nextRefreshVersion, "version") < rowNumber(currentRefreshVersion, "version")
            ) {
              throw new StorageValidationError(
                "candidate knowledge source refresh version must not move backward",
              );
            }
          }
        }
      }
      if (currentRow === undefined) {
        this.database
          .prepare(
            `INSERT INTO candidate_knowledge_source_refresh_observations
               (source_id, observed_version_id, status, checked_at,
                last_refreshed_version_id, last_refreshed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            normalizedSourceId,
            observedVersionId,
            status,
            checkedAt,
            lastRefreshedVersion,
            lastRefreshedAt,
          );
      } else {
        this.database
          .prepare(
            `UPDATE candidate_knowledge_source_refresh_observations
             SET observed_version_id = ?, status = ?, checked_at = ?,
                 last_refreshed_version_id = ?, last_refreshed_at = ?
             WHERE source_id = ?`,
          )
          .run(
            observedVersionId,
            status,
            checkedAt,
            lastRefreshedVersion,
            lastRefreshedAt,
            normalizedSourceId,
          );
      }
      result = candidateKnowledgeSourceRefreshObservationFromRow(
        {
          source_id: normalizedSourceId,
          observed_version_id: observedVersionId,
          status,
          checked_at: checkedAt,
          last_refreshed_version_id: lastRefreshedVersion,
          last_refreshed_at: lastRefreshedAt,
        },
        rowString(latestRow, "id"),
      );
    })();
    return result as CandidateKnowledgeSourceRefreshObservationRecord;
  }

  public async rebindCandidateKnowledgeSourceOrigin(
    knowledgeBaseId: string,
    sourceId: string,
    originPath: string,
    boundAt: string,
  ): Promise<CandidateKnowledgeSourceOriginBindingRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedOriginPath = resolve(
      requireAbsolutePath(originPath, "candidate knowledge source origin path"),
    );
    const normalizedBoundAt = requireTimestamp(
      boundAt,
      "candidate knowledge source origin binding boundAt",
    );
    let result: CandidateKnowledgeSourceOriginBindingRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
      );
      if (source.kind !== "file") {
        throw new StorageValidationError(
          "Candidate knowledge source origin bindings require a file source",
        );
      }
      this.requireCandidateKnowledgeSourceActive(normalizedSourceId);
      const managed = this.database
        .prepare(
          `SELECT 1
           FROM candidate_knowledge_source_versions AS version
           JOIN candidate_knowledge_managed_source_versions AS managed
             ON managed.version_id = version.id
           WHERE version.source_id = ?
           LIMIT 1`,
        )
        .get(normalizedSourceId);
      if (managed === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge source origin bindings require a managed file source",
        );
      }
      const currentRow = this.database
        .prepare(
          "SELECT source_id, origin_path, bound_at FROM candidate_knowledge_source_origin_bindings WHERE source_id = ?",
        )
        .get(normalizedSourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge source origin binding does not exist",
        );
      }
      const current = candidateKnowledgeSourceOriginBindingFromRow(currentRow);
      if (current.originPath === normalizedOriginPath) {
        result = current;
        return;
      }
      if (Date.parse(normalizedBoundAt) < Date.parse(current.boundAt)) {
        throw new StorageValidationError(
          "Candidate knowledge source origin binding boundAt must not precede its current boundAt",
        );
      }
      const update = this.database
        .prepare(
          "UPDATE candidate_knowledge_source_origin_bindings SET origin_path = ?, bound_at = ? WHERE source_id = ?",
        )
        .run(normalizedOriginPath, normalizedBoundAt, normalizedSourceId);
      if (update.changes !== 1) {
        throw new StorageConflictError(
          "Candidate knowledge source origin binding could not be replaced",
        );
      }
      result = {
        sourceId: normalizedSourceId,
        originPath: normalizedOriginPath,
        boundAt: normalizedBoundAt,
      };
    })();
    return result as CandidateKnowledgeSourceOriginBindingRecord;
  }

  public async listCandidateKnowledgeSources(
    knowledgeBaseId: string,
  ): Promise<readonly CandidateKnowledgeSourceRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    return this.database
      .prepare(
        "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ? ORDER BY created_at, id",
      )
      .all(normalizedKnowledgeBaseId)
      .map(candidateKnowledgeSourceFromRow);
  }

  public async listCandidateKnowledgeSourceVersions(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<readonly CandidateKnowledgeSourceVersionRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    this.requireCandidateKnowledgeSource(normalizedKnowledgeBaseId, normalizedSourceId);
    return this.database
      .prepare(
        "SELECT v.id, v.source_id, v.version, v.parent_version_id, v.media_type, v.checksum, v.size_bytes, v.created_at FROM candidate_knowledge_source_versions AS v JOIN candidate_knowledge_sources AS s ON s.id = v.source_id WHERE s.candidate_knowledge_base_id = ? AND v.source_id = ? ORDER BY v.version, v.id",
      )
      .all(normalizedKnowledgeBaseId, normalizedSourceId)
      .map(candidateKnowledgeSourceVersionFromRow);
  }

  public validateCandidateKnowledgeSourceGraph(): void {
    this.ensureOpen();
    const foreignKeyViolations = this.database.pragma("foreign_key_check");
    if (Array.isArray(foreignKeyViolations) && foreignKeyViolations.length > 0) {
      throw new StorageValidationError(
        "Candidate knowledge store contains invalid source relationships.",
      );
    }
    const sources = this.database
      .prepare("SELECT id, created_at FROM candidate_knowledge_sources ORDER BY id")
      .all<{ readonly id: string; readonly created_at: string }>();
    const selectVersions = this.database.prepare(
      "SELECT id, version, parent_version_id, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version, id",
    );
    for (const source of sources) {
      const sourceCreatedAt = requireTimestamp(
        source.created_at,
        `candidate knowledge source ${source.id} createdAt`,
      );
      const versions = selectVersions.all<{
        readonly id: string;
        readonly version: number;
        readonly parent_version_id: string | null;
        readonly created_at: string;
      }>(source.id);
      if (versions.length === 0) {
        throw new StorageValidationError(
          `Candidate knowledge source ${source.id} has no source versions.`,
        );
      }
      let previousId: string | null = null;
      let previousCreatedAt = sourceCreatedAt;
      for (const [index, version] of versions.entries()) {
        if (version.version !== index + 1 || version.parent_version_id !== previousId) {
          throw new StorageValidationError(
            `Candidate knowledge source ${source.id} has an invalid version chain.`,
          );
        }
        const versionCreatedAt = requireTimestamp(
          version.created_at,
          `candidate knowledge source version ${version.id} createdAt`,
        );
        if (Date.parse(versionCreatedAt) < Date.parse(previousCreatedAt)) {
          throw new StorageValidationError(
            `Candidate knowledge source ${source.id} has an invalid version timestamp order.`,
          );
        }
        previousId = version.id;
        previousCreatedAt = versionCreatedAt;
      }
    }
    const managedVersions = this.database
      .prepare(
        `SELECT m.version_id, v.source_id, v.created_at, s.kind
         FROM candidate_knowledge_managed_source_versions AS m
         JOIN candidate_knowledge_source_versions AS v ON v.id = m.version_id
         JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
         ORDER BY v.source_id, v.version, v.id`,
      )
      .all<{
        readonly version_id: string;
        readonly source_id: string;
        readonly created_at: string;
        readonly kind: string;
      }>();
    const selectUrlProvenance = this.database.prepare(
      `SELECT source_id, version_id, original_url, final_url, fetched_at, kind
       FROM candidate_knowledge_source_url_provenance
       WHERE version_id = ?`,
    );
    for (const managed of managedVersions) {
      if (managed.kind === "file") {
        if (selectUrlProvenance.get(managed.version_id) !== undefined) {
          throw new StorageValidationError(
            "Candidate knowledge store contains URL provenance for a file version.",
          );
        }
        continue;
      }
      if (managed.kind !== "url") {
        throw new StorageValidationError(
          "Candidate knowledge store contains a managed version for an unsupported source.",
        );
      }
      const provenanceRow = selectUrlProvenance.get(managed.version_id);
      if (provenanceRow === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a managed URL version without provenance.",
        );
      }
      const provenance = candidateKnowledgeSourceUrlProvenanceFromRow(provenanceRow);
      const normalizedProvenance = normalizeCandidateKnowledgeSourceUrlProvenance(provenance);
      if (
        provenance.sourceId !== managed.source_id ||
        provenance.versionId !== managed.version_id ||
        normalizedProvenance.originalUrl !== provenance.originalUrl ||
        normalizedProvenance.finalUrl !== provenance.finalUrl ||
        Date.parse(normalizedProvenance.fetchedAt) !== Date.parse(managed.created_at)
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains invalid managed URL provenance.",
        );
      }
    }
    const originBindings = this.database
      .prepare(
        `SELECT binding.source_id, binding.origin_path, binding.bound_at, source.kind,
                EXISTS (
                  SELECT 1
                  FROM candidate_knowledge_source_versions AS version
                  JOIN candidate_knowledge_managed_source_versions AS managed
                    ON managed.version_id = version.id
                  WHERE version.source_id = source.id
                ) AS has_managed_version
         FROM candidate_knowledge_source_origin_bindings AS binding
         JOIN candidate_knowledge_sources AS source ON source.id = binding.source_id
         ORDER BY binding.source_id`,
      )
      .all<{
        readonly source_id: string;
        readonly origin_path: string;
        readonly bound_at: string;
        readonly kind: string;
        readonly has_managed_version: number;
      }>();
    for (const binding of originBindings) {
      if (binding.kind !== "file" || binding.has_managed_version !== 1) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an origin binding for an unmanaged source.",
        );
      }
      requireAbsolutePath(
        binding.origin_path,
        `candidate knowledge source ${binding.source_id} origin path`,
      );
      requireTimestamp(
        binding.bound_at,
        `candidate knowledge source ${binding.source_id} origin binding boundAt`,
      );
    }

    const directoryBindings = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_bindings
         ORDER BY candidate_knowledge_base_id, id`,
      )
      .all<{
        readonly id: string;
        readonly candidate_knowledge_base_id: string;
        readonly root_path: string;
        readonly bound_at: string;
      }>();
    const selectDirectoryMembers = this.database.prepare(
      `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
       FROM candidate_knowledge_directory_members
       WHERE candidate_knowledge_base_id = ? AND directory_id = ?
       ORDER BY relative_path_hash`,
    );
    const selectDirectoryManaged = this.database.prepare(
      `SELECT version.id
       FROM candidate_knowledge_source_versions AS version
       JOIN candidate_knowledge_managed_source_versions AS managed
         ON managed.version_id = version.id
       WHERE version.source_id = ?
       LIMIT 1`,
    );
    const selectDirectoryOrigin = this.database.prepare(
      `SELECT source_id, origin_path, bound_at
       FROM candidate_knowledge_source_origin_bindings
       WHERE source_id = ?`,
    );
    for (const directory of directoryBindings) {
      const directoryId = requireNonEmpty(directory.id, "candidate knowledge directory id");
      const directoryKnowledgeBaseId = requireNonEmpty(
        directory.candidate_knowledge_base_id,
        "candidate knowledge directory knowledgeBaseId",
      );
      this.requireCandidateKnowledgeBase(directoryKnowledgeBaseId);
      const directoryRoot = requireCanonicalAbsolutePath(
        directory.root_path,
        `candidate knowledge directory ${directoryId} root path`,
      );
      if (directoryRoot !== directory.root_path) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a non-canonical directory root path.",
        );
      }
      const directoryBoundAt = requireTimestamp(
        directory.bound_at,
        `candidate knowledge directory ${directoryId} boundAt`,
      );
      const members = selectDirectoryMembers.all<{
        readonly directory_id: string;
        readonly candidate_knowledge_base_id: string;
        readonly source_id: string;
        readonly relative_path_hash: string;
      }>(directoryKnowledgeBaseId, directoryId);
      const seenHashes = new Set<string>();
      const seenSources = new Set<string>();
      for (const member of members) {
        if (
          member.directory_id !== directoryId ||
          member.candidate_knowledge_base_id !== directoryKnowledgeBaseId ||
          !/^[0-9a-f]{64}$/.test(member.relative_path_hash) ||
          seenHashes.has(member.relative_path_hash) ||
          seenSources.has(member.source_id)
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains invalid directory membership.",
          );
        }
        seenHashes.add(member.relative_path_hash);
        seenSources.add(member.source_id);
        const source = this.requireCandidateKnowledgeSource(
          directoryKnowledgeBaseId,
          member.source_id,
        );
        if (source.kind !== "file") {
          throw new StorageValidationError(
            "Candidate knowledge store contains a non-file directory member.",
          );
        }
        requireTimestamp(
          source.createdAt,
          `candidate knowledge source ${member.source_id} createdAt`,
        );
        if (selectDirectoryManaged.get(member.source_id) === undefined) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an unmanaged directory member.",
          );
        }
        const originRow = selectDirectoryOrigin.get(member.source_id);
        if (originRow === undefined) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a directory member without an origin binding.",
          );
        }
        requireTimestamp(
          rowString(originRow, "bound_at"),
          `candidate knowledge source ${member.source_id} origin binding boundAt`,
        );
        if (Date.parse(source.createdAt) > Date.parse(directoryBoundAt)) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a directory member created after its binding.",
          );
        }
      }
    }
    this.validateManagedCandidateKnowledgeWriteJournal();
  }

  private validateManagedCandidateKnowledgeWriteJournal(): void {
    const operations = this.database
      .prepare(
        "SELECT operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at FROM candidate_knowledge_managed_write_operations ORDER BY operation_id",
      )
      .all();
    const selectEvents = this.database.prepare(
      "SELECT sequence, state, target_version_id, created_at FROM candidate_knowledge_managed_write_events WHERE operation_id = ? ORDER BY sequence",
    );
    const selectSource = this.database.prepare(
      "SELECT candidate_knowledge_base_id, kind FROM candidate_knowledge_sources WHERE id = ?",
    );
    const selectTarget = this.database.prepare(
      `SELECT source.candidate_knowledge_base_id, version.source_id, managed.version_id
       FROM candidate_knowledge_source_versions AS version
       JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
       LEFT JOIN candidate_knowledge_managed_source_versions AS managed
         ON managed.version_id = version.id
       WHERE version.id = ?`,
    );
    for (const row of operations) {
      const operation = managedCandidateKnowledgeWriteOperationFromRow(row);
      requireNonEmpty(operation.operationId, "managed candidate knowledge write operation id");
      requireNonEmpty(
        operation.knowledgeBaseId,
        "managed candidate knowledge write candidate knowledge base id",
      );
      requireNonEmpty(operation.sourceId, "managed candidate knowledge write source id");
      requireNonEmpty(
        operation.requestedVersionId,
        "managed candidate knowledge write requested version id",
      );
      if (operation.kind !== "create" && operation.kind !== "append") {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid managed write operation kind.",
        );
      }
      const operationCreatedAt = requireTimestamp(
        operation.createdAt,
        `managed candidate knowledge write operation ${operation.operationId} createdAt`,
      );
      this.requireCandidateKnowledgeBase(operation.knowledgeBaseId);
      const source = selectSource.get<{
        readonly candidate_knowledge_base_id: string;
        readonly kind: string;
      }>(operation.sourceId);
      if (
        operation.kind === "append" &&
        (source === undefined ||
          source.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
          (source.kind !== "file" && source.kind !== "url"))
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid managed append operation source.",
        );
      }
      if (
        source !== undefined &&
        (source.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
          (source.kind !== "file" && source.kind !== "url"))
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid managed write operation source.",
        );
      }

      const events = selectEvents.all<{
        readonly sequence: number;
        readonly state: string;
        readonly target_version_id: string;
        readonly created_at: string;
      }>(operation.operationId);
      let previousState: ManagedCandidateKnowledgeWriteEventState | undefined;
      let previousCreatedAt = operationCreatedAt;
      let targetVersionId: string | undefined;
      for (const [index, event] of events.entries()) {
        if (event.sequence !== index + 1) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a non-contiguous managed write journal.",
          );
        }
        if (
          event.state !== "targeted" &&
          event.state !== "published" &&
          event.state !== "committed" &&
          event.state !== "completed" &&
          event.state !== "aborted" &&
          event.state !== "noop"
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write event state.",
          );
        }
        const transitionAllowed =
          (previousState === undefined && (event.state === "targeted" || event.state === "noop")) ||
          (previousState === "targeted" &&
            (event.state === "published" || event.state === "aborted")) ||
          (previousState === "published" &&
            (event.state === "committed" || event.state === "aborted")) ||
          (previousState === "committed" && event.state === "completed");
        if (!transitionAllowed) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write event transition.",
          );
        }
        const createdAt = requireTimestamp(
          event.created_at,
          `managed candidate knowledge write event ${operation.operationId}:${event.sequence} createdAt`,
        );
        if (Date.parse(createdAt) < Date.parse(previousCreatedAt)) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write timestamp order.",
          );
        }
        if (targetVersionId === undefined) targetVersionId = event.target_version_id;
        if (event.target_version_id !== targetVersionId) {
          throw new StorageValidationError(
            "Candidate knowledge store contains inconsistent managed write targets.",
          );
        }
        const target = selectTarget.get<{
          readonly candidate_knowledge_base_id: string;
          readonly source_id: string;
          readonly version_id: string | null;
        }>(event.target_version_id);
        const targetAllowed =
          event.target_version_id === operation.requestedVersionId ||
          (operation.kind === "append" && target?.source_id === operation.sourceId);
        if (!targetAllowed) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write target.",
          );
        }
        if (
          (event.state === "committed" || event.state === "completed") &&
          (target?.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
            target.source_id !== operation.sourceId ||
            target.version_id !== event.target_version_id)
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an unresolved managed write commit.",
          );
        }
        if (event.state === "noop") {
          if (
            operation.kind !== "append" ||
            target?.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
            target.source_id !== operation.sourceId ||
            target.version_id !== event.target_version_id
          ) {
            throw new StorageValidationError(
              "Candidate knowledge store contains an invalid managed write noop.",
            );
          }
        }
        previousState = event.state;
        previousCreatedAt = createdAt;
      }
    }
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
    return (await this.inspectEvidenceRetrieval(query, optionsOrLimit)).hits;
  }

  public async inspectEvidenceRetrieval(
    query: string,
    optionsOrLimit: EvidenceSearchOptions | number = {},
  ): Promise<EvidenceRetrievalInspection> {
    this.ensureOpen();
    const options = typeof optionsOrLimit === "number" ? { limit: optionsOrLimit } : optionsOrLimit;
    const limit = options.limit ?? 20;
    if (options.workspaceId !== undefined) {
      requireNonEmpty(options.workspaceId, "evidence search workspaceId");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new StorageValidationError("evidence search limit must be an integer from 1 to 100");
    }
    const workspaceId = options.workspaceId ?? null;
    const indexedChunkCount = Number(
      this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM evidence_chunks WHERE (? IS NULL OR workspace_id = ?)",
        )
        .get<{ readonly count: number }>(workspaceId, workspaceId)?.count ?? 0,
    );
    if (indexedChunkCount === 0) {
      return {
        status: "not-indexed",
        indexedChunkCount,
        selectedChunkCount: 0,
        selectedSourceCount: 0,
        hits: [],
      };
    }

    const queryTerms = evidenceQueryTerms(query);
    if (queryTerms.length === 0) {
      return {
        status: "no-query",
        indexedChunkCount,
        selectedChunkCount: 0,
        selectedSourceCount: 0,
        hits: [],
      };
    }
    const ftsQuery = queryTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    let hits = this.database
      .prepare(
        "SELECT c.id, c.workspace_id, c.source_id, c.ordinal, c.line_start, c.line_end, c.checksum, c.text, c.created_at, bm25(evidence_chunks_fts) AS rank FROM evidence_chunks_fts JOIN evidence_chunks AS c ON c.id = evidence_chunks_fts.chunk_id WHERE evidence_chunks_fts MATCH ? AND (? IS NULL OR c.workspace_id = ?) ORDER BY rank, c.id LIMIT ?",
      )
      .all(ftsQuery, workspaceId, workspaceId, limit)
      .map((row) => ({ ...evidenceChunkFromRow(row), rank: Number(row.rank) }));
    const status = hits.length > 0 ? "matched" : "fallback";
    if (hits.length === 0) {
      hits = this.database
        .prepare(
          "SELECT id, workspace_id, source_id, ordinal, line_start, line_end, checksum, text, created_at, 0 AS rank FROM evidence_chunks WHERE (? IS NULL OR workspace_id = ?) ORDER BY source_id, ordinal, id LIMIT ?",
        )
        .all(workspaceId, workspaceId, limit)
        .map((row) => ({ ...evidenceChunkFromRow(row), rank: Number(row.rank) }));
    }
    return {
      status,
      indexedChunkCount,
      selectedChunkCount: hits.length,
      selectedSourceCount: new Set(hits.map((hit) => hit.sourceId)).size,
      hits,
    };
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

  private requireManagedCandidateKnowledgeWriteOperation(
    operationId: string,
  ): ManagedCandidateKnowledgeWriteOperationRecord {
    const row = this.database
      .prepare(
        "SELECT operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at FROM candidate_knowledge_managed_write_operations WHERE operation_id = ?",
      )
      .get(operationId);
    if (row === undefined) {
      throw new StorageValidationError(
        `managed candidate knowledge write operation ${operationId} was not found`,
      );
    }
    return managedCandidateKnowledgeWriteOperationFromRow(row);
  }

  private requireManagedCandidateKnowledgeWriteState(
    operationId: string,
    expectedState: ManagedCandidateKnowledgeWriteEventState | undefined,
    expectedTargetVersionId: string | undefined,
  ): void {
    const row = this.database
      .prepare(
        "SELECT state, target_version_id FROM candidate_knowledge_managed_write_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get<{ readonly state: string; readonly target_version_id: string }>(operationId);
    if (expectedState === undefined) {
      if (row !== undefined) {
        throw new StorageConflictError(
          "managed candidate knowledge write operation is not in its prepared state",
        );
      }
      return;
    }
    if (
      row?.state !== expectedState ||
      (expectedTargetVersionId !== undefined && row.target_version_id !== expectedTargetVersionId)
    ) {
      throw new StorageConflictError(
        `managed candidate knowledge write operation is not ${expectedState}`,
      );
    }
  }

  private insertManagedCandidateKnowledgeWriteEvent(
    operationId: string,
    state: ManagedCandidateKnowledgeWriteEventState,
    targetVersionId: string,
    createdAt: string,
  ): void {
    this.requireManagedCandidateKnowledgeWriteOperation(operationId);
    const sequence =
      (this.database
        .prepare(
          "SELECT MAX(sequence) AS sequence FROM candidate_knowledge_managed_write_events WHERE operation_id = ?",
        )
        .get<{ readonly sequence: number | null }>(operationId)?.sequence ?? 0) + 1;
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_managed_write_events (operation_id, sequence, state, target_version_id, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(operationId, sequence, state, targetVersionId, createdAt);
  }

  private insertCandidateKnowledgeBase(record: CandidateKnowledgeBaseRecord): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_bases (id, display_name, description, state, is_default, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.displayName,
        record.description,
        record.state,
        record.isDefault ? 1 : 0,
        record.createdAt,
        record.updatedAt,
        record.archivedAt,
      );
  }

  private insertCandidateKnowledgeSource(record: CandidateKnowledgeSourceRecord): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_sources (id, candidate_knowledge_base_id, kind, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(record.id, record.knowledgeBaseId, record.kind, record.displayName, record.createdAt);
  }

  private insertCandidateKnowledgeSourceVersion(
    record: CandidateKnowledgeSourceVersionRecord,
  ): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_source_versions (id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.sourceId,
        record.version,
        record.parentVersionId,
        record.mediaType,
        record.checksum,
        record.sizeBytes,
        record.createdAt,
      );
  }

  private hasManagedCandidateKnowledgeSourceVersion(versionId: string): boolean {
    return (
      this.database
        .prepare(
          "SELECT version_id FROM candidate_knowledge_managed_source_versions WHERE version_id = ?",
        )
        .get(versionId) !== undefined
    );
  }

  private requireCandidateKnowledgeSourceActive(sourceId: string): void {
    const retired = this.database
      .prepare("SELECT source_id FROM candidate_knowledge_source_retirements WHERE source_id = ?")
      .get(sourceId);
    if (retired !== undefined) {
      throw new StorageConflictError("candidate knowledge source is retired");
    }
  }

  private insertManagedCandidateKnowledgeSourceVersion(versionId: string): void {
    this.database
      .prepare("INSERT INTO candidate_knowledge_managed_source_versions (version_id) VALUES (?)")
      .run(versionId);
  }

  private insertCandidateKnowledgeSourceUrlProvenance(
    record: CandidateKnowledgeSourceUrlProvenanceRecord,
  ): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_source_url_provenance (version_id, source_id, original_url, final_url, fetched_at, kind) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.versionId,
        record.sourceId,
        record.originalUrl,
        record.finalUrl,
        record.fetchedAt,
        record.kind,
      );
  }

  private insertCandidateKnowledgeSourceOriginBinding(
    record: CandidateKnowledgeSourceOriginBindingRecord,
  ): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_source_origin_bindings (source_id, origin_path, bound_at) VALUES (?, ?, ?)",
      )
      .run(record.sourceId, record.originPath, record.boundAt);
  }

  private readCandidateKnowledgeDirectoryMemberOriginRelation(
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ): CandidateKnowledgeDirectoryMemberOriginRelationRecord {
    const binding = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_bindings
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(knowledgeBaseId, directoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    const rootPath = requireCanonicalAbsolutePath(
      rowString(binding, "root_path"),
      "candidate knowledge directory root path",
    );
    requireTimestamp(
      rowString(binding, "bound_at"),
      `candidate knowledge directory ${directoryId} boundAt`,
    );
    const member = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_members
         WHERE candidate_knowledge_base_id = ? AND directory_id = ? AND source_id = ?`,
      )
      .get(knowledgeBaseId, directoryId, sourceId);
    if (member === undefined) {
      throw new StorageValidationError("candidate knowledge directory member was not found");
    }
    const memberRecord = candidateKnowledgeDirectoryMemberFromRow(member);
    if (
      memberRecord.directoryId !== directoryId ||
      memberRecord.knowledgeBaseId !== knowledgeBaseId ||
      memberRecord.sourceId !== sourceId ||
      !/^[0-9a-f]{64}$/.test(memberRecord.relativePathHash)
    ) {
      throw new StorageValidationError("candidate knowledge directory member is malformed");
    }
    const source = this.requireCandidateKnowledgeSource(knowledgeBaseId, sourceId);
    if (source.kind !== "file") {
      throw new StorageValidationError("candidate knowledge directory member is not a file source");
    }
    const managed = this.database
      .prepare(
        `SELECT version.id
         FROM candidate_knowledge_source_versions AS version
         JOIN candidate_knowledge_managed_source_versions AS managed
           ON managed.version_id = version.id
         WHERE version.source_id = ?
         LIMIT 1`,
      )
      .get(sourceId);
    if (managed === undefined) {
      throw new StorageValidationError("candidate knowledge directory member is not managed");
    }
    const originRow = this.database
      .prepare(
        `SELECT source_id, origin_path, bound_at
         FROM candidate_knowledge_source_origin_bindings
         WHERE source_id = ?`,
      )
      .get(sourceId);
    if (originRow === undefined) {
      return {
        directoryId,
        knowledgeBaseId,
        sourceId,
        relation: "unbound",
      };
    }
    const origin = candidateKnowledgeSourceOriginBindingFromRow(originRow);
    if (origin.sourceId !== sourceId) {
      throw new StorageValidationError("candidate knowledge source origin binding is malformed");
    }
    const originBoundAt = requireTimestamp(
      origin.boundAt,
      `candidate knowledge source ${sourceId} origin boundAt`,
    );
    const originPath = requireCanonicalAbsolutePath(
      origin.originPath,
      `candidate knowledge source ${sourceId} origin path`,
    );
    const memberHashes = new Set<string>();
    const members = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_members
         WHERE candidate_knowledge_base_id = ? AND directory_id = ?`,
      )
      .all(knowledgeBaseId, directoryId);
    for (const row of members) {
      const current = candidateKnowledgeDirectoryMemberFromRow(row);
      if (
        current.directoryId !== directoryId ||
        current.knowledgeBaseId !== knowledgeBaseId ||
        !/^[0-9a-f]{64}$/.test(current.relativePathHash) ||
        memberHashes.has(current.relativePathHash)
      ) {
        throw new StorageValidationError("candidate knowledge directory membership is malformed");
      }
      memberHashes.add(current.relativePathHash);
    }
    return {
      directoryId,
      knowledgeBaseId,
      sourceId,
      relation: directoryMemberOriginRelation(
        rootPath,
        originPath,
        memberRecord.relativePathHash,
        memberHashes,
      ),
      originBoundAt,
    };
  }

  private requireCandidateKnowledgeBase(id: string): CandidateKnowledgeBaseRecord {
    const row = this.database
      .prepare(
        "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases WHERE id = ?",
      )
      .get(id);
    if (row === undefined) {
      throw new StorageValidationError(`candidate knowledge base ${id} was not found`);
    }
    return candidateKnowledgeBaseFromRow(row);
  }

  private requireActiveCandidateKnowledgeBase(id: string): CandidateKnowledgeBaseRecord {
    const knowledgeBase = this.requireCandidateKnowledgeBase(id);
    if (knowledgeBase.state !== "active") {
      throw new StorageConflictError(`candidate knowledge base ${id} is archived`);
    }
    return knowledgeBase;
  }

  private requireCandidateKnowledgeSource(
    knowledgeBaseId: string,
    sourceId: string,
  ): CandidateKnowledgeSourceRecord {
    const row = this.database
      .prepare(
        "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ? AND id = ?",
      )
      .get(knowledgeBaseId, sourceId);
    if (row === undefined) {
      throw new StorageValidationError(
        `candidate knowledge source ${sourceId} was not found in candidate knowledge base ${knowledgeBaseId}`,
      );
    }
    return candidateKnowledgeSourceFromRow(row);
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

function normalizeCandidateKnowledgeBaseInput(
  input: CandidateKnowledgeBaseInput,
): CandidateKnowledgeBaseRecord {
  const id = requireNonEmpty(input.id, "candidate knowledge base id").trim();
  const displayName = requireNonEmpty(
    input.displayName,
    "candidate knowledge base displayName",
  ).trim();
  const createdAt = requireTimestamp(input.createdAt, "candidate knowledge base createdAt");
  if (input.description !== undefined && typeof input.description !== "string") {
    throw new StorageValidationError("candidate knowledge base description must be a string");
  }
  if (typeof input.isDefault !== "boolean") {
    throw new StorageValidationError("candidate knowledge base isDefault must be a boolean");
  }
  return {
    id,
    displayName,
    description: (input.description ?? "").trim(),
    state: "active",
    isDefault: input.isDefault,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

function normalizeCandidateKnowledgeSourceInput(
  input: CandidateKnowledgeSourceInput,
): CandidateKnowledgeSourceRecord {
  const id = requireNonEmpty(input.id, "candidate knowledge source id").trim();
  const knowledgeBaseId = requireNonEmpty(
    input.knowledgeBaseId,
    "candidate knowledge source knowledgeBaseId",
  ).trim();
  if (input.kind !== "file" && input.kind !== "url") {
    throw new StorageValidationError(`Unsupported candidate knowledge source kind: ${input.kind}`);
  }
  const displayName = requireNonEmpty(
    input.displayName,
    "candidate knowledge source displayName",
  ).trim();
  const createdAt = requireTimestamp(input.createdAt, "candidate knowledge source createdAt");
  return { id, knowledgeBaseId, kind: input.kind, displayName, createdAt };
}

function normalizeCandidateKnowledgeDirectoryBindingInput(
  input: CandidateKnowledgeDirectoryBindingInput,
): CandidateKnowledgeDirectoryBindingInput {
  const id = requireNonEmpty(input.id, "candidate knowledge directory id").trim();
  const knowledgeBaseId = requireNonEmpty(
    input.knowledgeBaseId,
    "candidate knowledge directory knowledgeBaseId",
  ).trim();
  const rootPath = requireCanonicalAbsolutePath(
    input.rootPath,
    "candidate knowledge directory root path",
  );
  const boundAt = requireTimestamp(input.boundAt, "candidate knowledge directory boundAt");
  if (!Array.isArray(input.sourceIds)) {
    throw new StorageValidationError("candidate knowledge directory source IDs must be an array");
  }
  const sourceIds = input.sourceIds.map((sourceId) =>
    requireNonEmpty(sourceId, "candidate knowledge directory source id").trim(),
  );
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new StorageConflictError("candidate knowledge directory source IDs must be unique");
  }
  return { id, knowledgeBaseId, rootPath, boundAt, sourceIds };
}

function normalizeCandidateKnowledgeSourceVersionInput(
  input: CandidateKnowledgeSourceVersionInput,
): CandidateKnowledgeSourceVersionInput {
  const id = requireNonEmpty(input.id, "candidate knowledge source version id").trim();
  const mediaType = requireNonEmpty(
    input.mediaType,
    "candidate knowledge source version mediaType",
  ).trim();
  if (!/^[0-9a-f]{64}$/.test(input.checksum)) {
    throw new StorageValidationError(
      "candidate knowledge source version checksum must be a lowercase SHA-256 checksum",
    );
  }
  const sizeBytes = requireNonNegativeInteger(
    input.sizeBytes,
    "candidate knowledge source version sizeBytes",
  );
  const createdAt = requireTimestamp(
    input.createdAt,
    "candidate knowledge source version createdAt",
  );
  return { id, mediaType, checksum: input.checksum, sizeBytes, createdAt };
}

function requireCandidateKnowledgeSourceRefreshObservationStatus(
  value: CandidateKnowledgeSourceRefreshObservationStatus,
): CandidateKnowledgeSourceRefreshObservationStatus {
  if (
    value !== "current" &&
    value !== "changed" &&
    value !== "missing" &&
    value !== "inaccessible" &&
    value !== "unbound"
  ) {
    throw new StorageValidationError(
      `Unsupported candidate knowledge source refresh observation status: ${value}`,
    );
  }
  return value;
}

function normalizeCandidateKnowledgeDirectoryRefreshObservationBatchInput(
  input: CandidateKnowledgeDirectoryRefreshObservationBatchInput,
): CandidateKnowledgeDirectoryRefreshObservationBatchInput {
  if (typeof input !== "object" || input === null || !Array.isArray(input.entries)) {
    throw new StorageValidationError(
      "Candidate knowledge directory refresh observation entries are required",
    );
  }
  const checkedAt = requireTimestamp(
    input.checkedAt,
    "candidate knowledge directory refresh checkedAt",
  );
  const sourceIds = new Set<string>();
  const entries = input.entries.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new StorageValidationError(
        "Candidate knowledge directory refresh observation entry is invalid",
      );
    }
    const sourceId = requireNonEmpty(
      entry.sourceId,
      "candidate knowledge directory refresh observation source id",
    ).trim();
    if (sourceIds.has(sourceId)) {
      throw new StorageValidationError(
        "Candidate knowledge directory refresh observation sources must be unique",
      );
    }
    sourceIds.add(sourceId);
    const observedVersionId = requireNonEmpty(
      entry.observedVersionId,
      "candidate knowledge directory refresh observation version id",
    ).trim();
    const status = entry.status;
    if (status !== "current" && status !== "changed" && status !== "missing") {
      throw new StorageValidationError(
        "Candidate knowledge directory refresh observation status is invalid",
      );
    }
    const expectedOriginBoundAt = requireTimestamp(
      entry.expectedOriginBoundAt,
      "candidate knowledge directory refresh expected origin boundAt",
    );
    return { sourceId, observedVersionId, status, expectedOriginBoundAt };
  });
  return { checkedAt, entries };
}

function requireCandidateKnowledgeSourceRetirementReason(
  value: CandidateKnowledgeSourceRetirementReason,
): CandidateKnowledgeSourceRetirementReason {
  if (value !== "user-requested") {
    throw new StorageValidationError(
      "Candidate knowledge source retirement reason must be user-requested",
    );
  }
  return value;
}

function normalizeCandidateKnowledgeSourceUrlProvenance(
  input: CandidateKnowledgeSourceUrlProvenanceInput | undefined,
): CandidateKnowledgeSourceUrlProvenanceInput {
  if (input === undefined) {
    throw new StorageValidationError("Candidate knowledge source URL provenance is required");
  }
  const originalUrl = requireNonEmpty(
    input.originalUrl,
    "candidate knowledge source original URL",
  ).trim();
  const finalUrl = requireNonEmpty(input.finalUrl, "candidate knowledge source final URL").trim();
  const validateUrl = (value: string, label: string): string => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new StorageValidationError(`Candidate knowledge source ${label} is invalid`);
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== "" ||
      parsed.hostname === ""
    ) {
      throw new StorageValidationError(`Candidate knowledge source ${label} is invalid`);
    }
    return parsed.href;
  };
  const kind = input.kind;
  if (!candidateKnowledgeSourceUrlKinds.includes(kind)) {
    throw new StorageValidationError("Candidate knowledge source URL kind is invalid");
  }
  return {
    originalUrl: validateUrl(originalUrl, "original URL"),
    finalUrl: validateUrl(finalUrl, "final URL"),
    fetchedAt: requireTimestamp(input.fetchedAt, "candidate knowledge source URL fetchedAt"),
    kind,
  };
}

function workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: rowString(row, "id"),
    state: rowString(row, "state") as WorkflowState,
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function candidateKnowledgeBaseFromRow(row: Record<string, unknown>): CandidateKnowledgeBaseRecord {
  return {
    id: rowString(row, "id"),
    displayName: rowString(row, "display_name"),
    description: rowString(row, "description"),
    state: rowString(row, "state") as CandidateKnowledgeBaseState,
    isDefault: rowNumber(row, "is_default") === 1,
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
    archivedAt: rowNullableString(row, "archived_at"),
  };
}

function candidateKnowledgeSourceFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceRecord {
  return {
    id: rowString(row, "id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    kind: rowString(row, "kind") as CandidateKnowledgeSourceKind,
    displayName: rowString(row, "display_name"),
    createdAt: rowString(row, "created_at"),
  };
}

function candidateKnowledgeSourceOriginBindingFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceOriginBindingRecord {
  return {
    sourceId: rowString(row, "source_id"),
    originPath: rowString(row, "origin_path"),
    boundAt: rowString(row, "bound_at"),
  };
}

function candidateKnowledgeDirectoryBindingFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeDirectoryBindingRecord {
  return {
    id: rowString(row, "id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    rootPath: rowString(row, "root_path"),
    boundAt: rowString(row, "bound_at"),
  };
}

function candidateKnowledgeDirectoryMemberFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeDirectoryMemberRecord {
  return {
    directoryId: rowString(row, "directory_id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    sourceId: rowString(row, "source_id"),
    relativePathHash: rowString(row, "relative_path_hash"),
  };
}

function candidateKnowledgeSourceUrlProvenanceFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceUrlProvenanceRecord {
  return {
    sourceId: rowString(row, "source_id"),
    versionId: rowString(row, "version_id"),
    originalUrl: rowString(row, "original_url"),
    finalUrl: rowString(row, "final_url"),
    fetchedAt: rowString(row, "fetched_at"),
    kind: rowString(row, "kind") as CandidateKnowledgeSourceUrlKind,
  };
}

function candidateKnowledgeSourceRetirementFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceRetirementRecord {
  return {
    sourceId: rowString(row, "source_id"),
    retiredAt: rowString(row, "retired_at"),
    reason: rowString(row, "reason") as CandidateKnowledgeSourceRetirementReason,
  };
}

function candidateKnowledgeSourceRefreshObservationFromRow(
  row: Record<string, unknown>,
  latestVersionId: string,
): CandidateKnowledgeSourceRefreshObservationRecord {
  const observedVersionId = rowString(row, "observed_version_id");
  return {
    sourceId: rowString(row, "source_id"),
    observedVersionId,
    status: rowString(row, "status") as CandidateKnowledgeSourceRefreshObservationStatus,
    checkedAt: rowString(row, "checked_at"),
    lastRefreshedVersionId: rowNullableString(row, "last_refreshed_version_id"),
    lastRefreshedAt: rowNullableString(row, "last_refreshed_at"),
    stale: observedVersionId !== latestVersionId,
  };
}

function managedCandidateKnowledgeWriteOperationFromRow(
  row: Record<string, unknown>,
): ManagedCandidateKnowledgeWriteOperationRecord {
  return {
    operationId: rowString(row, "operation_id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    sourceId: rowString(row, "source_id"),
    requestedVersionId: rowString(row, "requested_version_id"),
    kind: rowString(row, "kind") as ManagedCandidateKnowledgeWriteKind,
    createdAt: rowString(row, "created_at"),
  };
}

function candidateKnowledgeSourceVersionFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceVersionRecord {
  return {
    id: rowString(row, "id"),
    sourceId: rowString(row, "source_id"),
    version: rowNumber(row, "version"),
    parentVersionId: rowNullableString(row, "parent_version_id"),
    mediaType: rowString(row, "media_type"),
    checksum: rowString(row, "checksum"),
    sizeBytes: rowNumber(row, "size_bytes"),
    createdAt: rowString(row, "created_at"),
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
