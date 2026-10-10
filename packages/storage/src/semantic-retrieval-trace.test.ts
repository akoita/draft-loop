import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeCandidateKnowledgeLexicalManifestChecksum,
  SqliteStorage,
  StorageConflictError,
  StorageValidationError,
  storageSchemaVersion,
} from "./index.js";
import type { SemanticRetrievalTraceInput } from "./semantic-retrieval-trace.js";

interface RawDatabase {
  readonly prepare: (sql: string) => {
    readonly get: (...args: unknown[]) => Record<string, unknown> | undefined;
    readonly run: (...args: unknown[]) => unknown;
  };
  readonly exec: (sql: string) => void;
  readonly close: () => void;
}

const openRaw = createRequire(import.meta.url)("better-sqlite3") as new (
  path: string,
) => RawDatabase;

const workspaceId = "workspace-semantic";
const traceId = "trace-1";
const createdAt = "2026-09-01T10:00:00.000Z";

const identity = {
  modelId: "test-embedding",
  revision: "rev-1",
  modelFileSha256: "c".repeat(64),
  dimensions: 4,
  pooling: "mean",
  runtime: "runtime-a",
};

const used: SemanticRetrievalTraceInput = {
  workspaceId,
  traceId,
  retrievalMode: "hybrid",
  outcome: "semantic-used",
  embeddingIdentity: identity,
  selectedChunks: [
    { chunkId: "chunk-a1", vectorScore: 0.91, vectorRank: 1 },
    { chunkId: "chunk-a2", vectorScore: -0.25, vectorRank: 2 },
  ],
  createdAt,
};

const unavailable: SemanticRetrievalTraceInput = {
  workspaceId,
  traceId: "trace-2",
  retrievalMode: "semantic",
  outcome: "semantic-unavailable",
  reason: "model-absent",
  selectedChunks: [],
  createdAt,
};

async function appendV1Trace(storage: SqliteStorage, id: string): Promise<void> {
  const scope = {
    sources: [
      { storeId: "store-a", knowledgeBaseId: "ckb-a", sourceId: "source-a", versionId: "v-a" },
    ],
  };
  await storage.appendCandidateKnowledgeRetrievalTrace({
    schemaVersion: 1,
    id,
    workspaceId,
    operationId: `operation-${id}`,
    purpose: "critic-review",
    queryChecksum: "a".repeat(64),
    scope,
    index: {
      schemaVersion: 1,
      indexerId: "fts5-v1",
      manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scope),
    },
    status: "matched",
    indexedChunkCount: 2,
    selectedChunkCount: 1,
    selectedSourceCount: 1,
    latencyMs: 12,
    selectedChunks: [{ chunkId: "chunk-a1", bm25Rank: -1.5 }],
    createdAt,
  });
}

