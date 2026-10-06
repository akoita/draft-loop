import { createHash } from "node:crypto";
import type { CandidateKnowledgeVectorEmbeddingIdentity } from "./knowledge-vector-index.js";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

/**
 * Append-only companion to the v1 candidate knowledge retrieval trace. It records what semantic
 * retrieval did for one retrieval operation (used, or unavailable and why) without any candidate
 * or query content, and leaves the v1 trace table and payload untouched.
 */
export const semanticRetrievalTraceModes = ["semantic", "hybrid"] as const;
export type SemanticRetrievalTraceMode = (typeof semanticRetrievalTraceModes)[number];

export const semanticRetrievalTraceOutcomes = ["semantic-used", "semantic-unavailable"] as const;
export type SemanticRetrievalTraceOutcome = (typeof semanticRetrievalTraceOutcomes)[number];

export const semanticRetrievalTraceReasons = [
  "model-absent",
  "model-corrupt",
  "unsupported-platform",
  "runtime-failed",
  "index-stale",
] as const;
export type SemanticRetrievalTraceReason = (typeof semanticRetrievalTraceReasons)[number];

export interface SemanticRetrievalTraceChunk {
  readonly chunkId: string;
  /** Cosine similarity of unit-length vectors. */
  readonly vectorScore: number;
  /** One-based position in the vector ranking. */
  readonly vectorRank: number;
}

export interface SemanticRetrievalTraceInput {
  readonly workspaceId: string;
  readonly traceId: string;
  readonly retrievalMode: SemanticRetrievalTraceMode;
  readonly outcome: SemanticRetrievalTraceOutcome;
  /** Required when unavailable, forbidden when used. */
  readonly reason?: SemanticRetrievalTraceReason;
  /** Required when used, forbidden when unavailable. */
  readonly embeddingIdentity?: CandidateKnowledgeVectorEmbeddingIdentity;
  readonly selectedChunks: readonly SemanticRetrievalTraceChunk[];
  readonly createdAt: string;
}

export interface SemanticRetrievalTrace {
  readonly workspaceId: string;
  readonly traceId: string;
  readonly retrievalMode: SemanticRetrievalTraceMode;
  readonly outcome: SemanticRetrievalTraceOutcome;
  readonly reason: SemanticRetrievalTraceReason | null;
  readonly embeddingIdentity: CandidateKnowledgeVectorEmbeddingIdentity | null;
  readonly selectedChunks: readonly SemanticRetrievalTraceChunk[];
  readonly payloadChecksum: string;
  readonly createdAt: string;
}

export interface SemanticRetrievalTraceStoragePort {
  /**
   * Idempotent for an identical trace; a different trace for the same id is a conflict. The v1
   * retrieval trace it annotates must already exist.
   */
  readonly appendSemanticRetrievalTrace: (
    input: SemanticRetrievalTraceInput,
  ) => Promise<SemanticRetrievalTrace>;
  readonly getSemanticRetrievalTrace: (
    workspaceId: string,
    traceId: string,
  ) => Promise<SemanticRetrievalTrace | undefined>;
}

interface TraceStatement {
  readonly run: (...parameters: readonly unknown[]) => unknown;
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
}

export interface SemanticRetrievalTraceDatabase {
  readonly prepare: (sql: string) => TraceStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
}

