import type {
  CandidateKnowledgeLexicalChunk,
  CandidateKnowledgeRetrievalPurpose,
  CandidateKnowledgeRetrievalScopeInput,
} from "@draft-loop/domain";
import {
  applySemanticRelevanceFloor,
  createOnnxTextEmbedder,
  EmbeddingModelUnavailableError,
  type SemanticRelevanceFloor,
  semanticRelevanceFloorForIdentity,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import type { ingestBytes } from "@draft-loop/ingestion";
import {
  type CandidateKnowledgeVectorEmbeddingIdentity,
  CandidateKnowledgeVectorIndexUnavailableError,
  StorageConflictError,
} from "@draft-loop/storage";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import type { PreparedCandidateKnowledgeLexicalSelection } from "./candidate-knowledge-lexical-sync.js";
import { deriveCandidateKnowledgeLexicalChunks } from "./candidate-knowledge-source-chunks.js";
import {
  createEmbeddingModelService,
  defaultEmbeddingModelTier,
  type EmbeddingModelService,
  type EmbeddingModelTier,
} from "./embedding-model-install.js";

/*
 * Semantic and hybrid retrieval over one prepared CKB selection.
 *
 * Callers MUST still apply sensitivity exclusion (`filterResult` / `filterChunks`) to these hits
 * exactly as they do for lexical hits; this module neither reads nor enforces consent.
 */

/** Matches the semantic fallback reason codes recorded by the retrieval trace contract. */
export type SemanticUnavailableReason =
  | "model-absent"
  | "model-corrupt"
  | "unsupported-platform"
  | "runtime-failed"
  | "index-stale";

export type SemanticRetrievalMode = "semantic" | "hybrid";

export interface SemanticCandidateKnowledgeHit {
  readonly chunk: CandidateKnowledgeLexicalChunk;
  /** Cosine similarity, or `null` when the chunk only came from the lexical side. */
  readonly vectorScore: number | null;
  /** 1-based position in the vector ranking, or `null` when absent from it. */
  readonly vectorRank: number | null;
  /** 1-based position in the BM25 ranking, or `null` when absent from it (always in `semantic`). */
  readonly bm25Rank: number | null;
  /** Final 1-based position in the returned list. */
  readonly fusedRank: number;
}

export type SemanticResult<Value> =
  | ({ readonly ok: true } & Value)
  | { readonly ok: false; readonly reason: SemanticUnavailableReason };

/** The part of a prepared lexical selection that semantic retrieval needs. */
export type SemanticPreparedSelection = Pick<
  PreparedCandidateKnowledgeLexicalSelection,
  "entry" | "scope"
>;

const reciprocalRankFusionK = 60;
const maximumVectorsPerUpsert = 10_000;
const defaultBatchSize = 32;

export function embeddingStorageIdentity(
  embedder: TextEmbedder,
): CandidateKnowledgeVectorEmbeddingIdentity {
  const { modelId, revision, modelFileSha256, dimensions, pooling, runtime } = embedder.identity;
  return { modelId, revision, modelFileSha256, dimensions, pooling, runtime };
}

export interface OpenLocalTextEmbedderOptions {
  readonly modelRoot: string;
  readonly tier?: EmbeddingModelTier;
  readonly service?: Pick<EmbeddingModelService, "status">;
  readonly createEmbedder?: (options: {
    readonly modelDirectory: string;
    readonly tier: EmbeddingModelTier;
  }) => Promise<TextEmbedder>;
}

/** Open the installed local embedding model, mapping every failure to a reason. Never throws. */
export async function openLocalTextEmbedder(
  options: OpenLocalTextEmbedderOptions,
): Promise<SemanticResult<{ readonly embedder: TextEmbedder }>> {
  const tier = options.tier ?? defaultEmbeddingModelTier;
  const service = options.service ?? createEmbeddingModelService({ modelRoot: options.modelRoot });
  const createEmbedder = options.createEmbedder ?? createOnnxTextEmbedder;
  try {
    const status = await service.status(tier);
    switch (status.state) {
      case "absent":
      case "installing":
        return { ok: false, reason: "model-absent" };
      case "corrupt":
        return { ok: false, reason: "model-corrupt" };
      case "unsupported-platform":
        return { ok: false, reason: "unsupported-platform" };
      case "ready":
        break;
    }
    const embedder = await createEmbedder({ modelDirectory: status.modelDirectory, tier });
    return { ok: true, embedder };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof EmbeddingModelUnavailableError ? "model-corrupt" : "runtime-failed",
    };
  }
}

