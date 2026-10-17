import type {
  CandidateKnowledgeLexicalChunk,
  CandidateKnowledgeRetrievalTrace,
} from "@draft-loop/domain";
import type {
  CandidateKnowledgeLexicalIndexRecord,
  CandidateKnowledgeLexicalStoragePort,
} from "@draft-loop/storage";
import { serialize } from "@draft-loop/storage/audit-trail";
import {
  candidateKnowledgeLexicalScopeJson,
  candidateKnowledgeRetrievalTraceFromRow,
  expectedLexicalIndex,
  lexicalIndexInspection,
  lexicalIndexRecordFromRow,
  lexicalRetrievalResult,
  lexicalScopeEquals,
  lexicalSourceVersionDeletion,
  prepareLexicalIndexRebuild,
  prepareLexicalIndexUpsert,
  prepareRetrievalTrace,
  requireSingleCandidateKnowledgeLexicalScope,
  retrievalTraceKey,
  retrievalTraceListQuery,
  validatedCandidateKnowledgeRetrievalRequest,
  validatedCandidateKnowledgeRetrievalScope,
} from "@draft-loop/storage/candidate-knowledge-lexical";
import { StorageConflictError } from "@draft-loop/storage/errors";
import { evidenceQueryTerms } from "@draft-loop/storage/evidence-retrieval-precision";
import { recordToJson } from "@draft-loop/storage/history-records";
import {
  lexicalQueryPhrases,
  lexicalTokens,
  phraseInstanceCount,
  rankLexicalChunks,
} from "@draft-loop/storage/lexical-ranking";
import { now } from "@draft-loop/storage/versioned-records";
import type { SqlClient, SqlExecutor, SqlRow } from "./sql-client.js";

/** Serializes writes to one knowledge base's index; the key is per store and knowledge base. */
const lexicalIndexLockNamespace = 0x6c786978;

const indexSelect =
  "SELECT store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = $1 AND knowledge_base_id = $2";
const hitColumns = "chunk_id, ordinal, line_start, line_end, text, metadata_json";
const traceSelect =
  "SELECT workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at FROM candidate_knowledge_retrieval_traces WHERE workspace_id = $1";

async function lockIndex(
  executor: SqlExecutor,
  storeId: string,
  knowledgeBaseId: string,
): Promise<void> {
  await executor.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    lexicalIndexLockNamespace,
    `${storeId}:${knowledgeBaseId}`,
  ]);
}

async function readIndex(
  executor: SqlExecutor,
  storeId: string,
  knowledgeBaseId: string,
): Promise<CandidateKnowledgeLexicalIndexRecord | undefined> {
  const [row] = await executor.query(indexSelect, [storeId, knowledgeBaseId]);
  if (row === undefined) return undefined;
  const [count] = await executor.query(
    "SELECT count(*) AS count FROM candidate_knowledge_lexical_chunks WHERE store_id = $1 AND knowledge_base_id = $2",
    [storeId, knowledgeBaseId],
  );
  return lexicalIndexRecordFromRow(row, Number(count?.count ?? 0));
}

