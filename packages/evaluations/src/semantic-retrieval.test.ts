import { readFileSync } from "node:fs";

import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { EmbeddingModelIdentity, EmbeddingRole, TextEmbedder } from "@draft-loop/embeddings";
import { describe, expect, it } from "vitest";

import type { RetrievalBenchmarkCase } from "./index.js";
import { createSemanticRetriever } from "./semantic-retrieval.js";
import { runRetrievalModeComparison } from "./semantic-retrieval-comparison.js";

const identity: EmbeddingModelIdentity = {
  modelId: "fake-embedder",
  sourceRepository: "fixture://fake",
  revision: "0",
  modelFileSha256: "b".repeat(64),
  dimensions: 3,
  pooling: "cls",
  runtime: "fake",
};

interface FakeEmbedder extends TextEmbedder {
  readonly calls: { readonly role: EmbeddingRole; readonly texts: readonly string[] }[];
}

function fakeEmbedder(table: Readonly<Record<string, readonly number[]>>): FakeEmbedder {
  const calls: FakeEmbedder["calls"] = [];
  return {
    identity,
    calls,
    async embed(texts, role) {
      calls.push({ role, texts: [...texts] });
      return texts.map((text) => {
        const vector = table[text];
        if (vector === undefined) {
          throw new Error(`No fake vector for text: ${text}`);
        }
        return Float32Array.from(vector);
      });
    },
    async dispose() {},
  };
}

function chunk(id: string, text: string, workspaceId = "w1"): ScoredEvidenceChunk {
  return {
    id,
    workspaceId,
    sourceId: "s1",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    text,
    checksum: "a".repeat(64),
    rank: 0,
  };
}

const x = [1, 0, 0];
const y = [0, 1, 0];
const z = [0, 0, 1];
const xy = [Math.SQRT1_2, Math.SQRT1_2, 0];

describe("createSemanticRetriever", () => {
  it("orders by similarity with a negated-score rank and uses the document and query roles", async () => {
    const embedder = fakeEmbedder({
      "text a": y,
      "text b": xy,
      "text c": x,
      "the query": x,
    });
    const retriever = await createSemanticRetriever(embedder, [
      chunk("a", "text a"),
      chunk("b", "text b"),
      chunk("c", "text c"),
    ]);

    const results = await retriever.queryEvidence("the query");

    expect(results.map((result) => result.id)).toEqual(["c", "b", "a"]);
    expect(results[0]?.rank).toBeCloseTo(-1);
    expect(results[1]?.rank).toBeCloseTo(-Math.SQRT1_2);
    expect(results[2]?.rank).toBeCloseTo(0);
    expect(embedder.calls).toEqual([
      { role: "document", texts: ["text a", "text b", "text c"] },
      { role: "query", texts: ["the query"] },
    ]);
    expect(retriever.documentEmbeddingMs).toBeGreaterThanOrEqual(0);
  });

  it("breaks ties by chunk id so ordering is deterministic", async () => {
    const embedder = fakeEmbedder({ "text b": x, "text a": x, "text d": x, "text c": y, q: x });
    const retriever = await createSemanticRetriever(embedder, [
      chunk("b", "text b"),
      chunk("d", "text d"),
      chunk("c", "text c"),
      chunk("a", "text a"),
    ]);

    const first = await retriever.queryEvidence("q");
    const second = await retriever.queryEvidence("q");

    expect(first.map((result) => result.id)).toEqual(["a", "b", "d", "c"]);
    expect(second).toEqual(first);
  });

  it("filters by workspace and applies the limit", async () => {
    const embedder = fakeEmbedder({
      "text a": x,
      "text b": xy,
      "text other": x,
      q: x,
    });
    const retriever = await createSemanticRetriever(embedder, [
      chunk("a", "text a"),
      chunk("b", "text b"),
      chunk("other", "text other", "w2"),
    ]);

    const scoped = await retriever.queryEvidence("q", { workspaceId: "w1" });
    const limited = await retriever.queryEvidence("q", { limit: 1 });

    expect(scoped.map((result) => result.id)).toEqual(["a", "b"]);
    expect(limited.map((result) => result.id)).toEqual(["a"]);
    await expect(retriever.queryEvidence("q", { workspaceId: "missing" })).resolves.toEqual([]);
  });
});

