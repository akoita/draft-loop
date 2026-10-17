import type { CandidateKnowledgeRetrievalScopeInput } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";
import { computeCandidateKnowledgeLexicalManifestChecksum } from "../candidate-knowledge-lexical-rules.js";
import {
  type CandidateKnowledgeVectorEmbeddingIdentity,
  CandidateKnowledgeVectorIndexUnavailableError,
  type CandidateKnowledgeVectorStoragePort,
} from "../knowledge-vector-index.js";
import { StorageConflictError, StorageValidationError } from "../storage-errors.js";
import type { CandidateKnowledgeRetrievalStorage } from "./candidate-knowledge-retrieval.js";
import type { StorageContract } from "./history-records.js";

/** The knowledge-base and lexical ports the vectors derive from, plus the vector index itself. */
export type CandidateKnowledgeVectorsStorage = CandidateKnowledgeRetrievalStorage & {
  readonly candidateKnowledgeVectorIndex: CandidateKnowledgeVectorStoragePort;
};

export type CandidateKnowledgeVectorsStorageFactory = () => Promise<{
  readonly storage: CandidateKnowledgeVectorsStorage;
  readonly close: () => Promise<void>;
}>;

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

function scopeOf(
  knowledgeBaseId: string,
  ...sources: readonly (readonly [string, string])[]
): CandidateKnowledgeRetrievalScopeInput {
  return {
    sources: sources.map(([sourceId, versionId]) => ({
      storeId,
      knowledgeBaseId,
      sourceId,
      versionId,
    })),
  };
}

function chunk(
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
  chunkId: string,
  ordinal: number,
) {
  return {
    chunkId,
    ordinal,
    lineStart: 1,
    lineEnd: 1,
    text: `evidence ${chunkId}`,
    metadata: {
      section: "evidence",
      provenance: { storeId, knowledgeBaseId, sourceId, versionId },
    },
  };
}

const fullScope = scopeOf(
  ckb,
  ["source-a", "version-a1"],
  ["source-a", "version-a2"],
  ["source-b", "version-b1"],
);
const scopeA1 = scopeOf(ckb, ["source-a", "version-a1"]);

async function rebuild(
  storage: CandidateKnowledgeVectorsStorage,
  scope: CandidateKnowledgeRetrievalScopeInput,
  chunks: readonly ReturnType<typeof chunk>[],
): Promise<void> {
  await storage.rebuildCandidateKnowledgeLexicalIndex({
    scope,
    index: {
      indexerId: "test-indexer",
      manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scope),
    },
    chunks,
    createdAt,
  });
}

/** Source a has two versions and source b one, all in one lexical manifest. */
async function seed(storage: CandidateKnowledgeVectorsStorage): Promise<void> {
  await storage.ensureDefaultCandidateKnowledgeBase({
    id: ckb,
    displayName: "Career evidence",
    createdAt,
  });
  const version = (id: string, checksum: string) => ({
    id,
    mediaType: "text/plain",
    checksum: checksum.repeat(64),
    sizeBytes: 1,
    createdAt,
  });
  for (const sourceId of ["source-a", "source-b"]) {
    await storage.createCandidateKnowledgeSource(
      { id: sourceId, knowledgeBaseId: ckb, kind: "file", displayName: "Evidence", createdAt },
      version(sourceId === "source-a" ? "version-a1" : "version-b1", "a"),
    );
  }
  await storage.appendCandidateKnowledgeSourceVersion(ckb, "source-a", version("version-a2", "b"));
  await rebuild(storage, fullScope, [
    chunk(ckb, "source-a", "version-a1", "a1-0", 0),
    chunk(ckb, "source-a", "version-a1", "a1-1", 1),
    chunk(ckb, "source-a", "version-a2", "a2-0", 0),
    chunk(ckb, "source-b", "version-b1", "b1-0", 0),
  ]);
}

async function upsert(
  storage: CandidateKnowledgeVectorsStorage,
  vectors: readonly { readonly chunkId: string; readonly vector: Float32Array }[],
  vectorIdentity = identity,
) {
  return storage.candidateKnowledgeVectorIndex.upsertCandidateKnowledgeVectors({
    storeId,
    knowledgeBaseId: ckb,
    identity: vectorIdentity,
    vectors,
    createdAt,
  });
}

const allVectors = [
  { chunkId: "a1-0", vector: east },
  { chunkId: "a1-1", vector: diagonal },
  { chunkId: "a2-0", vector: north },
  { chunkId: "b1-0", vector: east },
];

