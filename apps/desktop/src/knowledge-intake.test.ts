import { describe, expect, it, vi } from "vitest";

import type {
  KnowledgeDirectoryImportResult,
  KnowledgeFileImportResult,
  KnowledgeReadinessResult,
} from "./bridge.js";
import {
  hasDesktopKnowledgeIntakeCapabilities,
  knowledgeIntakeSummary,
  knowledgeReadinessSummary,
  matchesKnowledgeBaseTarget,
  runKnowledgeIntake,
} from "./knowledge-intake.js";

const target = { storeId: "fictional-store", knowledgeBaseId: "fictional-base" };
const fileResult: KnowledgeFileImportResult = {
  ...target,
  sourceId: "fictional-source",
  kind: "file",
  versionId: "fictional-version",
  version: 1,
  created: true,
};
const directoryResult: KnowledgeDirectoryImportResult = {
  ...target,
  status: "partial",
  scannedEntryCount: 8,
  discoveredFileCount: 5,
  skippedEntryCount: 3,
  sourceCount: 4,
  sources: [],
  sourcesTruncated: true,
};
const readiness: KnowledgeReadinessResult = {
  ...target,
  state: "active",
  sourceCount: 4,
  readyCount: 3,
  blockedCount: 1,
  blockerReasons: ["fictional-blocker"],
};

describe("candidate knowledge intake", () => {
  it("requires all intake commands and matches exact store/base identity", () => {
    expect(
      hasDesktopKnowledgeIntakeCapabilities({
        importCandidateKnowledgeFile: async () => fileResult,
        importCandidateKnowledgeDirectory: async () => directoryResult,
        getCandidateKnowledgeReadiness: async () => readiness,
      }),
    ).toBe(true);
    expect(
      hasDesktopKnowledgeIntakeCapabilities({
        importCandidateKnowledgeFile: async () => fileResult,
        importCandidateKnowledgeDirectory: async () => directoryResult,
      }),
    ).toBe(false);
    expect(matchesKnowledgeBaseTarget(fileResult, target)).toBe(true);
    expect(matchesKnowledgeBaseTarget(readiness, target)).toBe(true);
    expect(
      matchesKnowledgeBaseTarget(fileResult, {
        storeId: "other-store",
        knowledgeBaseId: target.knowledgeBaseId,
      }),
    ).toBe(false);
  });

  it("summarizes file readiness and warns when a directory import is partial", () => {
    expect(knowledgeReadinessSummary(readiness)).toBe(
      "Readiness: 3 ready, 1 blocked of 4 sources.",
    );
    expect(knowledgeIntakeSummary(fileResult)).toBe(
      "File import complete. A candidate source was added.",
    );
    expect(knowledgeIntakeSummary({ ...fileResult, created: false })).toBe(
      "File import complete. An existing candidate source was reused.",
    );
    expect(knowledgeIntakeSummary(directoryResult)).toContain("Directory import partial");
    expect(knowledgeIntakeSummary(directoryResult)).toContain("Some content may not be available.");
    expect(knowledgeIntakeSummary(directoryResult)).toContain("skipped 3");
    expect(knowledgeIntakeSummary(directoryResult)).toContain("processed 4 sources");
  });

  it("refreshes after import even when readiness cannot be checked", async () => {
    const refresh = vi.fn(async () => true);
    const outcome = await runKnowledgeIntake({
      workspaceId: "workspace-1",
      target,
      isCurrent: () => true,
      importSource: async () => directoryResult,
      readReadiness: async () => {
        throw new Error("private host detail");
      },
      refreshWorkspace: refresh,
    });

    expect(outcome).toEqual({ status: "readiness-unavailable", result: directoryResult });
    expect(refresh).toHaveBeenCalledWith("workspace-1");
  });

  it("accepts readiness only for the exact imported base and refreshes after a complete result", async () => {
    const refresh = vi.fn(async () => true);
    const outcome = await runKnowledgeIntake({
      workspaceId: "workspace-1",
      target,
      isCurrent: () => true,
      importSource: async () => fileResult,
      readReadiness: async () => readiness,
      refreshWorkspace: refresh,
    });
    expect(outcome).toEqual({ status: "ready", result: fileResult, readiness });
    expect(refresh).toHaveBeenCalledWith("workspace-1");

    const mismatched = await runKnowledgeIntake({
      workspaceId: "workspace-1",
      target,
      isCurrent: () => true,
      importSource: async () => directoryResult,
      readReadiness: async () => ({ ...readiness, knowledgeBaseId: "other-base" }),
      refreshWorkspace: refresh,
    });
    expect(mismatched).toEqual({ status: "readiness-unavailable", result: directoryResult });
  });

  it("keeps stale imports from refreshing and native cancellation from claiming success", async () => {
    const refresh = vi.fn(async () => true);
    const stale = await runKnowledgeIntake({
      workspaceId: "workspace-1",
      target,
      isCurrent: () => false,
      importSource: async () => fileResult,
      readReadiness: async () => readiness,
      refreshWorkspace: refresh,
    });
    expect(stale).toEqual({ status: "stale" });

    await expect(
      runKnowledgeIntake({
        workspaceId: "workspace-1",
        target,
        isCurrent: () => true,
        importSource: async () => {
          throw new Error("native picker canceled");
        },
        readReadiness: async () => readiness,
        refreshWorkspace: refresh,
      }),
    ).rejects.toThrow("native picker canceled");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports an import result when the post-import workspace refresh fails", async () => {
    const outcome = await runKnowledgeIntake({
      workspaceId: "workspace-1",
      target,
      isCurrent: () => true,
      importSource: async () => fileResult,
      readReadiness: async () => readiness,
      refreshWorkspace: async () => {
        throw new Error("private refresh detail");
      },
    });

    expect(outcome).toEqual({ status: "refresh-unavailable", result: fileResult, readiness });
  });
});
