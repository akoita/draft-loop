import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCandidateKnowledgeStore } from "@draft-loop/storage/knowledge-store";
import { afterEach, describe, expect, it } from "vitest";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-30T09:00:00.000Z";

describe("candidate knowledge retrieval application service", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("rebuilds a path-free lexical projection from the exact managed source version", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-application-retrieval-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "resume.md");
    await writeFile(sourcePath, "TypeScript systems design and review.", "utf8");
    const ids = ["store-a", "ckb-a", "source-a", "version-a"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });

    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath,
    });

    const result = await service.queryCandidateKnowledge({
      selections: [{ storeRoot, knowledgeBaseId: "ckb-a" }],
      purpose: "achievement-recall",
      query: "TypeScript",
      limit: 4,
    });

    expect(result.status).toBe("matched");
    expect(result.selectedChunkCount).toBe(1);
    expect(result.selectedSourceCount).toBe(1);
    expect(result.hits[0]).toMatchObject({
      metadata: {
        provenance: {
          storeId: "store-a",
          knowledgeBaseId: "ckb-a",
          sourceId: "source-a",
          versionId: "version-a",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(storeRoot);
    expect(JSON.stringify(result)).not.toContain("resume.md");
  });

  it("fuses explicitly approved multiple CKB selections deterministically", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-application-retrieval-"));
    temporaryRoots.push(parent);
    const firstRoot = join(parent, "first");
    const secondRoot = join(parent, "second");
    const firstPath = join(parent, "first.md");
    const secondPath = join(parent, "second.md");
    await writeFile(firstPath, "Shared platform delivery.", "utf8");
    await writeFile(secondPath, "Shared platform delivery.", "utf8");
    const ids = [
      "store-z",
      "ckb-z",
      "source-z",
      "version-z",
      "store-a",
      "ckb-a",
      "source-a",
      "version-a",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot: firstRoot });
    await service.importKnowledgeSourceFile({
      storeRoot: firstRoot,
      knowledgeBaseId: "ckb-z",
      sourcePath: firstPath,
    });
    await service.initializeStore({ storeRoot: secondRoot });
    await service.importKnowledgeSourceFile({
      storeRoot: secondRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath: secondPath,
    });

    const result = await service.queryCandidateKnowledge({
      combinationApproved: true,
      selections: [
        { storeRoot: firstRoot, knowledgeBaseId: "ckb-z" },
        { storeRoot: secondRoot, knowledgeBaseId: "ckb-a" },
      ],
      purpose: "factual-checks",
      query: "platform",
      limit: 4,
    });

    expect(result.status).toBe("matched");
    expect(result.hits).toHaveLength(2);
    expect(result.hits.map((hit) => hit.metadata.provenance.storeId)).toEqual([
      "store-a",
      "store-z",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.storeId)).toEqual([
      "store-a",
      "store-z",
    ]);
  });

  it("fails closed before reading an unavailable lifecycle selection", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-application-retrieval-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "resume.md");
    await writeFile(sourcePath, "Private evidence.", "utf8");
    const ids = ["store-a", "ckb-default", "ckb-a", "source-a", "version-a"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.createKnowledgeBase({
      storeRoot,
      displayName: "Secondary evidence",
    });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath,
    });
    await service.archiveKnowledgeBase({ storeRoot, knowledgeBaseId: "ckb-a" });

    await expect(
      service.queryCandidateKnowledge({
        selections: [{ storeRoot, knowledgeBaseId: "ckb-a" }],
        purpose: "critic-review",
        query: "Private",
      }),
    ).rejects.toThrow("The candidate knowledge lexical index could not be synchronized.");
  });

  it("fails closed when managed bytes no longer match their exact version", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-application-retrieval-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "resume.md");
    await writeFile(sourcePath, "Integrity-checked evidence.", "utf8");
    const ids = ["store-a", "ckb-a", "source-a", "version-a"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath,
    });
    const store = await openCandidateKnowledgeStore(storeRoot);
    const managedPath = await store.getManagedCandidateKnowledgeFilePath(
      "ckb-a",
      "source-a",
      "version-a",
    );
    await store.close();
    await writeFile(managedPath ?? "", "tampered managed bytes", "utf8");

    const failure = await service
      .queryCandidateKnowledge({
        selections: [{ storeRoot, knowledgeBaseId: "ckb-a" }],
        purpose: "factual-checks",
        query: "Integrity",
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "The candidate knowledge lexical index could not be synchronized.",
    );
    expect((failure as Error).message).not.toContain(storeRoot);
  });
});
