import { describe, expect, it } from "vitest";
import { computeCandidateKnowledgeLexicalManifestChecksum } from "../index.js";
import type {
  CandidateKnowledgeBaseInput,
  CandidateKnowledgeBaseStoragePort,
  CandidateKnowledgeSourceInput,
  CandidateKnowledgeSourceVersionInput,
} from "../ports/candidate-knowledge.js";
import type { CandidateKnowledgeLexicalStoragePort } from "../ports/retrieval.js";
import type { WorkspaceRecord, WorkspaceStoragePort } from "../ports/workspace.js";
import { StorageConflictError, StorageValidationError } from "../storage-errors.js";
import type { StorageContract } from "./history-records.js";

/** The port surface of knowledge bases, their sources and the sources' versions. */
export type CandidateKnowledgeBaseStorage = WorkspaceStoragePort &
  Pick<
    CandidateKnowledgeBaseStoragePort,
    | "ensureDefaultCandidateKnowledgeBase"
    | "createCandidateKnowledgeBase"
    | "getCandidateKnowledgeBase"
    | "listCandidateKnowledgeBases"
    | "createCandidateKnowledgeSource"
    | "appendCandidateKnowledgeSourceVersion"
    | "getCandidateKnowledgeSource"
    | "listCandidateKnowledgeSources"
    | "listCandidateKnowledgeSourceVersions"
  >;

/** The port surface retrieval reads: knowledge bases, source versions, the lexical index and traces. */
export type CandidateKnowledgeRetrievalStorage = CandidateKnowledgeBaseStorage &
  CandidateKnowledgeLexicalStoragePort;

export interface OpenedCandidateKnowledgeRetrievalStorage<
  Storage = CandidateKnowledgeRetrievalStorage,
> {
  readonly storage: Storage;
  readonly close: () => Promise<void>;
}

export type CandidateKnowledgeRetrievalStorageFactory<
  Storage = CandidateKnowledgeRetrievalStorage,
> = () => Promise<OpenedCandidateKnowledgeRetrievalStorage<Storage>>;

const workspace: WorkspaceRecord = {
  id: "conformance-workspace",
  state: "collecting",
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

const knowledgeBase = (id: string, isDefault: boolean): CandidateKnowledgeBaseInput => ({
  id,
  displayName: `Knowledge ${id}`,
  description: "Sanitized test knowledge",
  isDefault,
  createdAt: "2026-08-13T09:00:00.000Z",
});

const knowledgeSource = (id: string, knowledgeBaseId: string): CandidateKnowledgeSourceInput => ({
  id,
  knowledgeBaseId,
  kind: "file",
  displayName: `${id}.md`,
  createdAt: "2026-08-13T09:01:00.000Z",
});

const sourceVersion = (
  id: string,
  checksum: string,
  createdAt = "2026-08-13T09:02:00.000Z",
): CandidateKnowledgeSourceVersionInput => ({
  id,
  mediaType: "text/markdown",
  checksum,
  sizeBytes: 128,
  createdAt,
});

const reference = (knowledgeBaseId: string, sourceId: string, versionId: string) => ({
  storeId: `store-${knowledgeBaseId}`,
  knowledgeBaseId,
  sourceId,
  versionId,
});

const lexicalChunk = (
  chunkId: string,
  provenance: ReturnType<typeof reference>,
  text: string,
  ordinal = 0,
) => ({
  chunkId,
  ordinal,
  lineStart: ordinal + 1,
  lineEnd: ordinal + 1,
  text,
  metadata: { section: "Experience", technology: "TypeScript", provenance },
});

/** Two knowledge bases: `ckb-a` with two sources and `ckb-b` with one. */
async function seedKnowledge(storage: CandidateKnowledgeBaseStorage) {
  await storage.saveWorkspace(workspace);
  await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase("ckb-a", true));
  const a1 = await storage.createCandidateKnowledgeSource(
    knowledgeSource("source-a1", "ckb-a"),
    sourceVersion("version-a1", "d".repeat(64)),
  );
  const a2 = await storage.createCandidateKnowledgeSource(
    knowledgeSource("source-a2", "ckb-a"),
    sourceVersion("version-a2", "e".repeat(64)),
  );
  await storage.createCandidateKnowledgeBase(knowledgeBase("ckb-b", false));
  const b1 = await storage.createCandidateKnowledgeSource(
    knowledgeSource("source-b1", "ckb-b"),
    sourceVersion("version-b1", "f".repeat(64)),
  );
  const refA1 = reference("ckb-a", a1.source.id, a1.version.id);
  const refA2 = reference("ckb-a", a2.source.id, a2.version.id);
  const refB1 = reference("ckb-b", b1.source.id, b1.version.id);
  return { refA1, refA2, refB1, scopeA: { sources: [refA1, refA2] }, scopeB: { sources: [refB1] } };
}

