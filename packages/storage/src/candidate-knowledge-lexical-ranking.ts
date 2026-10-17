/**
 * BM25 ranking that reproduces SQLite FTS5's `bm25()` for a store that keeps chunk tokens
 * itself (ADR 0011, D11). FTS5 is the reference: the local store ranks with it, and a hosted
 * store ranks the same chunks in the same order with the same scores when it tokenizes text
 * with `lexicalTokens` and passes the same table-wide statistics.
 */

/** FTS5's default `bm25()` parameters. */
const k1 = 1.2;
const b = 0.75;

/**
 * Tokens as FTS5's default `unicode61` tokenizer produces them with `remove_diacritics 1`:
 * case-folded runs of letters, numbers and private-use characters, with diacritics removed.
 * Everything else, including `-` and `_`, separates tokens.
 */
export function lexicalTokens(text: string): readonly string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}\p{Co}]+/gu) ?? []
  );
}

/**
 * The phrases FTS5 matches for `"term" OR "term"` queries: one phrase per query term, tokenized
 * like the indexed text. A term that tokenizes to nothing matches nothing.
 */
export function lexicalQueryPhrases(queryTerms: readonly string[]): readonly (readonly string[])[] {
  return queryTerms.map(lexicalTokens);
}

/** How many times `phrase` occurs in `tokens`, counting each starting position. */
export function phraseInstanceCount(tokens: readonly string[], phrase: readonly string[]): number {
  if (phrase.length === 0) return 0;
  let count = 0;
  for (let start = 0; start + phrase.length <= tokens.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[start + offset] !== phrase[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) count += 1;
  }
  return count;
}

/** Statistics over every indexed chunk in the store, as FTS5 computes them over its table. */
export interface LexicalCorpusStatistics {
  readonly rowCount: number;
  readonly tokenCount: number;
  /** For each phrase, the number of chunks in the store that contain it. */
  readonly phraseRowCounts: readonly number[];
}

/**
 * The FTS5 `bm25()` value of one chunk: the negated sum over phrases of
 * IDF × tf × (k1 + 1) / (tf + k1 × (1 − b + b × |D| / avgdl)), where an IDF at or below zero
 * becomes 1e-6. Lower is better, as in FTS5. Operations follow FTS5's order so the floating-point
 * result matches.
 */
export function lexicalBm25Rank(
  tokens: readonly string[],
  phrases: readonly (readonly string[])[],
  statistics: LexicalCorpusStatistics,
): number {
  const averageLength = statistics.tokenCount / statistics.rowCount;
  const documentLength = tokens.length;
  let score = 0;
  for (const [index, phrase] of phrases.entries()) {
    const hits = statistics.phraseRowCounts[index] ?? 0;
    let idf = Math.log((statistics.rowCount - hits + 0.5) / (hits + 0.5));
    if (idf <= 0) idf = 1e-6;
    const frequency = phraseInstanceCount(tokens, phrase);
    score +=
      idf *
      ((frequency * (k1 + 1.0)) /
        (frequency + k1 * (1 - b + (b * documentLength) / averageLength)));
  }
  return -1.0 * score;
}

/** Byte order of UTF-8 strings, as SQLite's BINARY collation compares them. */
export function compareBinary(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * Ranks the chunks that contain at least one phrase, best first, ties by chunk id, as FTS5's
 * `ORDER BY bm25(...), chunk_id` does, and keeps the first `limit`.
 */
export function rankLexicalChunks<
  Chunk extends { readonly chunkId: string; readonly tokens: readonly string[] },
>(
  chunks: readonly Chunk[],
  phrases: readonly (readonly string[])[],
  statistics: LexicalCorpusStatistics,
  limit: number,
): readonly (Chunk & { readonly bm25Rank: number })[] {
  return chunks
    .filter((chunk) => phrases.some((phrase) => phraseInstanceCount(chunk.tokens, phrase) > 0))
    .map((chunk) => ({ ...chunk, bm25Rank: lexicalBm25Rank(chunk.tokens, phrases, statistics) }))
    .sort(
      (left, right) => left.bm25Rank - right.bm25Rank || compareBinary(left.chunkId, right.chunkId),
    )
    .slice(0, limit);
}
