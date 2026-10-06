import type { CandidateKnowledgeRetrievalScopeInput } from "@draft-loop/domain";
import { candidateKnowledgeRetrievalScopeSchema } from "@draft-loop/schemas";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

/**
 * Embedding identity as the storage layer sees it. It is defined structurally
 * here so storage never depends on the embedding runtime package. `runtime` is
 * recorded for diagnostics but does not participate in staleness.
 */
export interface CandidateKnowledgeVectorEmbeddingIdentity {
  readonly modelId: string;
  readonly revision: string;
  readonly modelFileSha256: string;
  readonly dimensions: number;
  readonly pooling: string;
  readonly runtime: string;
}

export type CandidateKnowledgeVectorIndexStatus = "matched" | "stale" | "not-indexed";

export interface CandidateKnowledgeVectorIndexInspection {
  readonly status: CandidateKnowledgeVectorIndexStatus;
  readonly identity: CandidateKnowledgeVectorEmbeddingIdentity | null;
  /** Vectors stored for chunks of the requested source versions. */
  readonly vectorCount: number;
  /** Lexical chunks of the requested source versions. */
  readonly scopeChunkCount: number;
}

export interface CandidateKnowledgeVectorHit {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly chunkId: string;
  readonly ordinal: number;
  /** Cosine similarity of unit-length vectors, i.e. their dot product. */
  readonly score: number;
}

export interface CandidateKnowledgeVectorUpsertInput {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly identity: CandidateKnowledgeVectorEmbeddingIdentity;
  readonly vectors: readonly { readonly chunkId: string; readonly vector: Float32Array }[];
  readonly createdAt: string;
}

export interface CandidateKnowledgeVectorDeleteInput {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

export interface CandidateKnowledgeVectorQueryInput {
  readonly scope: CandidateKnowledgeRetrievalScopeInput;
  readonly identity: CandidateKnowledgeVectorEmbeddingIdentity;
  readonly queryVector: Float32Array;
  readonly limit: number;
}

/**
 * Replaceable exact-version vector projection beside the lexical index. Its
 * rows are derived data: they cascade away with the lexical chunks and index
 * they were computed from, so every lexical rebuild, source-version deletion,
 * and CKB lifecycle invalidation also clears the vectors.
 */
export interface CandidateKnowledgeVectorStoragePort {
  readonly upsertCandidateKnowledgeVectors: (
    input: CandidateKnowledgeVectorUpsertInput,
  ) => Promise<CandidateKnowledgeVectorIndexInspection>;
  readonly deleteCandidateKnowledgeVectorIndex: (
    input: CandidateKnowledgeVectorDeleteInput,
  ) => Promise<void>;
  readonly inspectCandidateKnowledgeVectorIndex: (
    scope: CandidateKnowledgeRetrievalScopeInput,
    identity: CandidateKnowledgeVectorEmbeddingIdentity,
  ) => Promise<CandidateKnowledgeVectorIndexInspection>;
  /** Throws {@link CandidateKnowledgeVectorIndexUnavailableError} unless the index is matched. */
  readonly queryCandidateKnowledgeVectors: (
    input: CandidateKnowledgeVectorQueryInput,
  ) => Promise<readonly CandidateKnowledgeVectorHit[]>;
}

/** The vector index cannot answer; the application maps this to a visible fallback. */
export class CandidateKnowledgeVectorIndexUnavailableError extends Error {
  public readonly status: Exclude<CandidateKnowledgeVectorIndexStatus, "matched">;

