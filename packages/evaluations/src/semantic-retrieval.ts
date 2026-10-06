import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  applySemanticRelevanceFloor,
  cosineSimilarity,
  type SemanticRelevanceFloor,
  type TextEmbedder,
} from "@draft-loop/embeddings";

export interface SemanticRetrieverQueryOptions {
  readonly workspaceId?: string;
  readonly limit?: number;
}

export interface SemanticRetriever {
  queryEvidence(
    query: string,
    options?: SemanticRetrieverQueryOptions,
  ): Promise<readonly ScoredEvidenceChunk[]>;
  /** Wall-clock milliseconds spent embedding the whole corpus once. */
  readonly documentEmbeddingMs: number;
}

const defaultLimit = 20;

/**
 * Builds an in-memory semantic retriever over a learned local embedder.
 *
 * Every chunk is embedded once with the "document" role; each query is embedded with the "query"
 * role. Results are ordered by cosine similarity (descending), then chunk id (ascending) so ties
 * are deterministic, and `rank` is the negated score to match the lexical rank convention.
 *
 * When `relevanceFloor` is given it is applied to the ordered hits before truncation to `limit`,
 * so fewer than `limit` chunks come back when the lower hits are not plausibly relevant.
 */
export async function createSemanticRetriever(
  embedder: TextEmbedder,
  chunks: readonly ScoredEvidenceChunk[],
  options: {
    readonly signal?: AbortSignal;
    readonly relevanceFloor?: SemanticRelevanceFloor;
  } = {},
): Promise<SemanticRetriever> {
  const startedAt = performance.now();
  const embedOptions = options.signal === undefined ? undefined : { signal: options.signal };
  const documentVectors = await embedder.embed(
    chunks.map((chunk) => chunk.text),
    "document",
    embedOptions,
  );
  const documentEmbeddingMs = performance.now() - startedAt;
  if (documentVectors.length !== chunks.length) {
    throw new RangeError(
      `Embedder returned ${documentVectors.length} vectors for ${chunks.length} chunks.`,
    );
  }
  const indexed = chunks.map((chunk, index) => ({
    chunk,
    vector: documentVectors[index] as Float32Array,
  }));

  return {
    documentEmbeddingMs,
    async queryEvidence(query, queryOptions) {
      const [queryVector] = await embedder.embed([query], "query", embedOptions);
      if (queryVector === undefined) {
        throw new RangeError("Embedder returned no vector for the query.");
      }
      const limit = queryOptions?.limit ?? defaultLimit;
      const ordered = indexed
        .filter(
          ({ chunk }) =>
            queryOptions?.workspaceId === undefined ||
            chunk.workspaceId === queryOptions.workspaceId,
        )
        .map(({ chunk, vector }) => ({ chunk, score: cosineSimilarity(queryVector, vector) }))
        .sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));
      const floored =
        options.relevanceFloor === undefined
          ? ordered
          : applySemanticRelevanceFloor(
              ordered.map((entry) => ({ ...entry, id: entry.chunk.id })),
              options.relevanceFloor,
            );
      return floored.slice(0, limit).map(({ chunk, score }) => ({ ...chunk, rank: -score }));
    },
  };
}
