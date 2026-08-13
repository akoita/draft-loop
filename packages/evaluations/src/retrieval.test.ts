import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  assertNoRetrievalRegression,
  benchmarkRetrieval,
  cosineSimilarity,
  createHybridRetriever,
  evaluateRetrievalMetrics,
  fuseReciprocalRanks,
  LocalVectorEmbedding,
  LocalVectorRetriever,
  type RetrievalBenchmarkCase,
  RetrievalRegressionError,
} from "./index.js";

function chunk(id: string, text: string, ordinal = 0, rank = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal,
    lineStart: 1,
    lineEnd: 10,
    checksum: "a".repeat(64),
    text,
    rank,
  };
}

describe("Local Vector Embeddings & RRF Hybrid Retrieval", () => {
  it("computes cosine similarity accurately", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1.0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("builds deterministic local embeddings and retrieves nearest semantic chunks", async () => {
    const embedder = new LocalVectorEmbedding(["hello world", "test corpus"]);
    expect(embedder.embed("hello")).toHaveLength(4);

    const c1 = chunk("c1", "TypeScript backend distributed systems and Node.js microservices");
    const c2 = chunk("c2", "React CSS design system and accessibility");
    const c3 = chunk("c3", "PostgreSQL database indexing and query tuning");

    const retriever = new LocalVectorRetriever([c1, c2, c3]);
    const results = await retriever.queryEvidence("TypeScript Node.js distributed");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe("c1");
  });

  it("fuses reciprocal ranks (RRF) from multiple retrievers", () => {
    const c1 = chunk("c1", "System architecture");
    const c2 = chunk("c2", "Database storage");
    const c3 = chunk("c3", "UI design");

    const listA = [c1, c2]; // c1 is rank 0, c2 is rank 1
    const listB = [c2, c3]; // c2 is rank 0, c3 is rank 1

    const fused = fuseReciprocalRanks([listA, listB], 60);

    // c2 appears in both lists: 1/62 + 1/61 = ~0.0325
    // c1 appears only in listA: 1/61 = ~0.0163
    // c3 appears only in listB: 1/62 = ~0.0161
    expect(fused[0]?.id).toBe("c2");
    expect(fused[1]?.id).toBe("c1");
    expect(fused[2]?.id).toBe("c3");
  });

  it("creates a hybrid retriever combining lexical and vector results", async () => {
    const c1 = chunk("c1", "Distributed databases with Raft consensus");
    const c2 = chunk("c2", "Frontend state management with Redux");

    const lexicalRetriever = {
      queryEvidence: async () => [c1],
    };
    const vectorRetriever = {
      queryEvidence: async () => [c1, c2],
    };

    const hybrid = createHybridRetriever(lexicalRetriever, vectorRetriever);
    const results = await hybrid.queryEvidence("Distributed databases");

    expect(results.length).toBe(2);
    expect(results[0]?.id).toBe("c1");
  });
});

describe("Retrieval Evaluation Benchmark & Quality Gate", () => {
  const c1 = chunk("c-ts", "Senior TypeScript developer building high-throughput microservices.");
  const c2 = chunk("c-k8s", "Kubernetes cluster administration and Helm deployment pipelines.");
  const c3 = chunk("c-irrelevant", "Unrelated hobby projects in vintage audio repair.");

  const benchmarkCase: RetrievalBenchmarkCase = {
    id: "case-cloud-systems",
    query: "TypeScript Kubernetes systems engineer",
    corpus: [c1, c2, c3],
    groundTruthEvidenceIds: ["c-ts", "c-k8s"],
    requirements: [
      { id: "req-ts", text: "TypeScript microservices" },
      { id: "req-k8s", text: "Kubernetes administration" },
    ],
    draftClaims: [
      { id: "claim-1", text: "Led TypeScript microservices.", evidenceIds: ["c-ts"] },
      { id: "claim-2", text: "Maintained Kubernetes clusters.", evidenceIds: ["c-k8s"] },
    ],
  };

  it("evaluates precision, coverage, and unsupported claims accurately", () => {
    // When all ground truth chunks are retrieved:
    const perfectMetrics = evaluateRetrievalMetrics([c1, c2], benchmarkCase);
    expect(perfectMetrics.citationAccuracy).toBe(1.0);
    expect(perfectMetrics.requirementCoverage).toBe(1.0);
    expect(perfectMetrics.irrelevantContextRatio).toBe(0.0);
    expect(perfectMetrics.unsupportedClaimCount).toBe(0);
    expect(perfectMetrics.meanReciprocalRank).toBe(1.0);

    // When only irrelevant chunk is retrieved:
    const poorMetrics = evaluateRetrievalMetrics([c3], benchmarkCase);
    expect(poorMetrics.citationAccuracy).toBe(0.0);
    expect(poorMetrics.irrelevantContextRatio).toBe(1.0);
    expect(poorMetrics.unsupportedClaimCount).toBe(2);
  });

  it("benchmarks retrieval modes and passes quality gate when hybrid meets baseline", async () => {
    const lexical = {
      mode: "lexical" as const,
      queryEvidence: async () => [c1, c3],
    };
    const hybrid = {
      mode: "hybrid" as const,
      queryEvidence: async () => [c1, c2],
    };

    const report = await benchmarkRetrieval([benchmarkCase], lexical, hybrid);

    expect(report.passed).toBe(true);
    expect(report.deltas.citationAccuracyDelta).toBeGreaterThan(0);
    expect(report.deltas.unsupportedClaimDelta).toBeLessThanOrEqual(0);
    expect(() => assertNoRetrievalRegression(report)).not.toThrow();
  });

  it("fails quality gate deterministically when candidate retrieval mode regresses", async () => {
    const baseline = {
      mode: "lexical" as const,
      queryEvidence: async () => [c1, c2],
    };
    const regressed = {
      mode: "vector" as const,
      queryEvidence: async () => [c3],
    };

    const report = await benchmarkRetrieval([benchmarkCase], baseline, regressed, {
      maxCitationAccuracyDrop: 0.1,
    });

    expect(report.passed).toBe(false);
    expect(report.regressionReasons.length).toBeGreaterThan(0);
    expect(() => assertNoRetrievalRegression(report)).toThrow(RetrievalRegressionError);
  });
});
