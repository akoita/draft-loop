import { describe, expect, it, vi } from "vitest";

import type {
  KnowledgeCurrentResult,
  KnowledgeDirectoryImportResult,
  KnowledgeFileImportResult,
  KnowledgeReadinessResult,
} from "./bridge.js";
import {
  type CareerEvidenceCapabilities,
  type CareerEvidenceStatus,
  loadCareerEvidenceStatus,
} from "./career-evidence.js";
import {
  addFirstCareerEvidence,
  importLegacyEvidence,
  noSelectionMode,
  supportsAutomaticKnowledgeBase,
} from "./career-evidence-setup.js";

const target = { storeId: "store-1", knowledgeBaseId: "base-1" };
const ensured = { ...target, displayName: "Career evidence", created: true };
const readiness: KnowledgeReadinessResult = {
  ...target,
  state: "active",
  sourceCount: 1,
  readyCount: 1,
  blockedCount: 0,
  blockerReasons: [],
};
const fileResult: KnowledgeFileImportResult = {
  ...target,
  sourceId: "source-1",
  kind: "file",
  versionId: "version-1",
  version: 1,
  created: true,
};
function directoryResult(
  overrides: Partial<KnowledgeDirectoryImportResult> = {},
): KnowledgeDirectoryImportResult {
  return {
    ...target,
    status: "complete",
    scannedEntryCount: 3,
    discoveredFileCount: 3,
    skippedEntryCount: 0,
    sourceCount: 3,
    sources: [],
    sourcesTruncated: false,
    ...overrides,
  };
}

function capabilities(
  overrides: Partial<CareerEvidenceCapabilities> = {},
  calls: string[] = [],
): CareerEvidenceCapabilities {
  return {
    getCurrentCandidateKnowledge: async () =>
      ({ store: null, selectedKnowledgeBaseIds: [] }) satisfies KnowledgeCurrentResult,
    getCandidateKnowledgeReadiness: async () => readiness,
    ensureDefaultCandidateKnowledgeBase: async () => {
      calls.push("ensure");
      return ensured;
    },
    selectCandidateKnowledgeBase: async (workspaceId, entry) => {
      calls.push("select");
      return { workspaceId, entries: [entry] } as never;
    },
    importCandidateKnowledgeFile: async () => {
      calls.push("import-file");
      return fileResult;
    },
    importWorkspaceCandidateSources: async () => {
      calls.push("import-workspace");
      return directoryResult();
    },
    getLegacyEvidenceMigration: async (workspaceId) => ({ workspaceId, declined: false }),
    declineLegacyEvidenceMigration: async (workspaceId) => ({ workspaceId, declined: true }),
    ...overrides,
  };
}

const context = {
  workspaceId: "workspace-1",
  safeName: (name: string) => name,
  isCurrent: () => true,
};

describe("no-selection mode", () => {
  const none = (legacyDeclined?: boolean): Extract<CareerEvidenceStatus, { kind: "none" }> =>
    legacyDeclined === undefined ? { kind: "none" } : { kind: "none", legacyDeclined };

  it("creates on the first add without legacy evidence and offers an import with it", () => {
    expect(
      noSelectionMode({ status: none(false), legacyEvidenceSourceCount: 0, automatic: true }),
    ).toBe("first-add");
    expect(
      noSelectionMode({ status: none(false), legacyEvidenceSourceCount: 2, automatic: true }),
    ).toBe("offer");
  });

  it("stays on the legacy path after a decline, an unreadable decision, or an old host", () => {
    for (const status of [none(true), none()]) {
      expect(noSelectionMode({ status, legacyEvidenceSourceCount: 2, automatic: true })).toBe(
        "legacy",
      );
    }
    expect(
      noSelectionMode({ status: none(false), legacyEvidenceSourceCount: 0, automatic: false }),
    ).toBe("legacy");
  });

  it("needs every automatic capability", () => {
    expect(supportsAutomaticKnowledgeBase(capabilities())).toBe(true);
    for (const missing of [
      "ensureDefaultCandidateKnowledgeBase",
      "selectCandidateKnowledgeBase",
      "getLegacyEvidenceMigration",
      "declineLegacyEvidenceMigration",
    ] as const) {
      expect(supportsAutomaticKnowledgeBase(capabilities({ [missing]: undefined }))).toBe(false);
    }
  });
});

