import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  CandidateKnowledgeBaseInput,
  CandidateKnowledgeSourceInput,
  CandidateKnowledgeSourceVersionInput,
  EvidenceChunkRecord,
  EvidenceSourceRecord,
  WorkspaceRecord,
} from "./index.js";
import {
  computeCandidateKnowledgeLexicalManifestChecksum,
  openSqliteStorage,
  StorageConflictError,
  StorageValidationError,
} from "./index.js";

function workspace(id = "workspace-1"): WorkspaceRecord {
  return {
    id,
    state: "collecting",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
  };
}

function source(id: string, workspaceId = "workspace-1"): EvidenceSourceRecord {
  return {
    id,
    workspaceId,
    path: `sources/${id}.md`,
    mediaType: "text/markdown",
    checksum: "0123456789abcdef0123456789abcdef01234567",
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function chunk(
  id: string,
  text: string,
  ordinal: number,
  workspaceId = "workspace-1",
  sourceId = "source-1",
): EvidenceChunkRecord {
  return {
    id,
    workspaceId,
    sourceId,
    ordinal,
    lineStart: ordinal * 10 + 1,
    lineEnd: (ordinal + 1) * 10,
    checksum: "0123456789abcdef0123456789abcdef01234567",
    text,
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function candidateKnowledgeBase(id: string, isDefault: boolean): CandidateKnowledgeBaseInput {
  return {
    id,
    displayName: `Knowledge ${id}`,
    description: "Sanitized test knowledge",
    isDefault,
    createdAt: "2026-08-13T09:00:00.000Z",
  };
}

function candidateKnowledgeSource(
  id: string,
  knowledgeBaseId: string,
): CandidateKnowledgeSourceInput {
  return {
    id,
    knowledgeBaseId,
    kind: "file",
    displayName: `${id}.md`,
    createdAt: "2026-08-13T09:01:00.000Z",
  };
}

function candidateKnowledgeVersion(
  id: string,
  checksum = "d".repeat(64),
): CandidateKnowledgeSourceVersionInput {
  return {
    id,
    mediaType: "text/markdown",
    checksum,
    sizeBytes: 128,
    createdAt: "2026-08-13T09:02:00.000Z",
  };
}

function lexicalScope(
  storeId: string,
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
) {
  return {
    sources: [{ storeId, knowledgeBaseId, sourceId, versionId }],
  };
}

function lexicalChunk(
  chunkId: string,
  sourceId: string,
  versionId: string,
  text: string,
  ordinal = 0,
  storeId = "store-a",
  knowledgeBaseId = "ckb-a",
) {
  return {
    chunkId,
    ordinal,
    lineStart: ordinal + 1,
    lineEnd: ordinal + 1,
    text,
    metadata: {
      section: "Experience",
      technology: "TypeScript",
      provenance: { storeId, knowledgeBaseId, sourceId, versionId },
    },
  };
}

describe("SQLite FTS5 / BM25 Evidence Retrieval", () => {
  it("indexes and retrieves evidence chunks using BM25 ranking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));

    await storage.saveEvidenceChunk(
      chunk(
        "c-1",
        "Designed scalable distributed systems with Node.js and TypeScript.",
        0,
        "ws-1",
        "src-1",
      ),
    );
    await storage.saveEvidenceChunk(
      chunk("c-2", "Built React UI components and modern CSS design systems.", 1, "ws-1", "src-1"),
    );
    await storage.saveEvidenceChunk(
      chunk(
        "c-3",
        "Managed SQLite local database storage and offline synchronization.",
        2,
        "ws-1",
        "src-1",
      ),
    );

    // Single term search
    const tsResults = await storage.queryEvidence("TypeScript", { workspaceId: "ws-1" });
    expect(tsResults).toHaveLength(1);
    expect(tsResults[0]?.id).toBe("c-1");
    expect(tsResults[0]?.rank).toBeDefined();

    // Multi-term search
    const sqlResults = await storage.queryEvidence("SQLite database", { workspaceId: "ws-1" });
    expect(sqlResults).toHaveLength(1);
    expect(sqlResults[0]?.id).toBe("c-3");

    await storage.close();
  });

  it("retrieves relevant evidence from a long multi-sentence job description", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-long-query-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));
    await storage.saveEvidenceChunk(
      chunk(
        "c-relevant",
        "Built event-driven data pipelines with Python, Airflow, dbt, and ClickHouse.",
        0,
        "ws-1",
        "src-1",
      ),
    );
    await storage.saveEvidenceChunk(
      chunk("c-unrelated", "Designed accessible React component libraries.", 1, "ws-1", "src-1"),
    );

    const description = `
      We are looking for a senior data engineer to join our remote product team.
      The successful candidate will design reliable event-driven pipelines and operate
      production analytics systems using Python, Airflow, dbt, and ClickHouse while
      collaborating with product and infrastructure stakeholders.
    `;
    const inspection = await storage.inspectEvidenceRetrieval(description, {
      workspaceId: "ws-1",
      limit: 5,
    });

    expect(inspection.status).toBe("matched");
    expect(inspection.hits.map((hit) => hit.id)).toContain("c-relevant");
    expect(inspection.selectedSourceCount).toBe(1);
    await storage.close();
  });

  it("bounds and de-duplicates stop-word-heavy queries without collapsing retrieval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-bounded-query-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));
    await storage.saveEvidenceChunk(
      chunk("c-1", "Operated reliable distributed data platforms.", 0, "ws-1", "src-1"),
    );

    const noise = Array.from({ length: 200 }, (_, index) => `keyword${index}`).join(" ");
    const inspection = await storage.inspectEvidenceRetrieval(
      `the and we are looking for reliable reliable distributed ${noise}`,
      { workspaceId: "ws-1" },
    );

    expect(inspection.status).toBe("matched");
    expect(inspection.hits[0]?.id).toBe("c-1");
    await storage.close();
  });

  it("distinguishes an empty index from a deterministic workspace-scoped fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-fallback-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-empty"));
    await expect(
      storage.inspectEvidenceRetrieval("quantum chemistry", { workspaceId: "ws-empty" }),
    ).resolves.toMatchObject({
      status: "not-indexed",
      indexedChunkCount: 0,
      selectedChunkCount: 0,
      selectedSourceCount: 0,
      hits: [],
    });

    await storage.saveWorkspace(workspace("ws-alpha"));
    await storage.saveEvidenceSource(source("src-alpha", "ws-alpha"));
    await storage.saveEvidenceChunk(
      chunk("alpha-2", "Private platform operations.", 1, "ws-alpha", "src-alpha"),
    );
    await storage.saveEvidenceChunk(
      chunk("alpha-1", "Private backend delivery.", 0, "ws-alpha", "src-alpha"),
    );
    await storage.saveWorkspace(workspace("ws-beta"));
    await storage.saveEvidenceSource(source("src-beta", "ws-beta"));
    await storage.saveEvidenceChunk(
      chunk("beta-1", "Other workspace material.", 0, "ws-beta", "src-beta"),
    );

    const first = await storage.inspectEvidenceRetrieval("quantum chemistry", {
      workspaceId: "ws-alpha",
      limit: 1,
    });
    const second = await storage.inspectEvidenceRetrieval("quantum chemistry", {
      workspaceId: "ws-alpha",
      limit: 1,
    });
    expect(first).toMatchObject({
      status: "fallback",
      indexedChunkCount: 2,
      selectedChunkCount: 1,
      selectedSourceCount: 1,
    });
    expect(first.hits.map((hit) => hit.id)).toEqual(["alpha-1"]);
    expect(second.hits).toEqual(first.hits);
    expect(first.hits.every((hit) => hit.workspaceId === "ws-alpha")).toBe(true);
    await storage.close();
  });

  it("strictly enforces workspace isolation in retrieval queries (T-008)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-iso-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-alpha"));
    await storage.saveEvidenceSource(source("src-alpha", "ws-alpha"));
    await storage.saveEvidenceChunk(
      chunk("c-alpha", "Confidential architecture for Project Alpha.", 0, "ws-alpha", "src-alpha"),
    );

    await storage.saveWorkspace(workspace("ws-beta"));
    await storage.saveEvidenceSource(source("src-beta", "ws-beta"));
    await storage.saveEvidenceChunk(
      chunk("c-beta", "Confidential architecture for Project Beta.", 0, "ws-beta", "src-beta"),
    );

    // Searching within ws-alpha only returns ws-alpha chunks
    const alphaHits = await storage.queryEvidence("Confidential architecture", {
      workspaceId: "ws-alpha",
    });
    expect(alphaHits).toHaveLength(1);
    expect(alphaHits[0]?.id).toBe("c-alpha");
    expect(alphaHits[0]?.workspaceId).toBe("ws-alpha");

    // Searching within ws-beta only returns ws-beta chunks
    const betaHits = await storage.queryEvidence("Confidential architecture", {
      workspaceId: "ws-beta",
    });
    expect(betaHits).toHaveLength(1);
    expect(betaHits[0]?.id).toBe("c-beta");
    expect(betaHits[0]?.workspaceId).toBe("ws-beta");

    await storage.close();
  });

  it("handles punctuation, special characters, and empty queries safely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-safe-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));
    await storage.saveEvidenceChunk(
      chunk("c-1", "Full-stack developer with C++ and C# experience.", 0, "ws-1", "src-1"),
    );

    // Punctuation and symbols should not crash FTS5
    await expect(storage.queryEvidence("!@#$%^&*()")).resolves.toEqual([]);
    await expect(storage.queryEvidence("")).resolves.toEqual([]);
    await expect(storage.queryEvidence("   ")).resolves.toEqual([]);
    await expect(storage.queryEvidence("' OR '1'='1")).resolves.toEqual([]);

    // Hyphenated search
    const results = await storage.queryEvidence("Full-stack", { workspaceId: "ws-1" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.id).toBe("c-1");

    await storage.close();
  });

  it("respects limit parameter in retrieval options", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-limit-"));
    const storage = openSqliteStorage(join(dir, "workspace.sqlite"));

    await storage.saveWorkspace(workspace("ws-1"));
    await storage.saveEvidenceSource(source("src-1", "ws-1"));

    for (let i = 0; i < 10; i++) {
      await storage.saveEvidenceChunk(
        chunk(
          `chunk-${i}`,
          `Engineering leadership and distributed systems contribution ${i}`,
          i,
          "ws-1",
          "src-1",
        ),
      );
    }

    const limited = await storage.queryEvidence("Engineering leadership", {
      workspaceId: "ws-1",
      limit: 3,
    });
    expect(limited).toHaveLength(3);

    await storage.close();
  });
});

