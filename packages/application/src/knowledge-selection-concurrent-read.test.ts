import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

describe("concurrent reads of one candidate knowledge store", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  // The desktop refreshes the review screen, which reads the store, while a resumed run checks
  // its pinned selection against the same store. Neither read may fail because the other is open.
  it("captures a selection snapshot while another reader opens the same store", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-concurrent-read-"));
    directories.push(root);
    const storeRoot = join(root, "candidate-store");
    const sourcePath = join(root, "candidate.md");
    await writeFile(sourcePath, "Built local-first TypeScript tools.\n", "utf8");
    const ids = ["store", "ckb", "source", "version"];
    const setup = createCandidateKnowledgeStoreService({ generateId: () => ids.shift() ?? "x" });
    await setup.initializeStore({ storeRoot });
    await setup.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId: "ckb", sourcePath });

    const screen = createCandidateKnowledgeStoreService();
    const run = createCandidateKnowledgeStoreService();
    const results = await Promise.all([
      screen.getKnowledgeBaseLifecycleReadiness({ storeRoot, knowledgeBaseId: "ckb" }),
      run.createKnowledgeSelectionSnapshot({ selections: [{ storeRoot, knowledgeBaseId: "ckb" }] }),
      screen.getKnowledgeBaseLifecycleReadiness({ storeRoot, knowledgeBaseId: "ckb" }),
    ]);

    expect(results[1].entries).toMatchObject([{ storeId: "store", knowledgeBaseId: "ckb" }]);
  });
});
