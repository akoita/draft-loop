import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateKnowledgeRetrievalScopeInput } from "@draft-loop/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeCandidateKnowledgeLexicalManifestChecksum, SqliteStorage } from "./index.js";
import {
  initializeCandidateKnowledgeStore,
  openCandidateKnowledgeStore,
  restoreCandidateKnowledgePortableBackup,
} from "./knowledge-store.js";
import {
  type CandidateKnowledgeVectorEmbeddingIdentity,
  CandidateKnowledgeVectorIndexUnavailableError,
  decodeCandidateKnowledgeVector,
  encodeCandidateKnowledgeVector,
} from "./knowledge-vector-index.js";

const createdAt = "2026-08-29T09:00:00.000Z";
const storeId = "knowledge-store-1";
const ckb = "ckb-default";

const identity: CandidateKnowledgeVectorEmbeddingIdentity = {
  modelId: "test-embedding",
  revision: "rev-1",
  modelFileSha256: "c".repeat(64),
  dimensions: 4,
  pooling: "mean",
  runtime: "runtime-a",
};

function unit(...components: number[]): Float32Array {
  const norm = Math.hypot(...components);
  return new Float32Array(components.map((component) => component / norm));
}

const east = unit(1, 0, 0, 0);
const north = unit(0, 1, 0, 0);
const diagonal = unit(1, 1, 0, 0);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scopeOf(
  ...sources: readonly (readonly [string, string])[]
): CandidateKnowledgeRetrievalScopeInput {
  return {
    sources: sources.map(([sourceId, versionId]) => ({
      storeId,
      knowledgeBaseId: ckb,
      sourceId,
      versionId,
    })),
  };
}

function chunk(sourceId: string, versionId: string, chunkId: string, ordinal: number, text = "x") {
  return {
    chunkId,
    ordinal,
    lineStart: 1,
    lineEnd: 1,
    text,
    metadata: {
      section: "evidence",
      provenance: { storeId, knowledgeBaseId: ckb, sourceId, versionId },
    },
  } as const;
}

type Store = Awaited<ReturnType<typeof initializeCandidateKnowledgeStore>>;

async function createSource(store: Store, sourceId: string, versionId: string): Promise<void> {
  await store.createCandidateKnowledgeSource(
    { id: sourceId, knowledgeBaseId: ckb, kind: "file", displayName: "Evidence", createdAt },
    { id: versionId, mediaType: "text/plain", checksum: "a".repeat(64), sizeBytes: 1, createdAt },
  );
}

async function rebuild(
  store: Store,
  scope: CandidateKnowledgeRetrievalScopeInput,
  chunks: readonly ReturnType<typeof chunk>[],
): Promise<void> {
  await store.rebuildCandidateKnowledgeLexicalIndex({
    scope,
    index: {
      indexerId: "test-indexer",
      manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scope),
    },
    chunks,
    createdAt,
  });
}

