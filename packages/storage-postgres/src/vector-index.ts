import type { CandidateKnowledgeRetrievalScopeInput } from "@draft-loop/domain";
import {
  type CandidateKnowledgeVectorEmbeddingIdentity,
  type CandidateKnowledgeVectorIndexInspection,
  CandidateKnowledgeVectorIndexUnavailableError,
  type CandidateKnowledgeVectorStoragePort,
} from "@draft-loop/storage";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import {
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
} from "@draft-loop/storage/knowledge-vector-rules";
import { lockIndex } from "./lexical-index.js";
import type { SqlClient, SqlExecutor } from "./sql-client.js";

const lexicalIndexSql =
  "SELECT manifest_checksum, scope_json, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = $1 AND knowledge_base_id = $2";
const vectorIndexSql =
  "SELECT model_id, model_revision, model_sha256, dimensions, pooling, runtime, lexical_manifest_checksum FROM candidate_knowledge_vector_indexes WHERE store_id = $1 AND knowledge_base_id = $2";

/** pgvector's text form; each component prints and parses back as the same float32. */
function vectorLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

function parseVector(value: unknown, dimensions: number): Float32Array {
  const components: unknown = typeof value === "string" ? JSON.parse(value) : undefined;
  if (!Array.isArray(components) || components.length !== dimensions) {
    throw new StorageValidationError("Stored candidate knowledge vector has an invalid size");
  }
  return new Float32Array(components as number[]);
}

async function inspectScope(
  executor: SqlExecutor,
  scope: CandidateKnowledgeRetrievalScopeInput,
  storeId: string,
  knowledgeBaseId: string,
  expected: CandidateKnowledgeVectorEmbeddingIdentity,
): Promise<CandidateKnowledgeVectorIndexInspection> {
  const [lexical] = await executor.query(lexicalIndexSql, [storeId, knowledgeBaseId]);
  const [vector] = await executor.query(vectorIndexSql, [storeId, knowledgeBaseId]);
  const chunks = await executor.query(
    `SELECT c.source_id, c.version_id, v.chunk_id IS NOT NULL AS has_vector
     FROM candidate_knowledge_lexical_chunks c
     LEFT JOIN candidate_knowledge_vector_chunks v
       ON v.store_id = c.store_id AND v.knowledge_base_id = c.knowledge_base_id AND v.chunk_id = c.chunk_id
     WHERE c.store_id = $1 AND c.knowledge_base_id = $2`,
    [storeId, knowledgeBaseId],
  );
  return vectorInspection(
    {
      lexical,
      vector,
      chunks: chunks.map((row) => ({
        sourceId: stringColumn(row, "source_id"),
        versionId: stringColumn(row, "version_id"),
        hasVector: row.has_vector === true,
      })),
    },
    scope,
    expected,
  );
}

/**
 * The knowledge vector index on Postgres, stored as pgvector `vector` values. Queries rank the
 * scope's vectors in the application with the same rules as SQLite, so both stores return the
 * same hits and scores. An approximate (HNSW) index would trade that exactness for speed, which a
 * single person's knowledge base does not need.
 */