describe("loading the no-selection status", () => {
  it("carries the saved decision, and omits it when it cannot be read", async () => {
    await expect(loadCareerEvidenceStatus(capabilities(), "workspace-1", String)).resolves.toEqual({
      kind: "none",
      legacyDeclined: false,
    });
    await expect(
      loadCareerEvidenceStatus(
        capabilities({
          getLegacyEvidenceMigration: async (workspaceId) => ({ workspaceId, declined: true }),
        }),
        "workspace-1",
        String,
      ),
    ).resolves.toEqual({ kind: "none", legacyDeclined: true });
    await expect(
      loadCareerEvidenceStatus(
        capabilities({
          getLegacyEvidenceMigration: async () => {
            throw new Error("unreadable");
          },
        }),
        "workspace-1",
        String,
      ),
    ).resolves.toEqual({ kind: "none" });
  });
});

describe("first career evidence", () => {
  it("creates the base, imports into it, then selects it, and says where it lives", async () => {
    const calls: string[] = [];
    const onChanged = vi.fn(async () => {
      calls.push("refresh");
      return true;
    });
    const outcome = await addFirstCareerEvidence({
      ...context,
      capabilities: capabilities({}, calls),
      source: { kind: "file" },
      onChanged,
    });
    expect(calls).toEqual(["ensure", "import-file", "select", "refresh"]);
    expect(outcome).toEqual({
      status: "added",
      message:
        "Created knowledge base “Career evidence” in DraftLoop application data and selected it for this workspace. Added to Career evidence. 1 source, 1 ready.",
    });
  });

  it("reuses an existing default base without claiming to have created it", async () => {
    const outcome = await addFirstCareerEvidence({
      ...context,
      capabilities: capabilities({
        ensureDefaultCandidateKnowledgeBase: async () => ({ ...ensured, created: false }),
      }),
      source: { kind: "file" },
      onChanged: async () => true,
    });
    expect(outcome).toMatchObject({
      message: expect.stringContaining("Selected knowledge base “Career evidence”"),
    });
  });

  it("never selects the base when the import is cancelled or fails", async () => {
    const calls: string[] = [];
    await expect(
      addFirstCareerEvidence({
        ...context,
        capabilities: capabilities(
          {
            importCandidateKnowledgeFile: async () => {
              throw new Error("Candidate knowledge file intake was cancelled.");
            },
          },
          calls,
        ),
        source: { kind: "file" },
        onChanged: async () => true,
      }),
    ).rejects.toThrow("cancelled");
    expect(calls).toEqual(["ensure"]);
  });
});

describe("one-time legacy evidence import", () => {
  it("imports, selects, refreshes, and reports the counts", async () => {
    const calls: string[] = [];
    const outcome = await importLegacyEvidence({
      ...context,
      capabilities: capabilities({}, calls),
      onChanged: async () => {
        calls.push("refresh");
        return true;
      },
    });
    expect(calls).toEqual(["ensure", "import-workspace", "select", "refresh"]);
    expect(outcome).toEqual({
      status: "imported",
      message:
        "Created knowledge base “Career evidence” in DraftLoop application data and selected it for this workspace. Imported 3 of 3 legacy evidence files.",
    });
  });

  it("reports partial results and rejections", async () => {
    const outcome = await importLegacyEvidence({
      ...context,
      capabilities: capabilities({
        importWorkspaceCandidateSources: async () =>
          directoryResult({
            status: "partial",
            discoveredFileCount: 4,
            sourceCount: 2,
            skippedEntryCount: 1,
          }),
      }),
      onChanged: async () => true,
    });
    expect(outcome).toMatchObject({
      status: "imported",
      message: expect.stringContaining(
        "Imported 2 of 4 legacy evidence files. Not imported: 2 files, which stay in the workspace evidence folder. 1 entry skipped as unsupported.",
      ),
    });
  });

  it("does not select an empty base when nothing could be imported", async () => {
    const calls: string[] = [];
    const outcome = await importLegacyEvidence({
      ...context,
      capabilities: capabilities(
        {
          importWorkspaceCandidateSources: async () =>
            directoryResult({ status: "partial", sourceCount: 0, discoveredFileCount: 2 }),
        },
        calls,
      ),
      onChanged: async () => true,
    });
    expect(outcome).toMatchObject({ status: "nothing-imported" });
    expect(calls).toEqual(["ensure"]);
  });
});
