import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  createOnnxTextEmbedder,
  type GraniteEmbeddingTier,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import type { RetrievalBenchmarkCase, RetrievalBenchmarkReport } from "./index.js";
import {
  type RetrievalModeComparisonReport,
  runRetrievalModeComparison,
} from "./semantic-retrieval-comparison.js";

/**
 * Real-model retrieval comparison. It only runs when a local Granite model directory is supplied:
 *
 *   DRAFT_LOOP_EMBEDDING_MODEL_DIR   directory with the verified model files
 *   DRAFT_LOOP_EMBEDDING_TIER        "97m" (default) or "311m"
 *   DRAFT_LOOP_EMBEDDING_DIMENSIONS  optional Matryoshka truncation
 *   DRAFT_LOOP_RETRIEVAL_REPORT_PATH optional path for the content-free JSON report
 */
const modelDirectory = process.env.DRAFT_LOOP_EMBEDDING_MODEL_DIR;
const tier: GraniteEmbeddingTier =
  process.env.DRAFT_LOOP_EMBEDDING_TIER === "311m" ? "311m" : "97m";
const dimensionsEnv = process.env.DRAFT_LOOP_EMBEDDING_DIMENSIONS;
const dimensions = dimensionsEnv === undefined ? undefined : Number(dimensionsEnv);
const reportPath = process.env.DRAFT_LOOP_RETRIEVAL_REPORT_PATH;
const timestamp = "2026-09-19T18:00:00.000Z";
const checksum = "a".repeat(64);
const limit = 3;

interface RetrievalFixture {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly corpus: readonly {
    readonly id: string;
    readonly text: string;
    readonly ordinal: number;
  }[];
  readonly cases: readonly Omit<RetrievalBenchmarkCase, "corpus">[];
}

function loadFixture(name: string): RetrievalFixture {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/retrieval-quality/${name}`, import.meta.url), "utf8"),
  ) as RetrievalFixture;
}

function metricsWithinUnitRange(report: RetrievalBenchmarkReport): void {
  for (const metrics of [report.baselineMetrics, report.candidateMetrics]) {
    for (const value of [
      metrics.citationAccuracy,
      metrics.requirementCoverage,
      metrics.irrelevantContextRatio,
      metrics.meanReciprocalRank,
      metrics.recall,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  }
}

/** Deterministic part of a report: timings and memory are expected to vary between runs. */
function stable(report: RetrievalModeComparisonReport) {
  return {
    embeddingIdentity: report.embeddingIdentity,
    limit: report.limit,
    caseCount: report.caseCount,
    semantic: report.semantic,
    semanticHybrid: report.semanticHybrid,
  };
}

async function compareFixture(
  fixture: RetrievalFixture,
  embedder: TextEmbedder,
): Promise<RetrievalModeComparisonReport> {
  const storage = openSqliteStorage(":memory:");
  try {
    await storage.saveWorkspace({
      id: fixture.workspaceId,
      state: "collecting",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await storage.saveEvidenceSource({
      id: fixture.sourceId,
      workspaceId: fixture.workspaceId,
      path: "fixture://sanitized/retrieval-source",
      mediaType: "text/markdown",
      checksum,
      createdAt: timestamp,
    });
    const records = fixture.corpus.map((entry) => ({
      ...entry,
      workspaceId: fixture.workspaceId,
      sourceId: fixture.sourceId,
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
    const cases: readonly RetrievalBenchmarkCase[] = fixture.cases.map((benchmarkCase) => ({
      ...benchmarkCase,
      corpus,
    }));
    const lexical = {
      queryEvidence: (query: string, options?: { readonly limit?: number }) =>
        storage.queryEvidence(query, {
          workspaceId: fixture.workspaceId,
          limit: options?.limit ?? limit,
        }),
    };

    return await runRetrievalModeComparison({ cases, lexical, embedder, limit });
  } finally {
    await storage.close();
  }
}

describe.skipIf(modelDirectory === undefined || modelDirectory === "")(
  "real-model retrieval mode comparison",
  () => {
    it("compares lexical, semantic, and semantic-hybrid retrieval deterministically", async () => {
      const embedder = await createOnnxTextEmbedder({
        modelDirectory: modelDirectory as string,
        tier,
        ...(dimensions === undefined ? {} : { dimensions }),
      });
      try {
        const semanticFixture = loadFixture("semantic-cases.json");
        const lexicalGuardFixture = loadFixture("cases.json");

        const semanticReport = await compareFixture(semanticFixture, embedder);
        const semanticRepeat = await compareFixture(semanticFixture, embedder);
        const guardReport = await compareFixture(lexicalGuardFixture, embedder);

        expect(stable(semanticRepeat)).toEqual(stable(semanticReport));
        for (const report of [semanticReport, guardReport]) {
          metricsWithinUnitRange(report.semantic);
          metricsWithinUnitRange(report.semanticHybrid);
        }
        expect(semanticReport.semantic.candidateMetrics.recall).toBeGreaterThanOrEqual(
          semanticReport.semantic.baselineMetrics.recall,
        );

        if (reportPath !== undefined) {
          mkdirSync(dirname(reportPath), { recursive: true });
          writeFileSync(
            reportPath,
            `${JSON.stringify(
              {
                tier,
                dimensions: dimensions ?? embedder.identity.dimensions,
                semanticFixture: semanticReport,
                lexicalGuardFixture: guardReport,
              },
              null,
              2,
            )}\n`,
          );
        }
      } finally {
        await embedder.dispose();
      }
    }, 300_000);
  },
);