describe("SQLite CKB lexical retrieval", () => {
  it("rebuilds, updates, isolates, and exactly deletes source-version projections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "draft-loop-ckb-lexical-"));
    const storage = openSqliteStorage(join(dir, "knowledge.sqlite"));

    await storage.ensureDefaultCandidateKnowledgeBase(candidateKnowledgeBase("ckb-a", true));
    const sourceA = await storage.createCandidateKnowledgeSource(
      candidateKnowledgeSource("source-a", "ckb-a"),
      candidateKnowledgeVersion("version-a"),
    );
    const sourceA2 = await storage.createCandidateKnowledgeSource(
      candidateKnowledgeSource("source-a2", "ckb-a"),
      candidateKnowledgeVersion("version-a2", "f".repeat(64)),
    );
    await storage.createCandidateKnowledgeBase(candidateKnowledgeBase("ckb-b", false));
    const sourceB = await storage.createCandidateKnowledgeSource(
      candidateKnowledgeSource("source-b", "ckb-b"),
      candidateKnowledgeVersion("version-b", "e".repeat(64)),
    );
    const scopeA = {
      sources: [
        {
          storeId: "store-a",
          knowledgeBaseId: "ckb-a",
          sourceId: sourceA.source.id,
          versionId: sourceA.version.id,
        },
        {
          storeId: "store-a",
          knowledgeBaseId: "ckb-a",
          sourceId: sourceA2.source.id,
          versionId: sourceA2.version.id,
        },
      ],
    };
    const scopeA2 = lexicalScope("store-a", "ckb-a", sourceA2.source.id, sourceA2.version.id);
    const scopeB = lexicalScope("store-b", "ckb-b", sourceB.source.id, sourceB.version.id);
    const indexA = {
      indexerId: "fts5-v1",
      manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scopeA),
    };
    const indexB = {
      indexerId: "fts5-v1",
      manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scopeB),
    };

    await storage.rebuildCandidateKnowledgeLexicalIndex({
      scope: scopeA,
      index: indexA,
      createdAt: "2026-08-13T09:10:00.000Z",
      chunks: [
        lexicalChunk(
          "chunk-a2",
          sourceA.source.id,
          sourceA.version.id,
          "Led platform operations",
          1,
        ),
        lexicalChunk(
          "chunk-a1",
          sourceA.source.id,
          sourceA.version.id,
          "Built TypeScript services",
          0,
        ),
        lexicalChunk(
          "chunk-a3",
          sourceA2.source.id,
          sourceA2.version.id,
          "Designed Python automation",
          0,
        ),
      ],
    });
    await storage.rebuildCandidateKnowledgeLexicalIndex({
      scope: scopeB,
      index: indexB,
      createdAt: "2026-08-13T09:11:00.000Z",
      chunks: [
        lexicalChunk(
          "chunk-b1",
          sourceB.source.id,
          sourceB.version.id,
          "Private Python automation",
          0,
          "store-b",
          "ckb-b",
        ),
      ],
    });

    await expect(storage.inspectCandidateKnowledgeLexicalIndex(scopeA)).resolves.toMatchObject({
      status: "matched",
      indexedChunkCount: 3,
    });
    await expect(
      storage.queryCandidateKnowledge({
        purpose: "achievement-recall",
        query: "TypeScript",
        scope: scopeA,
      }),
    ).resolves.toMatchObject({
      status: "matched",
      hits: [{ chunkId: "chunk-a1" }],
      selectedSourceCount: 1,
    });
    await expect(
      storage.queryCandidateKnowledge({
        purpose: "achievement-recall",
        query: "quantum chemistry",
        scope: scopeA,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      status: "bounded-fallback",
      hits: [{ chunkId: "chunk-a1" }],
    });
    await expect(
      storage.queryCandidateKnowledge({
        purpose: "factual-checks",
        query: "the and we",
        scope: scopeA,
      }),
    ).resolves.toMatchObject({
      status: "no-query",
      hits: [],
    });

    await storage.upsertCandidateKnowledgeLexicalChunks({
      scope: scopeA,
      index: indexA,
      chunks: [
        lexicalChunk("chunk-a1", sourceA.source.id, sourceA.version.id, "Built Rust services", 0),
      ],
    });
    await expect(
      storage.queryCandidateKnowledge({
        purpose: "factual-checks",
        query: "Rust",
        scope: scopeA,
      }),
    ).resolves.toMatchObject({ status: "matched", hits: [{ chunkId: "chunk-a1" }] });

    await storage.deleteCandidateKnowledgeLexicalSourceVersion({
      storeId: "store-a",
      knowledgeBaseId: "ckb-a",
      sourceId: sourceA.source.id,
      versionId: sourceA.version.id,
    });
    await expect(storage.inspectCandidateKnowledgeLexicalIndex(scopeA)).resolves.toMatchObject({
      status: "not-indexed",
      indexedChunkCount: 0,
    });
    await expect(storage.inspectCandidateKnowledgeLexicalIndex(scopeA2)).resolves.toMatchObject({
      status: "not-indexed",
      index: null,
      indexedScope: null,
      indexedChunkCount: 0,
    });
    await expect(
      storage.queryCandidateKnowledge({
        purpose: "critic-review",
        query: "Rust",
        scope: scopeA,
      }),
    ).resolves.toMatchObject({ status: "not-indexed", hits: [] });
    await expect(
      storage.queryCandidateKnowledge({
        purpose: "critic-review",
        query: "Python",
        scope: scopeB,
      }),
    ).resolves.toMatchObject({ status: "matched", hits: [{ chunkId: "chunk-b1" }] });
    await storage.close();
  });

  it("reports stale exact-scope requests and rejects multi-CKB or unbound manifests", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(candidateKnowledgeBase("ckb-a", true));
    const sourceA = await storage.createCandidateKnowledgeSource(
      candidateKnowledgeSource("source-a", "ckb-a"),
      candidateKnowledgeVersion("version-a"),
    );
    const scopeA = lexicalScope("store-a", "ckb-a", sourceA.source.id, sourceA.version.id);
    const alternateScope = lexicalScope("store-a", "ckb-a", "source-other", "version-other");
    const index = {
      indexerId: "fts5-v1",
      manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scopeA),
    };
    await expect(
      storage.rebuildCandidateKnowledgeLexicalIndex({
        scope: {
          sources: [
            ...scopeA.sources,
            {
              storeId: "store-b",
              knowledgeBaseId: "ckb-a",
              sourceId: sourceA.source.id,
              versionId: sourceA.version.id,
            },
          ],
        },
        index,
        createdAt: "2026-08-13T09:10:00.000Z",
        chunks: [],
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.rebuildCandidateKnowledgeLexicalIndex({
        scope: scopeA,
        index: { ...index, manifestChecksum: "a".repeat(64) },
        createdAt: "2026-08-13T09:10:00.000Z",
        chunks: [],
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.rebuildCandidateKnowledgeLexicalIndex({
        scope: scopeA,
        index,
        createdAt: "2026-08-13T09:10:00.000Z",
        chunks: [],
      }),
    ).rejects.toThrow(StorageValidationError);
    await storage.rebuildCandidateKnowledgeLexicalIndex({
      scope: scopeA,
      index,
      createdAt: "2026-08-13T09:10:00.000Z",
      chunks: [lexicalChunk("chunk-a1", sourceA.source.id, sourceA.version.id, "TypeScript")],
    });
    await expect(
      storage.inspectCandidateKnowledgeLexicalIndex(alternateScope),
    ).resolves.toMatchObject({
      status: "stale",
      indexedChunkCount: 1,
    });
    await expect(
      storage.queryCandidateKnowledge({
        purpose: "opportunity-requirements",
        query: "TypeScript",
        scope: alternateScope,
      }),
    ).resolves.toMatchObject({ status: "stale", hits: [] });
    await storage.close();
  });

  it("stores immutable private retrieval traces without query or source content", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace("workspace-trace"));
    const scope = lexicalScope("store-a", "ckb-a", "source-a", "version-a");
    const index = {
      schemaVersion: 1 as const,
      indexerId: "fts5-v1",
      manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scope),
    };
    const trace = {
      schemaVersion: 1 as const,
      id: "trace-1",
      workspaceId: "workspace-trace",
      operationId: "operation-1",
      purpose: "critic-review" as const,
      queryChecksum: "a".repeat(64),
      scope,
      index,
      status: "matched" as const,
      indexedChunkCount: 2,
      selectedChunkCount: 1,
      selectedSourceCount: 1,
      latencyMs: 12,
      selectedChunks: [{ chunkId: "chunk-a1", bm25Rank: -1.5 }],
      createdAt: "2026-08-13T10:00:00.000Z",
    };
    await expect(storage.appendCandidateKnowledgeRetrievalTrace(trace)).resolves.toEqual(trace);
    await expect(
      storage.getCandidateKnowledgeRetrievalTrace("workspace-trace", "trace-1"),
    ).resolves.toEqual(trace);
    await expect(
      storage.listCandidateKnowledgeRetrievalTraces("workspace-trace", {
        operationId: "operation-1",
      }),
    ).resolves.toEqual([trace]);
    await expect(storage.appendCandidateKnowledgeRetrievalTrace(trace)).resolves.toEqual(trace);
    await expect(
      storage.appendCandidateKnowledgeRetrievalTrace({
        ...trace,
        queryChecksum: "b".repeat(64),
      }),
    ).rejects.toThrow(StorageConflictError);
    const serializedTrace = JSON.stringify(trace);
    expect(serializedTrace).toContain("queryChecksum");
    expect(serializedTrace).toContain("source-a");
    expect(serializedTrace).toContain("version-a");
    expect(serializedTrace).not.toMatch(/raw query|chunk text|\/private|https?:/i);
    await expect(
      storage.appendCandidateKnowledgeRetrievalTrace({
        ...trace,
        id: "trace-2",
        query: "raw query",
      } as never),
    ).rejects.toThrow(StorageValidationError);
    await storage.close();
  });
});
