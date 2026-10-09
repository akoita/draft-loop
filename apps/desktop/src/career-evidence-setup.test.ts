import { describe, expect, it, vi } from "vitest";

import type {
  KnowledgeCurrentResult,
  KnowledgeFileImportResult,
  KnowledgeReadinessResult,
} from "./bridge.js";
import { type CareerEvidenceCapabilities, loadCareerEvidenceStatus } from "./career-evidence.js";
import {
  addFirstCareerEvidence,
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
    ...overrides,
  };
}

const context = {
  workspaceId: "workspace-1",
  safeName: (name: string) => name,
  isCurrent: () => true,
};

describe("no-selection mode", () => {
  it("creates the base on the first add, and keeps legacy evidence only for an old host", () => {
    expect(noSelectionMode(true)).toBe("first-add");
    expect(noSelectionMode(false)).toBe("legacy");
  });

  it("needs the create and select capabilities, not the legacy migration ones", () => {
    // The helper offers no legacy migration capabilities.
    expect(supportsAutomaticKnowledgeBase(capabilities())).toBe(true);
    for (const missing of [
      "ensureDefaultCandidateKnowledgeBase",
      "selectCandidateKnowledgeBase",
    ] as const) {
      expect(supportsAutomaticKnowledgeBase(capabilities({ [missing]: undefined }))).toBe(false);
    }
  });
});

describe("loading the no-selection status", () => {
  it("reports no selection without reading a legacy decision", async () => {
    const getLegacyEvidenceMigration = vi.fn(async (workspaceId: string) => ({
      workspaceId,
      declined: true,
    }));
    await expect(
      loadCareerEvidenceStatus(capabilities({ getLegacyEvidenceMigration }), "workspace-1", String),
    ).resolves.toEqual({ kind: "none" });
    expect(getLegacyEvidenceMigration).not.toHaveBeenCalled();
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
