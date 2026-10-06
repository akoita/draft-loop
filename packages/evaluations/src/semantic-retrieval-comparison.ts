import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { EmbeddingModelIdentity, TextEmbedder } from "@draft-loop/embeddings";

import {
  benchmarkRetrieval,
  type RetrievalBenchmarkCase,
  type RetrievalBenchmarkReport,
} from "./index.js";
import { createHybridRetriever } from "./retrieval.js";
import { createSemanticRetriever } from "./semantic-retrieval.js";

export interface RetrievalPort {
  queryEvidence(
    query: string,
    options?: { readonly workspaceId?: string; readonly limit?: number },
  ): Promise<readonly ScoredEvidenceChunk[]>;
}

export interface RetrievalModeComparisonInput {
  readonly cases: readonly RetrievalBenchmarkCase[];
  /** Lexical baseline. It must already be scoped to the workspace that holds the corpus. */
  readonly lexical: RetrievalPort;
  readonly embedder: TextEmbedder;
  /** Number of chunks every mode may return per query. */
  readonly limit: number;
  readonly signal?: AbortSignal;
}

/** Content-free comparison report: no chunk text and no query text. */
export interface RetrievalModeComparisonReport {
  readonly embeddingIdentity: EmbeddingModelIdentity;
  readonly limit: number;
  readonly caseCount: number;
  readonly documentEmbeddingMs: number;
  readonly meanQueryMs: number;
  /** Larger of the process RSS sampled before and after the comparison. */
  readonly peakRssBytes: number;
  readonly semantic: RetrievalBenchmarkReport;
  readonly semanticHybrid: RetrievalBenchmarkReport;
}

/** Compares lexical retrieval against semantic and semantic-hybrid retrieval with a real embedder. */
export async function runRetrievalModeComparison(
  input: RetrievalModeComparisonInput,
): Promise<RetrievalModeComparisonReport> {
  const { cases, lexical, embedder, limit } = input;
  const rssBefore = process.memoryUsage().rss;

  const union = new Map<string, ScoredEvidenceChunk>();
  for (const benchmarkCase of cases) {
    for (const chunk of benchmarkCase.corpus) {
      if (!union.has(chunk.id)) {
        union.set(chunk.id, chunk);
      }
    }
  }
  const semanticRetriever = await createSemanticRetriever(
    embedder,
    [...union.values()],
    input.signal === undefined ? {} : { signal: input.signal },
  );

  let queryCount = 0;
  let queryTotalMs = 0;
  const timedSemantic: RetrievalPort = {
    async queryEvidence(query, options) {
      const startedAt = performance.now();
      const results = await semanticRetriever.queryEvidence(query, options);
      queryTotalMs += performance.now() - startedAt;
      queryCount += 1;
      return results;
    },
  };
  const hybridPort = createHybridRetriever(lexical, timedSemantic);

  const lexicalMode = {
    mode: "lexical" as const,
    queryEvidence: (query: string) => lexical.queryEvidence(query, { limit }),
  };
  const semanticMode = {
    mode: "semantic" as const,
    queryEvidence: (query: string) => timedSemantic.queryEvidence(query, { limit }),
  };
  const semanticHybridMode = {
    mode: "semantic-hybrid" as const,
    queryEvidence: (query: string) => hybridPort.queryEvidence(query, { limit }),
  };

  const semantic = await benchmarkRetrieval(cases, lexicalMode, semanticMode);
  const semanticHybrid = await benchmarkRetrieval(cases, lexicalMode, semanticHybridMode);
  const rssAfter = process.memoryUsage().rss;

  return {
    embeddingIdentity: embedder.identity,
    limit,
    caseCount: cases.length,
    documentEmbeddingMs: semanticRetriever.documentEmbeddingMs,
    meanQueryMs: queryCount === 0 ? 0 : queryTotalMs / queryCount,
    peakRssBytes: Math.max(rssBefore, rssAfter),
    semantic,
    semanticHybrid,
  };
}
