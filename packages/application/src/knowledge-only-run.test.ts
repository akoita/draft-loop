import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { CliUserError, createLocalApplicationDriver } from "./local.js";

const silent = { write: () => undefined };

/** A workspace whose legacy evidence folder is empty, as the knowledge-base flow leaves it. */
async function knowledgeOnlyWorkspace(): Promise<{ root: string; storeRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-only-"));
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(
    join(root, "job.md"),
    "Build TypeScript local-first tools with deterministic testing.\n",
    "utf8",
  );
  const storeRoot = join(root, "candidate-store");
  const sourcePath = join(root, "candidate-resume.md");
  await writeFile(sourcePath, "Built local-first TypeScript tools with deterministic testing.\n");
  const ids = ["only-store", "only-ckb", "only-source", "only-version"];
  const service = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => "2026-08-23T10:00:00.000Z",
  });
  await service.initializeStore({ storeRoot });
  await service.importKnowledgeSourceFile({
    storeRoot,
    knowledgeBaseId: "only-ckb",
    sourcePath,
  });
  return { root, storeRoot };
}

describe("a run whose career evidence comes only from a knowledge base", () => {
  it("starts and resumes a fixture round with an empty local evidence folder", async () => {
    const { root, storeRoot } = await knowledgeOnlyWorkspace();
    const driver = createLocalApplicationDriver();
    try {
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        silent,
      );
      await driver.configureKnowledgeSelection(
        {
          root,
          entries: [{ storeRoot, storeId: "only-store", knowledgeBaseId: "only-ckb" }],
        },
        silent,
      );

      const begun = await driver.begin({ root, allowProviderData: false }, silent);
      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const record = await storage.getContextSnapshot(begun.contextSnapshotId);
        const payload = record?.payload as {
          readonly candidateKnowledgeSelection?: { readonly entries: readonly unknown[] };
          readonly evidenceManifest: readonly { readonly path: string }[];
        };
        expect(payload.candidateKnowledgeSelection?.entries).toHaveLength(1);
        expect(payload.evidenceManifest.length).toBeGreaterThan(0);
        for (const source of payload.evidenceManifest) {
          expect(source.path.startsWith("candidate-knowledge/")).toBe(true);
        }
      } finally {
        await storage.close();
      }

      const resumed = await driver.resume(
        { root, runId: begun.runId, allowProviderData: false },
        silent,
      );
      expect(resumed.state).toBe("awaiting-approval");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("completes a fixture round through start and reports its status", async () => {
    const { root, storeRoot } = await knowledgeOnlyWorkspace();
    const driver = createLocalApplicationDriver();
    try {
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        silent,
      );
      await driver.configureKnowledgeSelection(
        { root, entries: [{ storeRoot, storeId: "only-store", knowledgeBaseId: "only-ckb" }] },
        silent,
      );

      const started = await driver.start({ root, allowProviderData: false }, silent);
      expect(started.artifact).not.toBeNull();
      const status = await driver.status({ root, runId: started.runId }, silent);
      expect(status?.runId).toBe(started.runId);
      expect(status?.contextSnapshotId).toBe(started.contextSnapshotId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("still refuses to start without local files or a knowledge selection", async () => {
    const { root } = await knowledgeOnlyWorkspace();
    const driver = createLocalApplicationDriver();
    try {
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        silent,
      );
      const failure = driver.begin({ root, allowProviderData: false }, silent);
      await expect(failure).rejects.toBeInstanceOf(CliUserError);
      await expect(failure).rejects.toThrow(
        "No supported local source files were found in the source directory.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
