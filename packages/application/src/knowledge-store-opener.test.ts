import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import {
  type CandidateKnowledgeRunStore,
  candidateKnowledgeRunOperations,
  runOnlyCandidateKnowledgeStore,
} from "@draft-loop/storage/run-knowledge-store";
import { afterEach, describe, expect, it } from "vitest";

import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { withKnowledgeStoreOpener } from "./knowledge-store-opener.js";
import { createLocalApplicationDriver } from "./local.js";
import { writeWorkspaceEvidenceMode } from "./workspace-evidence-mode.js";

const silent = { write: () => undefined };
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A fixture workspace whose only career evidence is one synthetic knowledge base. */
async function knowledgeOnlyWorkspace(): Promise<{ root: string; storeRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-opener-"));
  roots.push(root);
  await mkdir(join(root, "evidence"));
  await writeFile(join(root, "job.md"), "Build TypeScript tools with deterministic testing.\n");
  const storeRoot = join(root, "candidate-store");
  const sourcePath = join(root, "career.md");
  await writeFile(
    sourcePath,
    "# Experience\n\n## Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript tools with deterministic testing.\n",
  );
  const ids = ["opener-store", "opener-ckb", "opener-source", "opener-version"];
  const service = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => "2026-10-21T10:00:00.000Z",
  });
  await service.initializeStore({ storeRoot });
  await service.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId: "opener-ckb", sourcePath });
  return { root, storeRoot };
}

/** Only the run's operations of a real local store, as a hosted store would offer them. */
function runOperationsOf(handle: CandidateKnowledgeStoreHandle): CandidateKnowledgeRunStore {
  const operations = Object.fromEntries(
    candidateKnowledgeRunOperations.map((name) => [name, handle[name].bind(handle)]),
  );
  return { descriptor: handle.descriptor, ...operations } as CandidateKnowledgeRunStore;
}

describe("knowledge store opener", () => {
  it.each(["retrieval", "full-source"] as const)(
    "runs a %s fixture round on a store that offers only a run's operations",
    async (mode) => {
      const { root, storeRoot } = await knowledgeOnlyWorkspace();
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        silent,
      );
      await driver.configureKnowledgeSelection(
        { root, entries: [{ storeRoot, storeId: "opener-store", knowledgeBaseId: "opener-ckb" }] },
        silent,
      );
      await writeWorkspaceEvidenceMode(root, mode);
      const opened: string[] = [];
      const opener = async (reference: string) => {
        opened.push(reference);
        return runOnlyCandidateKnowledgeStore(
          runOperationsOf(await openCandidateKnowledgeStore(reference)),
        );
      };

      const resumed = await withKnowledgeStoreOpener(opener, async () => {
        const begun = await driver.begin({ root, allowProviderData: false }, silent);
        return driver.resume({ root, runId: begun.runId, allowProviderData: false }, silent);
      });

      expect(resumed.state).toBe("awaiting-approval");
      expect(opened.length).toBeGreaterThan(0);
      expect(new Set(opened)).toEqual(new Set([storeRoot]));
    },
    120_000,
  );
});
