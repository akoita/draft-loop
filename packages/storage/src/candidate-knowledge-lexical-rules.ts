import type {
  CandidateKnowledgeLexicalChunk,
  CandidateKnowledgeLexicalIndexIdentity,
  CandidateKnowledgeLexicalIndexIdentityInput,
  CandidateKnowledgeLexicalRetrievalRequestInput,
  CandidateKnowledgeLexicalRetrievalResult,
  CandidateKnowledgeRetrievalScope,
  CandidateKnowledgeRetrievalScopeInput,
  CandidateKnowledgeRetrievalSourceVersionReference,
  CandidateKnowledgeRetrievalStatus,
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
} from "@draft-loop/domain";
import {
  candidateKnowledgeLexicalChunkSchema,
  candidateKnowledgeLexicalIndexIdentitySchema,
  candidateKnowledgeLexicalRetrievalRequestSchema,
  candidateKnowledgeLexicalRetrievalResultSchema,
  candidateKnowledgeRetrievalScopeSchema,
  candidateKnowledgeRetrievalSourceVersionReferenceSchema,
  candidateKnowledgeRetrievalTraceSchema,
} from "@draft-loop/schemas";
import { checksum, serialize } from "./audit-event-write.js";
import {
  parse,
  recordToJson,
  requireNonEmpty,
  rowNumber,
  rowString,
} from "./history-record-rows.js";
import type {
  CandidateKnowledgeLexicalIndexInspection,
  CandidateKnowledgeLexicalIndexRebuildInput,
  CandidateKnowledgeLexicalIndexRecord,
  CandidateKnowledgeLexicalIndexUpsertInput,
  CandidateKnowledgeLexicalSourceVersionDeletionInput,
  CandidateKnowledgeRetrievalTraceListOptions,
} from "./ports/retrieval.js";
import { StorageValidationError } from "./storage-errors.js";
import { requireTimestamp } from "./versioned-record-rules.js";

/**
 * The rules for a knowledge base's lexical index and its retrieval traces, shared by every
 * storage implementation: input validation, the manifest binding, index inspection, result
 * shaping and trace integrity. Implementations differ only in how they store and match chunks.
 */

export const candidateKnowledgeLexicalIndexRebuildKeys = new Set([
  "scope",
  "index",
  "chunks",
  "createdAt",
]);
export const candidateKnowledgeLexicalIndexUpsertKeys = new Set(["scope", "index", "chunks"]);
export const candidateKnowledgeLexicalSourceVersionDeletionKeys = new Set([
  "storeId",
  "knowledgeBaseId",
  "sourceId",
  "versionId",
]);
export const maximumCandidateKnowledgeLexicalIndexChunkCount = 100_000;
export const maximumCandidateKnowledgeRetrievalTraceListCount = 1_024;
export const candidateKnowledgeLexicalIndexManifestSchemaVersion = 1;

