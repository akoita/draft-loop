import type {
  CandidateKnowledgeLexicalChunk,
  CandidateKnowledgeRetrievalScopeInput,
} from "@draft-loop/domain";
import {
  decodeCandidateKnowledgeVector,
  encodeCandidateKnowledgeVector,
  identityMatches,
  indexedLexicalScope,
  numberColumn,
  prepareVectorDeletion,
  prepareVectorQuery,
  prepareVectorUpsert,
  rankVectorHits,
  requireStoreScope,
  storedIdentity,
  stringColumn,
  validatedIdentity,
  vectorInspection,
} from "./knowledge-vector-rules.js";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

export {
  decodeCandidateKnowledgeVector,
  encodeCandidateKnowledgeVector,
} from "./knowledge-vector-rules.js";

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
  /**
   * The validated lexical chunk, identical to what lexical retrieval returns
   * for the same chunk id (minus `bm25Rank`). Store, knowledge base, source,
   * and version identity live in `chunk.metadata.provenance`.
   */
  readonly chunk: CandidateKnowledgeLexicalChunk;
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

const lexicalIndexSql =
  "SELECT manifest_checksum, scope_json, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?";
const vectorIndexSql =
  "SELECT model_id, model_revision, model_sha256, dimensions, pooling, runtime, lexical_manifest_checksum FROM candidate_knowledge_vector_indexes WHERE store_id = ? AND knowledge_base_id = ?";

function inspectScope(
  database: CandidateKnowledgeVectorDatabase,
  scope: CandidateKnowledgeRetrievalScopeInput,
  storeId: string,
  knowledgeBaseId: string,
  expected: CandidateKnowledgeVectorEmbeddingIdentity,
): CandidateKnowledgeVectorIndexInspection {
  const chunks = database
    .prepare(
      "SELECT c.source_id, c.version_id, v.chunk_id IS NOT NULL AS has_vector FROM candidate_knowledge_lexical_chunks AS c LEFT JOIN candidate_knowledge_vector_chunks AS v ON v.store_id = c.store_id AND v.knowledge_base_id = c.knowledge_base_id AND v.chunk_id = c.chunk_id WHERE c.store_id = ? AND c.knowledge_base_id = ?",
    )
    .all(storeId, knowledgeBaseId)
    .map((row) => ({
      sourceId: stringColumn(row, "source_id"),
      versionId: stringColumn(row, "version_id"),
      hasVector: numberColumn(row, "has_vector") === 1,
    }));
  return vectorInspection(
    {
      lexical: database.prepare(lexicalIndexSql).get(storeId, knowledgeBaseId),
      vector: database.prepare(vectorIndexSql).get(storeId, knowledgeBaseId),
      chunks,
    },
    scope,
    expected,
  );
}

function upsertVectors(
  database: CandidateKnowledgeVectorDatabase,
  inputValue: unknown,
): CandidateKnowledgeVectorIndexInspection {
  const { storeId, knowledgeBaseId, identity, createdAt, entries } =
    prepareVectorUpsert(inputValue);

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
  const { scope, identity, queryVector, limit } = prepareVectorQuery(inputValue);
  const { storeId, knowledgeBaseId } = scope;
  return database.transaction(() => {
    const inspection = inspectScope(database, scope, storeId, knowledgeBaseId, identity);
    if (inspection.status !== "matched") {
      throw new CandidateKnowledgeVectorIndexUnavailableError(inspection.status);
    }
    const rows = database
      .prepare(
        "SELECT c.source_id, c.version_id, c.chunk_id, c.ordinal, c.line_start, c.line_end, c.text, c.metadata_json, v.vector FROM candidate_knowledge_vector_chunks AS v JOIN candidate_knowledge_lexical_chunks AS c ON c.store_id = v.store_id AND c.knowledge_base_id = v.knowledge_base_id AND c.chunk_id = v.chunk_id WHERE v.store_id = ? AND v.knowledge_base_id = ?",
      )
      .all(storeId, knowledgeBaseId);
    return rankVectorHits(
      rows.map((row) => ({
        row,
        vector: decodeCandidateKnowledgeVector(row.vector, identity.dimensions),
      })),
      scope,
      queryVector,
      limit,
    );
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
      const { storeId, knowledgeBaseId } = prepareVectorDeletion(inputValue);
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
