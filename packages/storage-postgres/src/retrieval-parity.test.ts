import { randomUUID } from "node:crypto";
import {
  computeCandidateKnowledgeLexicalManifestChecksum,
  openSqliteStorage,
} from "@draft-loop/storage";
import type { CandidateKnowledgeVectorsStorage } from "@draft-loop/storage/conformance";
import { describe, expect, it } from "vitest";
import { openPostgresStorage } from "./postgres-storage.js";
import { createSqlClient } from "./sql-client.js";

/**
 * Retrieval parity with the local store (ADR 0011, D11): the same knowledge, indexed in SQLite
 * and in Postgres, must return the same chunks in the same order with the same scores, for
 * lexical (BM25) and vector queries alike.
 */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-17T10:00:00.000Z";
const corpus = {
  "ckb-a": [
    "Built TypeScript services for the platform team",
    "Led platform operations and on-call for TypeScript services",
    "Designed Python automation; Python tooling for data_pipelines",
    "Café naïve résumé: front-end work in São Paulo",
    "platform platform platform",
    "A short line about Kubernetes",
  ],
  "ckb-b": [
    "Private Python automation for the finance platform",
    "Front end accessibility audits",
    "TypeScript TypeScript TypeScript",
  ],
} as const;
const queries = [
  "platform",
  "TypeScript services",
  "python automation",
  "front-end",
  "cafe resume",
  "platform operations typescript kubernetes",
  "data_pipelines",
];

async function seed(storage: CandidateKnowledgeVectorsStorage) {
  await storage.saveWorkspace({
    id: "workspace-1",
    state: "collecting",
    createdAt: at,
    updatedAt: at,
  });
  const scopes: Record<
    string,
    { sources: { storeId: string; knowledgeBaseId: string; sourceId: string; versionId: string }[] }
  > = {};
  for (const [knowledgeBaseId, texts] of Object.entries(corpus)) {
    const base = { id: knowledgeBaseId, displayName: knowledgeBaseId, createdAt: at };
    if (knowledgeBaseId === "ckb-a") await storage.ensureDefaultCandidateKnowledgeBase(base);
    else await storage.createCandidateKnowledgeBase({ ...base, isDefault: false });
    const sourceId = `${knowledgeBaseId}-source`;
    await storage.createCandidateKnowledgeSource(
      { id: sourceId, knowledgeBaseId, kind: "file", displayName: "notes.md", createdAt: at },
      {
        id: `${sourceId}-v1`,
        mediaType: "text/markdown",
        checksum: "a".repeat(64),
        sizeBytes: 1,
        createdAt: at,
      },
    );
    const provenance = {
      storeId: "store-1",
      knowledgeBaseId,
      sourceId,
      versionId: `${sourceId}-v1`,
    };
    const scope = { sources: [provenance] };
    scopes[knowledgeBaseId] = scope;
    await storage.rebuildCandidateKnowledgeLexicalIndex({
      scope,
      index: {
        indexerId: "fts5-v1",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scope),
      },
      createdAt: at,
      chunks: texts.map((text, ordinal) => ({
        chunkId: `${knowledgeBaseId}-chunk-${ordinal}`,
        ordinal,
        lineStart: ordinal + 1,
        lineEnd: ordinal + 1,
        text,
        metadata: { section: "Experience", provenance },
      })),
    });
  }
  return scopes;
}

async function rankings(storage: CandidateKnowledgeVectorsStorage) {
  const scopes = await seed(storage);
  const results: [string, string, readonly { chunkId: string; bm25Rank: number }[]][] = [];
  for (const knowledgeBaseId of Object.keys(corpus)) {
    for (const query of queries) {
      const result = await storage.queryCandidateKnowledge({
        purpose: "achievement-recall",
        query,
        scope: scopes[knowledgeBaseId] ?? { sources: [] },
        limit: 10,
      });
      results.push([
        knowledgeBaseId,
        query,
        result.hits.map((hit) => ({ chunkId: hit.chunkId, bm25Rank: hit.bm25Rank })),
      ]);
    }
  }
  return results;
}

const identity = {
  modelId: "parity-embedding",
  revision: "rev-1",
  modelFileSha256: "c".repeat(64),
  dimensions: 384,
  pooling: "mean",
  runtime: "test",
};

/** Deterministic unit vectors, so both stores see identical float32 components. */
function unitVector(seed: number): Float32Array {
  let state = seed;
  const components = Array.from({ length: identity.dimensions }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648 - 0.5;
  });
  const norm = Math.hypot(...components);
  return new Float32Array(components.map((component) => component / norm));
}

async function vectorHits(storage: CandidateKnowledgeVectorsStorage) {
  const scopes = await seed(storage);
  const results: (readonly { chunkId: string; score: number }[])[] = [];
  for (const [knowledgeBaseId, texts] of Object.entries(corpus)) {
    await storage.candidateKnowledgeVectorIndex.upsertCandidateKnowledgeVectors({
      storeId: "store-1",
      knowledgeBaseId,
      identity,
      vectors: texts.map((_, ordinal) => ({
        chunkId: `${knowledgeBaseId}-chunk-${ordinal}`,
        vector: unitVector(knowledgeBaseId.length * 100 + ordinal + 1),
      })),
      createdAt: at,
    });
    for (let query = 0; query < 5; query += 1) {
      const hits = await storage.candidateKnowledgeVectorIndex.queryCandidateKnowledgeVectors({
        scope: scopes[knowledgeBaseId] ?? { sources: [] },
        identity,
        queryVector: unitVector(9_000 + query),
        limit: 4,
      });
      results.push(hits.map((hit) => ({ chunkId: hit.chunk.chunkId, score: hit.score })));
    }
  }
  return results;
}

async function withPostgres<Result>(
  work: (storage: CandidateKnowledgeVectorsStorage) => Promise<Result>,
): Promise<Result> {
  const schema = `parity_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: connectionString ?? "", maxConnections: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const postgres = await openPostgresStorage({
    connectionString: connectionString ?? "",
    schema,
  });
  try {
    return await work(postgres);
  } finally {
    await postgres.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
}

async function withSqlite<Result>(
  work: (storage: CandidateKnowledgeVectorsStorage) => Promise<Result>,
): Promise<Result> {
  const sqlite = openSqliteStorage(":memory:");
  try {
    return await work(sqlite);
  } finally {
    await sqlite.close();
  }
}

describe.runIf(connectionString !== undefined)("Postgres retrieval parity", () => {
  it("returns SQLite FTS5's chunks, order and BM25 values for every query", async () => {
    const expected = await withSqlite(rankings);
    expect(expected.filter(([, , hits]) => hits.length > 1)).not.toHaveLength(0);
    const actual = await withPostgres(rankings);
    expect(
      actual.map(([base, query, hits]) => [base, query, hits.map((hit) => hit.chunkId)]),
    ).toEqual(expected.map(([base, query, hits]) => [base, query, hits.map((hit) => hit.chunkId)]));
    for (const [index, [, , hits]] of actual.entries()) {
      for (const [position, hit] of hits.entries()) {
        expect(hit.bm25Rank).toBeCloseTo(
          expected[index]?.[2][position]?.bm25Rank ?? Number.NaN,
          12,
        );
      }
    }
  });

  it("returns the local index's nearest chunks and scores for every vector query", async () => {
    const expected = await withSqlite(vectorHits);
    expect(expected.every((hits) => hits.length > 1)).toBe(true);
    await expect(withPostgres(vectorHits)).resolves.toEqual(expected);
  });
});