const lexicalIndex = (
  scope: Parameters<typeof computeCandidateKnowledgeLexicalManifestChecksum>[0],
) => ({
  indexerId: "fts5-v1",
  manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scope),
});

/** Seeds the knowledge and indexes both knowledge bases. */
async function seedIndexedKnowledge(storage: CandidateKnowledgeRetrievalStorage) {
  const seeded = await seedKnowledge(storage);
  await storage.rebuildCandidateKnowledgeLexicalIndex({
    scope: seeded.scopeA,
    index: lexicalIndex(seeded.scopeA),
    createdAt: "2026-08-13T09:10:00.000Z",
    chunks: [
      lexicalChunk("chunk-a1-1", seeded.refA1, "Led platform operations", 1),
      lexicalChunk("chunk-a1-0", seeded.refA1, "Built TypeScript services", 0),
      lexicalChunk("chunk-a2-0", seeded.refA2, "Designed Python automation", 0),
    ],
  });
  await storage.rebuildCandidateKnowledgeLexicalIndex({
    scope: seeded.scopeB,
    index: lexicalIndex(seeded.scopeB),
    createdAt: "2026-08-13T09:11:00.000Z",
    chunks: [lexicalChunk("chunk-b1-0", seeded.refB1, "Private Python automation", 0)],
  });
  return seeded;
}

const knowledgeBaseContracts: readonly StorageContract<CandidateKnowledgeBaseStorage>[] = [
  {
    name: "knowledge bases: read back what was created, with one default",
    check: async (storage) => {
      await seedKnowledge(storage);
      await expect(storage.getCandidateKnowledgeBase("ckb-a")).resolves.toMatchObject({
        id: "ckb-a",
        isDefault: true,
        state: "active",
        archivedAt: null,
      });
      await expect(storage.getCandidateKnowledgeBase("ckb-missing")).resolves.toBeUndefined();
      const listed = await storage.listCandidateKnowledgeBases();
      expect(listed.map((base) => base.id).sort()).toEqual(["ckb-a", "ckb-b"]);
      expect(listed.filter((base) => base.isDefault).map((base) => base.id)).toEqual(["ckb-a"]);
    },
  },
  {
    name: "knowledge bases: list each base's own sources",
    check: async (storage) => {
      await seedKnowledge(storage);
      const sources = await storage.listCandidateKnowledgeSources("ckb-a");
      expect(sources.map((source) => source.id).sort()).toEqual(["source-a1", "source-a2"]);
      await expect(
        storage.getCandidateKnowledgeSource("ckb-a", "source-a1"),
      ).resolves.toMatchObject({ id: "source-a1", knowledgeBaseId: "ckb-a", kind: "file" });
      await expect(
        storage.getCandidateKnowledgeSource("ckb-b", "source-a1"),
      ).resolves.toBeUndefined();
    },
  },
  {
    name: "source versions: append in order with their parent",
    check: async (storage) => {
      await seedKnowledge(storage);
      const second = await storage.appendCandidateKnowledgeSourceVersion(
        "ckb-a",
        "source-a1",
        sourceVersion("version-a1-2", "c".repeat(64), "2026-08-13T09:03:00.000Z"),
      );
      expect(second).toMatchObject({
        created: true,
        version: {
          id: "version-a1-2",
          sourceId: "source-a1",
          version: 2,
          parentVersionId: "version-a1",
        },
      });
      const versions = await storage.listCandidateKnowledgeSourceVersions("ckb-a", "source-a1");
      expect(
        versions.map((version) => [version.id, version.version, version.parentVersionId]),
      ).toEqual([
        ["version-a1", 1, null],
        ["version-a1-2", 2, "version-a1"],
      ]);
      await expect(
        storage.appendCandidateKnowledgeSourceVersion(
          "ckb-a",
          "source-a1",
          sourceVersion("version-a1-2", "c".repeat(64), "2026-08-13T09:03:00.000Z"),
        ),
      ).resolves.toMatchObject({ created: false, version: { id: "version-a1-2", version: 2 } });
      await expect(
        storage.listCandidateKnowledgeSourceVersions("ckb-a", "source-a1"),
      ).resolves.toHaveLength(2);
    },
  },
];

