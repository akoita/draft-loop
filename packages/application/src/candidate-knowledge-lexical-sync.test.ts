import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCandidateKnowledgeStore } from "@draft-loop/storage/knowledge-store";
import { afterEach, describe, expect, it } from "vitest";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-30T09:00:00.000Z";

describe("candidate knowledge lexical projection reuse", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  async function createFixture() {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-application-lexical-sync-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const firstPath = join(parent, "first.md");
    const secondPath = join(parent, "second.md");
    await writeFile(firstPath, "TypeScript systems design and review.", "utf8");
    await writeFile(secondPath, "Kubernetes platform delivery.", "utf8");
    const ids = ["store-a", "ckb-a", "source-a", "version-a", "source-b", "version-b"];
    let rebuildCount = 0;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
      open: async (root) => {
        const handle = await openCandidateKnowledgeStore(root);
        return {
          ...handle,
          rebuildCandidateKnowledgeLexicalIndex: (input) => {
            rebuildCount += 1;
            return handle.rebuildCandidateKnowledgeLexicalIndex(input);
          },
        };
      },
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath: firstPath,
    });
    const query = (text = "TypeScript") =>
      service.queryCandidateKnowledge({
        selections: [{ storeRoot, knowledgeBaseId: "ckb-a" }],
        purpose: "achievement-recall",
        query: text,
        limit: 4,
      });
    return {
      service,
      storeRoot,
      secondPath,
      query,
      rebuilds: () => rebuildCount,
    };
  }

  it("reuses the current projection on an unchanged selection with identical results", async () => {
    const { query, rebuilds } = await createFixture();

    const first = await query();
    expect(rebuilds()).toBe(1);
    const second = await query();
    const third = await query();

    expect(rebuilds()).toBe(1);
    expect(first.status).toBe("matched");
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("rebuilds when a source version is added to the selection", async () => {
    const { service, storeRoot, secondPath, query, rebuilds } = await createFixture();

    await query();
    expect(rebuilds()).toBe(1);
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath: secondPath,
    });
    const afterImport = await query("Kubernetes");

    expect(rebuilds()).toBe(2);
    expect(afterImport.status).toBe("matched");
    expect(afterImport.hits[0]?.metadata.provenance.sourceId).toBe("source-b");
    await query("Kubernetes");
    expect(rebuilds()).toBe(2);
  });

  it("rebuilds when a source is retired from the selection", async () => {
    const { service, storeRoot, secondPath, query, rebuilds } = await createFixture();
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "ckb-a",
      sourcePath: secondPath,
    });

    const before = await query("Kubernetes");
    expect(rebuilds()).toBe(1);
    expect(before.hits[0]?.metadata.provenance.sourceId).toBe("source-b");
    await service.retireKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "ckb-a",
      sourceId: "source-b",
    });
    const after = await query("Kubernetes");

    expect(rebuilds()).toBe(2);
    expect(after.hits.every((hit) => hit.metadata.provenance.sourceId !== "source-b")).toBe(true);
  });

  it("always rebuilds through the explicit rebuild command", async () => {
    const { service, storeRoot, query, rebuilds } = await createFixture();
    const command = { selections: [{ storeRoot, knowledgeBaseId: "ckb-a" }] };

    await query();
    expect(rebuilds()).toBe(1);
    const first = await service.rebuildCandidateKnowledgeLexicalIndexes(command);
    const second = await service.rebuildCandidateKnowledgeLexicalIndexes(command);

    expect(rebuilds()).toBe(3);
    expect(first[0]?.createdAt).toBe(createdAt);
    expect(second[0]?.index.manifestChecksum).toBe(first[0]?.index.manifestChecksum);
    await query();
    expect(rebuilds()).toBe(3);
  });
});
