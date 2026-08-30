import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateKnowledgeRetrievalScopeInput } from "@draft-loop/domain";
import { afterEach, describe, expect, it } from "vitest";
import { computeCandidateKnowledgeLexicalManifestChecksum } from "./index.js";
import {
  initializeCandidateKnowledgeStore,
  openCandidateKnowledgeStore,
  restoreCandidateKnowledgePortableBackup,
} from "./knowledge-store.js";

const createdAt = "2026-08-29T09:00:00.000Z";
const storeId = "knowledge-store-1";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function initialization(root: string) {
  return {
    root,
    descriptor: { schemaVersion: 1 as const, id: storeId, createdAt },
    defaultKnowledgeBase: {
      id: "ckb-default",
      displayName: "Career evidence",
      description: "Sanitized test knowledge",
      createdAt,
    },
  };
}

function scope(
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
): CandidateKnowledgeRetrievalScopeInput {
  return {
    sources: [{ storeId, knowledgeBaseId, sourceId, versionId }],
  };
}

function chunk(
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
  chunkId: string,
  text: string,
) {
  return {
    chunkId,
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    text,
    metadata: {
      section: "evidence",
      provenance: { storeId, knowledgeBaseId, sourceId, versionId },
    },
  } as const;
}

async function createSource(
  store: Awaited<ReturnType<typeof initializeCandidateKnowledgeStore>>,
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
): Promise<void> {
  await store.createCandidateKnowledgeSource(
    {
      id: sourceId,
      knowledgeBaseId,
      kind: "file",
      displayName: "Sanitized evidence",
      createdAt,
    },
    {
      id: versionId,
      mediaType: "text/plain",
      checksum: "a".repeat(64),
      sizeBytes: 1,
      createdAt,
    },
  );
}