export interface SemanticSyncProgress {
  readonly embedded: number;
  readonly total: number;
}

export interface SynchronizeCandidateKnowledgeVectorsRequest {
  readonly handle: CandidateKnowledgeStoreHandle;
  readonly prepared: SemanticPreparedSelection;
  readonly embedder: TextEmbedder;
  readonly ingest?: typeof ingestBytes;
  readonly createdAt: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SemanticSyncProgress) => void;
  readonly batchSize?: number;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function singleStoreScope(prepared: SemanticPreparedSelection): {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly scope: CandidateKnowledgeRetrievalScopeInput;
} {
  return {
    storeId: prepared.entry.storeId,
    knowledgeBaseId: prepared.entry.knowledgeBaseId,
    scope: prepared.scope,
  };
}

/**
 * Bring the vector projection of one selection up to date. A matched index costs one inspection;
 * otherwise chunks are derived, embedded as documents in bounded batches, and upserted.
 *
 * A lexical rebuild cascades away every vector row of the CKB, so after any rebuild the whole CKB
 * is re-embedded. Cancellation rethrows the abort and can leave only a partial, non-matched index.
 */
export async function synchronizeCandidateKnowledgeVectors(
  request: SynchronizeCandidateKnowledgeVectorsRequest,
): Promise<SemanticResult<{ readonly status: "matched"; readonly embeddedChunkCount: number }>> {
  const { handle, embedder, signal } = request;
  const { storeId, knowledgeBaseId, scope } = singleStoreScope(request.prepared);
  const identity = embeddingStorageIdentity(embedder);
  const batchSize = Math.max(1, Math.floor(request.batchSize ?? defaultBatchSize));
  signal?.throwIfAborted();

  try {
    const before = await handle.inspectCandidateKnowledgeVectorIndex(scope, identity);
    if (before.status === "matched") {
      return { ok: true, status: "matched", embeddedChunkCount: 0 };
    }

    const chunks = await deriveCandidateKnowledgeLexicalChunks(
      handle,
      request.prepared.entry,
      request.ingest,
    );
    let embedded = 0;
    let pending: { readonly chunkId: string; readonly vector: Float32Array }[] = [];
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const vectors = pending;
      pending = [];
      await handle.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId,
        identity,
        vectors,
        createdAt: request.createdAt,
      });
    };
    for (let start = 0; start < chunks.length; start += batchSize) {
      signal?.throwIfAborted();
      const batch = chunks.slice(start, start + batchSize);
      const vectors = await embedder.embed(
        batch.map((chunk) => chunk.text),
        "document",
        signal === undefined ? undefined : { signal },
      );
      if (vectors.length !== batch.length) return { ok: false, reason: "runtime-failed" };
      for (const [offset, chunk] of batch.entries()) {
        pending.push({ chunkId: chunk.chunkId, vector: vectors[offset] as Float32Array });
      }
      embedded += batch.length;
      if (pending.length >= maximumVectorsPerUpsert) await flush();
      request.onProgress?.({ embedded, total: chunks.length });
    }
    signal?.throwIfAborted();
    await flush();

    const after = await handle.inspectCandidateKnowledgeVectorIndex(scope, identity);
    if (after.status !== "matched") return { ok: false, reason: "index-stale" };
    return { ok: true, status: "matched", embeddedChunkCount: embedded };
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    if (error instanceof StorageConflictError) return { ok: false, reason: "index-stale" };
    return { ok: false, reason: "runtime-failed" };
  }
}

export interface QuerySemanticCandidateKnowledgeRequest {
  readonly handle: CandidateKnowledgeStoreHandle;
  readonly prepared: SemanticPreparedSelection;
  readonly embedder: TextEmbedder;
  readonly mode: SemanticRetrievalMode;
  readonly purpose: CandidateKnowledgeRetrievalPurpose;
  readonly query: string;
  readonly limit: number;
  /**
   * Relevance floor for vector hits. Defaults to the calibrated floor of the embedder's pinned
   * Granite tier; an embedder without a calibrated floor applies none.
   */
  readonly relevanceFloor?: SemanticRelevanceFloor;
  readonly signal?: AbortSignal;
}