  public constructor(status: Exclude<CandidateKnowledgeVectorIndexStatus, "matched">) {
    super(`Candidate knowledge vector index is ${status}`);
    this.name = "CandidateKnowledgeVectorIndexUnavailableError";
    this.status = status;
  }
}

interface VectorStatement {
  readonly run: (...parameters: readonly unknown[]) => unknown;
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

export interface CandidateKnowledgeVectorDatabase {
  readonly prepare: (sql: string) => VectorStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
}

/**
 * Both tables cascade from the lexical projection. After a lexical rebuild the
 * vector index is therefore `not-indexed` until it is embedded again.
 */
export const candidateKnowledgeVectorIndexMigration = {
  version: 28,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_vector_indexes (
      store_id TEXT NOT NULL CHECK (length(trim(store_id)) > 0),
      knowledge_base_id TEXT NOT NULL CHECK (length(trim(knowledge_base_id)) > 0),
      model_id TEXT NOT NULL CHECK (length(trim(model_id)) > 0),
      model_revision TEXT NOT NULL CHECK (length(trim(model_revision)) > 0),
      model_sha256 TEXT NOT NULL CHECK (
        length(model_sha256) = 64 AND model_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      dimensions INTEGER NOT NULL CHECK (
        typeof(dimensions) = 'integer' AND dimensions BETWEEN 1 AND 4096
      ),
      pooling TEXT NOT NULL CHECK (length(trim(pooling)) > 0),
      runtime TEXT NOT NULL CHECK (length(trim(runtime)) > 0),
      lexical_manifest_checksum TEXT NOT NULL CHECK (
        length(lexical_manifest_checksum) = 64 AND lexical_manifest_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      PRIMARY KEY (store_id, knowledge_base_id),
      FOREIGN KEY (store_id, knowledge_base_id)
        REFERENCES candidate_knowledge_lexical_indexes(store_id, knowledge_base_id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_vector_chunks (
      store_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      vector BLOB NOT NULL,
      PRIMARY KEY (store_id, knowledge_base_id, chunk_id),
      FOREIGN KEY (store_id, knowledge_base_id, chunk_id)
        REFERENCES candidate_knowledge_lexical_chunks(store_id, knowledge_base_id, chunk_id)
        ON DELETE CASCADE,
      FOREIGN KEY (store_id, knowledge_base_id)
        REFERENCES candidate_knowledge_vector_indexes(store_id, knowledge_base_id)
        ON DELETE CASCADE
    );
  `.trim(),
} as const;

const maximumVectorsPerUpsert = 10_000;
const maximumDimensions = 4096;
const maximumQueryLimit = 200;
const unitNormTolerance = 1e-3;
const maximumIdentityTextLength = 200;
const hexSha256 = /^[0-9a-f]{64}$/u;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const identityKeys = [
  "modelId",
  "revision",
  "modelFileSha256",
  "dimensions",
  "pooling",
  "runtime",
] as const;

function requireText(value: unknown, field: string, maximum = maximumIdentityTextLength): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new StorageValidationError(`Candidate knowledge vector ${field} is invalid`);
  }
  return value;
}

function requirePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorageValidationError(`Candidate knowledge vector ${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknownKey = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined || allowed.some((key) => !(key in record))) {
    throw new StorageValidationError(`Candidate knowledge vector ${field} has unexpected fields`);
  }
}

function validatedIdentity(value: unknown): CandidateKnowledgeVectorEmbeddingIdentity {
  const record = requirePlainObject(value, "embedding identity");
  requireExactKeys(record, identityKeys, "embedding identity");
  const modelFileSha256 = requireText(record.modelFileSha256, "model file checksum", 64);
  const { dimensions } = record;
  if (
    !hexSha256.test(modelFileSha256) ||
    typeof dimensions !== "number" ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > maximumDimensions
  ) {
    throw new StorageValidationError("Candidate knowledge vector embedding identity is invalid");
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

function identityMatches(
  stored: CandidateKnowledgeVectorEmbeddingIdentity,
  expected: CandidateKnowledgeVectorEmbeddingIdentity,
): boolean {
  return (
    stored.modelId === expected.modelId &&
    stored.revision === expected.revision &&
    stored.modelFileSha256 === expected.modelFileSha256 &&
    stored.dimensions === expected.dimensions &&
    stored.pooling === expected.pooling
  );
}

function validatedVector(value: unknown, dimensions: number, field: string): Float32Array {
  if (!(value instanceof Float32Array) || value.length !== dimensions) {
    throw new StorageValidationError(
      `Candidate knowledge vector ${field} must be a Float32Array of ${dimensions} dimensions`,
    );
  }
  let squares = 0;
  for (const component of value) {
    if (!Number.isFinite(component)) {
      throw new StorageValidationError(
        `Candidate knowledge vector ${field} must contain only finite values`,
      );
    }
    squares += component * component;
  }
  if (Math.abs(Math.sqrt(squares) - 1) > unitNormTolerance) {
    throw new StorageValidationError(`Candidate knowledge vector ${field} must be unit length`);
  }
  return value;
}

/** Float32 little-endian, independent of host endianness. */
export function encodeCandidateKnowledgeVector(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < vector.length; index += 1) {
    view.setFloat32(index * 4, vector[index] as number, true);
  }
  return bytes;
}

export function decodeCandidateKnowledgeVector(blob: unknown, dimensions: number): Float32Array {
  if (!(blob instanceof Uint8Array) || blob.byteLength !== dimensions * 4) {
    throw new StorageValidationError("Stored candidate knowledge vector has an invalid size");
  }
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vector = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = view.getFloat32(index * 4, true);
  }
  return vector;
}

interface ValidatedVectorScope extends CandidateKnowledgeRetrievalScopeInput {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

function requireStoreScope(scopeInput: unknown): ValidatedVectorScope {
  const parsed = candidateKnowledgeRetrievalScopeSchema.safeParse(scopeInput);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge retrieval scope is invalid");
  }
  const scope = parsed.data;
  const first = scope.sources[0];
  if (first === undefined) throw new StorageValidationError("Candidate knowledge scope is empty");
  if (
    scope.sources.some(
      (source) =>
        source.storeId !== first.storeId || source.knowledgeBaseId !== first.knowledgeBaseId,
    )
  ) {
    throw new StorageValidationError(
      "Candidate knowledge vector index operations require one store and knowledge base",
    );
  }
  return { sources: scope.sources, storeId: first.storeId, knowledgeBaseId: first.knowledgeBaseId };
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !isoTimestamp.test(value) || Number.isNaN(Date.parse(value))) {
    throw new StorageValidationError(
      "Candidate knowledge vector index createdAt must be a valid ISO timestamp",
    );
  }
  return value;
}

function sourceVersionKey(sourceId: string, versionId: string): string {
  return JSON.stringify([sourceId, versionId]);
}

function numberColumn(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new StorageValidationError("Stored candidate knowledge vector row is invalid");
  }
  return value;
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new StorageValidationError("Stored candidate knowledge vector row is invalid");
  }
  return value;
}

function storedIdentity(row: Record<string, unknown>): CandidateKnowledgeVectorEmbeddingIdentity {
  return Object.freeze({
    modelId: stringColumn(row, "model_id"),
    revision: stringColumn(row, "model_revision"),
    modelFileSha256: stringColumn(row, "model_sha256"),
    dimensions: numberColumn(row, "dimensions"),
    pooling: stringColumn(row, "pooling"),
    runtime: stringColumn(row, "runtime"),
  });
}

const lexicalIndexSql =
  "SELECT manifest_checksum, scope_json, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?";
const vectorIndexSql =
  "SELECT model_id, model_revision, model_sha256, dimensions, pooling, runtime, lexical_manifest_checksum FROM candidate_knowledge_vector_indexes WHERE store_id = ? AND knowledge_base_id = ?";

function indexedLexicalScope(
  lexical: Record<string, unknown>,
): CandidateKnowledgeRetrievalScopeInput {
  const parsed = candidateKnowledgeRetrievalScopeSchema.safeParse(
    JSON.parse(stringColumn(lexical, "scope_json")),
  );
  if (!parsed.success) {
    throw new StorageValidationError("Stored candidate knowledge lexical scope is invalid");
  }
  return parsed.data;
}

function inspectScope(
  database: CandidateKnowledgeVectorDatabase,
  scope: CandidateKnowledgeRetrievalScopeInput,
  storeId: string,
  knowledgeBaseId: string,
  expected: CandidateKnowledgeVectorEmbeddingIdentity,
): CandidateKnowledgeVectorIndexInspection {
  const lexical = database.prepare(lexicalIndexSql).get(storeId, knowledgeBaseId);
  const vector = database.prepare(vectorIndexSql).get(storeId, knowledgeBaseId);
  if (lexical === undefined || vector === undefined) {
    return { status: "not-indexed", identity: null, vectorCount: 0, scopeChunkCount: 0 };
  }
  const identity = storedIdentity(vector);
  const requested = new Set(
    scope.sources.map((source) => sourceVersionKey(source.sourceId, source.versionId)),
  );
  const rows = database
    .prepare(
      "SELECT c.source_id, c.version_id, v.chunk_id IS NOT NULL AS has_vector FROM candidate_knowledge_lexical_chunks AS c LEFT JOIN candidate_knowledge_vector_chunks AS v ON v.store_id = c.store_id AND v.knowledge_base_id = c.knowledge_base_id AND v.chunk_id = c.chunk_id WHERE c.store_id = ? AND c.knowledge_base_id = ?",
    )
    .all(storeId, knowledgeBaseId);
  let scopeChunkCount = 0;
  let vectorCount = 0;
  for (const row of rows) {
    if (
      !requested.has(
        sourceVersionKey(stringColumn(row, "source_id"), stringColumn(row, "version_id")),
      )
    ) {
      continue;
    }
    scopeChunkCount += 1;
    if (numberColumn(row, "has_vector") === 1) vectorCount += 1;
  }
  const indexed = new Set(
    indexedLexicalScope(lexical).sources.map((source) =>
      sourceVersionKey(source.sourceId, source.versionId),
    ),
  );
  const stale =
    numberColumn(lexical, "stale") === 1 ||
    [...requested].some((key) => !indexed.has(key)) ||
    !identityMatches(identity, expected) ||
    stringColumn(vector, "lexical_manifest_checksum") !==
      stringColumn(lexical, "manifest_checksum") ||
    vectorCount < scopeChunkCount;
  return { status: stale ? "stale" : "matched", identity, vectorCount, scopeChunkCount };
}

function upsertVectors(
  database: CandidateKnowledgeVectorDatabase,
  inputValue: unknown,
): CandidateKnowledgeVectorIndexInspection {
  const input = requirePlainObject(inputValue, "upsert");
  requireExactKeys(
    input,
    ["storeId", "knowledgeBaseId", "identity", "vectors", "createdAt"],
    "upsert",
  );
  const storeId = requireText(input.storeId, "store id");
  const knowledgeBaseId = requireText(input.knowledgeBaseId, "knowledge base id");
  const identity = validatedIdentity(input.identity);
  const createdAt = requireTimestamp(input.createdAt);
  if (!Array.isArray(input.vectors) || input.vectors.length > maximumVectorsPerUpsert) {
    throw new StorageValidationError(
      `Candidate knowledge vector upsert must contain at most ${maximumVectorsPerUpsert} vectors`,
    );
  }
  const seen = new Set<string>();
  const entries = (input.vectors as readonly unknown[]).map((value) => {
    const entry = requirePlainObject(value, "entry");
    requireExactKeys(entry, ["chunkId", "vector"], "entry");
    const chunkId = requireText(entry.chunkId, "chunk id", 500);
    if (seen.has(chunkId)) {
      throw new StorageValidationError("Candidate knowledge vector chunk ids must be unique");
    }
    seen.add(chunkId);
    return { chunkId, vector: validatedVector(entry.vector, identity.dimensions, "entry") };
  });

  return database.transaction(() => {
    const lexical = database.prepare(lexicalIndexSql).get(storeId, knowledgeBaseId);
    if (lexical === undefined) {
      throw new StorageConflictError("Candidate knowledge lexical index must be rebuilt first");
    }
    if (numberColumn(lexical, "stale") === 1) {
      throw new StorageConflictError("Candidate knowledge lexical index is stale");
    }
    const lexicalChecksum = stringColumn(lexical, "manifest_checksum");
    for (const { chunkId } of entries) {
      const known = database
        .prepare(
          "SELECT 1 AS present FROM candidate_knowledge_lexical_chunks WHERE store_id = ? AND knowledge_base_id = ? AND chunk_id = ?",
        )
        .get(storeId, knowledgeBaseId, chunkId);
      if (known === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge vector chunk is not in the lexical index",
        );
      }
    }
    const existing = database.prepare(vectorIndexSql).get(storeId, knowledgeBaseId);
    if (
      existing === undefined ||
      !identityMatches(storedIdentity(existing), identity) ||
      stringColumn(existing, "lexical_manifest_checksum") !== lexicalChecksum
    ) {
      database
        .prepare(
          "DELETE FROM candidate_knowledge_vector_chunks WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(storeId, knowledgeBaseId);
      database
        .prepare(
          "DELETE FROM candidate_knowledge_vector_indexes WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(storeId, knowledgeBaseId);
      database
        .prepare(
          "INSERT INTO candidate_knowledge_vector_indexes (store_id, knowledge_base_id, model_id, model_revision, model_sha256, dimensions, pooling, runtime, lexical_manifest_checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          storeId,
          knowledgeBaseId,
          identity.modelId,
          identity.revision,
          identity.modelFileSha256,
          identity.dimensions,
          identity.pooling,
          identity.runtime,
          lexicalChecksum,
          createdAt,
        );
    }
    const insert = database.prepare(
      "INSERT INTO candidate_knowledge_vector_chunks (store_id, knowledge_base_id, chunk_id, vector) VALUES (?, ?, ?, ?) ON CONFLICT (store_id, knowledge_base_id, chunk_id) DO UPDATE SET vector = excluded.vector",
    );
    for (const { chunkId, vector } of entries) {
      insert.run(
        storeId,
        knowledgeBaseId,
        chunkId,
        Buffer.from(encodeCandidateKnowledgeVector(vector)),
      );
    }
    const indexedScope = indexedLexicalScope(lexical);
    return inspectScope(database, indexedScope, storeId, knowledgeBaseId, identity);
  })();
}

function queryVectors(
  database: CandidateKnowledgeVectorDatabase,
  inputValue: unknown,
): readonly CandidateKnowledgeVectorHit[] {
  const input = requirePlainObject(inputValue, "query");
  requireExactKeys(input, ["scope", "identity", "queryVector", "limit"], "query");
  const scope = requireStoreScope(input.scope);
  const identity = validatedIdentity(input.identity);
  const queryVector = validatedVector(input.queryVector, identity.dimensions, "query vector");
  const { limit } = input;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximumQueryLimit
  ) {
    throw new StorageValidationError(
      `Candidate knowledge vector query limit must be an integer from 1 to ${maximumQueryLimit}`,
    );
  }
  const { storeId, knowledgeBaseId } = scope;
  return database.transaction(() => {
    const inspection = inspectScope(database, scope, storeId, knowledgeBaseId, identity);
    if (inspection.status !== "matched") {
      throw new CandidateKnowledgeVectorIndexUnavailableError(inspection.status);
    }
    const requested = new Set(
      scope.sources.map((source) => sourceVersionKey(source.sourceId, source.versionId)),
    );
    const rows = database
      .prepare(
        "SELECT c.source_id, c.version_id, c.chunk_id, c.ordinal, v.vector FROM candidate_knowledge_vector_chunks AS v JOIN candidate_knowledge_lexical_chunks AS c ON c.store_id = v.store_id AND c.knowledge_base_id = v.knowledge_base_id AND c.chunk_id = v.chunk_id WHERE v.store_id = ? AND v.knowledge_base_id = ?",
      )
      .all(storeId, knowledgeBaseId);
    const hits: CandidateKnowledgeVectorHit[] = [];
    for (const row of rows) {
      const sourceId = stringColumn(row, "source_id");
      const versionId = stringColumn(row, "version_id");
      if (!requested.has(sourceVersionKey(sourceId, versionId))) continue;
      const stored = decodeCandidateKnowledgeVector(row.vector, identity.dimensions);
      let score = 0;
      for (let index = 0; index < stored.length; index += 1) {
        score += (stored[index] as number) * (queryVector[index] as number);
      }
      hits.push({
        storeId,
        knowledgeBaseId,
        sourceId,
        versionId,
        chunkId: stringColumn(row, "chunk_id"),
        ordinal: numberColumn(row, "ordinal"),
        score,
      });
    }
    const compare = (left: string, right: string): number =>
      left < right ? -1 : left > right ? 1 : 0;
    hits.sort(
      (left, right) =>
        right.score - left.score ||
        compare(left.sourceId, right.sourceId) ||
        compare(left.versionId, right.versionId) ||
        left.ordinal - right.ordinal ||
        compare(left.chunkId, right.chunkId),
    );
    return Object.freeze(hits.slice(0, limit).map((hit) => Object.freeze(hit)));
  })();
}

/** Builds the vector port over a database handle; `ensureOpen` guards every call. */
export function createCandidateKnowledgeVectorStorage(
  database: CandidateKnowledgeVectorDatabase,
  ensureOpen: () => void,
): CandidateKnowledgeVectorStoragePort {
  return {
    upsertCandidateKnowledgeVectors: async (input) => {
      ensureOpen();
      return upsertVectors(database, input);
    },
    deleteCandidateKnowledgeVectorIndex: async (inputValue) => {
      ensureOpen();
      const input = requirePlainObject(inputValue, "deletion");
      requireExactKeys(input, ["storeId", "knowledgeBaseId"], "deletion");
      const storeId = requireText(input.storeId, "store id");
      const knowledgeBaseId = requireText(input.knowledgeBaseId, "knowledge base id");
      database.transaction(() => {
        database
          .prepare(
            "DELETE FROM candidate_knowledge_vector_chunks WHERE store_id = ? AND knowledge_base_id = ?",
          )
          .run(storeId, knowledgeBaseId);
        database
          .prepare(
            "DELETE FROM candidate_knowledge_vector_indexes WHERE store_id = ? AND knowledge_base_id = ?",
          )
          .run(storeId, knowledgeBaseId);
      })();
    },
    inspectCandidateKnowledgeVectorIndex: async (scopeInput, identityInput) => {
      ensureOpen();
      const scope = requireStoreScope(scopeInput);
      return inspectScope(
        database,
        scope,
        scope.storeId,
        scope.knowledgeBaseId,
        validatedIdentity(identityInput),
      );
    },
    queryCandidateKnowledgeVectors: async (input) => {
      ensureOpen();
      return queryVectors(database, input);
    },
  };
}

/** Handle members for a CKB store: reads pass through, writes run under the store writer lease. */
export function coordinateCandidateKnowledgeVectorPort(
  port: CandidateKnowledgeVectorStoragePort,
  coordinateWrite: <T>(operation: string, callback: () => Promise<T>) => Promise<T>,
): CandidateKnowledgeVectorStoragePort {
  return {
    upsertCandidateKnowledgeVectors: (input) =>
      coordinateWrite("ckb-vector-upsert", () => port.upsertCandidateKnowledgeVectors(input)),
    deleteCandidateKnowledgeVectorIndex: (input) =>
      coordinateWrite("ckb-vector-delete", () => port.deleteCandidateKnowledgeVectorIndex(input)),
    inspectCandidateKnowledgeVectorIndex: (scope, identity) =>
      port.inspectCandidateKnowledgeVectorIndex(scope, identity),
    queryCandidateKnowledgeVectors: (input) => port.queryCandidateKnowledgeVectors(input),
  };
}