describe("createSemanticRetriever relevance floor", () => {
  const table = { "text a": y, "text b": xy, "text c": x, q: x };
  const chunks = [chunk("a", "text a"), chunk("b", "text b"), chunk("c", "text c")];

  it("returns fewer than the limit when lower hits fall under the floor", async () => {
    const retriever = await createSemanticRetriever(fakeEmbedder(table), chunks, {
      relevanceFloor: { maxMarginFromTop: 0.1, minimumScore: 0 },
    });

    const results = await retriever.queryEvidence("q", { limit: 3 });

    expect(results.map((result) => result.id)).toEqual(["c"]);
  });

  it("applies the absolute minimum and can return nothing", async () => {
    const retriever = await createSemanticRetriever(fakeEmbedder(table), chunks, {
      relevanceFloor: { maxMarginFromTop: 1, minimumScore: 0.5 },
    });
    expect((await retriever.queryEvidence("q", { limit: 3 })).map((result) => result.id)).toEqual([
      "c",
      "b",
    ]);

    const strict = await createSemanticRetriever(fakeEmbedder(table), chunks, {
      relevanceFloor: { maxMarginFromTop: 1, minimumScore: 1.5 },
    });
    await expect(strict.queryEvidence("q", { limit: 3 })).resolves.toEqual([]);
  });

  it("still applies the limit after the floor", async () => {
    const retriever = await createSemanticRetriever(fakeEmbedder(table), chunks, {
      relevanceFloor: { maxMarginFromTop: 1, minimumScore: 0.5 },
    });
    const results = await retriever.queryEvidence("q", { limit: 1 });
    expect(results.map((result) => result.id)).toEqual(["c"]);
  });

  it("measures the margin from the best hit inside the requested workspace", async () => {
    const scoped = [chunk("top", "text c", "w2"), chunk("a", "text a"), chunk("b", "text b")];
    const retriever = await createSemanticRetriever(fakeEmbedder(table), scoped, {
      relevanceFloor: { maxMarginFromTop: 0.1, minimumScore: 0 },
    });
    const results = await retriever.queryEvidence("q", { workspaceId: "w1", limit: 3 });
    expect(results.map((result) => result.id)).toEqual(["b"]);
  });
});

