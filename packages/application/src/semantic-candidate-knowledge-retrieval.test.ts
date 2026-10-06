import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateKnowledgeRetrievalScopeInput } from "@draft-loop/domain";
import {
  EmbeddingModelUnavailableError,
  type EmbeddingRole,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import { ingestBytes } from "@draft-loop/ingestion";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import { afterEach, describe, expect, it } from "vitest";
import { synchronizeCandidateKnowledgeLexicalSelection } from "./candidate-knowledge-lexical-sync.js";
import type { EmbeddingModelState } from "./embedding-model-install.js";
import {
  createCandidateKnowledgeStoreService,
  type KnowledgeSelectionSnapshot,
} from "./knowledge-base.js";
import {
  embeddingStorageIdentity,
  openLocalTextEmbedder,
  querySemanticCandidateKnowledge,
  type SemanticPreparedSelection,
  synchronizeCandidateKnowledgeVectors,
} from "./semantic-candidate-knowledge-retrieval.js";

const createdAt = "2026-08-30T09:00:00.000Z";
const vocabulary = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "xray",
  "yankee",
  "typescript",
  "kubernetes",
  "platform",
];

interface FakeEmbedder extends TextEmbedder {
  readonly calls: { readonly role: EmbeddingRole; readonly texts: readonly string[] }[];
  documentCount: () => number;
  failNext: Error | undefined;
  onDocumentBatch: ((batchNumber: number) => void) | undefined;
}

/** Keyword bag-of-words unit vectors; `rewriteQuery` lets a test steer the query direction. */
function createFakeEmbedder(
  options: { rewriteQuery?: (query: string) => string } = {},
): FakeEmbedder {
  const calls: { role: EmbeddingRole; texts: readonly string[] }[] = [];
  let documentBatches = 0;
  const embedder: FakeEmbedder = {
    identity: {
      modelId: "fake-keyword-embedder",
      sourceRepository: "example/fake",
      revision: "rev-1",
      modelFileSha256: "a".repeat(64),
      dimensions: vocabulary.length + 1,
      pooling: "cls",
      runtime: "fake-runtime",
    },
    calls,
    failNext: undefined,
    onDocumentBatch: undefined,
    documentCount: () =>
      calls
        .filter((call) => call.role === "document")
        .reduce((sum, call) => sum + call.texts.length, 0),
    embed: async (texts, role) => {
      if (embedder.failNext !== undefined) {
        const error = embedder.failNext;
        embedder.failNext = undefined;
        throw error;
      }
      calls.push({ role, texts });
      if (role === "document") {
        documentBatches += 1;
        embedder.onDocumentBatch?.(documentBatches);
      }
      return texts.map((text) => {
        const words = (role === "query" ? (options.rewriteQuery?.(text) ?? text) : text)
          .toLowerCase()
          .split(/[^a-z]+/u);
        const vector = new Float32Array(vocabulary.length + 1);
        for (const word of words) {
          const axis = vocabulary.indexOf(word);
          if (axis >= 0) vector[axis] = (vector[axis] as number) + 1;
        }
        vector[vocabulary.length] = 0.01;
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        return vector.map((value) => value / norm);
      });
    },
    dispose: async () => undefined,
  };
  return embedder;
}

function scopeForEntry(
  entry: KnowledgeSelectionSnapshot["entries"][number],
): CandidateKnowledgeRetrievalScopeInput {
  const key = (reference: {
    storeId: string;
    knowledgeBaseId: string;
    sourceId: string;
    versionId: string;
  }) =>
    JSON.stringify([
      reference.storeId,
      reference.knowledgeBaseId,
      reference.sourceId,
      reference.versionId,
    ]);
  const sources = entry.sources
    .map((source) => ({
      storeId: entry.storeId,
      knowledgeBaseId: entry.knowledgeBaseId,
      sourceId: source.sourceId,
      versionId: source.versionId,
    }))
    .sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));
  return { sources };
}

