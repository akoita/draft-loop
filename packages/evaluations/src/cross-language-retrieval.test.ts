import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  createOnnxTextEmbedder,
  type GraniteEmbeddingTier,
  graniteEmbeddingModels,
  semanticRelevanceFloorForIdentity,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import {
  type CrossLanguageRetrievalFixture,
  compareWithSameLanguage,
  type LanguagePair,
  languagePairCases,
  languagePairCorpus,
  languagePairs,
} from "./cross-language-retrieval.js";
import { benchmarkRetrieval, type RetrievalBenchmarkCase } from "./index.js";
import {
  type RetrievalModeComparisonReport,
  runRetrievalModeComparison,
} from "./semantic-retrieval-comparison.js";

/**
 * Cross-language retrieval measurement (#2332). The lexical part always runs. The semantic and
 * hybrid part runs only with a local embedding model, as in `semantic-retrieval.model.test.ts`:
 *
 *   DRAFT_LOOP_EMBEDDING_MODEL_DIR   directory with the verified model files
 *   DRAFT_LOOP_EMBEDDING_TIER        "311m" (default here), "97m", or "eg2-text"
 *   DRAFT_LOOP_RETRIEVAL_REPORT_PATH optional path for the content-free JSON report
 */
const modelDirectory = process.env.DRAFT_LOOP_EMBEDDING_MODEL_DIR;
const requestedTier = process.env.DRAFT_LOOP_EMBEDDING_TIER ?? "311m";
const tier = (
  requestedTier in graniteEmbeddingModels ? requestedTier : "311m"
) as GraniteEmbeddingTier;
const reportPath = process.env.DRAFT_LOOP_RETRIEVAL_REPORT_PATH;
const timestamp = "2026-11-06T22:00:00.000Z";
const checksum = "b".repeat(64);
const limit = 3;

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/retrieval-quality/cross-language-cases.json", import.meta.url),
    "utf8",
  ),
) as CrossLanguageRetrievalFixture;

interface PairBench {
  readonly cases: readonly RetrievalBenchmarkCase[];
  readonly lexical: {
    readonly queryEvidence: (
      query: string,
      options?: { readonly limit?: number },
    ) => Promise<readonly ScoredEvidenceChunk[]>;
  };
}