describe("runRetrievalModeComparison", () => {
  it("records the floor, shrinks semantic results and keeps lexical hits in hybrid mode", async () => {
    const alpha = chunk("alpha", "Secret alpha corpus sentence.");
    const beta = chunk("beta", "Secret beta corpus sentence.");
    const gamma = chunk("gamma", "Secret gamma corpus sentence.");
    const corpus = [alpha, beta, gamma];
    const cases: readonly RetrievalBenchmarkCase[] = [
      {
        id: "case-1",
        query: "Secret query one",
        corpus,
        groundTruthEvidenceIds: ["alpha", "gamma"],
      },
    ];
    const table = {
      "Secret alpha corpus sentence.": x,
      "Secret beta corpus sentence.": xy,
      "Secret gamma corpus sentence.": z,
      "Secret query one": x,
    };
    const lexical = {
      queryEvidence: async () => [gamma],
    };
    const relevanceFloor = { maxMarginFromTop: 0.1, minimumScore: 0 };

    const floored = await runRetrievalModeComparison({
      cases,
      lexical,
      embedder: fakeEmbedder(table),
      limit: 3,
      relevanceFloor,
    });
    const unfloored = await runRetrievalModeComparison({
      cases,
      lexical,
      embedder: fakeEmbedder(table),
      limit: 3,
    });

    expect(floored.relevanceFloor).toEqual(relevanceFloor);
    expect(unfloored.relevanceFloor).toBeNull();
    // Unfloored semantic returns all three chunks; the floor keeps only alpha.
    expect(unfloored.semantic.candidateMetrics.irrelevantContextRatio).toBeCloseTo(1 / 3);
    expect(floored.semantic.candidateMetrics.irrelevantContextRatio).toBe(0);
    expect(floored.semantic.candidateMetrics.recall).toBeCloseTo(0.5);
    // Hybrid keeps the lexical hit (gamma) and the semantic hit above the floor (alpha) only.
    expect(floored.semanticHybrid.candidateMetrics.recall).toBe(1);
    expect(floored.semanticHybrid.candidateMetrics.irrelevantContextRatio).toBe(0);
    expect(unfloored.semanticHybrid.candidateMetrics.irrelevantContextRatio).toBeCloseTo(1 / 3);
  });

  it("reports lexical versus semantic and semantic-hybrid metrics without chunk or query text", async () => {
    const alpha = chunk("alpha", "Secret alpha corpus sentence.");
    const beta = chunk("beta", "Secret beta corpus sentence.");
    const gamma = chunk("gamma", "Secret gamma corpus sentence.");
    const corpus = [alpha, beta, gamma];
    const cases: readonly RetrievalBenchmarkCase[] = [
      {
        id: "case-1",
        query: "Secret query one",
        corpus,
        groundTruthEvidenceIds: ["alpha"],
        requirements: [{ id: "r1", text: "alpha" }],
        draftClaims: [{ id: "c1", text: "claim", evidenceIds: ["alpha"] }],
      },
      {
        id: "case-2",
        query: "Secret query two",
        corpus,
        groundTruthEvidenceIds: ["beta", "gamma"],
      },
    ];
    const embedder = fakeEmbedder({
      "Secret alpha corpus sentence.": x,
      "Secret beta corpus sentence.": y,
      "Secret gamma corpus sentence.": z,
      "Secret query one": x,
      "Secret query two": y,
    });
    const lexical = {
      queryEvidence: async (query: string, options?: { readonly limit?: number }) =>
        (query === "Secret query one" ? [gamma] : [beta, gamma]).slice(0, options?.limit ?? 20),
    };

    const report = await runRetrievalModeComparison({ cases, lexical, embedder, limit: 1 });

    expect(report.embeddingIdentity).toEqual(identity);
    expect(report.limit).toBe(1);
    expect(report.caseCount).toBe(2);
    expect(report.semantic.baselineMode).toBe("lexical");
    expect(report.semantic.candidateMode).toBe("semantic");
    expect(report.semanticHybrid.baselineMode).toBe("lexical");
    expect(report.semanticHybrid.candidateMode).toBe("semantic-hybrid");
    // Lexical misses alpha (limit 1 returns gamma); semantic returns it first.
    expect(report.semantic.baselineMetrics.recall).toBeCloseTo(0.25);
    expect(report.semantic.candidateMetrics.recall).toBeCloseTo(0.75);
    expect(report.semantic.deltas.recallDelta).toBeGreaterThan(0);
    expect(report.semantic.passed).toBe(true);
    expect(report.documentEmbeddingMs).toBeGreaterThanOrEqual(0);
    expect(report.meanQueryMs).toBeGreaterThanOrEqual(0);
    expect(report.peakRssBytes).toBeGreaterThan(0);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("Secret");
    expect(serialized).not.toContain("corpus sentence");
    // The union corpus is embedded exactly once with the document role.
    expect(embedder.calls.filter((call) => call.role === "document")).toHaveLength(1);
    expect(embedder.calls.filter((call) => call.role === "query").length).toBeGreaterThan(0);
  });
});

describe("semantic retrieval fixture", () => {
  const text = readFileSync(
    new URL("../fixtures/retrieval-quality/semantic-cases.json", import.meta.url),
    "utf8",
  );
  const fixture = JSON.parse(text) as {
    readonly corpus: readonly { readonly id: string; readonly text: string }[];
    readonly cases: readonly {
      readonly id: string;
      readonly groundTruthEvidenceIds: readonly string[];
      readonly requirements: readonly { readonly id: string }[];
      readonly draftClaims: readonly {
        readonly id: string;
        readonly evidenceIds: readonly string[];
      }[];
    }[];
  };

  it("contains only invented local fixture content", () => {
    for (const forbidden of ["anthropic", "openai", "/private/", "@draft-loop"]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("has unique ids and resolvable evidence references", () => {
    const corpusIds = fixture.corpus.map((entry) => entry.id);
    expect(new Set(corpusIds).size).toBe(corpusIds.length);
    const caseIds = fixture.cases.map((entry) => entry.id);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect(fixture.corpus.length).toBeGreaterThanOrEqual(24);
    expect(fixture.cases.length).toBe(16);

    const known = new Set(corpusIds);
    for (const benchmarkCase of fixture.cases) {
      expect(benchmarkCase.groundTruthEvidenceIds.length).toBeGreaterThanOrEqual(1);
      expect(benchmarkCase.groundTruthEvidenceIds.length).toBeLessThanOrEqual(3);
      for (const id of benchmarkCase.groundTruthEvidenceIds) {
        expect(known.has(id), `${benchmarkCase.id} -> ${id}`).toBe(true);
      }
      expect(benchmarkCase.requirements.length).toBeGreaterThanOrEqual(1);
      for (const claim of benchmarkCase.draftClaims) {
        for (const id of claim.evidenceIds) {
          expect(known.has(id), `${claim.id} -> ${id}`).toBe(true);
        }
      }
    }
  });
});
