import { describe, expect, it } from "vitest";
import {
  lexicalQueryPhrases,
  lexicalTokens,
  phraseInstanceCount,
  rankLexicalChunks,
} from "./candidate-knowledge-lexical-ranking.js";
import { loadSqlite } from "./sqlite-handle.js";

// FTS5 is the reference implementation; these tests measure the shared ranker against it.

const texts = [
  "Built TypeScript services for the platform team",
  "Led platform operations and on-call for TypeScript services",
  "Designed Python automation; Python tooling for data_pipelines",
  "Café naïve résumé: front-end work in São Paulo",
  "Straße, İstanbul, ŒUVRE and the ﬁle ligature",
  "日本語テキスト and 中文 mixed with ASCII words",
  "C++ and C# engineer, 3.5 years, v2_beta release",
  "platform platform platform",
  "A short line",
];

function openFts() {
  const database = loadSqlite(":memory:");
  database.exec(`
    CREATE VIRTUAL TABLE chunks USING fts5(chunk_key UNINDEXED, text);
    CREATE VIRTUAL TABLE chunk_terms USING fts5vocab(chunks, instance);
  `);
  const insert = database.prepare("INSERT INTO chunks (chunk_key, text) VALUES (?, ?)");
  for (const [index, text] of texts.entries()) insert.run(`chunk-${index}`, text);
  return database;
}

describe("lexical ranking parity with SQLite FTS5", () => {
  it("tokenizes text as the unicode61 tokenizer does", () => {
    const database = openFts();
    try {
      for (const [index] of texts.entries()) {
        const rows = database
          .prepare(
            "SELECT term FROM chunk_terms WHERE doc = (SELECT rowid FROM chunks WHERE chunk_key = ?) ORDER BY offset",
          )
          .all(`chunk-${index}`) as readonly { readonly term: string }[];
        expect(lexicalTokens(texts[index] ?? "")).toEqual(rows.map((row) => row.term));
      }
    } finally {
      database.close();
    }
  });

  it.each([
    ["platform"],
    ["TypeScript services"],
    ["python automation"],
    ["front-end"],
    ["cafe resume"],
    ["platform operations typescript"],
    ["data_pipelines"],
  ])("ranks %s with the same order and bm25 values", (query) => {
    const database = openFts();
    try {
      const terms = query.toLowerCase().split(" ");
      const ftsQuery = terms.map((term) => `"${term}"`).join(" OR ");
      const expected = database
        .prepare(
          "SELECT chunk_key, bm25(chunks) AS rank FROM chunks WHERE chunks MATCH ? ORDER BY rank, chunk_key",
        )
        .all(ftsQuery) as readonly { readonly chunk_key: string; readonly rank: number }[];
      const documents = texts.map((text, index) => ({
        chunkId: `chunk-${index}`,
        tokens: lexicalTokens(text),
      }));
      const phrases = lexicalQueryPhrases(terms);
      const statistics = {
        rowCount: documents.length,
        tokenCount: documents.reduce((total, document) => total + document.tokens.length, 0),
        phraseRowCounts: phrases.map(
          (phrase) =>
            documents.filter((document) => phraseInstanceCount(document.tokens, phrase) > 0).length,
        ),
      };
      const ranked = rankLexicalChunks(documents, phrases, statistics, 100);
      expect(expected.length).toBeGreaterThan(0);
      expect(ranked.map((chunk) => chunk.chunkId)).toEqual(expected.map((row) => row.chunk_key));
      for (const [index, chunk] of ranked.entries()) {
        expect(chunk.bm25Rank).toBeCloseTo(expected[index]?.rank ?? Number.NaN, 12);
      }
    } finally {
      database.close();
    }
  });
});