const lexicalContracts: readonly StorageContract<CandidateKnowledgeRetrievalStorage>[] = [
  {
    name: "lexical index: a rebuilt scope reports matched and answers its query",
    check: async (storage) => {
      const { scopeA } = await seedIndexedKnowledge(storage);
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
        hits: [{ chunkId: "chunk-a1-0" }],
        selectedSourceCount: 1,
      });
    },
  },
  {
    name: "lexical index: a query sees only its own knowledge base",
    check: async (storage) => {
      const { scopeA, scopeB } = await seedIndexedKnowledge(storage);
      const fromA = await storage.queryCandidateKnowledge({
        purpose: "critic-review",
        query: "Python automation",
        scope: scopeA,
      });
      expect(fromA.hits.map((hit) => hit.chunkId)).toEqual(["chunk-a2-0"]);
      const fromB = await storage.queryCandidateKnowledge({
        purpose: "critic-review",
        query: "Python automation",
        scope: scopeB,
      });
      expect(fromB.hits.map((hit) => hit.chunkId)).toEqual(["chunk-b1-0"]);
    },
  },
  {
    name: "lexical index: a query without terms or matches says so",
    check: async (storage) => {
      const { scopeA } = await seedIndexedKnowledge(storage);
      await expect(
        storage.queryCandidateKnowledge({
          purpose: "factual-checks",
          query: "the and we",
          scope: scopeA,
        }),
      ).resolves.toMatchObject({ status: "no-query", hits: [] });
      await expect(
        storage.queryCandidateKnowledge({
          purpose: "achievement-recall",
          query: "quantum chemistry",
          scope: scopeA,
          limit: 1,
        }),
      ).resolves.toMatchObject({ status: "bounded-fallback", hits: [{ chunkId: "chunk-a1-0" }] });
    },
  },
  {
    name: "lexical index: an upsert replaces a chunk's text",
    check: async (storage) => {
      const { scopeA, refA1 } = await seedIndexedKnowledge(storage);
      await storage.upsertCandidateKnowledgeLexicalChunks({
        scope: scopeA,
        index: lexicalIndex(scopeA),
        chunks: [lexicalChunk("chunk-a1-0", refA1, "Built Rust services", 0)],
      });
      await expect(
        storage.queryCandidateKnowledge({
          purpose: "factual-checks",
          query: "Rust",
          scope: scopeA,
        }),
      ).resolves.toMatchObject({ status: "matched", hits: [{ chunkId: "chunk-a1-0" }] });
      const typescript = await storage.queryCandidateKnowledge({
        purpose: "factual-checks",
        query: "TypeScript",
        scope: scopeA,
      });
      expect(typescript.status).not.toBe("matched");
    },
  },
  {
    name: "lexical index: deleting a source version unindexes its scope only",
    check: async (storage) => {
      const { scopeA, scopeB, refA1 } = await seedIndexedKnowledge(storage);
      await storage.deleteCandidateKnowledgeLexicalSourceVersion(refA1);
      await expect(storage.inspectCandidateKnowledgeLexicalIndex(scopeA)).resolves.toMatchObject({
        status: "not-indexed",
        indexedChunkCount: 0,
      });
      await expect(
        storage.queryCandidateKnowledge({
          purpose: "critic-review",
          query: "TypeScript",
          scope: scopeA,
        }),
      ).resolves.toMatchObject({ status: "not-indexed", hits: [] });
      await expect(storage.inspectCandidateKnowledgeLexicalIndex(scopeB)).resolves.toMatchObject({
        status: "matched",
        indexedChunkCount: 1,
      });
    },
  },
  {
    name: "lexical index: a different scope over an indexed base is stale",
    check: async (storage) => {
      const { refA1 } = await seedIndexedKnowledge(storage);
      const narrower = { sources: [refA1] };
      await expect(storage.inspectCandidateKnowledgeLexicalIndex(narrower)).resolves.toMatchObject({
        status: "stale",
      });
      await expect(
        storage.queryCandidateKnowledge({
          purpose: "opportunity-requirements",
          query: "TypeScript",
          scope: narrower,
        }),
      ).resolves.toMatchObject({ status: "stale", hits: [] });
    },
  },
  {
    name: "lexical index: a rebuild needs a manifest bound to its scope",
    check: async (storage) => {
      const { scopeA, refA1 } = await seedKnowledge(storage);
      await expect(
        storage.rebuildCandidateKnowledgeLexicalIndex({
          scope: scopeA,
          index: { ...lexicalIndex(scopeA), manifestChecksum: "a".repeat(64) },
          createdAt: "2026-08-13T09:10:00.000Z",
          chunks: [lexicalChunk("chunk-a1-0", refA1, "TypeScript")],
        }),
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(storage.inspectCandidateKnowledgeLexicalIndex(scopeA)).resolves.toMatchObject({
        status: "not-indexed",
      });
    },
  },
];