/** Every vector-index contract, in a stable order. */
export const candidateKnowledgeVectorContracts: readonly StorageContract<CandidateKnowledgeVectorsStorage>[] =
  [
    {
      name: "vector index: not indexed, then stale while partial, then matched",
      check: async (storage) => {
        await seed(storage);
        const vectors = storage.candidateKnowledgeVectorIndex;
        await expect(
          vectors.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
        ).resolves.toMatchObject({ status: "not-indexed", vectorCount: 0 });
        await upsert(storage, allVectors.slice(0, 2));
        await expect(
          vectors.inspectCandidateKnowledgeVectorIndex(fullScope, identity),
        ).resolves.toEqual({ status: "stale", identity, vectorCount: 2, scopeChunkCount: 4 });
        await expect(
          vectors.inspectCandidateKnowledgeVectorIndex(scopeA1, { ...identity, runtime: "other" }),
        ).resolves.toMatchObject({ status: "matched", vectorCount: 2, scopeChunkCount: 2 });
        await expect(upsert(storage, allVectors.slice(2))).resolves.toMatchObject({
          status: "matched",
          vectorCount: 4,
        });
      },
    },
    {
      name: "vector index: another model revision, checksum, pooling or size is stale",
      check: async (storage) => {
        await seed(storage);
        await upsert(storage, allVectors);
        for (const changed of [
          { revision: "rev-2" },
          { modelFileSha256: "d".repeat(64) },
          { pooling: "cls" },
          { dimensions: 8 },
        ]) {
          await expect(
            storage.candidateKnowledgeVectorIndex.inspectCandidateKnowledgeVectorIndex(fullScope, {
              ...identity,
              ...changed,
            }),
          ).resolves.toMatchObject({ status: "stale" });
        }
      },
    },
    {
      name: "vector index: queries only the selected versions, ties by ordinal and chunk id",
      check: async (storage) => {
        await seed(storage);
        await upsert(storage, allVectors);
        const query = (scope: CandidateKnowledgeRetrievalScopeInput, queryVector: Float32Array) =>
          storage.candidateKnowledgeVectorIndex.queryCandidateKnowledgeVectors({
            scope,
            identity,
            queryVector,
            limit: 10,
          });
        const hits = await query(fullScope, east);
        expect(hits.map((hit) => hit.chunk.chunkId)).toEqual(["a1-0", "b1-0", "a1-1", "a2-0"]);
        expect(hits[0]?.score).toBeCloseTo(1, 6);
        expect(hits[0]?.chunk).toMatchObject({
          text: "evidence a1-0",
          metadata: { provenance: { sourceId: "source-a", versionId: "version-a1" } },
        });
        const onlyA1 = await query(scopeA1, north);
        expect(onlyA1.map((hit) => hit.chunk.chunkId)).toEqual(["a1-1", "a1-0"]);
      },
    },
    {
      name: "vector index: a new identity clears old vectors, a re-upsert replaces one",
      check: async (storage) => {
        await seed(storage);
        await upsert(storage, allVectors);
        await expect(
          upsert(storage, [{ chunkId: "a1-0", vector: north }], { ...identity, revision: "rev-2" }),
        ).resolves.toMatchObject({ status: "stale", vectorCount: 1 });
        await upsert(storage, allVectors);
        await upsert(storage, [{ chunkId: "a1-0", vector: north }]);
        const hits = await storage.candidateKnowledgeVectorIndex.queryCandidateKnowledgeVectors({
          scope: fullScope,
          identity,
          queryVector: north,
          limit: 2,
        });
        expect(hits.map((hit) => hit.chunk.chunkId)).toEqual(["a1-0", "a2-0"]);
      },
    },
    {
      name: "vector index: a lexical rebuild or an index deletion drops the vectors",
      check: async (storage) => {
        await seed(storage);
        await upsert(storage, allVectors);
        await rebuild(storage, fullScope, [chunk(ckb, "source-a", "version-a1", "a1-0", 0)]);
        await expect(
          storage.candidateKnowledgeVectorIndex.inspectCandidateKnowledgeVectorIndex(
            fullScope,
            identity,
          ),
        ).resolves.toMatchObject({ status: "not-indexed" });
        await upsert(storage, [{ chunkId: "a1-0", vector: east }]);
        await storage.candidateKnowledgeVectorIndex.deleteCandidateKnowledgeVectorIndex({
          storeId,
          knowledgeBaseId: ckb,
        });
        await expect(
          storage.candidateKnowledgeVectorIndex.queryCandidateKnowledgeVectors({
            scope: fullScope,
            identity,
            queryVector: east,
            limit: 1,
          }),
        ).rejects.toBeInstanceOf(CandidateKnowledgeVectorIndexUnavailableError);
      },
    },
    {
      name: "vector index: refuses vectors without their lexical chunks or of the wrong shape",
      check: async (storage) => {
        await storage.ensureDefaultCandidateKnowledgeBase({
          id: ckb,
          displayName: "Career evidence",
          createdAt,
        });
        await expect(upsert(storage, [{ chunkId: "a1-0", vector: east }])).rejects.toBeInstanceOf(
          StorageConflictError,
        );
        await storage.createCandidateKnowledgeSource(
          { id: "source-a", knowledgeBaseId: ckb, kind: "file", displayName: "E", createdAt },
          {
            id: "version-a1",
            mediaType: "text/plain",
            checksum: "a".repeat(64),
            sizeBytes: 1,
            createdAt,
          },
        );
        await rebuild(storage, scopeA1, [chunk(ckb, "source-a", "version-a1", "a1-0", 0)]);
        await expect(
          upsert(storage, [{ chunkId: "missing", vector: east }]),
        ).rejects.toBeInstanceOf(StorageValidationError);
        await expect(
          upsert(storage, [{ chunkId: "a1-0", vector: new Float32Array([1, 1, 0, 0]) }]),
        ).rejects.toBeInstanceOf(StorageValidationError);
      },
    },
  ];

/** Runs every vector-index contract against fresh stores from `open`, one test per contract. */
export function describeCandidateKnowledgeVectorConformance(
  implementation: string,
  open: CandidateKnowledgeVectorsStorageFactory,
): void {
  describe(`${implementation} storage conformance: candidate-knowledge vectors`, () => {
    for (const contract of candidateKnowledgeVectorContracts) {
      it(contract.name, async () => {
        const opened = await open();
        try {
          await contract.check(opened.storage);
        } finally {
          await opened.close();
        }
      });
    }
  });
}
