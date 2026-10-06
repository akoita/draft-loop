import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCandidateKnowledgeStore } from "@draft-loop/storage/knowledge-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import type { CanonicalCandidateProfileExtractionRequest } from "./candidate-profile-extraction.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-09-01T09:00:00.000Z";
const retiredAt = "2026-09-02T09:00:00.000Z";
const keptMarker = "SYNTHETIC-KEPT-MARKER";
const retiredMarker = "SYNTHETIC-RETIRED-MARKER";
const knowledgeBaseId = "ckb-1";

describe("selection snapshots with retired sources", () => {
  let parent: string;
  let storeRoot: string;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "draft-loop-retired-selection-"));
    storeRoot = join(parent, "candidate-knowledge");
  });

  afterEach(async () => {
    await rm(parent, { force: true, recursive: true });
  });

  /** Imports one Markdown source per entry, in order, so source ids are `source-<n>`. */
  async function createService(contents: readonly string[], extraIds: readonly string[] = []) {
    const ids = ["store-1", knowledgeBaseId];
    contents.forEach((_, index) => {
      ids.push(`source-${index + 1}`, `version-${index + 1}`);
    });
    ids.push(...extraIds);
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    for (const [index, content] of contents.entries()) {
      const sourcePath = join(parent, `source-${index + 1}.md`);
      await writeFile(sourcePath, content, "utf8");
      await service.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
    }
    return service;
  }

  const selection = () => ({ selections: [{ storeRoot, knowledgeBaseId }] });

  async function observeChanged(sourceId: string, versionId: string): Promise<void> {
    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      await store.upsertCandidateKnowledgeSourceRefreshObservation(knowledgeBaseId, sourceId, {
        observedVersionId: versionId,
        status: "changed",
        checkedAt: retiredAt,
      });
    } finally {
      await store.close();
    }
  }

  it("omits a retired source and keeps the ready one", async () => {
    const service = await createService([
      `# Kept\n${keptMarker} delivery.\n`,
      `# Retired\n${retiredMarker} delivery.\n`,
    ]);
    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-2" });

    const snapshot = await service.createKnowledgeSelectionSnapshot(selection());

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.sources.map((source) => source.sourceId)).toEqual(["source-1"]);
    expect(snapshot.entries[0]?.sources[0]?.lifecycleRevision.retirement).toBeNull();
  });

  it("keeps reporting the retired source as blocked in readiness", async () => {
    const service = await createService(["# Kept\nkept.\n", "# Retired\nretired.\n"]);
    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-2" });

    const readiness = await service.getKnowledgeBaseLifecycleReadiness({
      storeRoot,
      knowledgeBaseId,
    });

    expect(
      readiness.sources.map(({ sourceId, status, reasons }) => ({ sourceId, status, reasons })),
    ).toEqual([
      { sourceId: "source-1", status: "ready", reasons: [] },
      { sourceId: "source-2", status: "blocked", reasons: ["source-retired"] },
    ]);
  });

  it("omits a retired source even when it has another blocking reason", async () => {
    const service = await createService(["# Kept\nkept.\n", "# Retired\nretired.\n"]);
    await observeChanged("source-2", "version-2");
    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-2" });

    const snapshot = await service.createKnowledgeSelectionSnapshot(selection());

    expect(snapshot.entries[0]?.sources.map((source) => source.sourceId)).toEqual(["source-1"]);
  });

  it("never retrieves chunks of a source retired after it was indexed", async () => {
    const service = await createService([
      `# Kept\n${keptMarker} shared delivery.\n`,
      `# Retired\n${retiredMarker} shared delivery.\n`,
    ]);
    const before = await service.queryCandidateKnowledge({
      ...selection(),
      purpose: "achievement-recall",
      query: "shared delivery",
      limit: 10,
    });
    expect(JSON.stringify(before.hits)).toContain(retiredMarker);

    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-2" });
    const after = await service.queryCandidateKnowledge({
      ...selection(),
      purpose: "achievement-recall",
      query: "shared delivery",
      limit: 10,
    });

    expect(after.hits.length).toBeGreaterThan(0);
    expect(JSON.stringify(after)).toContain(keptMarker);
    expect(JSON.stringify(after)).not.toContain(retiredMarker);
    expect(after.hits.every((hit) => hit.metadata.provenance.sourceId === "source-1")).toBe(true);
    expect(after.indexedChunkCount).toBe(1);
  });

  it("never sends a retired source's text to profile derivation", async () => {
    const service = await createService([
      `# Kept\n${keptMarker} delivery.\n`,
      `# Retired\n${retiredMarker} delivery.\n`,
    ]);
    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-2" });
    const requests: CanonicalCandidateProfileExtractionRequest[] = [];
    const derivation = createCanonicalCandidateProfileDerivationService({
      persistence: {
        getLatestCanonicalCandidateProfile: vi.fn(async () => undefined),
        saveCanonicalCandidateProfile: vi.fn(async (workspaceId, profile) => ({
          workspaceId,
          profile,
          checksum: "a".repeat(64),
        })),
      },
      extractor: {
        extract: (request) => {
          requests.push(request);
          return { schemaVersion: 1, facts: [], issues: [] };
        },
      },
      knowledgeService: service,
      now: () => createdAt,
    });

    await derivation
      .deriveCanonicalCandidateProfile({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        ...selection(),
        allowProviderData: true,
      })
      .catch(() => undefined);

    expect(requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(requests)).toContain(keptMarker);
    expect(JSON.stringify(requests)).not.toContain(retiredMarker);
  });

  it("still fails when every source is retired", async () => {
    const service = await createService(["# One\none.\n", "# Two\ntwo.\n"]);
    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-1" });
    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-2" });

    await expect(service.createKnowledgeSelectionSnapshot(selection())).rejects.toThrow(
      "The selected candidate knowledge base selection snapshot could not be created.",
    );
  });

  it("still fails when a non-retired source is blocked", async () => {
    const service = await createService(["# Kept\nkept.\n", "# Changed\nchanged.\n"]);
    await observeChanged("source-2", "version-2");

    await expect(service.createKnowledgeSelectionSnapshot(selection())).rejects.toThrow(
      "The selected candidate knowledge base selection snapshot could not be created.",
    );
  });

  it("still fails when a retired source sits beside a blocked non-retired source", async () => {
    const service = await createService(["# Kept\nkept.\n", "# Retired\nr.\n", "# Changed\nc.\n"]);
    await service.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: "source-2" });
    await observeChanged("source-3", "version-3");

    await expect(service.createKnowledgeSelectionSnapshot(selection())).rejects.toThrow(
      "The selected candidate knowledge base selection snapshot could not be created.",
    );
  });

  it("still fails for an archived knowledge base", async () => {
    const service = await createService(
      ["# Default\ndefault.\n"],
      ["ckb-2", "source-x", "version-x"],
    );
    await service.createKnowledgeBase({ storeRoot, displayName: "Second" });
    const sourcePath = join(parent, "second.md");
    await writeFile(sourcePath, "# Second\nsecond.\n", "utf8");
    await service.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId: "ckb-2", sourcePath });
    const second = { selections: [{ storeRoot, knowledgeBaseId: "ckb-2" }] };
    await expect(service.createKnowledgeSelectionSnapshot(second)).resolves.toBeDefined();

    await service.archiveKnowledgeBase({ storeRoot, knowledgeBaseId: "ckb-2" });

    await expect(service.createKnowledgeSelectionSnapshot(second)).rejects.toThrow(
      "The selected candidate knowledge base selection snapshot could not be created.",
    );
  });
});