export function createVectorIndex(client: SqlClient): CandidateKnowledgeVectorStoragePort {
  return {
    upsertCandidateKnowledgeVectors: async (input) => {
      const { storeId, knowledgeBaseId, identity, createdAt, entries } = prepareVectorUpsert(input);
      return client.transaction(async (executor) => {
        await lockIndex(executor, storeId, knowledgeBaseId);
        const [lexical] = await executor.query(lexicalIndexSql, [storeId, knowledgeBaseId]);
        if (lexical === undefined) {
          throw new StorageConflictError("Candidate knowledge lexical index must be rebuilt first");
        }
        if (numberColumn(lexical, "stale") === 1) {
          throw new StorageConflictError("Candidate knowledge lexical index is stale");
        }
        const lexicalChecksum = stringColumn(lexical, "manifest_checksum");
        const known = await executor.query(
          "SELECT chunk_id FROM candidate_knowledge_lexical_chunks WHERE store_id = $1 AND knowledge_base_id = $2 AND chunk_id = ANY($3::text[])",
          [storeId, knowledgeBaseId, entries.map((entry) => entry.chunkId)],
        );
        if (known.length !== entries.length) {
          throw new StorageValidationError(
            "Candidate knowledge vector chunk is not in the lexical index",
          );
        }
        const [existing] = await executor.query(vectorIndexSql, [storeId, knowledgeBaseId]);
        if (
          existing === undefined ||
          !identityMatches(storedIdentity(existing), identity) ||
          stringColumn(existing, "lexical_manifest_checksum") !== lexicalChecksum
        ) {
          // Deleting the index row cascades to its vectors.
          await executor.query(
            "DELETE FROM candidate_knowledge_vector_indexes WHERE store_id = $1 AND knowledge_base_id = $2",
            [storeId, knowledgeBaseId],
          );
          await executor.query(
            `INSERT INTO candidate_knowledge_vector_indexes
               (store_id, knowledge_base_id, model_id, model_revision, model_sha256, dimensions, pooling, runtime, lexical_manifest_checksum, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
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
            ],
          );
        }
        for (const { chunkId, vector } of entries) {
          await executor.query(
            `INSERT INTO candidate_knowledge_vector_chunks (store_id, knowledge_base_id, chunk_id, vector)
             VALUES ($1, $2, $3, $4::public.vector)
             ON CONFLICT (store_id, knowledge_base_id, chunk_id) DO UPDATE SET vector = excluded.vector`,
            [storeId, knowledgeBaseId, chunkId, vectorLiteral(vector)],
          );
        }
        return inspectScope(
          executor,
          indexedLexicalScope(lexical),
          storeId,
          knowledgeBaseId,
          identity,
        );
      });
    },
    deleteCandidateKnowledgeVectorIndex: async (input) => {
      const { storeId, knowledgeBaseId } = prepareVectorDeletion(input);
      await client.transaction(async (executor) => {
        await lockIndex(executor, storeId, knowledgeBaseId);
        await executor.query(
          "DELETE FROM candidate_knowledge_vector_indexes WHERE store_id = $1 AND knowledge_base_id = $2",
          [storeId, knowledgeBaseId],
        );
      });
    },
    inspectCandidateKnowledgeVectorIndex: async (scopeInput, identityInput) => {
      const scope = requireStoreScope(scopeInput);
      return inspectScope(
        client,
        scope,
        scope.storeId,
        scope.knowledgeBaseId,
        validatedIdentity(identityInput),
      );
    },
    queryCandidateKnowledgeVectors: async (input) => {
      const { scope, identity, queryVector, limit } = prepareVectorQuery(input);
      const { storeId, knowledgeBaseId } = scope;
      return client.transaction(async (executor) => {
        await executor.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
        const inspection = await inspectScope(executor, scope, storeId, knowledgeBaseId, identity);
        if (inspection.status !== "matched") {
          throw new CandidateKnowledgeVectorIndexUnavailableError(inspection.status);
        }
        const rows = await executor.query(
          `SELECT c.source_id, c.version_id, c.chunk_id, c.ordinal, c.line_start, c.line_end, c.text,
             c.metadata_json, v.vector::text AS vector
           FROM candidate_knowledge_vector_chunks v
           JOIN candidate_knowledge_lexical_chunks c
             ON c.store_id = v.store_id AND c.knowledge_base_id = v.knowledge_base_id AND c.chunk_id = v.chunk_id
           WHERE v.store_id = $1 AND v.knowledge_base_id = $2`,
          [storeId, knowledgeBaseId],
        );
        return rankVectorHits(
          rows.map((row) => ({ row, vector: parseVector(row.vector, identity.dimensions) })),
          scope,
          queryVector,
          limit,
        );
      });
    },
  };
}