const hex64 = (column: string): string =>
  `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const semanticRetrievalTraceMigration = {
  version: 29,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_semantic_retrieval_traces (
      workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
      trace_id TEXT NOT NULL CHECK (length(trim(trace_id)) > 0),
      retrieval_mode TEXT NOT NULL CHECK (retrieval_mode IN ('semantic', 'hybrid')),
      outcome TEXT NOT NULL CHECK (outcome IN ('semantic-used', 'semantic-unavailable')),
      reason TEXT CHECK (
        reason IS NULL OR reason IN (
          'model-absent',
          'model-corrupt',
          'unsupported-platform',
          'runtime-failed',
          'index-stale'
        )
      ),
      model_id TEXT CHECK (model_id IS NULL OR length(trim(model_id)) > 0),
      model_revision TEXT CHECK (model_revision IS NULL OR length(trim(model_revision)) > 0),
      model_sha256 TEXT CHECK (model_sha256 IS NULL OR (${hex64("model_sha256")})),
      dimensions INTEGER CHECK (
        dimensions IS NULL OR (typeof(dimensions) = 'integer' AND dimensions BETWEEN 1 AND 4096)
      ),
      pooling TEXT CHECK (pooling IS NULL OR length(trim(pooling)) > 0),
      runtime TEXT CHECK (runtime IS NULL OR length(trim(runtime)) > 0),
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL CHECK (${hex64("payload_checksum")}),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, trace_id),
      FOREIGN KEY (workspace_id, trace_id)
        REFERENCES candidate_knowledge_retrieval_traces(workspace_id, trace_id),
      CHECK (
        (
          outcome = 'semantic-used' AND reason IS NULL
          AND model_id IS NOT NULL AND model_revision IS NOT NULL AND model_sha256 IS NOT NULL
          AND dimensions IS NOT NULL AND pooling IS NOT NULL AND runtime IS NOT NULL
        ) OR (
          outcome = 'semantic-unavailable' AND reason IS NOT NULL
          AND model_id IS NULL AND model_revision IS NULL AND model_sha256 IS NULL
          AND dimensions IS NULL AND pooling IS NULL AND runtime IS NULL
        )
      )
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_semantic_retrieval_traces_immutable_update
      BEFORE UPDATE ON candidate_knowledge_semantic_retrieval_traces
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge semantic retrieval traces are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_semantic_retrieval_traces_immutable_delete
      BEFORE DELETE ON candidate_knowledge_semantic_retrieval_traces
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge semantic retrieval traces are immutable'); END;
  `.trim(),
} as const;

const maximumSelectedChunks = 100;
const maximumIdentifierLength = 120;
const maximumIdentityTextLength = 200;
const maximumDimensions = 4096;
const safeIdentifier = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const hexSha256 = /^[0-9a-f]{64}$/u;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const inputKeys = [
  "workspaceId",
  "traceId",
  "retrievalMode",
  "outcome",
  "reason",
  "embeddingIdentity",
  "selectedChunks",
  "createdAt",
] as const;
const optionalInputKeys: readonly string[] = ["reason", "embeddingIdentity"];
const identityKeys = [
  "modelId",
  "revision",
  "modelFileSha256",
  "dimensions",
  "pooling",
  "runtime",
] as const;
const chunkKeys = ["chunkId", "vectorScore", "vectorRank"] as const;

function invalid(field: string): StorageValidationError {
  return new StorageValidationError(`Semantic retrieval trace ${field} is invalid`);
}

function requireObject(
  value: unknown,
  field: string,
  allowed: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(field);
  const record = value as Record<string, unknown>;
  const exact =
    Object.keys(record).every((key) => allowed.includes(key)) &&
    allowed.every((key) => key in record || optional.includes(key));
  if (!exact) {
    throw new StorageValidationError(`Semantic retrieval trace ${field} has unexpected fields`);
  }
  return record;
}

function requireIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumIdentifierLength ||
    !safeIdentifier.test(value)
  ) {
    throw new StorageValidationError(
      `Semantic retrieval trace ${field} must be a safe opaque identifier`,
    );
  }
  return value;
}

function requireText(value: unknown, field: string, maximum = maximumIdentityTextLength): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw invalid(field);
  }
  return value;
}

function requireMember<Member extends string>(
  value: unknown,
  members: readonly Member[],
  field: string,
): Member {
  const member = members.find((candidate) => candidate === value);
  if (member === undefined) throw invalid(field);
  return member;
}

function validatedIdentity(value: unknown): CandidateKnowledgeVectorEmbeddingIdentity {
  const record = requireObject(value, "embedding identity", identityKeys);
  const modelFileSha256 = requireText(record.modelFileSha256, "model file checksum", 64);
  const { dimensions } = record;
  if (
    !hexSha256.test(modelFileSha256) ||
    typeof dimensions !== "number" ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > maximumDimensions
  ) {
    throw invalid("embedding identity");
  }
  return Object.freeze({
    modelId: requireText(record.modelId, "model id"),
    revision: requireText(record.revision, "model revision"),
    modelFileSha256,
    dimensions,
    pooling: requireText(record.pooling, "pooling"),
    runtime: requireText(record.runtime, "runtime"),
  });
}