describe("candidate knowledge vector index", () => {
  let parent: string;
  let store: Store;
  // Source a has two versions and source b has one, all in one lexical manifest.
  const fullScope = scopeOf(
    ["source-a", "version-a1"],
    ["source-a", "version-a2"],
    ["source-b", "version-b1"],
  );
  const scopeA1 = scopeOf(["source-a", "version-a1"]);
  const scopeA2 = scopeOf(["source-a", "version-a2"]);

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "draft-loop-storage-vector-"));
    store = await initializeCandidateKnowledgeStore({
      root: join(parent, "candidate-knowledge"),
      descriptor: { schemaVersion: 1 as const, id: storeId, createdAt },
      defaultKnowledgeBase: {
        id: ckb,
        displayName: "Career evidence",
        description: "Sanitized test knowledge",
        createdAt,
      },
    });
    await createSource(store, "source-a", "version-a1");
    await store.appendCandidateKnowledgeSourceVersion(ckb, "source-a", {
      id: "version-a2",
      mediaType: "text/plain",
      checksum: "b".repeat(64),
      sizeBytes: 1,
      createdAt: "2026-08-29T09:01:00.000Z",
    });
    await createSource(store, "source-b", "version-b1");
    await rebuild(store, fullScope, [
      chunk("source-a", "version-a1", "a1-0", 0),
      chunk("source-a", "version-a1", "a1-1", 1),
      chunk("source-a", "version-a2", "a2-0", 0),
      chunk("source-b", "version-b1", "b1-0", 0),
    ]);
  });

  afterEach(async () => {
    await store.close().catch(() => undefined);
    await rm(parent, { force: true, recursive: true });
  });

  async function upsertAll(vectorIdentity = identity): Promise<void> {
    await store.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: ckb,
      identity: vectorIdentity,
      vectors: [
        { chunkId: "a1-0", vector: east },
        { chunkId: "a1-1", vector: diagonal },
        { chunkId: "a2-0", vector: north },
        { chunkId: "b1-0", vector: east },
      ],
      createdAt,
    });
  }

  it("encodes Float32 little-endian and round-trips bit-exactly", () => {
    const vector = unit(0.1, 0.2, 0.3, 0.4);
    const bytes = encodeCandidateKnowledgeVector(vector);
    expect(bytes.byteLength).toBe(16);
    expect(Array.from(encodeCandidateKnowledgeVector(new Float32Array([1])))).toEqual([
      0, 0, 128, 63,
    ]);
    const decoded = decodeCandidateKnowledgeVector(Buffer.from(bytes), 4);
    expect(Array.from(decoded)).toEqual(Array.from(vector));
    expect(() => decodeCandidateKnowledgeVector(Buffer.from(bytes), 3)).toThrow(/invalid size/u);
  });

  it("reports not-indexed, then stale with partial coverage, then matched", async () => {
    await expect(store.inspectCandidateKnowledgeVectorIndex(fullScope, identity)).resolves.toEqual({
      status: "not-indexed",
      identity: null,
      vectorCount: 0,
      scopeChunkCount: 0,
    });
    await expect(
      store.queryCandidateKnowledgeVectors({
        scope: fullScope,
        identity,
        queryVector: east,
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: "CandidateKnowledgeVectorIndexUnavailableError",
      status: "not-indexed",
    });

    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: ckb,
        identity,
        vectors: [{ chunkId: "a1-0", vector: east }],
        createdAt,
      }),
    ).resolves.toMatchObject({ status: "stale", vectorCount: 1, scopeChunkCount: 4 });
    await expect(
      store.queryCandidateKnowledgeVectors({
        scope: fullScope,
        identity,
        queryVector: east,
        limit: 5,
      }),
    ).rejects.toBeInstanceOf(CandidateKnowledgeVectorIndexUnavailableError);
    await expect(
      store.queryCandidateKnowledgeVectors({
        scope: fullScope,
        identity,
        queryVector: east,
        limit: 5,
      }),
    ).rejects.toMatchObject({ status: "stale" });

    await upsertAll();
    await expect(store.inspectCandidateKnowledgeVectorIndex(fullScope, identity)).resolves.toEqual({
      status: "matched",
      identity,
      vectorCount: 4,
      scopeChunkCount: 4,
    });
  });

  it("matches a narrower scope by its own chunks and ignores runtime", async () => {
    await store.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: ckb,
      identity,
      vectors: [
        { chunkId: "a1-0", vector: east },
        { chunkId: "a1-1", vector: north },
      ],
      createdAt,
    });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(scopeA1, { ...identity, runtime: "runtime-b" }),
    ).resolves.toMatchObject({ status: "matched", vectorCount: 2, scopeChunkCount: 2 });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(scopeA2, identity),
    ).resolves.toMatchObject({ status: "stale", vectorCount: 0, scopeChunkCount: 1 });
  });

  it("reports stale when a requested source version is not in the lexical index", async () => {
    await store.rebuildCandidateKnowledgeLexicalIndex({
      scope: scopeA1,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scopeA1),
      },
      chunks: [
        chunk("source-a", "version-a1", "a1-0", 0),
        chunk("source-a", "version-a1", "a1-1", 1),
      ],
      createdAt,
    });
    await store.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: ckb,
      identity,
      vectors: [
        { chunkId: "a1-0", vector: east },
        { chunkId: "a1-1", vector: north },
      ],
      createdAt,
    });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(scopeA1, identity),
    ).resolves.toMatchObject({ status: "matched" });
    const withMissing = scopeOf(["source-a", "version-a1"], ["source-b", "version-b1"]);
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(withMissing, identity),
    ).resolves.toMatchObject({ status: "stale", vectorCount: 2, scopeChunkCount: 2 });
    await expect(
      store.queryCandidateKnowledgeVectors({
        scope: withMissing,
        identity,
        queryVector: east,
        limit: 5,
      }),
    ).rejects.toMatchObject({
      name: "CandidateKnowledgeVectorIndexUnavailableError",
      status: "stale",
    });
  });

  it("flags a different model revision, checksum, pooling, or dimensions as stale", async () => {
    await upsertAll();
    for (const changed of [
      { revision: "rev-2" },
      { modelId: "other-model" },
      { modelFileSha256: "d".repeat(64) },
      { pooling: "cls" },
      { dimensions: 8 },
    ]) {
      await expect(
        store.inspectCandidateKnowledgeVectorIndex(fullScope, { ...identity, ...changed }),
      ).resolves.toMatchObject({ status: "stale" });
    }
  });

  it("queries only the exact selected source versions with deterministic ordering", async () => {
    await upsertAll();
    const query = (scope: CandidateKnowledgeRetrievalScopeInput, limit: number) =>
      store.queryCandidateKnowledgeVectors({ scope, identity, queryVector: east, limit });

    const hits = await query(scopeOf(["source-a", "version-a1"], ["source-b", "version-b1"]), 10);
    // a1-0 and b1-0 tie at score 1; source id breaks the tie, then the weaker diagonal follows.
    expect(hits.map((hit) => hit.chunkId)).toEqual(["a1-0", "b1-0", "a1-1"]);
    expect(hits[0]).toEqual({
      storeId,
      knowledgeBaseId: ckb,
      sourceId: "source-a",
      versionId: "version-a1",
      chunkId: "a1-0",
      ordinal: 0,
      score: 1,
    });
    expect(hits[2]?.score).toBeCloseTo(Math.SQRT1_2, 6);
    // The unselected version a2 of the same source never appears.
    expect(hits.some((hit) => hit.versionId === "version-a2")).toBe(false);
    await expect(query(scopeA1, 1)).resolves.toHaveLength(1);
    await expect(query(scopeA2, 10)).resolves.toMatchObject([{ chunkId: "a2-0", score: 0 }]);
    expect(await query(fullScope, 10)).toEqual(await query(fullScope, 10));

    for (const limit of [0, 201, 1.5, Number.NaN]) {
      await expect(query(scopeA1, limit)).rejects.toThrow(/limit/u);
    }
  });

  it("orders ties by ordinal and chunk id within a source version", async () => {
    await store.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: ckb,
      identity,
      vectors: [
        { chunkId: "a1-1", vector: east },
        { chunkId: "a1-0", vector: east },
      ],
      createdAt,
    });
    const hits = await store.queryCandidateKnowledgeVectors({
      scope: scopeA1,
      identity,
      queryVector: east,
      limit: 10,
    });
    expect(hits.map((hit) => hit.chunkId)).toEqual(["a1-0", "a1-1"]);
  });

  it("isolates vectors between knowledge bases", async () => {
    await store.createCandidateKnowledgeBase({
      id: "ckb-other",
      displayName: "Other",
      isDefault: false,
      createdAt,
    });
    await store.createCandidateKnowledgeSource(
      {
        id: "source-o",
        knowledgeBaseId: "ckb-other",
        kind: "file",
        displayName: "Other evidence",
        createdAt,
      },
      {
        id: "version-o",
        mediaType: "text/plain",
        checksum: "a".repeat(64),
        sizeBytes: 1,
        createdAt,
      },
    );
    const otherScope = {
      sources: [
        { storeId, knowledgeBaseId: "ckb-other", sourceId: "source-o", versionId: "version-o" },
      ],
    };
    await store.rebuildCandidateKnowledgeLexicalIndex({
      scope: otherScope,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(otherScope),
      },
      chunks: [
        {
          ...chunk("source-o", "version-o", "o-0", 0),
          metadata: {
            section: "evidence",
            provenance: {
              storeId,
              knowledgeBaseId: "ckb-other",
              sourceId: "source-o",
              versionId: "version-o",
            },
          },
        },
      ],
      createdAt,
    });
    await upsertAll();
    await store.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: "ckb-other",
      identity,
      vectors: [{ chunkId: "o-0", vector: east }],
      createdAt,
    });
    const other = await store.queryCandidateKnowledgeVectors({
      scope: otherScope,
      identity,
      queryVector: east,
      limit: 10,
    });
    expect(other.map((hit) => hit.chunkId)).toEqual(["o-0"]);
    const main = await store.queryCandidateKnowledgeVectors({
      scope: fullScope,
      identity,
      queryVector: east,
      limit: 10,
    });
    expect(main.some((hit) => hit.chunkId === "o-0")).toBe(false);
    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: "ckb-other",
        identity,
        vectors: [{ chunkId: "a1-0", vector: east }],
        createdAt,
      }),
    ).rejects.toThrow(/not in the lexical index/u);
    // Deleting one knowledge base's vectors leaves the other untouched.
    await store.deleteCandidateKnowledgeVectorIndex({ storeId, knowledgeBaseId: "ckb-other" });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(otherScope, identity),
    ).resolves.toMatchObject({ status: "not-indexed" });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
    ).resolves.toMatchObject({ status: "matched" });
  });

  it("clears old vectors when the identity changes", async () => {
    await upsertAll();
    const next = { ...identity, revision: "rev-2" };
    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: ckb,
        identity: next,
        vectors: [{ chunkId: "a1-0", vector: east }],
        createdAt,
      }),
    ).resolves.toMatchObject({ status: "stale", vectorCount: 1 });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
    ).resolves.toMatchObject({ status: "stale" });
    await expect(store.inspectCandidateKnowledgeVectorIndex(scopeA1, next)).resolves.toMatchObject({
      vectorCount: 1,
      scopeChunkCount: 2,
    });
  });

  it("replaces an existing vector without disturbing the others", async () => {
    await upsertAll();
    await store.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: ckb,
      identity,
      vectors: [{ chunkId: "a1-0", vector: north }],
      createdAt,
    });
    const hits = await store.queryCandidateKnowledgeVectors({
      scope: fullScope,
      identity,
      queryVector: north,
      limit: 10,
    });
    expect(hits.find((hit) => hit.chunkId === "a1-0")?.score).toBe(1);
    expect(hits).toHaveLength(4);
  });

  it("drops vectors when a lexical chunk is replaced, rebuilt, or deleted", async () => {
    await upsertAll();
    await store.upsertCandidateKnowledgeLexicalChunks({
      scope: fullScope,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(fullScope),
      },
      chunks: [chunk("source-a", "version-a2", "a2-0", 0, "changed text")],
    });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(scopeA2, identity),
    ).resolves.toMatchObject({ status: "stale", vectorCount: 0, scopeChunkCount: 1 });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(scopeA1, identity),
    ).resolves.toMatchObject({ status: "matched", vectorCount: 2 });

    await upsertAll();
    await rebuild(store, fullScope, [
      chunk("source-a", "version-a1", "a1-0", 0),
      chunk("source-a", "version-a2", "a2-0", 0),
      chunk("source-b", "version-b1", "b1-0", 0),
    ]);
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
    ).resolves.toMatchObject({ status: "not-indexed", vectorCount: 0 });

    await store.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: ckb,
      identity,
      vectors: [{ chunkId: "a1-0", vector: east }],
      createdAt,
    });
    await store.deleteCandidateKnowledgeLexicalSourceVersion({
      storeId,
      knowledgeBaseId: ckb,
      sourceId: "source-a",
      versionId: "version-a1",
    });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
    ).resolves.toMatchObject({ status: "not-indexed" });
  });

  it("drops vectors on a lexical manifest change and on lifecycle invalidation", async () => {
    await upsertAll();
    await store.retireCandidateKnowledgeSource(ckb, "source-b", {
      retiredAt: "2026-08-29T09:02:00.000Z",
      reason: "user-requested",
    });
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
    ).resolves.toMatchObject({ status: "not-indexed", vectorCount: 0 });
    const rows = (await store.inspectCandidateKnowledgeLexicalIndex(fullScope)).status;
    expect(rows).toBe("not-indexed");
  });

  it("rejects invalid input", async () => {
    const upsert = (vectors: readonly { chunkId: string; vector: Float32Array }[]) =>
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: ckb,
        identity,
        vectors,
        createdAt,
      });
    await expect(upsert([{ chunkId: "a1-0", vector: unit(1, 0, 0) }])).rejects.toThrow(
      /4 dimensions/u,
    );
    await expect(
      upsert([{ chunkId: "a1-0", vector: new Float32Array([1, Number.NaN, 0, 0]) }]),
    ).rejects.toThrow(/finite/u);
    await expect(
      upsert([{ chunkId: "a1-0", vector: new Float32Array([1, Number.POSITIVE_INFINITY, 0, 0]) }]),
    ).rejects.toThrow(/finite/u);
    await expect(
      upsert([{ chunkId: "a1-0", vector: new Float32Array([2, 0, 0, 0]) }]),
    ).rejects.toThrow(/unit length/u);
    await expect(upsert([{ chunkId: "missing", vector: east }])).rejects.toThrow(
      /not in the lexical index/u,
    );
    await expect(
      upsert([
        { chunkId: "a1-0", vector: east },
        { chunkId: "a1-0", vector: north },
      ]),
    ).rejects.toThrow(/unique/u);
    await expect(upsert([{ chunkId: " ", vector: east }])).rejects.toThrow(/chunk id/u);
    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: ckb,
        identity: { ...identity, modelFileSha256: "NOT-HEX" },
        vectors: [],
        createdAt,
      }),
    ).rejects.toThrow(/identity/u);
    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: ckb,
        identity: { ...identity, dimensions: 5000 },
        vectors: [],
        createdAt,
      }),
    ).rejects.toThrow(/identity/u);
    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: ckb,
        identity,
        vectors: [],
        createdAt: "yesterday",
      }),
    ).rejects.toThrow(/createdAt/u);
    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: ckb,
        identity,
        vectors: new Array(10_001).fill({ chunkId: "a1-0", vector: east }),
        createdAt,
      }),
    ).rejects.toThrow(/at most 10000/u);
    await expect(
      store.queryCandidateKnowledgeVectors({
        scope: fullScope,
        identity,
        queryVector: new Float32Array([2, 0, 0, 0]),
        limit: 1,
      }),
    ).rejects.toThrow(/unit length/u);
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(
        {
          sources: [
            { storeId, knowledgeBaseId: ckb, sourceId: "source-a", versionId: "version-a1" },
            {
              storeId,
              knowledgeBaseId: "ckb-other",
              sourceId: "source-b",
              versionId: "version-b1",
            },
          ],
        },
        identity,
      ),
    ).rejects.toThrow(/one store and knowledge base/u);
    // Nothing was written by any rejected call.
    await expect(
      store.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
    ).resolves.toMatchObject({ status: "not-indexed" });
  });

  it("refuses to index a missing lexical index", async () => {
    await expect(
      store.upsertCandidateKnowledgeVectors({
        storeId,
        knowledgeBaseId: "ckb-unknown",
        identity,
        vectors: [],
        createdAt,
      }),
    ).rejects.toThrow(/lexical index must be rebuilt first/u);
  });

  it("does not restore vector rows from a portable backup", async () => {
    // The fixture store holds unmanaged sources, which a portable backup rejects.
    await store.close();
    const sourcePath = join(parent, "evidence.md");
    await writeFile(sourcePath, "Restorable managed evidence", "utf8");
    const backupStore = await initializeCandidateKnowledgeStore({
      root: join(parent, "backup-source"),
      descriptor: { schemaVersion: 1 as const, id: storeId, createdAt },
      defaultKnowledgeBase: {
        id: ckb,
        displayName: "Career evidence",
        description: "x",
        createdAt,
      },
    });
    const managed = await backupStore.createManagedCandidateKnowledgeFileSource(
      {
        id: "source-managed",
        knowledgeBaseId: ckb,
        kind: "file",
        displayName: "Managed evidence",
        createdAt,
      },
      {
        id: "version-managed",
        sourcePath,
        mediaType: "text/markdown",
        checksum: sha256("Restorable managed evidence"),
        sizeBytes: Buffer.byteLength("Restorable managed evidence"),
        createdAt,
      },
    );
    const managedScope = scopeOf([managed.source.id, managed.version.id]);
    await rebuild(backupStore, managedScope, [
      chunk(managed.source.id, managed.version.id, "m-0", 0),
    ]);
    await backupStore.upsertCandidateKnowledgeVectors({
      storeId,
      knowledgeBaseId: ckb,
      identity,
      vectors: [{ chunkId: "m-0", vector: east }],
      createdAt,
    });
    await expect(
      backupStore.inspectCandidateKnowledgeVectorIndex(managedScope, identity),
    ).resolves.toMatchObject({ status: "matched" });
    const backup = join(parent, "portable-backup");
    await backupStore.exportPortableBackup(backup, { createdAt });
    await backupStore.close();

    const restoredRoot = join(parent, "restored");
    await restoreCandidateKnowledgePortableBackup(backup, restoredRoot, {
      collision: "fail-if-destination-exists",
      restoredAt: "2026-08-29T09:03:00.000Z",
    });
    const restored = await openCandidateKnowledgeStore(restoredRoot);
    await expect(
      restored.inspectCandidateKnowledgeVectorIndex(managedScope, identity),
    ).resolves.toMatchObject({ status: "not-indexed", vectorCount: 0 });
    await restored.close();
  });

  it("applies migration 28 to an existing v27 database with a stable checksum", () => {
    const filename = join(parent, "migrate.sqlite");
    const first = new SqliteStorage(filename);
    first.close();
    const raw = createRequire(import.meta.url)("better-sqlite3") as new (
      path: string,
    ) => {
      prepare: (sql: string) => {
        get: (...args: unknown[]) => Record<string, unknown> | undefined;
        run: (...args: unknown[]) => unknown;
      };
      exec: (sql: string) => void;
      close: () => void;
    };
    const database = new raw(filename);
    const applied = database
      .prepare("SELECT checksum FROM schema_migrations WHERE version = 28")
      .get() as { checksum: string };
    expect(applied.checksum).toMatch(/^[0-9a-f]{64}$/u);
    database.exec(
      "DROP TABLE candidate_knowledge_vector_chunks; DROP TABLE candidate_knowledge_vector_indexes; DELETE FROM schema_migrations WHERE version = 28;",
    );
    database.close();

    const second = new SqliteStorage(filename);
    second.close();
    const verify = new raw(filename);
    expect(
      verify.prepare("SELECT checksum FROM schema_migrations WHERE version = 28").get(),
    ).toEqual(applied);
    expect(
      verify
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name IN ('candidate_knowledge_vector_indexes', 'candidate_knowledge_vector_chunks')",
        )
        .get(),
    ).toEqual({ count: 2 });
    verify.close();
    // Re-opening an already migrated database is a no-op.
    new SqliteStorage(filename).close();
  });

  it("allows inspection and query on a read-only store", async () => {
    await upsertAll();
    await store.close();
    const readOnly = new SqliteStorage(
      join(parent, "candidate-knowledge", ".draft-loop", "knowledge.sqlite"),
      {
        readOnly: true,
        fileMustExist: true,
      },
    );
    await expect(
      readOnly.candidateKnowledgeVectorIndex.inspectCandidateKnowledgeVectorIndex(
        fullScope,
        identity,
      ),
    ).resolves.toMatchObject({ status: "matched" });
    readOnly.close();
  });
});