async function insertChunks(
  executor: SqlExecutor,
  storeId: string,
  knowledgeBaseId: string,
  chunks: readonly CandidateKnowledgeLexicalChunk[],
): Promise<void> {
  for (const chunk of chunks) {
    const provenance = chunk.metadata.provenance;
    await executor.query(
      `INSERT INTO candidate_knowledge_lexical_chunks
         (store_id, knowledge_base_id, source_id, version_id, chunk_id, ordinal, line_start, line_end, text, metadata_json, tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        storeId,
        knowledgeBaseId,
        provenance.sourceId,
        provenance.versionId,
        chunk.chunkId,
        chunk.ordinal,
        chunk.lineStart,
        chunk.lineEnd,
        chunk.text,
        serialize(recordToJson(chunk.metadata)),
        lexicalTokens(chunk.text),
      ],
    );
  }
}

async function requireStoredIndex(
  executor: SqlExecutor,
  storeId: string,
  knowledgeBaseId: string,
): Promise<CandidateKnowledgeLexicalIndexRecord> {
  const record = await readIndex(executor, storeId, knowledgeBaseId);
  if (record === undefined) {
    throw new StorageConflictError("Candidate knowledge lexical index was not stored");
  }
  return record;
}

/**
 * Selects and ranks the scope's chunks for the query phrases. Postgres finds the chunks holding
 * any phrase token through the GIN index; ranking runs in the application with FTS5's BM25 over
 * table-wide statistics, so results and scores match the local store (ADR 0011, D11).
 */
async function rankedChunks(
  executor: SqlExecutor,
  storeId: string,
  knowledgeBaseId: string,
  phrases: readonly (readonly string[])[],
  limit: number,
): Promise<readonly SqlRow[]> {
  const queryTokens = [...new Set(phrases.flat())];
  if (queryTokens.length === 0) return [];
  const [totals] = await executor.query(
    "SELECT count(*) AS row_count, COALESCE(sum(cardinality(tokens)), 0) AS token_count FROM candidate_knowledge_lexical_chunks",
  );
  const containing = await executor.query(
    "SELECT store_id, knowledge_base_id, chunk_id, tokens FROM candidate_knowledge_lexical_chunks WHERE tokens && $1::text[]",
    [queryTokens],
  );
  const chunks = containing.map((row) => ({
    storeId: String(row.store_id),
    knowledgeBaseId: String(row.knowledge_base_id),
    chunkId: String(row.chunk_id),
    tokens: row.tokens as readonly string[],
  }));
  const statistics = {
    rowCount: Number(totals?.row_count ?? 0),
    tokenCount: Number(totals?.token_count ?? 0),
    phraseRowCounts: phrases.map(
      (phrase) => chunks.filter((chunk) => phraseInstanceCount(chunk.tokens, phrase) > 0).length,
    ),
  };
  const ranked = rankLexicalChunks(
    chunks.filter(
      (chunk) => chunk.storeId === storeId && chunk.knowledgeBaseId === knowledgeBaseId,
    ),
    phrases,
    statistics,
    limit,
  );
  if (ranked.length === 0) return [];
  const rows = await executor.query(
    `SELECT ${hitColumns} FROM candidate_knowledge_lexical_chunks
     WHERE store_id = $1 AND knowledge_base_id = $2 AND chunk_id = ANY($3::text[])`,
    [storeId, knowledgeBaseId, ranked.map((chunk) => chunk.chunkId)],
  );
  const byId = new Map(rows.map((row) => [String(row.chunk_id), row]));
  return ranked.map((chunk) => ({ ...byId.get(chunk.chunkId), bm25_rank: chunk.bm25Rank }));
}

/**
 * A knowledge base's lexical index and the retrieval traces on Postgres, with the shared rules
 * from `@draft-loop/storage/candidate-knowledge-lexical` and FTS5-equivalent BM25 ranking.
 */
export function createLexicalIndex(client: SqlClient): CandidateKnowledgeLexicalStoragePort {
  const inspect: CandidateKnowledgeLexicalStoragePort["inspectCandidateKnowledgeLexicalIndex"] =
    async (scopeInput, indexInput) => {
      const requestedScope = validatedCandidateKnowledgeRetrievalScope(scopeInput);
      const { storeId, knowledgeBaseId } =
        requireSingleCandidateKnowledgeLexicalScope(requestedScope);
      return lexicalIndexInspection(
        requestedScope,
        await readIndex(client, storeId, knowledgeBaseId),
        expectedLexicalIndex(indexInput),
      );
    };

  return {
    rebuildCandidateKnowledgeLexicalIndex: async (input) => {
      const { scope, identity, storeId, knowledgeBaseId, chunks, createdAt } =
        prepareLexicalIndexRebuild(input);
      return client.transaction(async (executor) => {
        await lockIndex(executor, storeId, knowledgeBaseId);
        await executor.query(
          "DELETE FROM candidate_knowledge_lexical_chunks WHERE store_id = $1 AND knowledge_base_id = $2",
          [storeId, knowledgeBaseId],
        );
        await executor.query(
          "DELETE FROM candidate_knowledge_lexical_indexes WHERE store_id = $1 AND knowledge_base_id = $2",
          [storeId, knowledgeBaseId],
        );
        await executor.query(
          `INSERT INTO candidate_knowledge_lexical_indexes
             (store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at, stale)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
          [
            storeId,
            knowledgeBaseId,
            identity.schemaVersion,
            identity.indexerId,
            identity.manifestChecksum,
            candidateKnowledgeLexicalScopeJson(scope),
            createdAt,
          ],
        );
        await insertChunks(executor, storeId, knowledgeBaseId, chunks);
        return requireStoredIndex(executor, storeId, knowledgeBaseId);
      });
    },
    upsertCandidateKnowledgeLexicalChunks: async (input) => {
      const { scope, identity, storeId, knowledgeBaseId, chunks } =
        prepareLexicalIndexUpsert(input);
      return client.transaction(async (executor) => {
        await lockIndex(executor, storeId, knowledgeBaseId);
        const existing = await readIndex(executor, storeId, knowledgeBaseId);
        if (existing === undefined) {
          throw new StorageConflictError("Candidate knowledge lexical index must be rebuilt first");
        }
        if (!lexicalScopeEquals(existing.scope, scope)) {
          throw new StorageConflictError("Candidate knowledge lexical index scope has changed");
        }
        for (const chunk of chunks) {
          await executor.query(
            `DELETE FROM candidate_knowledge_lexical_chunks
             WHERE store_id = $1 AND knowledge_base_id = $2
               AND (chunk_id = $3 OR (source_id = $4 AND version_id = $5 AND ordinal = $6))`,
            [
              storeId,
              knowledgeBaseId,
              chunk.chunkId,
              chunk.metadata.provenance.sourceId,
              chunk.metadata.provenance.versionId,
              chunk.ordinal,
            ],
          );
          await insertChunks(executor, storeId, knowledgeBaseId, [chunk]);
        }
        await executor.query(
          `UPDATE candidate_knowledge_lexical_indexes
           SET schema_version = $1, indexer_id = $2, manifest_checksum = $3, scope_json = $4, created_at = $5, stale = 0
           WHERE store_id = $6 AND knowledge_base_id = $7`,
          [
            identity.schemaVersion,
            identity.indexerId,
            identity.manifestChecksum,
            candidateKnowledgeLexicalScopeJson(scope),
            now(),
            storeId,
            knowledgeBaseId,
          ],
        );
        return requireStoredIndex(executor, storeId, knowledgeBaseId);
      });
    },
    deleteCandidateKnowledgeLexicalSourceVersion: async (input) => {
      const reference = lexicalSourceVersionDeletion(input);
      // A deleted source version invalidates the whole manifest, so the index and all its chunks
      // go together and the next query needs a full rebuild.
      await client.transaction(async (executor) => {
        await lockIndex(executor, reference.storeId, reference.knowledgeBaseId);
        await executor.query(
          "DELETE FROM candidate_knowledge_lexical_chunks WHERE store_id = $1 AND knowledge_base_id = $2",
          [reference.storeId, reference.knowledgeBaseId],
        );
        await executor.query(
          "DELETE FROM candidate_knowledge_lexical_indexes WHERE store_id = $1 AND knowledge_base_id = $2",
          [reference.storeId, reference.knowledgeBaseId],
        );
      });
    },
    inspectCandidateKnowledgeLexicalIndex: inspect,
    queryCandidateKnowledge: async (requestInput) => {
      const request = validatedCandidateKnowledgeRetrievalRequest(requestInput);
      const inspection = await inspect(request.scope);
      if (inspection.status !== "matched") {
        return lexicalRetrievalResult(request, inspection, inspection.status, []);
      }
      const queryTerms = evidenceQueryTerms(request.query);
      if (queryTerms.length === 0) {
        return lexicalRetrievalResult(request, inspection, "no-query", []);
      }
      const { storeId, knowledgeBaseId } = requireSingleCandidateKnowledgeLexicalScope(
        request.scope,
      );
      return client.transaction(async (executor) => {
        // One snapshot for the statistics and the chunks they rank.
        await executor.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
        const matched = await rankedChunks(
          executor,
          storeId,
          knowledgeBaseId,
          lexicalQueryPhrases(queryTerms),
          request.limit,
        );
        if (matched.length > 0) {
          return lexicalRetrievalResult(request, inspection, "matched", matched);
        }
        const fallback = await executor.query(
          `SELECT ${hitColumns}, 0 AS bm25_rank FROM candidate_knowledge_lexical_chunks
           WHERE store_id = $1 AND knowledge_base_id = $2 ORDER BY chunk_id COLLATE "C" LIMIT $3`,
          [storeId, knowledgeBaseId, request.limit],
        );
        return lexicalRetrievalResult(request, inspection, "bounded-fallback", fallback);
      });
    },
    appendCandidateKnowledgeRetrievalTrace: async (input) => {
      const { trace, payloadJson, payloadChecksum } = prepareRetrievalTrace(input);
      return client.transaction(async (executor): Promise<CandidateKnowledgeRetrievalTrace> => {
        await executor.query(
          `INSERT INTO candidate_knowledge_retrieval_traces
             (workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (workspace_id, trace_id) DO NOTHING`,
          [
            trace.workspaceId,
            trace.id,
            trace.schemaVersion,
            trace.operationId,
            trace.purpose,
            trace.queryChecksum,
            payloadJson,
            payloadChecksum,
            trace.createdAt,
          ],
        );
        const [stored] = await executor.query(`${traceSelect} AND trace_id = $2`, [
          trace.workspaceId,
          trace.id,
        ]);
        if (stored === undefined || String(stored.payload_checksum) !== payloadChecksum) {
          throw new StorageConflictError("Candidate knowledge retrieval trace is immutable");
        }
        return candidateKnowledgeRetrievalTraceFromRow(stored);
      });
    },
    getCandidateKnowledgeRetrievalTrace: async (workspaceIdInput, traceIdInput) => {
      const { workspaceId, traceId } = retrievalTraceKey(workspaceIdInput, traceIdInput);
      const [row] = await client.query(`${traceSelect} AND trace_id = $2`, [workspaceId, traceId]);
      return row === undefined ? undefined : candidateKnowledgeRetrievalTraceFromRow(row);
    },
    listCandidateKnowledgeRetrievalTraces: async (workspaceIdInput, options = {}) => {
      const { workspaceId, operationId, limit } = retrievalTraceListQuery(
        workspaceIdInput,
        options,
      );
      const rows =
        operationId === undefined
          ? await client.query(
              `${traceSelect} ORDER BY created_at COLLATE "C", trace_id COLLATE "C" LIMIT $2`,
              [workspaceId, limit],
            )
          : await client.query(
              `${traceSelect} AND operation_id = $2 ORDER BY created_at COLLATE "C", trace_id COLLATE "C" LIMIT $3`,
              [workspaceId, operationId, limit],
            );
      return rows.map(candidateKnowledgeRetrievalTraceFromRow);
    },
  };
}