async function withPairBench<T>(pair: LanguagePair, run: (bench: PairBench) => Promise<T>) {
  const workspaceId = `fictional-${pair.id}`;
  const sourceId = `fictional-${pair.id}-source`;
  const storage = openSqliteStorage(":memory:");
  try {
    await storage.saveWorkspace({
      id: workspaceId,
      state: "collecting",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await storage.saveEvidenceSource({
      id: sourceId,
      workspaceId,
      path: `fixture://fictional/${pair.evidence}-evidence`,
      mediaType: "text/markdown",
      checksum,
      createdAt: timestamp,
    });
    const records = languagePairCorpus(fixture, pair).map((entry) => ({
      ...entry,
      workspaceId,
      sourceId,
      lineStart: entry.ordinal + 1,
      lineEnd: entry.ordinal + 1,
      checksum,
      createdAt: timestamp,
    }));
    for (const record of records) {
      await storage.saveEvidenceChunk(record);
    }
    const corpus: readonly ScoredEvidenceChunk[] = records.map((record) => ({
      ...record,
      rank: 0,
    }));
    const cases = languagePairCases(fixture, pair).map((benchmarkCase) => ({
      ...benchmarkCase,
      corpus,
    }));
    const lexical = {
      queryEvidence: (query: string, options?: { readonly limit?: number }) =>
        storage.queryEvidence(query, { workspaceId, limit: options?.limit ?? limit }),
    };
    return await run({ cases, lexical });
  } finally {
    await storage.close();
  }
}

async function lexicalRecall(pair: LanguagePair): Promise<number> {
  return withPairBench(pair, async ({ cases, lexical }) => {
    const mode = { mode: "lexical" as const, queryEvidence: lexical.queryEvidence };
    const report = await benchmarkRetrieval(cases, mode, mode);
    return report.baselineMetrics.recall;
  });
}

describe("cross-language retrieval fixture", () => {
  it("gives every chunk and requirement both languages and valid ground truth", () => {
    const ids = new Set(fixture.corpus.map((entry) => entry.id));
    for (const entry of fixture.corpus) {
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.fr.length).toBeGreaterThan(0);
    }
    for (const benchmarkCase of fixture.cases) {
      expect(benchmarkCase.en.length).toBeGreaterThan(0);
      expect(benchmarkCase.fr.length).toBeGreaterThan(0);
      for (const id of benchmarkCase.groundTruthEvidenceIds) {
        expect(ids.has(id)).toBe(true);
      }
    }
  });

  it("records lexical recall for each language pair", async () => {
    const recall = new Map<string, number>();
    for (const pair of languagePairs) {
      recall.set(pair.id, await lexicalRecall(pair));
    }
    // Recorded in docs/evaluation/cross-language-retrieval.md. Lexical matching cannot cross a
    // language boundary except on shared words such as "cloud" or "services".
    expect(Object.fromEntries(recall)).toEqual(LEXICAL_RECALL);
  });
});

describe.skipIf(modelDirectory === undefined || modelDirectory === "")(
  "real-model cross-language retrieval",
  () => {
    it("compares each pair's lexical, semantic and hybrid recall with its same-language baseline", async () => {
      const embedder: TextEmbedder = await createOnnxTextEmbedder({
        modelDirectory: modelDirectory as string,
        tier,
      });
      try {
        const relevanceFloor = semanticRelevanceFloorForIdentity(embedder.identity);
        const reports = new Map<string, RetrievalModeComparisonReport>();
        for (const pair of languagePairs) {
          const report = await withPairBench(pair, ({ cases, lexical }) =>
            runRetrievalModeComparison({
              cases,
              lexical,
              embedder,
              limit,
              ...(relevanceFloor === undefined ? {} : { relevanceFloor }),
            }),
          );
          reports.set(pair.id, report);
        }
        const recall = new Map(
          [...reports].map(([pairId, report]) => [
            pairId,
            new Map([
              ["lexical", report.semantic.baselineMetrics.recall],
              ["semantic", report.semantic.candidateMetrics.recall],
              ["semantic-hybrid", report.semanticHybrid.candidateMetrics.recall],
            ]),
          ]),
        );
        const comparison = compareWithSameLanguage(recall);
        expect(comparison).toHaveLength(languagePairs.length * 3);
        for (const row of comparison) {
          expect(row.recall).toBeGreaterThanOrEqual(0);
          expect(row.recall).toBeLessThanOrEqual(1);
        }

        if (reportPath !== undefined) {
          mkdirSync(dirname(reportPath), { recursive: true });
          writeFileSync(
            reportPath,
            `${JSON.stringify(
              {
                tier,
                embeddingIdentity: embedder.identity,
                relevanceFloor: relevanceFloor ?? null,
                limit,
                comparison,
                pairs: Object.fromEntries(
                  [...reports].map(([pairId, report]) => [
                    pairId,
                    {
                      lexical: report.semantic.baselineMetrics,
                      semantic: report.semantic.candidateMetrics,
                      semanticHybrid: report.semanticHybrid.candidateMetrics,
                      meanQueryMs: report.meanQueryMs,
                    },
                  ]),
                ),
              },
              null,
              2,
            )}\n`,
          );
        }
      } finally {
        await embedder.dispose();
      }
    }, 600_000);
  },
);

const LEXICAL_RECALL = {
  "en-evidence-en-job": 1,
  "fr-evidence-fr-job": 1,
  "fr-evidence-en-job": 0.4,
  "en-evidence-fr-job": 0.4,
};