describe("semantic candidate knowledge retrieval", () => {
  const temporaryRoots: string[] = [];
  const handles: CandidateKnowledgeStoreHandle[] = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  async function createFixture(initialTexts: readonly string[]) {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-application-semantic-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const queuedIds = ["store-a", "ckb-a"];
    let generated = 0;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => {
        generated += 1;
        return queuedIds.shift() ?? `generated-${generated}`;
      },
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    let fileCount = 0;
    const writeSource = async (text: string): Promise<string> => {
      fileCount += 1;
      const path = join(parent, `source-${fileCount}.md`);
      await writeFile(path, text, "utf8");
      return path;
    };
    for (const text of initialTexts) {
      await service.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId: "ckb-a",
        sourcePath: await writeSource(text),
      });
    }
    const handle = await openCandidateKnowledgeStore(storeRoot);
    handles.push(handle);
    const prepare = async (
      knowledgeBaseId = "ckb-a",
    ): Promise<Awaited<ReturnType<typeof synchronizeCandidateKnowledgeLexicalSelection>>> => {
      const selection = { storeRoot, knowledgeBaseId };
      const snapshot = await service.createKnowledgeSelectionSnapshot({ selections: [selection] });
      return synchronizeCandidateKnowledgeLexicalSelection({
        handle,
        selection,
        snapshot,
        scopeForEntry,
        ingestBytes,
        createdAt,
        reuseCurrent: true,
        indexFailure: () => new Error("lexical index failure"),
        selectionChangedFailure: () => new Error("selection changed"),
      });
    };
    const sync = (
      prepared: SemanticPreparedSelection,
      embedder: TextEmbedder,
      extra: { signal?: AbortSignal; batchSize?: number } = {},
    ) => synchronizeCandidateKnowledgeVectors({ handle, prepared, embedder, createdAt, ...extra });
    const inspect = (prepared: SemanticPreparedSelection, embedder: TextEmbedder) =>
      handle.inspectCandidateKnowledgeVectorIndex(
        prepared.scope,
        embeddingStorageIdentity(embedder),
      );
    return { service, storeRoot, handle, writeSource, queuedIds, prepare, sync, inspect };
  }

  const baseTexts = [
    "alpha alpha alpha xray",
    "alpha beta gamma delta yankee",
    "kubernetes platform delivery",
  ];

  it("embeds everything once, then reuses the matched index without embedding", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();

    const progress: { embedded: number; total: number }[] = [];
    const first = await synchronizeCandidateKnowledgeVectors({
      handle: fixture.handle,
      prepared,
      embedder,
      createdAt,
      batchSize: 2,
      onProgress: (event) => progress.push(event),
    });
    expect(first).toEqual({ ok: true, status: "matched", embeddedChunkCount: 3 });
    expect(embedder.documentCount()).toBe(3);
    expect(progress).toEqual([
      { embedded: 2, total: 3 },
      { embedded: 3, total: 3 },
    ]);

    const second = await fixture.sync(prepared, embedder);
    expect(second).toEqual({ ok: true, status: "matched", embeddedChunkCount: 0 });
    expect(embedder.documentCount()).toBe(3);
    expect((await fixture.inspect(prepared, embedder)).status).toBe("matched");
  });

  it("keeps vectors across an unchanged lexical query and re-embeds after a source is added", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);

    const result = await fixture.service.queryCandidateKnowledge({
      selections: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: "ckb-a" }],
      purpose: "achievement-recall",
      query: "alpha",
      limit: 3,
    });
    expect(result.status).toBe("matched");
    expect((await fixture.inspect(prepared, embedder)).status).toBe("matched");
    expect((await fixture.prepare()).rebuilt).toBeUndefined();
    expect((await fixture.sync(prepared, embedder)).ok).toBe(true);
    expect(embedder.documentCount()).toBe(3);

    await fixture.service.importKnowledgeSourceFile({
      storeRoot: fixture.storeRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath: await fixture.writeSource("typescript systems design"),
    });
    const rebuilt = await fixture.prepare();
    expect(rebuilt.rebuilt).toBeDefined();
    expect((await fixture.inspect(rebuilt, embedder)).status).toBe("not-indexed");

    const resynced = await fixture.sync(rebuilt, embedder);
    expect(resynced).toEqual({ ok: true, status: "matched", embeddedChunkCount: 4 });
    expect(embedder.documentCount()).toBe(7);
  });

  it("re-embeds a source whose version was appended", async () => {
    const fixture = await createFixture(["alpha beta"]);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);
    const [source] = prepared.entry.sources;
    const path = await fixture.writeSource("gamma delta");
    await fixture.service.appendKnowledgeSourceFileVersion({
      storeRoot: fixture.storeRoot,
      knowledgeBaseId: "ckb-a",
      sourceId: source?.sourceId ?? "",
      sourcePath: path,
    });

    const rebuilt = await fixture.prepare();
    expect(rebuilt.entry.sources[0]?.versionId).not.toBe(source?.versionId);
    expect((await fixture.inspect(rebuilt, embedder)).status).toBe("not-indexed");
    expect(await fixture.sync(rebuilt, embedder)).toEqual({
      ok: true,
      status: "matched",
      embeddedChunkCount: 1,
    });
  });

  it("rethrows the abort reason on cancellation and leaves no matched index", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    const controller = new AbortController();
    const reason = new Error("stop requested");
    embedder.onDocumentBatch = (batch) => {
      if (batch === 1) controller.abort(reason);
    };

    await expect(
      fixture.sync(prepared, embedder, { signal: controller.signal, batchSize: 1 }),
    ).rejects.toBe(reason);
    expect(embedder.documentCount()).toBe(1);
    expect((await fixture.inspect(prepared, embedder)).status).not.toBe("matched");

    embedder.onDocumentBatch = undefined;
    expect(await fixture.sync(prepared, embedder, { batchSize: 1 })).toMatchObject({
      ok: true,
      embeddedChunkCount: 3,
    });
    await expect(
      fixture.sync(prepared, embedder, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });

  it("orders semantic hits by vector score", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);

    const result = await querySemanticCandidateKnowledge({
      handle: fixture.handle,
      prepared,
      embedder,
      mode: "semantic",
      purpose: "achievement-recall",
      query: "kubernetes platform",
      limit: 3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(embedder.calls.filter((call) => call.role === "query")).toHaveLength(1);
    expect(result.hits.map((hit) => hit.chunk.text)).toEqual([
      "kubernetes platform delivery",
      expect.any(String),
      expect.any(String),
    ]);
    expect(result.hits.map((hit) => hit.fusedRank)).toEqual([1, 2, 3]);
    expect(result.hits.map((hit) => hit.vectorRank)).toEqual([1, 2, 3]);
    expect(result.hits.every((hit) => hit.bm25Rank === null)).toBe(true);
    const scores = result.hits.map((hit) => hit.vectorScore as number);
    expect([...scores].sort((left, right) => right - left)).toEqual(scores);
    expect(scores[0]).toBeGreaterThan(0.9);
  });

  it("fuses hybrid hits with RRF, keeps both ranks and breaks ties by chunk id", async () => {
    const fixture = await createFixture(baseTexts);
    // Lexical "alpha" prefers the short, repetitive chunk; the vector query prefers the other.
    const embedder = createFakeEmbedder({ rewriteQuery: () => "yankee xray" });
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);
    const request = {
      handle: fixture.handle,
      prepared,
      embedder,
      purpose: "achievement-recall" as const,
      query: "alpha",
      limit: 3,
    };

    const semantic = await querySemanticCandidateKnowledge({ ...request, mode: "semantic" });
    const hybrid = await querySemanticCandidateKnowledge({ ...request, mode: "hybrid" });
    const again = await querySemanticCandidateKnowledge({ ...request, mode: "hybrid" });

    expect(semantic.ok && hybrid.ok).toBe(true);
    if (!semantic.ok || !hybrid.ok || !again.ok) return;
    expect(again).toEqual(hybrid);
    const byText = (hits: typeof hybrid.hits, text: string) =>
      hits.find((hit) => hit.chunk.text === text);
    const repetitive = byText(hybrid.hits, "alpha alpha alpha xray");
    const mixed = byText(hybrid.hits, "alpha beta gamma delta yankee");
    const unrelated = byText(hybrid.hits, "kubernetes platform delivery");
    expect(mixed?.vectorRank).toBe(1);
    expect(mixed?.bm25Rank).toBe(2);
    expect(repetitive?.vectorRank).toBe(2);
    expect(repetitive?.bm25Rank).toBe(1);
    expect(unrelated?.bm25Rank).toBeNull();
    expect(unrelated?.vectorRank).toBe(3);
    expect(unrelated?.vectorScore).not.toBeNull();
    // Swapped ranks give exactly equal RRF scores, so the lower chunk id comes first.
    const tied = [repetitive, mixed].map((hit) => hit?.chunk.chunkId ?? "").sort();
    expect(hybrid.hits.slice(0, 2).map((hit) => hit.chunk.chunkId)).toEqual(tied);
    expect(hybrid.hits[2]).toBe(unrelated);
    expect(hybrid.hits.map((hit) => hit.fusedRank)).toEqual([1, 2, 3]);

    const truncated = await querySemanticCandidateKnowledge({
      ...request,
      limit: 1,
      mode: "hybrid",
    });
    expect(truncated.ok && truncated.hits.map((hit) => hit.chunk.chunkId)).toEqual([tied[0]]);
  });

  it("applies no floor to an embedder without a calibrated floor and reports it", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);

    const result = await querySemanticCandidateKnowledge({
      handle: fixture.handle,
      prepared,
      embedder,
      mode: "semantic",
      purpose: "achievement-recall",
      query: "kubernetes platform",
      limit: 3,
    });

    expect(result.ok && result.relevanceFloor).toBeNull();
    expect(result.ok && result.hits).toHaveLength(3);
  });

  it("returns fewer than the limit in semantic mode when hits fall under the floor", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);
    const relevanceFloor = { maxMarginFromTop: 0.5, minimumScore: 0.5 };

    const result = await querySemanticCandidateKnowledge({
      handle: fixture.handle,
      prepared,
      embedder,
      mode: "semantic",
      purpose: "achievement-recall",
      query: "kubernetes platform",
      limit: 3,
      relevanceFloor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relevanceFloor).toEqual(relevanceFloor);
    expect(result.hits.map((hit) => hit.chunk.text)).toEqual(["kubernetes platform delivery"]);
    expect(result.hits.map((hit) => hit.vectorRank)).toEqual([1]);
    expect(result.hits.map((hit) => hit.fusedRank)).toEqual([1]);

    const nothing = await querySemanticCandidateKnowledge({
      handle: fixture.handle,
      prepared,
      embedder,
      mode: "semantic",
      purpose: "achievement-recall",
      query: "kubernetes platform",
      limit: 3,
      relevanceFloor: { maxMarginFromTop: 1, minimumScore: 1.5 },
    });
    expect(nothing.ok && nothing.hits).toEqual([]);
  });

  it("keeps lexical hits in hybrid mode and admits semantic-only hits only above the floor", async () => {
    const fixture = await createFixture(baseTexts);
    // Lexical "alpha" matches two chunks; the vector query "yankee xray" scores the mixed chunk
    // highest, the repetitive chunk lower and the unrelated chunk near zero.
    const embedder = createFakeEmbedder({ rewriteQuery: () => "yankee xray" });
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);
    const request = {
      handle: fixture.handle,
      prepared,
      embedder,
      mode: "hybrid" as const,
      purpose: "achievement-recall" as const,
      query: "alpha",
      limit: 3,
    };

    const floored = await querySemanticCandidateKnowledge({
      ...request,
      relevanceFloor: { maxMarginFromTop: 0.05, minimumScore: 0 },
    });

    expect(floored.ok).toBe(true);
    if (!floored.ok) return;
    const byText = (text: string) => floored.hits.find((hit) => hit.chunk.text === text);
    expect(floored.hits).toHaveLength(2);
    expect(byText("alpha beta gamma delta yankee")).toMatchObject({ vectorRank: 1, bm25Rank: 2 });
    // The repetitive chunk fell under the floor on the vector side but stays through BM25.
    expect(byText("alpha alpha alpha xray")).toMatchObject({
      vectorRank: null,
      vectorScore: null,
      bm25Rank: 1,
    });
    expect(byText("kubernetes platform delivery")).toBeUndefined();

    const unfloored = await querySemanticCandidateKnowledge(request);
    expect(unfloored.ok && unfloored.hits).toHaveLength(3);
  });

  it("scopes hits to the requested exact source versions", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    await fixture.sync(prepared, embedder);
    const [selected] = prepared.scope.sources;
    if (selected === undefined) throw new Error("expected a source");

    const result = await querySemanticCandidateKnowledge({
      handle: fixture.handle,
      prepared: { entry: prepared.entry, scope: { sources: [selected] } },
      embedder,
      mode: "hybrid",
      purpose: "achievement-recall",
      query: "alpha kubernetes",
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.chunk.metadata.provenance).toMatchObject({
      sourceId: selected.sourceId,
      versionId: selected.versionId,
    });
  });

  it("never returns another knowledge base's chunks", async () => {
    const fixture = await createFixture(baseTexts);
    fixture.queuedIds.push("ckb-b");
    await fixture.service.createKnowledgeBase({
      storeRoot: fixture.storeRoot,
      displayName: "Second",
    });
    await fixture.service.importKnowledgeSourceFile({
      storeRoot: fixture.storeRoot,
      knowledgeBaseId: "ckb-b",
      sourcePath: await fixture.writeSource("alpha alpha alpha other knowledge base"),
    });
    const embedder = createFakeEmbedder();
    const first = await fixture.prepare("ckb-a");
    const second = await fixture.prepare("ckb-b");
    expect(await fixture.sync(first, embedder)).toMatchObject({ ok: true, embeddedChunkCount: 3 });
    expect((await fixture.inspect(second, embedder)).status).toBe("not-indexed");
    expect(await fixture.sync(second, embedder)).toMatchObject({ ok: true, embeddedChunkCount: 1 });
    expect((await fixture.inspect(first, embedder)).status).toBe("matched");

    for (const mode of ["semantic", "hybrid"] as const) {
      const result = await querySemanticCandidateKnowledge({
        handle: fixture.handle,
        prepared: first,
        embedder,
        mode,
        purpose: "achievement-recall",
        query: "alpha",
        limit: 10,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.hits).toHaveLength(3);
      expect(
        result.hits.every((hit) => hit.chunk.metadata.provenance.knowledgeBaseId === "ckb-a"),
      ).toBe(true);
    }
  });

  it("reports index-stale when querying an index that is not matched", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();

    const request = {
      handle: fixture.handle,
      prepared,
      embedder,
      purpose: "achievement-recall" as const,
      query: "alpha",
      limit: 3,
    };
    expect(await querySemanticCandidateKnowledge({ ...request, mode: "semantic" })).toEqual({
      ok: false,
      reason: "index-stale",
    });
    expect(await querySemanticCandidateKnowledge({ ...request, mode: "hybrid" })).toEqual({
      ok: false,
      reason: "index-stale",
    });
  });

  it("reports index-stale when the lexical index was never built for a vector sync", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();
    const unbuilt = await createFixture(baseTexts);
    const snapshot = await unbuilt.service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot: unbuilt.storeRoot, knowledgeBaseId: "ckb-a" }],
    });
    const entry = snapshot.entries[0];
    if (entry === undefined) throw new Error("expected an entry");

    const result = await synchronizeCandidateKnowledgeVectors({
      handle: unbuilt.handle,
      prepared: { entry, scope: scopeForEntry(entry) },
      embedder,
      createdAt,
    });

    expect(result).toEqual({ ok: false, reason: "index-stale" });
    expect((await fixture.inspect(prepared, embedder)).status).toBe("not-indexed");
  });

  it("maps embedder failures to runtime-failed during sync and query", async () => {
    const fixture = await createFixture(baseTexts);
    const embedder = createFakeEmbedder();
    const prepared = await fixture.prepare();

    embedder.failNext = new Error("onnx exploded");
    expect(await fixture.sync(prepared, embedder)).toEqual({ ok: false, reason: "runtime-failed" });
    expect((await fixture.inspect(prepared, embedder)).status).not.toBe("matched");

    await fixture.sync(prepared, embedder);
    embedder.failNext = new Error("onnx exploded");
    expect(
      await querySemanticCandidateKnowledge({
        handle: fixture.handle,
        prepared,
        embedder,
        mode: "semantic",
        purpose: "achievement-recall",
        query: "alpha",
        limit: 3,
      }),
    ).toEqual({ ok: false, reason: "runtime-failed" });
  });

  describe("openLocalTextEmbedder", () => {
    const serviceWith = (state: EmbeddingModelState) => ({
      status: async () =>
        ({ state, modelDirectory: "/models/granite" }) as Awaited<
          ReturnType<import("./embedding-model-install.js").EmbeddingModelService["status"]>
        >,
    });

    it.each([
      ["absent", "model-absent"],
      ["installing", "model-absent"],
      ["corrupt", "model-corrupt"],
      ["unsupported-platform", "unsupported-platform"],
    ] as const)("maps a %s model to %s without creating an embedder", async (state, reason) => {
      let created = 0;
      const result = await openLocalTextEmbedder({
        modelRoot: "/models",
        service: serviceWith(state),
        createEmbedder: async () => {
          created += 1;
          return createFakeEmbedder();
        },
      });
      expect(result).toEqual({ ok: false, reason });
      expect(created).toBe(0);
    });

    it("opens a ready model through the injected factory", async () => {
      const embedder = createFakeEmbedder();
      const seen: string[] = [];
      const result = await openLocalTextEmbedder({
        modelRoot: "/models",
        service: serviceWith("ready"),
        createEmbedder: async (options) => {
          seen.push(options.modelDirectory);
          return embedder;
        },
      });
      expect(result).toEqual({ ok: true, embedder });
      expect(seen).toEqual(["/models/granite"]);
    });

    it("maps a model-file problem to model-corrupt and anything else to runtime-failed", async () => {
      expect(
        await openLocalTextEmbedder({
          modelRoot: "/models",
          service: serviceWith("ready"),
          createEmbedder: async () => {
            throw new EmbeddingModelUnavailableError("size-mismatch", "model.onnx");
          },
        }),
      ).toEqual({ ok: false, reason: "model-corrupt" });
      expect(
        await openLocalTextEmbedder({
          modelRoot: "/models",
          service: serviceWith("ready"),
          createEmbedder: async () => {
            throw new Error("native runtime missing");
          },
        }),
      ).toEqual({ ok: false, reason: "runtime-failed" });
    });

    it("never throws when the status check itself fails", async () => {
      expect(
        await openLocalTextEmbedder({
          modelRoot: "/models",
          service: {
            status: async () => {
              throw new Error("disk error");
            },
          },
        }),
      ).toEqual({ ok: false, reason: "runtime-failed" });
    });
  });
});