const traceContracts: readonly StorageContract<CandidateKnowledgeRetrievalStorage>[] = [
  {
    name: "retrieval traces: are immutable and listed by operation",
    check: async (storage) => {
      const { scopeA } = await seedKnowledge(storage);
      const trace = {
        schemaVersion: 1 as const,
        id: "trace-1",
        workspaceId: workspace.id,
        operationId: "operation-1",
        purpose: "critic-review" as const,
        queryChecksum: "a".repeat(64),
        scope: scopeA,
        index: { schemaVersion: 1 as const, ...lexicalIndex(scopeA) },
        status: "matched" as const,
        indexedChunkCount: 3,
        selectedChunkCount: 1,
        selectedSourceCount: 1,
        latencyMs: 12,
        selectedChunks: [{ chunkId: "chunk-a1-0", bm25Rank: -1.5 }],
        createdAt: "2026-08-13T10:00:00.000Z",
      };
      const other = { ...trace, id: "trace-2", operationId: "operation-2" };
      await expect(storage.appendCandidateKnowledgeRetrievalTrace(trace)).resolves.toEqual(trace);
      await storage.appendCandidateKnowledgeRetrievalTrace(other);
      await expect(storage.appendCandidateKnowledgeRetrievalTrace(trace)).resolves.toEqual(trace);
      await expect(
        storage.appendCandidateKnowledgeRetrievalTrace({ ...trace, queryChecksum: "b".repeat(64) }),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(
        storage.getCandidateKnowledgeRetrievalTrace(workspace.id, "trace-1"),
      ).resolves.toEqual(trace);
      await expect(
        storage.getCandidateKnowledgeRetrievalTrace("workspace-other", "trace-1"),
      ).resolves.toBeUndefined();
      await expect(
        storage.listCandidateKnowledgeRetrievalTraces(workspace.id, { operationId: "operation-1" }),
      ).resolves.toEqual([trace]);
      await expect(
        storage.listCandidateKnowledgeRetrievalTraces(workspace.id),
      ).resolves.toHaveLength(2);
    },
  },
  {
    name: "retrieval traces: refuse raw query text",
    check: async (storage) => {
      const { scopeA } = await seedKnowledge(storage);
      await expect(
        storage.appendCandidateKnowledgeRetrievalTrace({
          schemaVersion: 1,
          id: "trace-raw",
          workspaceId: workspace.id,
          operationId: "operation-1",
          purpose: "critic-review",
          queryChecksum: "a".repeat(64),
          scope: scopeA,
          index: { schemaVersion: 1, ...lexicalIndex(scopeA) },
          status: "matched",
          indexedChunkCount: 3,
          selectedChunkCount: 0,
          selectedSourceCount: 0,
          latencyMs: 1,
          selectedChunks: [],
          createdAt: "2026-08-13T10:00:00.000Z",
          query: "raw query",
        } as never),
      ).rejects.toBeInstanceOf(StorageValidationError);
    },
  },
];

/** Every candidate-knowledge retrieval contract, in a stable order. */
export const candidateKnowledgeRetrievalContracts: readonly StorageContract<CandidateKnowledgeRetrievalStorage>[] =
  [...knowledgeBaseContracts, ...lexicalContracts, ...traceContracts];

function describeContracts<Storage>(
  title: string,
  contracts: readonly StorageContract<Storage>[],
  open: CandidateKnowledgeRetrievalStorageFactory<Storage>,
): void {
  describe(title, () => {
    for (const contract of contracts) {
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

/** Runs every retrieval contract against fresh stores from `open`, one test per contract. */
export function describeCandidateKnowledgeRetrievalConformance(
  implementation: string,
  open: CandidateKnowledgeRetrievalStorageFactory,
): void {
  describeContracts(
    `${implementation} storage conformance: candidate-knowledge retrieval`,
    candidateKnowledgeRetrievalContracts,
    open,
  );
}

/**
 * Runs only the knowledge-base contracts, for an implementation that stores knowledge bases and
 * source versions before it has a lexical index. A complete one runs the retrieval suite instead.
 */
export function describeCandidateKnowledgeBaseConformance(
  implementation: string,
  open: CandidateKnowledgeRetrievalStorageFactory<CandidateKnowledgeBaseStorage>,
): void {
  describeContracts(
    `${implementation} storage conformance: candidate knowledge bases`,
    knowledgeBaseContracts,
    open,
  );
}