interface FusionEntry {
  chunk: CandidateKnowledgeLexicalChunk;
  vectorScore: number | null;
  vectorRank: number | null;
  bm25Rank: number | null;
}

/**
 * Semantic or hybrid hits for one selection. The query is embedded once. Hybrid fuses the vector
 * ranking with the lexical BM25 ranking per chunk id by reciprocal rank fusion (k = 60), breaking
 * score ties by chunk id ascending. Lexical hits only join the fusion when the lexical query
 * actually matched; the bounded fallback (arbitrary chunks, no relevance signal) is ignored.
 *
 * Vector hits first pass the relevance floor, so `semantic` may return fewer than `limit` hits and
 * `hybrid` admits semantic-only hits only above the floor; lexical hits always participate. The
 * floor that was applied is returned so callers can record it.
 */
export async function querySemanticCandidateKnowledge(
  request: QuerySemanticCandidateKnowledgeRequest,
): Promise<
  SemanticResult<{
    readonly hits: readonly SemanticCandidateKnowledgeHit[];
    readonly relevanceFloor: SemanticRelevanceFloor | null;
  }>
> {
  const { handle, embedder, signal, limit } = request;
  const relevanceFloor =
    request.relevanceFloor ?? semanticRelevanceFloorForIdentity(embedder.identity) ?? null;
  const { scope } = singleStoreScope(request.prepared);
  const identity = embeddingStorageIdentity(embedder);
  signal?.throwIfAborted();

  let vectorHits: Awaited<ReturnType<typeof handle.queryCandidateKnowledgeVectors>>;
  try {
    const [queryVector] = await embedder.embed(
      [request.query],
      "query",
      signal === undefined ? undefined : { signal },
    );
    if (queryVector === undefined) return { ok: false, reason: "runtime-failed" };
    vectorHits = await handle.queryCandidateKnowledgeVectors({
      scope,
      identity,
      queryVector,
      limit,
    });
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    if (error instanceof CandidateKnowledgeVectorIndexUnavailableError) {
      return { ok: false, reason: "index-stale" };
    }
    return { ok: false, reason: "runtime-failed" };
  }

  if (relevanceFloor !== null) {
    vectorHits = [...applySemanticRelevanceFloor(vectorHits, relevanceFloor)];
  }

  if (request.mode === "semantic") {
    return {
      ok: true,
      relevanceFloor,
      hits: vectorHits.slice(0, limit).map((hit, index) => ({
        chunk: hit.chunk,
        vectorScore: hit.score,
        vectorRank: index + 1,
        bm25Rank: null,
        fusedRank: index + 1,
      })),
    };
  }

  const lexical = await handle.queryCandidateKnowledge({
    purpose: request.purpose,
    query: request.query,
    scope,
    limit,
  });
  const entries = new Map<string, FusionEntry>();
  for (const [index, hit] of vectorHits.entries()) {
    entries.set(hit.chunk.chunkId, {
      chunk: hit.chunk,
      vectorScore: hit.score,
      vectorRank: index + 1,
      bm25Rank: null,
    });
  }
  if (lexical.status === "matched") {
    for (const [index, hit] of lexical.hits.entries()) {
      const existing = entries.get(hit.chunkId);
      if (existing !== undefined) {
        existing.bm25Rank = index + 1;
        continue;
      }
      const { bm25Rank: _rawBm25, ...chunk } = hit;
      entries.set(hit.chunkId, { chunk, vectorScore: null, vectorRank: null, bm25Rank: index + 1 });
    }
  }
  const fusedScore = (entry: FusionEntry): number =>
    (entry.vectorRank === null ? 0 : 1 / (reciprocalRankFusionK + entry.vectorRank)) +
    (entry.bm25Rank === null ? 0 : 1 / (reciprocalRankFusionK + entry.bm25Rank));
  const ordered = [...entries.values()]
    .map((entry) => ({ entry, score: fusedScore(entry) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.entry.chunk.chunkId < right.entry.chunk.chunkId
          ? -1
          : left.entry.chunk.chunkId > right.entry.chunk.chunkId
            ? 1
            : 0),
    )
    .slice(0, limit);
  return {
    ok: true,
    relevanceFloor,
    hits: ordered.map(({ entry }, index) => ({ ...entry, fusedRank: index + 1 })),
  };
}
