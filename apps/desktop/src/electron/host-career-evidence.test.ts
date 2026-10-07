import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DesktopReviewState } from "../model.js";
import { createNativeHost } from "./host.js";

describe("setup readiness follows the selected knowledge base", () => {
  it("counts the base the run will use, not the legacy workspace evidence folder", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-career-evidence-"));
    const root = join(parent, "workspace");
    try {
      const sourcePath = join(parent, "resume.md");
      await writeFile(sourcePath, "Built TypeScript services.\n", "utf8");
      const host = createNativeHost({
        dialogs: {
          chooseDirectory: async () => parent,
          chooseFiles: async () => [],
          chooseKnowledgeSourceFile: async () => sourcePath,
        },
      });
      const created = await host.invoke({
        type: "workspace.create",
        input: { name: "workspace", mode: "real" },
      });
      if (!created.ok) throw new Error("Expected workspace creation to succeed.");
      const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
      await writeFile(join(root, "job.md"), "- TypeScript systems engineer\n", "utf8");
      await writeFile(
        join(root, "evidence", "legacy-a.md"),
        "Legacy workspace evidence.\n",
        "utf8",
      );
      await writeFile(join(root, "evidence", "legacy-b.md"), "More legacy evidence.\n", "utf8");

      const setupOf = async () => {
        const loaded = await host.invoke({ type: "review.load", input: { workspaceId } });
        if (!loaded.ok) throw new Error("Expected the review to load.");
        return (loaded.value as DesktopReviewState).setup;
      };

      const legacy = await setupOf();
      expect(legacy.evidenceSourceCount).toBe(2);
      expect(legacy.ready).toBe(true);

      const store = await host.invoke({
        type: "knowledge.create",
        input: { name: "candidate-knowledge", displayName: "My evidence" },
      });
      if (!store.ok) throw new Error("Expected store creation to succeed.");
      const storeId = (store.value as { storeId: string }).storeId;
      const knowledgeBaseId = (store.value as { knowledgeBases: readonly { id: string }[] })
        .knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
      await host.invoke({
        type: "knowledge.import-file",
        input: { storeId, knowledgeBaseId, selection: "native-dialog" },
      });
      await expect(
        host.invoke({
          type: "knowledge.select",
          input: { workspaceId, entries: [{ storeId, knowledgeBaseId }] },
        }),
      ).resolves.toMatchObject({ ok: true });

      const filled = await setupOf();
      // The two legacy files are not part of the base the run will use.
      expect(filled.evidenceSourceCount).toBe(1);
      expect(filled.ready).toBe(true);
      expect(filled.nextSteps).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
