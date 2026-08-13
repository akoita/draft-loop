import type { ScoredEvidenceChunk } from "@draft-loop/domain";

/** Computes cosine similarity between two numeric vectors. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Builds a local term-frequency vector over a fixed vocabulary for privacy-preserving offline retrieval. */
export class LocalVectorEmbedding {
  private readonly vocabulary: Map<string, number>;

  constructor(corpusTexts: readonly string[]) {
    this.vocabulary = new Map();
    let index = 0;
    for (const text of corpusTexts) {
      for (const token of this.tokenize(text)) {
        if (!this.vocabulary.has(token)) {
          this.vocabulary.set(token, index++);
        }
      }
    }
  }

  tokenize(text: string): readonly string[] {
    return (
      text
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu)
        ?.filter((token) => token.length > 1) ?? []
    );
  }

  embed(text: string): readonly number[] {
    const vector = new Array<number>(this.vocabulary.size).fill(0);
    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      return vector;
    }
    for (const token of tokens) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        vector[idx] = (vector[idx] ?? 0) + 1;
      }
    }
    // Normalize L2
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] = (vector[i] ?? 0) / norm;
      }
    }
    return vector;
  }
}

/** Local vector retriever using deterministic in-memory embeddings. */
export class LocalVectorRetriever {
  private readonly embedder: LocalVectorEmbedding;
  private readonly chunksWithEmbeddings: Array<{
    readonly chunk: ScoredEvidenceChunk;
    readonly embedding: readonly number[];
  }>;

  constructor(chunks: readonly ScoredEvidenceChunk[]) {
    this.embedder = new LocalVectorEmbedding(chunks.map((chunk) => chunk.text));
    this.chunksWithEmbeddings = chunks.map((chunk) => ({
      chunk,
      embedding: this.embedder.embed(chunk.text),
    }));
  }

  async queryEvidence(
    query: string,
    options?: { readonly workspaceId?: string; readonly limit?: number },
  ): Promise<readonly ScoredEvidenceChunk[]> {
    const queryVector = this.embedder.embed(query);
    const limit = options?.limit ?? 20;

    const scored = this.chunksWithEmbeddings
      .filter(
        ({ chunk }) =>
          options?.workspaceId === undefined || chunk.workspaceId === options.workspaceId,
      )
      .map(({ chunk, embedding }) => {
        const similarity = cosineSimilarity(queryVector, embedding);
        return {
          ...chunk,
          rank: -similarity, // lower is better in rank ordering convention
        };
      })
      .filter((chunk) => (chunk.rank ?? 0) < 0)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

    return scored.slice(0, limit);
  }
}

/** Merges multiple ranked lists using Reciprocal Rank Fusion (RRF). */
export function fuseReciprocalRanks(
  rankedLists: readonly (readonly ScoredEvidenceChunk[])[],
  k = 60,
): readonly ScoredEvidenceChunk[] {
  const rrfScores = new Map<string, { chunk: ScoredEvidenceChunk; score: number }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const chunk = list[rank];
      if (!chunk) continue;
      const current = rrfScores.get(chunk.id);
      const increment = 1 / (k + rank + 1);
      if (current) {
        current.score += increment;
      } else {
        rrfScores.set(chunk.id, { chunk, score: increment });
      }
    }
  }

  return [...rrfScores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ chunk, score }) => ({
      ...chunk,
      rank: -score, // Inverted so lower/negative number represents higher RRF priority
    }));
}

/** Creates a hybrid retriever combining a lexical retriever and vector retriever via RRF. */
export function createHybridRetriever(
  lexicalRetriever: {
    readonly queryEvidence: (
      query: string,
      options?: { readonly workspaceId?: string; readonly limit?: number },
    ) => Promise<readonly ScoredEvidenceChunk[]>;
  },
  vectorRetriever: {
    readonly queryEvidence: (
      query: string,
      options?: { readonly workspaceId?: string; readonly limit?: number },
    ) => Promise<readonly ScoredEvidenceChunk[]>;
  },
  k = 60,
) {
  return {
    async queryEvidence(
      query: string,
      options?: { readonly workspaceId?: string; readonly limit?: number },
    ): Promise<readonly ScoredEvidenceChunk[]> {
      const [lexicalResults, vectorResults] = await Promise.all([
        lexicalRetriever.queryEvidence(query, options),
        vectorRetriever.queryEvidence(query, options),
      ]);
      const fused = fuseReciprocalRanks([lexicalResults, vectorResults], k);
      const limit = options?.limit ?? 20;
      return fused.slice(0, limit);
    },
  };
}
