import { describe, expect, it, vi } from "vitest";

import type { CandidateKnowledgeStoreHandle } from "./knowledge-store.js";
import {
  CandidateKnowledgeOperationUnsupportedError,
  type CandidateKnowledgeRunStore,
  runOnlyCandidateKnowledgeStore,
} from "./run-knowledge-store.js";

function runStore(): CandidateKnowledgeRunStore {
  const missing = async () => undefined;
  return {
    descriptor: { schemaVersion: 1, id: "store-1", createdAt: "2026-10-21T00:00:00.000Z" },
    close: vi.fn(async () => undefined),
    withWriterLease: async (_operation, callback) => callback(),
    getCandidateKnowledgeBaseLifecycleReadiness: vi.fn(missing),
    getCandidateKnowledgeSourceSensitivityRules: missing,
    readManagedCandidateKnowledgeSourceVersion: missing,
    inspectCandidateKnowledgeLexicalIndex: vi.fn(),
    queryCandidateKnowledge: vi.fn(),
    rebuildCandidateKnowledgeLexicalIndex: vi.fn(),
    inspectCandidateKnowledgeVectorIndex: vi.fn(),
    queryCandidateKnowledgeVectors: vi.fn(),
    upsertCandidateKnowledgeVectors: vi.fn(),
    deleteCandidateKnowledgeVectorIndex: vi.fn(),
  } as CandidateKnowledgeRunStore;
}

describe("run-only candidate knowledge store", () => {
  it("offers the run's operations from the store it wraps", async () => {
    const store = runStore();
    const handle = runOnlyCandidateKnowledgeStore(store);

    expect(handle.descriptor.id).toBe("store-1");
    await handle.getCandidateKnowledgeBaseLifecycleReadiness("ckb-1");
    await handle.close();

    expect(store.getCandidateKnowledgeBaseLifecycleReadiness).toHaveBeenCalledWith("ckb-1");
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(await handle.withWriterLease("rebuild", async () => "done")).toBe("done");
  });

  it("refuses intake, local bindings and every other operation", async () => {
    const handle = runOnlyCandidateKnowledgeStore(runStore());

    await expect(handle.listCandidateKnowledgeSources("ckb-1")).rejects.toBeInstanceOf(
      CandidateKnowledgeOperationUnsupportedError,
    );
    await expect(
      handle.createManagedCandidateKnowledgeFileSource(
        {} as Parameters<
          CandidateKnowledgeStoreHandle["createManagedCandidateKnowledgeFileSource"]
        >[0],
        {} as Parameters<
          CandidateKnowledgeStoreHandle["createManagedCandidateKnowledgeFileSource"]
        >[1],
      ),
    ).rejects.toThrow("does not support createManagedCandidateKnowledgeFileSource");
    expect(() => handle.root).toThrow(CandidateKnowledgeOperationUnsupportedError);
  });

  it("does not look like a promise, so it can be returned from an async opener", async () => {
    const handle = runOnlyCandidateKnowledgeStore(runStore());

    expect(await Promise.resolve(handle)).toBe(handle);
  });
});