function validatedChunks(value: unknown): readonly SemanticRetrievalTraceChunk[] {
  if (!Array.isArray(value) || value.length > maximumSelectedChunks) {
    throw new StorageValidationError(
      `Semantic retrieval trace selectedChunks must be an array of at most ${maximumSelectedChunks} entries`,
    );
  }
  const seen = new Set<string>();
  return Object.freeze(
    (value as readonly unknown[]).map((entry) => {
      const record = requireObject(entry, "selected chunk", chunkKeys);
      const chunkId = requireIdentifier(record.chunkId, "chunk id");
      const { vectorScore, vectorRank } = record;
      if (
        typeof vectorScore !== "number" ||
        !Number.isFinite(vectorScore) ||
        vectorScore < -1 ||
        vectorScore > 1 ||
        typeof vectorRank !== "number" ||
        !Number.isInteger(vectorRank) ||
        vectorRank < 1
      ) {
        throw invalid("selected chunk score or rank");
      }
      if (seen.has(chunkId)) {
        throw new StorageValidationError("Semantic retrieval trace chunk ids must be unique");
      }
      seen.add(chunkId);
      return Object.freeze({ chunkId, vectorScore, vectorRank });
    }),
  );
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !isoTimestamp.test(value) || Number.isNaN(Date.parse(value))) {
    throw new StorageValidationError(
      "Semantic retrieval trace createdAt must be a valid ISO timestamp",
    );
  }
  return value;
}

interface ValidatedTrace {
  readonly workspaceId: string;
  readonly traceId: string;
  readonly retrievalMode: SemanticRetrievalTraceMode;
  readonly outcome: SemanticRetrievalTraceOutcome;
  readonly reason: SemanticRetrievalTraceReason | null;
  readonly embeddingIdentity: CandidateKnowledgeVectorEmbeddingIdentity | null;
  readonly selectedChunks: readonly SemanticRetrievalTraceChunk[];
  readonly createdAt: string;
}

function validatedTrace(inputValue: unknown): ValidatedTrace {
  const input = requireObject(inputValue, "input", inputKeys, optionalInputKeys);
  const outcome = requireMember(input.outcome, semanticRetrievalTraceOutcomes, "outcome");
  const hasReason = input.reason !== undefined;
  const hasIdentity = input.embeddingIdentity !== undefined;
  const used = outcome === "semantic-used";
  if (used === hasReason) {
    throw new StorageValidationError(
      "Semantic retrieval trace reason is required exactly when semantic retrieval was unavailable",
    );
  }
  if (used !== hasIdentity) {
    throw new StorageValidationError(
      "Semantic retrieval trace embedding identity is required exactly when semantic retrieval was used",
    );
  }
  const selectedChunks = validatedChunks(input.selectedChunks);
  if (!used && selectedChunks.length > 0) {
    throw new StorageValidationError(
      "Semantic retrieval trace cannot select chunks when semantic retrieval was unavailable",
    );
  }
  return {
    workspaceId: requireIdentifier(input.workspaceId, "workspaceId"),
    traceId: requireIdentifier(input.traceId, "trace id"),
    retrievalMode: requireMember(
      input.retrievalMode,
      semanticRetrievalTraceModes,
      "retrieval mode",
    ),
    outcome,
    reason: hasReason ? requireMember(input.reason, semanticRetrievalTraceReasons, "reason") : null,
    embeddingIdentity: hasIdentity ? validatedIdentity(input.embeddingIdentity) : null,
    selectedChunks,
    createdAt: requireTimestamp(input.createdAt),
  };
}

function payloadJson(selectedChunks: readonly SemanticRetrievalTraceChunk[]): string {
  return JSON.stringify({
    selectedChunks: selectedChunks.map(({ chunkId, vectorScore, vectorRank }) => ({
      chunkId,
      vectorRank,
      vectorScore,
    })),
  });
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string")
    throw new StorageValidationError("Stored semantic trace is invalid");
  return value;
}

function nullableString(row: Record<string, unknown>, column: string): string | null {
  return row[column] === null ? null : stringColumn(row, column);
}

function storedIdentity(
  row: Record<string, unknown>,
): CandidateKnowledgeVectorEmbeddingIdentity | null {
  if (row.model_id === null) return null;
  const dimensions = row.dimensions;
  if (typeof dimensions !== "number") {
    throw new StorageValidationError("Stored semantic trace is invalid");
  }
  return Object.freeze({
    modelId: stringColumn(row, "model_id"),
    revision: stringColumn(row, "model_revision"),
    modelFileSha256: stringColumn(row, "model_sha256"),
    dimensions,
    pooling: stringColumn(row, "pooling"),
    runtime: stringColumn(row, "runtime"),
  });
}

const selectSql =
  "SELECT workspace_id, trace_id, retrieval_mode, outcome, reason, model_id, model_revision, model_sha256, dimensions, pooling, runtime, payload_json, payload_checksum, created_at FROM candidate_knowledge_semantic_retrieval_traces WHERE workspace_id = ? AND trace_id = ?";