describe("semantic retrieval trace companion", () => {
  let directory: string;
  let filename: string;
  let storage: SqliteStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-semantic-trace-"));
    filename = join(directory, "workspace.sqlite");
    storage = new SqliteStorage(filename);
    await storage.saveWorkspace({
      id: workspaceId,
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    });
    await appendV1Trace(storage, traceId);
    await appendV1Trace(storage, "trace-2");
  });

  afterEach(async () => {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips a used and an unavailable trace", async () => {
    const port = storage.candidateKnowledgeSemanticRetrievalTrace;
    const usedRecord = await port.appendSemanticRetrievalTrace(used);
    expect(usedRecord).toMatchObject({
      workspaceId,
      traceId,
      retrievalMode: "hybrid",
      outcome: "semantic-used",
      reason: null,
      embeddingIdentity: identity,
      selectedChunks: used.selectedChunks,
      createdAt,
    });
    expect(usedRecord.payloadChecksum).toMatch(/^[0-9a-f]{64}$/u);
    await expect(port.getSemanticRetrievalTrace(workspaceId, traceId)).resolves.toEqual(usedRecord);

    const unavailableRecord = await port.appendSemanticRetrievalTrace(unavailable);
    expect(unavailableRecord).toMatchObject({
      outcome: "semantic-unavailable",
      reason: "model-absent",
      embeddingIdentity: null,
      selectedChunks: [],
    });
    await expect(port.getSemanticRetrievalTrace(workspaceId, "trace-2")).resolves.toEqual(
      unavailableRecord,
    );
    await expect(port.getSemanticRetrievalTrace(workspaceId, "trace-3")).resolves.toBeUndefined();
  });

  it("stores only chunk ids, scores, and ranks in the payload", async () => {
    await storage.candidateKnowledgeSemanticRetrievalTrace.appendSemanticRetrievalTrace(used);
    const raw = new openRaw(filename);
    const row = raw
      .prepare(
        "SELECT payload_json FROM candidate_knowledge_semantic_retrieval_traces WHERE trace_id = ?",
      )
      .get(traceId) as { payload_json: string };
    raw.close();
    expect(JSON.parse(row.payload_json)).toEqual({
      selectedChunks: [
        { chunkId: "chunk-a1", vectorRank: 1, vectorScore: 0.91 },
        { chunkId: "chunk-a2", vectorRank: 2, vectorScore: -0.25 },
      ],
    });
  });

  it("is idempotent for an identical trace and rejects a different one as a conflict", async () => {
    const port = storage.candidateKnowledgeSemanticRetrievalTrace;
    const first = await port.appendSemanticRetrievalTrace(used);
    await expect(port.appendSemanticRetrievalTrace(used)).resolves.toEqual(first);
    await expect(
      port.appendSemanticRetrievalTrace({
        ...used,
        selectedChunks: [{ chunkId: "chunk-a1", vectorScore: 0.9, vectorRank: 1 }],
      }),
    ).rejects.toThrow(StorageConflictError);
    await expect(
      port.appendSemanticRetrievalTrace({ ...used, retrievalMode: "semantic" }),
    ).rejects.toThrow(StorageConflictError);
    await expect(
      port.appendSemanticRetrievalTrace({
        ...used,
        embeddingIdentity: { ...identity, runtime: "runtime-b" },
      }),
    ).rejects.toThrow(StorageConflictError);
    await expect(
      port.appendSemanticRetrievalTrace({
        ...unavailable,
        traceId,
      }),
    ).rejects.toThrow(StorageConflictError);
    await expect(port.getSemanticRetrievalTrace(workspaceId, traceId)).resolves.toEqual(first);
  });

  it("requires an existing v1 retrieval trace", async () => {
    const port = storage.candidateKnowledgeSemanticRetrievalTrace;
    await expect(
      port.appendSemanticRetrievalTrace({ ...used, traceId: "missing-trace" }),
    ).rejects.toThrow(/existing candidate knowledge retrieval trace/u);
    await expect(
      port.appendSemanticRetrievalTrace({ ...used, traceId: "missing-trace" }),
    ).rejects.toBeInstanceOf(StorageValidationError);
    const raw = new openRaw(filename);
    raw.exec("PRAGMA foreign_keys = ON");
    expect(() =>
      raw
        .prepare(
          "INSERT INTO candidate_knowledge_semantic_retrieval_traces (workspace_id, trace_id, retrieval_mode, outcome, reason, payload_json, payload_checksum, created_at) VALUES (?, ?, 'semantic', 'semantic-unavailable', 'model-absent', '{}', ?, ?)",
        )
        .run(workspaceId, "missing-trace", "a".repeat(64), createdAt),
    ).toThrow(/FOREIGN KEY/u);
    raw.close();
  });

  it("blocks updates and deletes with immutability triggers", async () => {
    await storage.candidateKnowledgeSemanticRetrievalTrace.appendSemanticRetrievalTrace(used);
    const raw = new openRaw(filename);
    expect(() =>
      raw
        .prepare(
          "UPDATE candidate_knowledge_semantic_retrieval_traces SET retrieval_mode = 'semantic'",
        )
        .run(),
    ).toThrow(/immutable/u);
    expect(() =>
      raw.prepare("DELETE FROM candidate_knowledge_semantic_retrieval_traces").run(),
    ).toThrow(/immutable/u);
    raw.close();
  });

  it("rejects content-bearing and unexpected fields", async () => {
    const port = storage.candidateKnowledgeSemanticRetrievalTrace;
    for (const extra of [{ query: "raw query" }, { text: "chunk text" }, { payload: {} }]) {
      await expect(
        port.appendSemanticRetrievalTrace({ ...used, ...extra } as never),
      ).rejects.toThrow(/unexpected fields/u);
    }
    await expect(
      port.appendSemanticRetrievalTrace({
        ...used,
        selectedChunks: [{ chunkId: "chunk-a1", vectorScore: 0.5, vectorRank: 1, text: "x" }],
      } as never),
    ).rejects.toThrow(/unexpected fields/u);
    await expect(
      port.appendSemanticRetrievalTrace({
        ...used,
        embeddingIdentity: { ...identity, path: "/private/model.onnx" },
      } as never),
    ).rejects.toThrow(/unexpected fields/u);
    await expect(port.getSemanticRetrievalTrace(workspaceId, traceId)).resolves.toBeUndefined();
  });

  it.each([
    ["used with a reason", { ...used, reason: "index-stale" }],
    ["used without an identity", { ...used, embeddingIdentity: undefined }],
    ["unavailable without a reason", { ...unavailable, reason: undefined }],
    ["unavailable with an identity", { ...unavailable, embeddingIdentity: identity }],
    [
      "unavailable with chunks",
      { ...unavailable, selectedChunks: [{ chunkId: "chunk-a1", vectorScore: 0, vectorRank: 1 }] },
    ],
    ["an unknown reason", { ...unavailable, reason: "disk-full" }],
    ["an unknown outcome", { ...used, outcome: "semantic-skipped" }],
    ["the lexical mode", { ...used, retrievalMode: "lexical" }],
    [
      "an unsafe chunk id",
      { ...used, selectedChunks: [{ ...used.selectedChunks[0], chunkId: "a b" }] },
    ],
    ["an overlong trace id", { ...used, traceId: "t".repeat(121) }],
    [
      "a score above one",
      { ...used, selectedChunks: [{ chunkId: "chunk-a1", vectorScore: 1.5, vectorRank: 1 }] },
    ],
    [
      "a non-finite score",
      {
        ...used,
        selectedChunks: [{ chunkId: "chunk-a1", vectorScore: Number.NaN, vectorRank: 1 }],
      },
    ],
    [
      "a zero rank",
      { ...used, selectedChunks: [{ chunkId: "chunk-a1", vectorScore: 0.5, vectorRank: 0 }] },
    ],
    [
      "a fractional rank",
      { ...used, selectedChunks: [{ chunkId: "chunk-a1", vectorScore: 0.5, vectorRank: 1.5 }] },
    ],
    [
      "duplicate chunk ids",
      {
        ...used,
        selectedChunks: [
          { chunkId: "chunk-a1", vectorScore: 0.5, vectorRank: 1 },
          { chunkId: "chunk-a1", vectorScore: 0.4, vectorRank: 2 },
        ],
      },
    ],
    [
      "too many chunks",
      {
        ...used,
        selectedChunks: Array.from({ length: 101 }, (_, index) => ({
          chunkId: `chunk-${index}`,
          vectorScore: 0.1,
          vectorRank: index + 1,
        })),
      },
    ],
    [
      "a bad identity checksum",
      { ...used, embeddingIdentity: { ...identity, modelFileSha256: "x" } },
    ],
    ["zero dimensions", { ...used, embeddingIdentity: { ...identity, dimensions: 0 } }],
    ["a bad timestamp", { ...used, createdAt: "yesterday" }],
  ])("rejects %s", async (_label, input) => {
    await expect(
      storage.candidateKnowledgeSemanticRetrievalTrace.appendSemanticRetrievalTrace(input as never),
    ).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("enforces outcome, reason, and identity consistency in the table itself", () => {
    const raw = new openRaw(filename);
    const insert = (outcome: string, reason: string | null, modelId: string | null) =>
      raw
        .prepare(
          "INSERT INTO candidate_knowledge_semantic_retrieval_traces (workspace_id, trace_id, retrieval_mode, outcome, reason, model_id, model_revision, model_sha256, dimensions, pooling, runtime, payload_json, payload_checksum, created_at) VALUES (?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)",
        )
        .run(
          workspaceId,
          traceId,
          outcome,
          reason,
          modelId,
          modelId === null ? null : "rev",
          modelId === null ? null : "c".repeat(64),
          modelId === null ? null : 4,
          modelId === null ? null : "mean",
          modelId === null ? null : "runtime",
          "a".repeat(64),
          createdAt,
        );
    expect(() => insert("semantic-used", "model-absent", "model")).toThrow(/CHECK/u);
    expect(() => insert("semantic-used", null, null)).toThrow(/CHECK/u);
    expect(() => insert("semantic-unavailable", null, null)).toThrow(/CHECK/u);
    expect(() => insert("semantic-unavailable", "model-absent", "model")).toThrow(/CHECK/u);
    expect(() => insert("semantic-unavailable", "disk-full", null)).toThrow(/CHECK/u);
    raw.close();
  });

  it("applies migration 29 to an existing v28 database without touching v1 traces", async () => {
    expect(storageSchemaVersion).toBe(33);
    await storage.candidateKnowledgeSemanticRetrievalTrace.appendSemanticRetrievalTrace(used);
    storage.close();

    // A v28 store has no companion table, triggers, or migration row; the v1 trace tables are the
    // same, so dropping migration 29's artefacts reproduces the schema main shipped before it.
    const legacy = new openRaw(filename);
    const applied = legacy
      .prepare("SELECT checksum FROM schema_migrations WHERE version = 29")
      .get() as { checksum: string };
    expect(applied.checksum).toMatch(/^[0-9a-f]{64}$/u);
    legacy.exec(
      "DROP TABLE candidate_knowledge_semantic_retrieval_traces; DELETE FROM schema_migrations WHERE version = 29;",
    );
    legacy.close();

    storage = new SqliteStorage(filename);
    expect(storage.appliedMigrationVersions()).toContain(29);
    await expect(
      storage.getCandidateKnowledgeRetrievalTrace(workspaceId, traceId),
    ).resolves.toMatchObject({ id: traceId, selectedChunks: [{ chunkId: "chunk-a1" }] });
    const port = storage.candidateKnowledgeSemanticRetrievalTrace;
    await expect(port.getSemanticRetrievalTrace(workspaceId, traceId)).resolves.toBeUndefined();
    await expect(port.appendSemanticRetrievalTrace(used)).resolves.toMatchObject({ traceId });
    storage.close();

    const verify = new openRaw(filename);
    expect(
      verify.prepare("SELECT checksum FROM schema_migrations WHERE version = 29").get(),
    ).toEqual(applied);
    verify.close();
    // Re-opening an already migrated database is a no-op.
    storage = new SqliteStorage(filename);
  });
});
