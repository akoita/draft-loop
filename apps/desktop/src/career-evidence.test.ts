import { describe, expect, it, vi } from "vitest";

import type { KnowledgeCurrentResult, KnowledgeReadinessResult } from "./bridge.js";
import {
  addCareerEvidence,
  type CareerEvidenceCapabilities,
  careerEvidenceReadinessText,
  careerEvidenceReady,
  loadCareerEvidenceStatus,
  semanticStatusLine,
} from "./career-evidence.js";

const store = {
  storeId: "store-1",
  knowledgeBases: [
    {
      id: "base-1",
      displayName: "Engineering",
      description: "",
      state: "active" as const,
      isDefault: true,
    },
    {
      id: "base-2",
      displayName: "Design",
      description: "",
      state: "active" as const,
      isDefault: false,
    },
  ],
};

function readiness(overrides: Partial<KnowledgeReadinessResult> = {}): KnowledgeReadinessResult {
  return {
    storeId: "store-1",
    knowledgeBaseId: "base-1",
    state: "active",
    sourceCount: 3,
    readyCount: 3,
    blockedCount: 0,
    blockerReasons: [],
    ...overrides,
  };
}

function capabilities(
  current: KnowledgeCurrentResult,
  extra: Partial<CareerEvidenceCapabilities> = {},
): CareerEvidenceCapabilities {
  return {
    getCurrentCandidateKnowledge: async () => current,
    getCandidateKnowledgeReadiness: async () => readiness(),
    ...extra,
  };
}

const selected: KnowledgeCurrentResult = { store, selectedKnowledgeBaseIds: ["base-1"] };
const name = (value: string) => value;