function traceFromRow(row: Record<string, unknown>): SemanticRetrievalTrace {
  const json = stringColumn(row, "payload_json");
  const payloadChecksum = stringColumn(row, "payload_checksum");
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new StorageValidationError("Stored semantic trace is invalid");
  }
  const selectedChunks = validatedChunks(
    requireObject(payload, "payload", ["selectedChunks"]).selectedChunks,
  );
  if (createHash("sha256").update(json, "utf8").digest("hex") !== payloadChecksum) {
    throw new StorageValidationError("Stored semantic trace checksum does not match its payload");
  }
  return Object.freeze({
    workspaceId: stringColumn(row, "workspace_id"),
    traceId: stringColumn(row, "trace_id"),
    retrievalMode: requireMember(row.retrieval_mode, semanticRetrievalTraceModes, "retrieval mode"),
    outcome: requireMember(row.outcome, semanticRetrievalTraceOutcomes, "outcome"),
    reason:
      row.reason === null
        ? null
        : requireMember(nullableString(row, "reason"), semanticRetrievalTraceReasons, "reason"),
    embeddingIdentity: storedIdentity(row),
    selectedChunks,
    payloadChecksum,
    createdAt: stringColumn(row, "created_at"),
  });
}

function sameTrace(stored: SemanticRetrievalTrace, trace: ValidatedTrace, checksum: string) {
  const left = stored.embeddingIdentity;
  const right = trace.embeddingIdentity;
  return (
    stored.payloadChecksum === checksum &&
    stored.retrievalMode === trace.retrievalMode &&
    stored.outcome === trace.outcome &&
    stored.reason === trace.reason &&
    stored.createdAt === trace.createdAt &&
    (left === null || right === null
      ? left === right
      : identityKeys.every((key) => left[key] === right[key]))
  );
}

/** Builds the semantic retrieval trace port over a database handle; `ensureOpen` guards each call. */
export function createSemanticRetrievalTraceStorage(
  database: SemanticRetrievalTraceDatabase,
  ensureOpen: () => void,
): SemanticRetrievalTraceStoragePort {
  return {
    appendSemanticRetrievalTrace: async (inputValue) => {
      ensureOpen();
      const trace = validatedTrace(inputValue);
      const json = payloadJson(trace.selectedChunks);
      const checksum = createHash("sha256").update(json, "utf8").digest("hex");
      let result: SemanticRetrievalTrace | undefined;
      database.transaction(() => {
        const existing = database.prepare(selectSql).get(trace.workspaceId, trace.traceId);
        if (existing !== undefined) {
          const stored = traceFromRow(existing);
          if (!sameTrace(stored, trace, checksum)) {
            throw new StorageConflictError("Semantic retrieval trace is immutable");
          }
          result = stored;
          return;
        }
        const parent = database
          .prepare(
            "SELECT 1 AS present FROM candidate_knowledge_retrieval_traces WHERE workspace_id = ? AND trace_id = ?",
          )
          .get(trace.workspaceId, trace.traceId);
        if (parent === undefined) {
          throw new StorageValidationError(
            "Semantic retrieval trace requires an existing candidate knowledge retrieval trace",
          );
        }
        const identity = trace.embeddingIdentity;
        database
          .prepare(
            "INSERT INTO candidate_knowledge_semantic_retrieval_traces (workspace_id, trace_id, retrieval_mode, outcome, reason, model_id, model_revision, model_sha256, dimensions, pooling, runtime, payload_json, payload_checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            trace.workspaceId,
            trace.traceId,
            trace.retrievalMode,
            trace.outcome,
            trace.reason,
            identity?.modelId ?? null,
            identity?.revision ?? null,
            identity?.modelFileSha256 ?? null,
            identity?.dimensions ?? null,
            identity?.pooling ?? null,
            identity?.runtime ?? null,
            json,
            checksum,
            trace.createdAt,
          );
        result = Object.freeze({
          workspaceId: trace.workspaceId,
          traceId: trace.traceId,
          retrievalMode: trace.retrievalMode,
          outcome: trace.outcome,
          reason: trace.reason,
          embeddingIdentity: trace.embeddingIdentity,
          selectedChunks: trace.selectedChunks,
          payloadChecksum: checksum,
          createdAt: trace.createdAt,
        });
      })();
      return result as SemanticRetrievalTrace;
    },
    getSemanticRetrievalTrace: async (workspaceId, traceId) => {
      ensureOpen();
      const row = database
        .prepare(selectSql)
        .get(requireIdentifier(workspaceId, "workspaceId"), requireIdentifier(traceId, "trace id"));
      return row === undefined ? undefined : traceFromRow(row);
    },
  };
}
