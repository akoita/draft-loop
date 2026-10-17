import type {
  CandidateKnowledgeLexicalChunk,
  CandidateKnowledgeRetrievalScopeInput,
} from "@draft-loop/domain";
import {
  candidateKnowledgeLexicalChunkSchema,
  candidateKnowledgeRetrievalScopeSchema,
} from "@draft-loop/schemas";
import type {
  CandidateKnowledgeVectorEmbeddingIdentity,
  CandidateKnowledgeVectorHit,
  CandidateKnowledgeVectorIndexInspection,
} from "./knowledge-vector-index.js";
import { StorageValidationError } from "./storage-errors.js";

/**
 * The rules for a knowledge base's vector index, shared by every storage implementation:
 * input validation, staleness, and how hits are scored and ordered. Implementations differ only
 * in how they store vectors and read the rows these rules take.
 */

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

export function requireText(
  value: unknown,
  field: string,
  maximum = maximumIdentityTextLength,
): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new StorageValidationError(`Candidate knowledge vector ${field} is invalid`);
  }
  return value;
}

export function requirePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorageValidationError(`Candidate knowledge vector ${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

export function requireExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknownKey = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined || allowed.some((key) => !(key in record))) {
    throw new StorageValidationError(`Candidate knowledge vector ${field} has unexpected fields`);
  }
}

export function validatedIdentity(value: unknown): CandidateKnowledgeVectorEmbeddingIdentity {
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

export function identityMatches(
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

export function validatedVector(value: unknown, dimensions: number, field: string): Float32Array {
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

export interface ValidatedVectorScope extends CandidateKnowledgeRetrievalScopeInput {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

export function requireStoreScope(scopeInput: unknown): ValidatedVectorScope {
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

export function requireVectorTimestamp(value: unknown): string {
  if (typeof value !== "string" || !isoTimestamp.test(value) || Number.isNaN(Date.parse(value))) {
    throw new StorageValidationError(
      "Candidate knowledge vector index createdAt must be a valid ISO timestamp",
    );
  }
  return value;
}

export function sourceVersionKey(sourceId: string, versionId: string): string {
  return JSON.stringify([sourceId, versionId]);
}

export function numberColumn(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new StorageValidationError("Stored candidate knowledge vector row is invalid");
  }
  return value;
}

export function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new StorageValidationError("Stored candidate knowledge vector row is invalid");
  }
  return value;
}

export function storedIdentity(
  row: Record<string, unknown>,
): CandidateKnowledgeVectorEmbeddingIdentity {
  return Object.freeze({
    modelId: stringColumn(row, "model_id"),
    revision: stringColumn(row, "model_revision"),
    modelFileSha256: stringColumn(row, "model_sha256"),
    dimensions: numberColumn(row, "dimensions"),
    pooling: stringColumn(row, "pooling"),
    runtime: stringColumn(row, "runtime"),
  });
}

export function indexedLexicalScope(
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

/** Validates a stored lexical row with the same schema the lexical path uses. */
export function lexicalChunkFromRow(
  row: Record<string, unknown>,
  storeId: string,
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
): CandidateKnowledgeLexicalChunk {
  let metadata: unknown;
  try {
    metadata = JSON.parse(stringColumn(row, "metadata_json"));
  } catch (error) {
    if (error instanceof StorageValidationError) throw error;
    throw new StorageValidationError("Candidate knowledge lexical chunk is invalid");
  }
  const parsed = candidateKnowledgeLexicalChunkSchema.safeParse({
    chunkId: stringColumn(row, "chunk_id"),
    ordinal: numberColumn(row, "ordinal"),
    lineStart: numberColumn(row, "line_start"),
    lineEnd: numberColumn(row, "line_end"),
    text: stringColumn(row, "text"),
    metadata,
  });
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge lexical chunk is invalid");
  }
  const { provenance } = parsed.data.metadata;
  if (
    provenance.storeId !== storeId ||
    provenance.knowledgeBaseId !== knowledgeBaseId ||
    provenance.sourceId !== sourceId ||
    provenance.versionId !== versionId
  ) {
    throw new StorageValidationError("Candidate knowledge lexical chunk provenance is invalid");
  }
  return parsed.data;
}

/** A validated upsert: the embedding identity and unique, unit-length vectors of its dimensions. */
export function prepareVectorUpsert(inputValue: unknown): {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly identity: CandidateKnowledgeVectorEmbeddingIdentity;
  readonly createdAt: string;
  readonly entries: readonly { readonly chunkId: string; readonly vector: Float32Array }[];
} {
  const input = requirePlainObject(inputValue, "upsert");
  requireExactKeys(
    input,
    ["storeId", "knowledgeBaseId", "identity", "vectors", "createdAt"],
    "upsert",
  );
  const storeId = requireText(input.storeId, "store id");
  const knowledgeBaseId = requireText(input.knowledgeBaseId, "knowledge base id");
  const identity = validatedIdentity(input.identity);
  const createdAt = requireVectorTimestamp(input.createdAt);
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
  return { storeId, knowledgeBaseId, identity, createdAt, entries };
}

/** A validated index deletion. */
export function prepareVectorDeletion(inputValue: unknown): {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
} {
  const input = requirePlainObject(inputValue, "deletion");
  requireExactKeys(input, ["storeId", "knowledgeBaseId"], "deletion");
  return {
    storeId: requireText(input.storeId, "store id"),
    knowledgeBaseId: requireText(input.knowledgeBaseId, "knowledge base id"),
  };
}

/** A validated query: one store and knowledge base, a unit query vector and a bounded limit. */
export function prepareVectorQuery(inputValue: unknown): {
  readonly scope: ValidatedVectorScope;
  readonly identity: CandidateKnowledgeVectorEmbeddingIdentity;
  readonly queryVector: Float32Array;
  readonly limit: number;
} {
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
  return { scope, identity, queryVector, limit };
}

/** What an inspection reads: the lexical and vector index rows and each lexical chunk's state. */
export interface VectorInspectionRows {
  readonly lexical: Record<string, unknown> | undefined;
  readonly vector: Record<string, unknown> | undefined;
  readonly chunks: readonly {
    readonly sourceId: string;
    readonly versionId: string;
    readonly hasVector: boolean;
  }[];
}

/**
 * The index status for a requested scope. It is stale when the lexical index is stale or lacks a
 * requested source version, the identity differs, the vectors were computed for another lexical
 * manifest, or a chunk in scope has no vector yet.
 */
export function vectorInspection(
  rows: VectorInspectionRows,
  scope: CandidateKnowledgeRetrievalScopeInput,
  expected: CandidateKnowledgeVectorEmbeddingIdentity,
): CandidateKnowledgeVectorIndexInspection {
  const { lexical, vector } = rows;
  if (lexical === undefined || vector === undefined) {
    return { status: "not-indexed", identity: null, vectorCount: 0, scopeChunkCount: 0 };
  }
  const identity = storedIdentity(vector);
  const requested = new Set(
    scope.sources.map((source) => sourceVersionKey(source.sourceId, source.versionId)),
  );
  let scopeChunkCount = 0;
  let vectorCount = 0;
  for (const chunk of rows.chunks) {
    if (!requested.has(sourceVersionKey(chunk.sourceId, chunk.versionId))) continue;
    scopeChunkCount += 1;
    if (chunk.hasVector) vectorCount += 1;
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

/** A stored chunk with its vector, as a query reads it. */
export interface VectorCandidateRow {
  readonly row: Record<string, unknown>;
  readonly vector: Float32Array;
}

/**
 * Scores the scope's chunks by inner product with the query (vectors are unit length, so this is
 * cosine similarity), best first; ties go by source, version, ordinal and chunk id. Only the
 * returned hits are validated, matching the lexical retrieval path.
 */
export function rankVectorHits(
  candidates: readonly VectorCandidateRow[],
  scope: ValidatedVectorScope,
  queryVector: Float32Array,
  limit: number,
): readonly CandidateKnowledgeVectorHit[] {
  const requested = new Set(
    scope.sources.map((source) => sourceVersionKey(source.sourceId, source.versionId)),
  );
  const scored: {
    readonly row: Record<string, unknown>;
    readonly sourceId: string;
    readonly versionId: string;
    readonly chunkId: string;
    readonly ordinal: number;
    readonly score: number;
  }[] = [];
  for (const { row, vector } of candidates) {
    const sourceId = stringColumn(row, "source_id");
    const versionId = stringColumn(row, "version_id");
    if (!requested.has(sourceVersionKey(sourceId, versionId))) continue;
    let score = 0;
    for (let index = 0; index < vector.length; index += 1) {
      score += (vector[index] as number) * (queryVector[index] as number);
    }
    scored.push({
      row,
      sourceId,
      versionId,
      chunkId: stringColumn(row, "chunk_id"),
      ordinal: numberColumn(row, "ordinal"),
      score,
    });
  }
  const compare = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      compare(left.sourceId, right.sourceId) ||
      compare(left.versionId, right.versionId) ||
      left.ordinal - right.ordinal ||
      compare(left.chunkId, right.chunkId),
  );
  return Object.freeze(
    scored.slice(0, limit).map((entry) =>
      Object.freeze({
        chunk: lexicalChunkFromRow(
          entry.row,
          scope.storeId,
          scope.knowledgeBaseId,
          entry.sourceId,
          entry.versionId,
        ),
        score: entry.score,
      }),
    ),
  );
}
