import { describe, expect, it } from "vitest";
import type { KnowledgeSelectionSnapshot } from "./knowledge-base.js";
import { selectionSnapshotsMatch } from "./knowledge-selection-match.js";

function snapshot(entries: readonly unknown[], schemaVersion = 1): KnowledgeSelectionSnapshot {
  return { schemaVersion, capturedAt: "2026-10-04T16:05:34.763Z", entries } as never;
}

const builtSource = {
  sourceId: "source-1",
  versionId: "version-1",
  lifecycleRevision: {
    knowledgeBaseState: "active",
    knowledgeBaseArchivedAt: null,
    managed: true,
    directory: null,
    createdAt: "2026-10-04T16:05:34.763Z",
  },
};

// The same source as it comes back from persistence: identical content, keys in sorted order.
const persistedSource = {
  lifecycleRevision: {
    createdAt: "2026-10-04T16:05:34.763Z",
    directory: null,
    knowledgeBaseArchivedAt: null,
    knowledgeBaseState: "active",
    managed: true,
  },
  sourceId: "source-1",
  versionId: "version-1",
};

describe("knowledge selection snapshot matching", () => {
  it("matches snapshots whose content is equal but whose keys are ordered differently", () => {
    const built = snapshot([
      { storeId: "store-1", knowledgeBaseId: "kb-1", sources: [builtSource] },
    ]);
    const persisted = snapshot([
      { knowledgeBaseId: "kb-1", sources: [persistedSource], storeId: "store-1" },
    ]);

    expect(JSON.stringify(built.entries)).not.toBe(JSON.stringify(persisted.entries));
    expect(selectionSnapshotsMatch(persisted, built)).toBe(true);
  });

  it("still rejects a changed value", () => {
    const built = snapshot([
      { storeId: "store-1", knowledgeBaseId: "kb-1", sources: [builtSource] },
    ]);
    const changed = snapshot([
      {
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        sources: [{ ...persistedSource, versionId: "version-2" }],
      },
    ]);

    expect(selectionSnapshotsMatch(changed, built)).toBe(false);
  });

  it("still rejects a different source order or schema version", () => {
    const other = { ...builtSource, sourceId: "source-2" };
    const forward = snapshot([
      { storeId: "store-1", knowledgeBaseId: "kb-1", sources: [builtSource, other] },
    ]);
    const reversed = snapshot([
      { storeId: "store-1", knowledgeBaseId: "kb-1", sources: [other, builtSource] },
    ]);

    expect(selectionSnapshotsMatch(forward, reversed)).toBe(false);
    expect(selectionSnapshotsMatch(forward, snapshot(forward.entries, 2))).toBe(false);
  });
});