describe("candidate knowledge lexical lifecycle adapter", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("keeps exact source-version isolation while rebuilding and querying", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-storage-retrieval-"));
    temporaryRoots.push(parent);
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await createSource(store, "ckb-default", "source-a", "version-a");
    const firstScope = scope("ckb-default", "source-a", "version-a");

    await store.rebuildCandidateKnowledgeLexicalIndex({
      scope: firstScope,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(firstScope),
      },
      chunks: [chunk("ckb-default", "source-a", "version-a", "chunk-a", "TypeScript delivery")],
      createdAt,
    });
    await expect(store.inspectCandidateKnowledgeLexicalIndex(firstScope)).resolves.toMatchObject({
      status: "matched",
      indexedChunkCount: 1,
    });
    await expect(
      store.queryCandidateKnowledge({
        purpose: "achievement-recall",
        query: "TypeScript",
        scope: firstScope,
      }),
    ).resolves.toMatchObject({ status: "matched", selectedSourceCount: 1 });
    await expect(
      store.queryCandidateKnowledge({
        purpose: "achievement-recall",
        query: "unseen-term",
        scope: firstScope,
      }),
    ).resolves.toMatchObject({ status: "bounded-fallback", selectedChunkCount: 1 });
    await expect(
      store.queryCandidateKnowledge({
        purpose: "achievement-recall",
        query: "   ",
        scope: firstScope,
      }),
    ).resolves.toMatchObject({ status: "no-query", selectedChunkCount: 0 });

    await store.appendCandidateKnowledgeSourceVersion("ckb-default", "source-a", {
      id: "version-b",
      mediaType: "text/plain",
      checksum: "b".repeat(64),
      sizeBytes: 1,
      createdAt: "2026-08-29T09:01:00.000Z",
    });
    const secondScope = scope("ckb-default", "source-a", "version-b");
    await expect(store.inspectCandidateKnowledgeLexicalIndex(secondScope)).resolves.toMatchObject({
      status: "not-indexed",
    });
    await store.rebuildCandidateKnowledgeLexicalIndex({
      scope: secondScope,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(secondScope),
      },
      chunks: [chunk("ckb-default", "source-a", "version-b", "chunk-b", "Rust delivery")],
      createdAt,
    });
    await expect(store.inspectCandidateKnowledgeLexicalIndex(firstScope)).resolves.toMatchObject({
      status: "stale",
      indexedChunkCount: 1,
    });
    await expect(
      store.queryCandidateKnowledge({
        purpose: "factual-checks",
        query: "Rust",
        scope: secondScope,
      }),
    ).resolves.toMatchObject({ status: "matched", selectedChunkCount: 1 });

    await store.retireCandidateKnowledgeSource("ckb-default", "source-a", {
      retiredAt: "2026-08-29T09:02:00.000Z",
      reason: "user-requested",
    });
    await expect(store.inspectCandidateKnowledgeLexicalIndex(secondScope)).resolves.toMatchObject({
      status: "not-indexed",
    });
    await store.close();
  });

  it("invalidates archived and confirmed-deleted CKB projections", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-storage-retrieval-"));
    temporaryRoots.push(parent);
    const root = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "evidence.md");
    await writeFile(sourcePath, "Archived managed evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createCandidateKnowledgeBase({
      id: "ckb-archived",
      displayName: "Archived evidence",
      isDefault: false,
      createdAt,
    });
    const managed = await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "source-archived",
        knowledgeBaseId: "ckb-archived",
        kind: "file",
        displayName: "Archived evidence",
        createdAt,
      },
      {
        id: "version-archived",
        sourcePath,
        mediaType: "text/markdown",
        checksum: sha256("Archived managed evidence"),
        sizeBytes: Buffer.byteLength("Archived managed evidence"),
        createdAt,
      },
    );
    const archivedScope = scope("ckb-archived", managed.source.id, managed.version.id);
    await store.rebuildCandidateKnowledgeLexicalIndex({
      scope: archivedScope,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(archivedScope),
      },
      chunks: [
        chunk("ckb-archived", managed.source.id, managed.version.id, "chunk-archived", "Archived"),
      ],
      createdAt,
    });
    await store.archiveCandidateKnowledgeBase("ckb-archived", "2026-08-29T09:01:00.000Z");
    await expect(store.inspectCandidateKnowledgeLexicalIndex(archivedScope)).resolves.toMatchObject(
      {
        status: "not-indexed",
      },
    );

    // Rebuild after archive solely to prove confirmed deletion clears the whole
    // derived projection before removing the canonical graph.
    await store.rebuildCandidateKnowledgeLexicalIndex({
      scope: archivedScope,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(archivedScope),
      },
      chunks: [
        chunk("ckb-archived", managed.source.id, managed.version.id, "chunk-archived", "Archived"),
      ],
      createdAt,
    });
    const plan = await store.planCandidateKnowledgeBaseDeletion("ckb-archived");
    await expect(
      store.deleteCandidateKnowledgeBase("ckb-archived", plan.confirmationToken),
    ).resolves.toMatchObject({
      status: "deleted",
    });
    await expect(store.inspectCandidateKnowledgeLexicalIndex(archivedScope)).resolves.toMatchObject(
      {
        status: "not-indexed",
      },
    );
    await expect(store.getCandidateKnowledgeBase("ckb-archived")).resolves.toBeUndefined();
    await store.close();
  });

  it("restores canonical CKB bytes without restoring replaceable lexical rows", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-storage-retrieval-"));
    temporaryRoots.push(parent);
    const root = join(parent, "candidate-knowledge");
    const backup = join(parent, "portable-backup");
    const restoredRoot = join(parent, "restored");
    const sourcePath = join(parent, "evidence.md");
    await writeFile(sourcePath, "Restorable managed evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const managed = await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "source-restored",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Restorable evidence",
        createdAt,
      },
      {
        id: "version-restored",
        sourcePath,
        mediaType: "text/markdown",
        checksum: sha256("Restorable managed evidence"),
        sizeBytes: Buffer.byteLength("Restorable managed evidence"),
        createdAt,
      },
    );
    const restoredScope = scope("ckb-default", managed.source.id, managed.version.id);
    await store.rebuildCandidateKnowledgeLexicalIndex({
      scope: restoredScope,
      index: {
        indexerId: "test-indexer",
        manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(restoredScope),
      },
      chunks: [
        chunk("ckb-default", managed.source.id, managed.version.id, "chunk-restored", "Restorable"),
      ],
      createdAt,
    });
    await store.exportPortableBackup(backup, { createdAt });
    await store.close();

    await restoreCandidateKnowledgePortableBackup(backup, restoredRoot, {
      collision: "fail-if-destination-exists",
      restoredAt: "2026-08-29T09:03:00.000Z",
    });
    const restored = await openCandidateKnowledgeStore(restoredRoot);
    await expect(
      restored.inspectCandidateKnowledgeLexicalIndex(restoredScope),
    ).resolves.toMatchObject({
      status: "not-indexed",
    });
    await expect(
      restored.readManagedCandidateKnowledgeSourceVersion(
        "ckb-default",
        managed.source.id,
        managed.version.id,
      ),
    ).resolves.toMatchObject({ metadata: { id: managed.version.id } });
    await restored.close();
  });
});
