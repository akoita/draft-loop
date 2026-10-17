import { randomUUID } from "node:crypto";
import {
  computeCandidateKnowledgeLexicalManifestChecksum,
  openSqliteStorage,
} from "@draft-loop/storage";
import type { CandidateKnowledgeRetrievalStorage } from "@draft-loop/storage/conformance";
import { describe, expect, it } from "vitest";
import { openPostgresStorage } from "./postgres-storage.js";
import { createSqlClient } from "./sql-client.js";

/**
 * Ranking parity with the local store (ADR 0011, D11): the same knowledge, indexed in SQLite
 * FTS5 and in Postgres, must return the same chunks in the same order with the same BM25 values.
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

async function seed(storage: CandidateKnowledgeRetrievalStorage) {
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

async function rankings(storage: CandidateKnowledgeRetrievalStorage) {
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

describe.runIf(connectionString !== undefined)("Postgres lexical ranking parity", () => {
  it("returns SQLite FTS5's chunks, order and BM25 values for every query", async () => {
    const sqlite = openSqliteStorage(":memory:");
    const expected = await rankings(sqlite);
    expect(expected.filter(([, , hits]) => hits.length > 1)).not.toHaveLength(0);
    await sqlite.close();

    const schema = `parity_${randomUUID().replaceAll("-", "")}`;
    const admin = createSqlClient({ connectionString: connectionString ?? "", maxConnections: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const postgres = await openPostgresStorage({
      connectionString: connectionString ?? "",
      schema,
    });
    try {
      const actual = await rankings(postgres);
      expect(
        actual.map(([base, query, hits]) => [base, query, hits.map((hit) => hit.chunkId)]),
      ).toEqual(
        expected.map(([base, query, hits]) => [base, query, hits.map((hit) => hit.chunkId)]),
      );
      for (const [index, [, , hits]] of actual.entries()) {
        for (const [position, hit] of hits.entries()) {
          expect(hit.bm25Rank).toBeCloseTo(
            expected[index]?.[2][position]?.bm25Rank ?? Number.NaN,
            12,
          );
        }
      }
    } finally {
      await postgres.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    }
  });
});