export function requireStrictStorageObject(
  value: unknown,
  keys: ReadonlySet<string>,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorageValidationError(`${field} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.has(key)) throw new StorageValidationError(`${field} contains unsupported fields`);
  }
  return record;
}

export function validatedCandidateKnowledgeRetrievalScope(
  value: unknown,
): CandidateKnowledgeRetrievalScope {
  const parsed = candidateKnowledgeRetrievalScopeSchema.safeParse(value);
  if (!parsed.success)
    throw new StorageValidationError("Candidate knowledge retrieval scope is invalid");
  return parsed.data;
}

export function validatedCandidateKnowledgeLexicalIndexIdentity(
  value: unknown,
): CandidateKnowledgeLexicalIndexIdentity {
  const parsed = candidateKnowledgeLexicalIndexIdentitySchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge lexical index identity is invalid");
  }
  return parsed.data;
}

export function validatedCandidateKnowledgeLexicalChunk(
  value: unknown,
): CandidateKnowledgeLexicalChunk {
  const parsed = candidateKnowledgeLexicalChunkSchema.safeParse(value);
  if (!parsed.success)
    throw new StorageValidationError("Candidate knowledge lexical chunk is invalid");
  return parsed.data;
}

export function validatedCandidateKnowledgeRetrievalRequest(
  value: unknown,
): CandidateKnowledgeLexicalRetrievalRequestInput & {
  readonly scope: CandidateKnowledgeRetrievalScope;
  readonly limit: number;
} {
  const parsed = candidateKnowledgeLexicalRetrievalRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge retrieval request is invalid");
  }
  return parsed.data;
}

export function validatedCandidateKnowledgeRetrievalResult(
  value: unknown,
): CandidateKnowledgeLexicalRetrievalResult {
  const parsed = candidateKnowledgeLexicalRetrievalResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge retrieval result is invalid");
  }
  return parsed.data;
}

export function validatedCandidateKnowledgeRetrievalTrace(
  value: unknown,
): CandidateKnowledgeRetrievalTrace {
  const parsed = candidateKnowledgeRetrievalTraceSchema.safeParse(value);
  if (!parsed.success)
    throw new StorageValidationError("Candidate knowledge retrieval trace is invalid");
  return parsed.data;
}

export function candidateKnowledgeLexicalReferenceKey(
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
  ]);
}

export function candidateKnowledgeLexicalScopeJson(
  scope: CandidateKnowledgeRetrievalScope,
): string {
  return serialize({
    sources: scope.sources.map((source) => ({
      storeId: source.storeId,
      knowledgeBaseId: source.knowledgeBaseId,
      sourceId: source.sourceId,
      versionId: source.versionId,
    })),
  });
}

/** Deterministic identity of the exact source-version manifest, without paths or checksums. */
export function computeCandidateKnowledgeLexicalManifestChecksum(
  scope: CandidateKnowledgeRetrievalScopeInput,
): string {
  const normalizedScope = validatedCandidateKnowledgeRetrievalScope(scope);
  return checksum(
    serialize({
      schemaVersion: candidateKnowledgeLexicalIndexManifestSchemaVersion,
      scope: recordToJson(normalizedScope),
    }),
  );
}

export function requireCandidateKnowledgeLexicalManifestBinding(
  scope: CandidateKnowledgeRetrievalScope,
  index: CandidateKnowledgeLexicalIndexIdentity,
): void {
  if (index.manifestChecksum !== computeCandidateKnowledgeLexicalManifestChecksum(scope)) {
    throw new StorageValidationError("Candidate knowledge lexical index manifest is invalid");
  }
}

export function requireSingleCandidateKnowledgeLexicalScope(
  scope: CandidateKnowledgeRetrievalScope,
): {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
} {
  const first = scope.sources[0];
  if (first === undefined) throw new StorageValidationError("Candidate knowledge scope is empty");
  if (
    scope.sources.some(
      (source) =>
        source.storeId !== first.storeId || source.knowledgeBaseId !== first.knowledgeBaseId,
    )
  ) {
    throw new StorageValidationError(
      "Candidate knowledge lexical index operations require one store and knowledge base",
    );
  }
  return { storeId: first.storeId, knowledgeBaseId: first.knowledgeBaseId };
}

export function requireSafeLexicalIdentifier(value: string, field: string, maximum = 120): string {
  const normalized = requireNonEmpty(value, field).trim();
  if (
    normalized.length > maximum ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(normalized)
  ) {
    throw new StorageValidationError(`${field} must be a safe opaque identifier`);
  }
  return normalized;
}

export function lexicalScopeEquals(
  left: CandidateKnowledgeRetrievalScope,
  right: CandidateKnowledgeRetrievalScope,
): boolean {
  return candidateKnowledgeLexicalScopeJson(left) === candidateKnowledgeLexicalScopeJson(right);
}

export function lexicalIndexEquals(
  left: CandidateKnowledgeLexicalIndexIdentity,
  right: CandidateKnowledgeLexicalIndexIdentity,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.indexerId === right.indexerId &&
    left.manifestChecksum === right.manifestChecksum
  );
}

export function candidateKnowledgeRetrievalTraceFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeRetrievalTrace {
  const payloadJson = rowString(row, "payload_json");
  const payload = parse(payloadJson);
  if (checksum(serialize(payload)) !== rowString(row, "payload_checksum")) {
    throw new StorageValidationError("Stored candidate knowledge retrieval trace is invalid");
  }
  const trace = validatedCandidateKnowledgeRetrievalTrace(payload);
  if (
    trace.workspaceId !== rowString(row, "workspace_id") ||
    trace.id !== rowString(row, "trace_id") ||
    trace.operationId !== rowString(row, "operation_id") ||
    trace.queryChecksum !== rowString(row, "query_checksum")
  ) {
    throw new StorageValidationError(
      "Stored candidate knowledge retrieval trace identity is invalid",
    );
  }
  return trace;
}

export function validatedCandidateKnowledgeLexicalChunks(
  value: unknown,
  scope: CandidateKnowledgeRetrievalScope,
): readonly CandidateKnowledgeLexicalChunk[] {
  if (!Array.isArray(value)) {
    throw new StorageValidationError("Candidate knowledge lexical chunks must be an array");
  }
  if (value.length > maximumCandidateKnowledgeLexicalIndexChunkCount) {
    throw new StorageValidationError("Candidate knowledge lexical chunks exceed the maximum");
  }
  const scopeKeys = new Set(scope.sources.map(candidateKnowledgeLexicalReferenceKey));
  const chunks = value.map((entry) => validatedCandidateKnowledgeLexicalChunk(entry));
  const chunkIds = new Set<string>();
  const ordinals = new Set<string>();
  for (const chunk of chunks) {
    if (!scopeKeys.has(candidateKnowledgeLexicalReferenceKey(chunk.metadata.provenance))) {
      throw new StorageValidationError(
        "Candidate knowledge lexical chunk is outside the index scope",
      );
    }
    if (chunkIds.has(chunk.chunkId)) {
      throw new StorageValidationError("Candidate knowledge lexical chunk ids must be unique");
    }
    chunkIds.add(chunk.chunkId);
    const ordinalKey = `${candidateKnowledgeLexicalReferenceKey(chunk.metadata.provenance)}\u0000${chunk.ordinal}`;
    if (ordinals.has(ordinalKey)) {
      throw new StorageValidationError("Candidate knowledge lexical chunk ordinals must be unique");
    }
    ordinals.add(ordinalKey);
  }
  return chunks.sort((left, right) => {
    const leftReference = candidateKnowledgeLexicalReferenceKey(left.metadata.provenance);
    const rightReference = candidateKnowledgeLexicalReferenceKey(right.metadata.provenance);
    if (leftReference !== rightReference) return leftReference < rightReference ? -1 : 1;
    if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
    return left.chunkId < right.chunkId ? -1 : left.chunkId > right.chunkId ? 1 : 0;
  });
}

/** A validated rebuild or upsert, bound to one store and knowledge base. */
export interface PreparedLexicalIndexWrite {
  readonly scope: CandidateKnowledgeRetrievalScope;
  readonly identity: CandidateKnowledgeLexicalIndexIdentity;
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly chunks: readonly CandidateKnowledgeLexicalChunk[];
}

function prepareLexicalIndexWrite(
  record: Record<string, unknown>,
): Omit<PreparedLexicalIndexWrite, "chunks"> {
  const scope = validatedCandidateKnowledgeRetrievalScope(record.scope);
  const identity = validatedCandidateKnowledgeLexicalIndexIdentity(record.index);
  const { storeId, knowledgeBaseId } = requireSingleCandidateKnowledgeLexicalScope(scope);
  requireCandidateKnowledgeLexicalManifestBinding(scope, identity);
  return { scope, identity, storeId, knowledgeBaseId };
}

/** Validates a full rebuild: at least one chunk, all inside the manifest's scope. */
export function prepareLexicalIndexRebuild(
  input: CandidateKnowledgeLexicalIndexRebuildInput,
): PreparedLexicalIndexWrite & { readonly createdAt: string } {
  const record = requireStrictStorageObject(
    input,
    candidateKnowledgeLexicalIndexRebuildKeys,
    "candidate knowledge lexical index rebuild",
  );
  const prepared = prepareLexicalIndexWrite(record);
  const createdAt = requireTimestamp(
    String(record.createdAt),
    "candidate knowledge lexical index createdAt",
  );
  const chunks = validatedCandidateKnowledgeLexicalChunks(record.chunks, prepared.scope);
  if (chunks.length === 0) {
    throw new StorageValidationError(
      "Candidate knowledge lexical index must contain at least one chunk",
    );
  }
  return { ...prepared, chunks, createdAt };
}

/** Validates an upsert of chunks into the current index of the same scope. */
export function prepareLexicalIndexUpsert(
  input: CandidateKnowledgeLexicalIndexUpsertInput,
): PreparedLexicalIndexWrite {
  const record = requireStrictStorageObject(
    input,
    candidateKnowledgeLexicalIndexUpsertKeys,
    "candidate knowledge lexical index upsert",
  );
  const prepared = prepareLexicalIndexWrite(record);
  return {
    ...prepared,
    chunks: validatedCandidateKnowledgeLexicalChunks(record.chunks, prepared.scope),
  };
}

/** Validates the source version whose deletion clears its knowledge base's index. */
export function lexicalSourceVersionDeletion(
  input: CandidateKnowledgeLexicalSourceVersionDeletionInput,
): CandidateKnowledgeRetrievalSourceVersionReference {
  const record = requireStrictStorageObject(
    input,
    candidateKnowledgeLexicalSourceVersionDeletionKeys,
    "candidate knowledge lexical source-version deletion",
  );
  const parsed = candidateKnowledgeRetrievalSourceVersionReferenceSchema.safeParse(record);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge lexical source-version is invalid");
  }
  return parsed.data as CandidateKnowledgeRetrievalSourceVersionReference;
}

/** Maps a stored index row; the chunk count comes from the implementation's own query. */
export function lexicalIndexRecordFromRow(
  row: Record<string, unknown>,
  indexedChunkCount: number,
): CandidateKnowledgeLexicalIndexRecord {
  const scope = validatedCandidateKnowledgeRetrievalScope(parse(rowString(row, "scope_json")));
  const index = validatedCandidateKnowledgeLexicalIndexIdentity({
    schemaVersion: rowNumber(row, "schema_version"),
    indexerId: rowString(row, "indexer_id"),
    manifestChecksum: rowString(row, "manifest_checksum"),
  });
  requireCandidateKnowledgeLexicalManifestBinding(scope, index);
  return {
    scope,
    index,
    indexedChunkCount,
    createdAt: requireTimestamp(rowString(row, "created_at"), "lexical index createdAt"),
    stale: rowNumber(row, "stale") === 1,
  };
}

/**
 * Compares the stored index with the requested scope: missing or empty is not indexed, and a
 * different scope, a stale flag or another index identity is stale.
 */
export function lexicalIndexInspection(
  requestedScope: CandidateKnowledgeRetrievalScope,
  record: CandidateKnowledgeLexicalIndexRecord | undefined,
  expectedIndex: CandidateKnowledgeLexicalIndexIdentity | undefined,
): CandidateKnowledgeLexicalIndexInspection {
  if (record === undefined || record.indexedChunkCount === 0) {
    return {
      status: "not-indexed",
      requestedScope,
      index: null,
      indexedScope: null,
      indexedChunkCount: 0,
    };
  }
  const stale =
    record.stale ||
    !lexicalScopeEquals(record.scope, requestedScope) ||
    (expectedIndex !== undefined && !lexicalIndexEquals(record.index, expectedIndex));
  return {
    status: stale ? "stale" : "matched",
    requestedScope,
    index: record.index,
    indexedScope: record.scope,
    indexedChunkCount: record.indexedChunkCount,
  };
}

/** Parses the optional index identity an inspection is checked against. */
export function expectedLexicalIndex(
  input: CandidateKnowledgeLexicalIndexIdentityInput | undefined,
): CandidateKnowledgeLexicalIndexIdentity | undefined {
  return input === undefined ? undefined : validatedCandidateKnowledgeLexicalIndexIdentity(input);
}

/** A stored chunk as a query reads it back, with the rank its matcher gave it. */
export interface LexicalHitRow {
  readonly chunk_id: unknown;
  readonly ordinal: unknown;
  readonly line_start: unknown;
  readonly line_end: unknown;
  readonly text: unknown;
  readonly metadata_json: unknown;
  readonly bm25_rank: unknown;
}

/** Shapes a query's result from the inspection and the selected rows, in their order. */
export function lexicalRetrievalResult(
  request: CandidateKnowledgeLexicalRetrievalRequestInput,
  inspection: CandidateKnowledgeLexicalIndexInspection,
  status: CandidateKnowledgeRetrievalStatus,
  rows: readonly Record<string, unknown>[],
): CandidateKnowledgeLexicalRetrievalResult {
  const hits = rows.map((row) => ({
    chunkId: rowString(row, "chunk_id"),
    ordinal: rowNumber(row, "ordinal"),
    lineStart: rowNumber(row, "line_start"),
    lineEnd: rowNumber(row, "line_end"),
    text: rowString(row, "text"),
    metadata: parse(rowString(row, "metadata_json")),
    bm25Rank: Number(row.bm25_rank),
  }));
  const selectedSourceCount = new Set(
    hits.map((hit) => {
      const metadata = hit.metadata as { readonly provenance?: unknown };
      return JSON.stringify(metadata.provenance);
    }),
  ).size;
  return validatedCandidateKnowledgeRetrievalResult({
    purpose: request.purpose,
    scope: request.scope,
    index: inspection.index,
    indexedChunkCount: inspection.indexedChunkCount,
    status,
    selectedChunkCount: hits.length,
    selectedSourceCount,
    hits,
  });
}

/** A trace ready to store: its canonical payload and that payload's checksum. */
export function prepareRetrievalTrace(input: CandidateKnowledgeRetrievalTraceInput): {
  readonly trace: CandidateKnowledgeRetrievalTrace;
  readonly payloadJson: string;
  readonly payloadChecksum: string;
} {
  const trace = validatedCandidateKnowledgeRetrievalTrace(input);
  if (trace.index !== null) {
    requireCandidateKnowledgeLexicalManifestBinding(trace.scope, trace.index);
  }
  const payloadJson = serialize(recordToJson(trace));
  return { trace, payloadJson, payloadChecksum: checksum(payloadJson) };
}

/** Validates a trace lookup's workspace and trace ids. */
export function retrievalTraceKey(
  workspaceId: string,
  traceId: string,
): { readonly workspaceId: string; readonly traceId: string } {
  return {
    workspaceId: requireSafeLexicalIdentifier(workspaceId, "retrieval trace workspaceId"),
    traceId: requireSafeLexicalIdentifier(traceId, "retrieval trace id"),
  };
}

/** Validates a trace listing: an optional operation filter and a bounded limit (100 by default). */
export function retrievalTraceListQuery(
  workspaceId: string,
  options: CandidateKnowledgeRetrievalTraceListOptions,
): {
  readonly workspaceId: string;
  readonly operationId: string | undefined;
  readonly limit: number;
} {
  const normalizedWorkspaceId = requireSafeLexicalIdentifier(
    workspaceId,
    "retrieval trace workspaceId",
  );
  const record = requireStrictStorageObject(
    options,
    new Set(["operationId", "limit"]),
    "retrieval trace list options",
  );
  const operationId =
    record.operationId === undefined
      ? undefined
      : requireSafeLexicalIdentifier(String(record.operationId), "retrieval trace operationId");
  const limit = record.limit === undefined ? 100 : Number(record.limit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximumCandidateKnowledgeRetrievalTraceListCount
  ) {
    throw new StorageValidationError("retrieval trace limit is invalid");
  }
  return { workspaceId: normalizedWorkspaceId, operationId, limit };
}