describe("career evidence status", () => {
  it("reports the selected base, its sources, and no semantic line in lexical mode", async () => {
    const status = await loadCareerEvidenceStatus(
      capabilities(selected, {
        getRetrievalMode: async () => ({
          workspaceId: "workspace-1",
          mode: "lexical",
          modelTier: "311m",
        }),
      }),
      "workspace-1",
      name,
    );
    expect(status).toEqual({
      kind: "selected",
      storeId: "store-1",
      knowledgeBaseId: "base-1",
      displayName: "Engineering",
      sourceCount: 3,
      blockedCount: 0,
      semanticLine: null,
    });
  });

  it("reports the semantic model state only when the mode uses it", async () => {
    const getEmbeddingModelStatus = vi.fn(async () => ({
      tier: "311m" as const,
      state: "absent" as const,
      modelId: "model",
      revision: "r",
      license: "gemma",
      totalSizeBytes: 1,
      sourceUrl: "https://huggingface.co/model",
    }));
    const status = await loadCareerEvidenceStatus(
      capabilities(selected, {
        getRetrievalMode: async () => ({
          workspaceId: "workspace-1",
          mode: "hybrid",
          modelTier: "311m",
        }),
        getEmbeddingModelStatus,
      }),
      "workspace-1",
      name,
    );
    expect(status).toMatchObject({
      kind: "selected",
      semanticLine: "Semantic search: model not installed",
    });
    expect(getEmbeddingModelStatus).toHaveBeenCalledWith("311m");
    expect(semanticStatusLine("ready")).toBe("Semantic search: ready");
  });

  it("reports an empty selected base as not ready without counting legacy evidence", async () => {
    const status = await loadCareerEvidenceStatus(
      capabilities(selected, {
        getCandidateKnowledgeReadiness: async () => readiness({ sourceCount: 0, readyCount: 0 }),
      }),
      "workspace-1",
      name,
    );
    if (status.kind !== "selected") throw new Error("Expected a selected base.");
    expect(careerEvidenceReadinessText(status)).toBe("Empty: add a CV, portfolio, or other source");
    // A workspace evidence count of 4 is legacy material the run does not use.
    expect(careerEvidenceReady(status, 4)).toBe(false);
  });

  it("describes blocked sources and is ready with at least one source", async () => {
    const status = await loadCareerEvidenceStatus(
      capabilities(selected, {
        getCandidateKnowledgeReadiness: async () => readiness({ readyCount: 1, blockedCount: 2 }),
      }),
      "workspace-1",
      name,
    );
    if (status.kind !== "selected") throw new Error("Expected a selected base.");
    expect(careerEvidenceReadinessText(status)).toBe("2 not ready");
    expect(careerEvidenceReady(status, 0)).toBe(true);
  });

  it("reports no selection, and falls back to legacy evidence for readiness", async () => {
    const none = await loadCareerEvidenceStatus(
      capabilities({ store: null, selectedKnowledgeBaseIds: [] }),
      "workspace-1",
      name,
    );
    expect(none).toEqual({ kind: "none" });
    expect(careerEvidenceReady(none, 2)).toBe(true);
    expect(careerEvidenceReady(none, 0)).toBe(false);
    const unselected = await loadCareerEvidenceStatus(
      capabilities({ store, selectedKnowledgeBaseIds: [] }),
      "workspace-1",
      name,
    );
    expect(unselected).toEqual({ kind: "none" });
  });

  it("reports an unreadable saved store and an unsupported host", async () => {
    await expect(
      loadCareerEvidenceStatus(
        capabilities({ store: null, selectedKnowledgeBaseIds: [], unavailable: true }),
        "workspace-1",
        name,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      loadCareerEvidenceStatus(
        capabilities(selected, {
          getCandidateKnowledgeReadiness: async () => {
            throw new Error("unreadable");
          },
        }),
        "workspace-1",
        name,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(loadCareerEvidenceStatus({}, "workspace-1", name)).resolves.toEqual({
      kind: "unsupported",
    });
  });
});

describe("adding career evidence", () => {
  const target = { storeId: "store-1", knowledgeBaseId: "base-1" };
  const fileResult = {
    ...target,
    sourceId: "source-1",
    kind: "file" as const,
    versionId: "version-1",
    version: 1,
    created: true,
  };

  it("imports a file into the selected base, then reads readiness and refreshes the workspace", async () => {
    const order: string[] = [];
    const importCandidateKnowledgeFile = vi.fn(async () => {
      order.push("import");
      return fileResult;
    });
    const getCandidateKnowledgeReadiness = vi.fn(async () => {
      order.push("readiness");
      return readiness({ sourceCount: 4, readyCount: 4 });
    });
    const onChanged = vi.fn(async () => {
      order.push("refresh");
      return true;
    });
    const outcome = await addCareerEvidence({
      capabilities: { importCandidateKnowledgeFile, getCandidateKnowledgeReadiness },
      workspaceId: "workspace-1",
      target,
      displayName: "Engineering",
      source: { kind: "file" },
      isCurrent: () => true,
      onChanged,
    });
    expect(importCandidateKnowledgeFile).toHaveBeenCalledWith("store-1", "base-1");
    expect(onChanged).toHaveBeenCalledWith("workspace-1");
    expect(order).toEqual(["import", "readiness", "refresh"]);
    expect(outcome).toEqual({
      status: "added",
      message: "Added to Engineering. 4 sources, 4 ready.",
    });
  });

  const addFile = (result: Record<string, unknown>) =>
    addCareerEvidence({
      capabilities: {
        importCandidateKnowledgeFile: async () => ({ ...fileResult, ...result }),
        getCandidateKnowledgeReadiness: async () => readiness({ sourceCount: 1, readyCount: 1 }),
      },
      workspaceId: "workspace-1",
      target,
      displayName: "Career evidence",
      source: { kind: "file" },
      isCurrent: () => true,
      onChanged: async () => true,
    });

  it("says a file is already in Career evidence when the host reports identical content", async () => {
    await expect(addFile({ created: false, outcome: "already-present" })).resolves.toEqual({
      status: "added",
      message: "Already in Career evidence. 1 source, 1 ready.",
    });
  });

  it("says a changed file became a new version of its source, not a second source", async () => {
    await expect(addFile({ version: 2, outcome: "new-version" })).resolves.toEqual({
      status: "added",
      message: "Added a new version of that file to Career evidence. 1 source, 1 ready.",
    });
  });

  it("reports a brand-new file as added", async () => {
    await expect(addFile({ outcome: "added" })).resolves.toEqual({
      status: "added",
      message: "Added to Career evidence. 1 source, 1 ready.",
    });
  });

  const folderResult = (overrides: Record<string, unknown> = {}) => ({
    ...target,
    status: "complete" as const,
    scannedEntryCount: 3,
    discoveredFileCount: 2,
    skippedEntryCount: 1,
    sourceCount: 2,
    sources: [],
    sourcesTruncated: false,
    ...overrides,
  });
  const addFolder = (result: ReturnType<typeof folderResult>, afterImport?: () => Promise<void>) =>
    addCareerEvidence({
      capabilities: {
        importCandidateKnowledgeDirectory: async () => result,
        getCandidateKnowledgeReadiness: async () => readiness({ sourceCount: 5, readyCount: 5 }),
      },
      workspaceId: "workspace-1",
      target,
      displayName: "Engineering",
      source: { kind: "directory" },
      isCurrent: () => true,
      onChanged: async () => true,
      ...(afterImport === undefined ? {} : { afterImport }),
    });

  it("imports a folder into the selected base and says how many sources it added", async () => {
    await expect(addFolder(folderResult())).resolves.toEqual({
      status: "added",
      message: "Added 2 sources from the folder to Engineering. 5 sources, 5 ready.",
    });
    await expect(addFolder(folderResult({ status: "partial", sourceCount: 1 }))).resolves.toEqual({
      status: "added",
      message:
        "Added 1 source from the folder to Engineering. Some files could not be imported. 5 sources, 5 ready.",
    });
  });

  it("fails on a folder with nothing to add, before a first add selects the base", async () => {
    const afterImport = vi.fn(async () => undefined);
    await expect(addFolder(folderResult({ sourceCount: 0 }), afterImport)).rejects.toThrow(
      "The folder has no supported files to add.",
    );
    expect(afterImport).not.toHaveBeenCalled();
  });

  it("imports a URL into the selected base only through the knowledge port", async () => {
    const importCandidateKnowledgeUrl = vi.fn(async () => ({
      ...target,
      sourceId: "source-2",
      kind: "url" as const,
      versionId: "version-1",
      version: 1,
      created: false,
    }));
    const importCandidateKnowledgeFile = vi.fn();
    const outcome = await addCareerEvidence({
      capabilities: {
        importCandidateKnowledgeUrl,
        importCandidateKnowledgeFile,
        getCandidateKnowledgeReadiness: async () => readiness({ sourceCount: 1, readyCount: 1 }),
      },
      workspaceId: "workspace-1",
      target,
      displayName: "Engineering",
      source: { kind: "url", url: "https://example.com/cv" },
      isCurrent: () => true,
      onChanged: async () => true,
    });
    expect(importCandidateKnowledgeUrl).toHaveBeenCalledWith(
      "store-1",
      "base-1",
      "https://example.com/cv",
    );
    expect(importCandidateKnowledgeFile).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: "added",
      message: "Already in Engineering. 1 source, 1 ready.",
    });
  });

  it("rejects an import result for another base and does not refresh", async () => {
    const onChanged = vi.fn(async () => true);
    await expect(
      addCareerEvidence({
        capabilities: {
          importCandidateKnowledgeFile: async () => ({ ...fileResult, knowledgeBaseId: "base-2" }),
          getCandidateKnowledgeReadiness: async () => readiness(),
        },
        workspaceId: "workspace-1",
        target,
        displayName: "Engineering",
        source: { kind: "file" },
        isCurrent: () => true,
        onChanged,
      }),
    ).rejects.toThrow("did not match the selected knowledge base");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("lets a dismissed picker propagate and ignores a stale workspace", async () => {
    await expect(
      addCareerEvidence({
        capabilities: {
          importCandidateKnowledgeFile: async () => {
            throw Object.assign(new Error("Candidate knowledge file import was cancelled."), {
              code: "permission-denied",
            });
          },
          getCandidateKnowledgeReadiness: async () => readiness(),
        },
        workspaceId: "workspace-1",
        target,
        displayName: "Engineering",
        source: { kind: "file" },
        isCurrent: () => true,
        onChanged: async () => true,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const onChanged = vi.fn(async () => true);
    await expect(
      addCareerEvidence({
        capabilities: {
          importCandidateKnowledgeFile: async () => fileResult,
          getCandidateKnowledgeReadiness: async () => readiness(),
        },
        workspaceId: "workspace-1",
        target,
        displayName: "Engineering",
        source: { kind: "file" },
        isCurrent: () => false,
        onChanged,
      }),
    ).resolves.toEqual({ status: "stale" });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps the import when readiness or the refresh is unavailable", async () => {
    const outcome = await addCareerEvidence({
      capabilities: {
        importCandidateKnowledgeFile: async () => fileResult,
        getCandidateKnowledgeReadiness: async () => {
          throw new Error("unavailable");
        },
      },
      workspaceId: "workspace-1",
      target,
      displayName: "Engineering",
      source: { kind: "file" },
      isCurrent: () => true,
      onChanged: async () => {
        throw new Error("unavailable");
      },
    });
    expect(outcome).toEqual({
      status: "added",
      message:
        "Added to Engineering. Readiness could not be checked. Reopen the workspace to refresh the review.",
    });
  });
});
