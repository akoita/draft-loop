import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateKnowledgeSelectionSnapshot } from "@draft-loop/domain";
import {
  canonicalCandidateProfileFactCategories,
  createCandidateKnowledgeSelectionSnapshot,
} from "@draft-loop/domain";
import type { CanonicalCandidateProfileExtractionProposal } from "@draft-loop/schemas";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { describe, expect, it, vi } from "vitest";

import {
  canonicalCandidateProfileDerivationApprovalErrorMessage,
  canonicalCandidateProfileDerivationErrorMessage,
  canonicalCandidateProfileSelectionStaleErrorMessage,
  createCanonicalCandidateProfileDerivationService,
} from "./candidate-profile-derivation.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const checksum = "a".repeat(64);

function extractionProposal(
  sourceId: string,
  quote: string,
): CanonicalCandidateProfileExtractionProposal {
  return {
    schemaVersion: 1,
    facts: canonicalCandidateProfileFactCategories.map((category, index) => ({
      key: `fact-${index + 1}`,
      category,
      ...(category === "role" || category === "employer" || category === "date"
        ? { subjectKey: "employment-example" }
        : {}),
      field: `${category}-field`,
      value: quote,
      evidence: [{ sourceId, quote }],
    })),
    issues: [],
  };
}

function snapshot(versionId = "version-1"): CandidateKnowledgeSelectionSnapshot {
  return createCandidateKnowledgeSelectionSnapshot({
    capturedAt: createdAt,
    entries: [
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        sources: [
          {
            sourceId: "source-1",
            versionId,
            lifecycleRevision: {
              knowledgeBaseState: "active",
              knowledgeBaseArchivedAt: null,
              versionId,
              version: versionId === "version-1" ? 1 : 2,
              createdAt,
              managed: true,
              originBoundAt: createdAt,
              observation: null,
              retirement: null,
              provenanceFetchedAt: null,
              directory: null,
            },
          },
        ],
      },
    ],
  });
}

describe("canonical candidate profile derivation", () => {
  it("derives and persists all profile categories from exact verified CKB bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-derivation-"));
    const storeRoot = join(directory, "knowledge-store");
    const sourcePath = join(directory, "career.md");
    const databasePath = join(directory, "workspace.sqlite");
    const knowledgeService = createCandidateKnowledgeStoreService({
      now: () => createdAt,
    });
    const storage = openSqliteStorage(databasePath);
    const workspace: WorkspaceRecord = {
      id: "workspace-1",
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    };
    const extract = vi.fn(async (request) => {
      const sourceId = request.sources[0]?.id;
      if (sourceId === undefined) throw new Error("missing source");
      return extractionProposal(sourceId, request.sources[0]?.text ?? "");
    });

    try {
      await writeFile(
        sourcePath,
        "# Career history\n\nCandidate-provided representative experience.",
        "utf8",
      );
      const initialized = await knowledgeService.initializeStore({
        storeRoot,
        displayName: "Career evidence",
      });
      const knowledgeBaseId = initialized.knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("missing knowledge base");
      await knowledgeService.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId,
        sourcePath,
      });
      await storage.saveWorkspace(workspace);

      const service = createCanonicalCandidateProfileDerivationService({
        persistence: createCanonicalCandidateProfilePersistenceService(storage),
        extractor: { extract },
        knowledgeService,
        now: () => createdAt,
      });
      const saved = await service.deriveCanonicalCandidateProfile({
        workspaceId: workspace.id,
        profileId: "profile-1",
        selections: [{ storeRoot, knowledgeBaseId: ` ${knowledgeBaseId} ` }],
        allowProviderData: true,
      });
      const refreshed = await service.deriveCanonicalCandidateProfile({
        workspaceId: workspace.id,
        profileId: "profile-1",
        selections: [{ storeRoot, knowledgeBaseId: ` ${knowledgeBaseId} ` }],
        allowProviderData: true,
      });

      expect(saved.profile.facts.map((fact) => fact.category).sort()).toEqual(
        [...canonicalCandidateProfileFactCategories].sort(),
      );
      expect(saved.profile.issues).toEqual([]);
      expect(saved.profile.candidateKnowledgeSelection?.entries[0]).toMatchObject({
        storeId: initialized.store.id,
        knowledgeBaseId,
      });
      expect(
        saved.profile.facts.every(
          (fact) =>
            fact.provenance.length === 1 &&
            fact.provenance[0]?.kind === "candidate-provided" &&
            fact.provenance[0]?.sourceId ===
              saved.profile.candidateKnowledgeSelection?.entries[0]?.sources[0]?.sourceId,
        ),
      ).toBe(true);
      expect(refreshed.profile).toMatchObject({
        version: 2,
        parentVersion: 1,
        status: "draft",
        createdAt: saved.profile.createdAt,
      });
      expect(await storage.getLatestCanonicalCandidateProfile(workspace.id, "profile-1")).toEqual(
        refreshed,
      );
      expect(JSON.stringify(saved)).not.toContain(sourcePath);
      expect(JSON.stringify(saved)).not.toContain(storeRoot);
      expect(JSON.stringify(extract.mock.calls)).not.toContain(sourcePath);
      expect(JSON.stringify(extract.mock.calls)).not.toContain(storeRoot);
      expect(extract).toHaveBeenCalledTimes(2);
    } finally {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires approval before reading local knowledge or invoking a provider", async () => {
    const createSnapshot = vi.fn(async () => snapshot());
    const openKnowledgeStore = vi.fn();
    const extract = vi.fn();
    const saveCanonicalCandidateProfile = vi.fn();
    const getLatestCanonicalCandidateProfile = vi.fn(async () => undefined);
    const service = createCanonicalCandidateProfileDerivationService({
      persistence: { getLatestCanonicalCandidateProfile, saveCanonicalCandidateProfile },
      extractor: { extract },
      knowledgeService: { createKnowledgeSelectionSnapshot: createSnapshot },
      openKnowledgeStore,
      now: () => createdAt,
    });

    await expect(
      service.deriveCanonicalCandidateProfile({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
        allowProviderData: false,
      }),
    ).rejects.toThrow(canonicalCandidateProfileDerivationApprovalErrorMessage);
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(openKnowledgeStore).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(saveCanonicalCandidateProfile).not.toHaveBeenCalled();
  });

  it("rejects path-bearing snapshot identities before reading or persistence", async () => {
    const selected = snapshot();
    const selectedEntry = selected.entries[0];
    if (selectedEntry === undefined) throw new Error("missing selected entry");
    const unsafeSnapshot = {
      ...selected,
      entries: [{ ...selectedEntry, storeId: "/private/store" }],
    } as unknown as CandidateKnowledgeSelectionSnapshot;
    const openKnowledgeStore = vi.fn();
    const extract = vi.fn();
    const saveCanonicalCandidateProfile = vi.fn();
    const service = createCanonicalCandidateProfileDerivationService({
      persistence: {
        getLatestCanonicalCandidateProfile: vi.fn(async () => undefined),
        saveCanonicalCandidateProfile,
      },
      extractor: { extract },
      knowledgeService: {
        createKnowledgeSelectionSnapshot: vi.fn(async () => unsafeSnapshot),
      },
      openKnowledgeStore,
      now: () => createdAt,
    });

    await expect(
      service.deriveCanonicalCandidateProfile({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
        allowProviderData: true,
      }),
    ).rejects.toThrow(canonicalCandidateProfileDerivationErrorMessage);
    expect(openKnowledgeStore).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(saveCanonicalCandidateProfile).not.toHaveBeenCalled();
  });

  it("fails closed when lifecycle state changes between verified reads and extraction", async () => {
    const initial = snapshot();
    const changed = snapshot("version-2");
    const createKnowledgeSelectionSnapshot = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(changed);
    const close = vi.fn(async () => undefined);
    const handle = {
      descriptor: { schemaVersion: 1, id: "store-1", createdAt },
      readManagedCandidateKnowledgeSourceVersion: vi.fn(async () => ({
        metadata: {
          knowledgeBaseId: "knowledge-1",
          kind: "file",
          id: "version-1",
          sourceId: "source-1",
          version: 1,
          parentVersionId: null,
          mediaType: "text/markdown",
          checksum: createHashForText("Candidate history"),
          sizeBytes: Buffer.byteLength("Candidate history"),
          createdAt,
        },
        bytes: new TextEncoder().encode("Candidate history"),
      })),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const extract = vi.fn(async (request) =>
      extractionProposal(request.sources[0]?.id ?? "none", request.sources[0]?.text ?? ""),
    );
    const saveCanonicalCandidateProfile = vi.fn();
    const getLatestCanonicalCandidateProfile = vi.fn(async () => undefined);
    const service = createCanonicalCandidateProfileDerivationService({
      persistence: { getLatestCanonicalCandidateProfile, saveCanonicalCandidateProfile },
      extractor: { extract },
      knowledgeService: { createKnowledgeSelectionSnapshot },
      openKnowledgeStore: async () => handle,
      now: () => createdAt,
    });

    await expect(
      service.deriveCanonicalCandidateProfile({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
        allowProviderData: true,
      }),
    ).rejects.toThrow(canonicalCandidateProfileSelectionStaleErrorMessage);
    expect(close).toHaveBeenCalledOnce();
    expect(extract).not.toHaveBeenCalled();
    expect(saveCanonicalCandidateProfile).not.toHaveBeenCalled();
  });

  it("discards extracted facts when lifecycle state changes before persistence", async () => {
    const initial = snapshot();
    const changed = snapshot("version-2");
    const createKnowledgeSelectionSnapshot = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(changed);
    const content = "Candidate history";
    const handle = {
      descriptor: { schemaVersion: 1, id: "store-1", createdAt },
      readManagedCandidateKnowledgeSourceVersion: vi.fn(async () => ({
        metadata: {
          knowledgeBaseId: "knowledge-1",
          kind: "file",
          id: "version-1",
          sourceId: "source-1",
          version: 1,
          parentVersionId: null,
          mediaType: "text/markdown",
          checksum: createHashForText(content),
          sizeBytes: Buffer.byteLength(content),
          createdAt,
        },
        bytes: new TextEncoder().encode(content),
      })),
      close: vi.fn(async () => undefined),
    } as unknown as CandidateKnowledgeStoreHandle;
    const extract = vi.fn(async (request) =>
      extractionProposal(request.sources[0]?.id ?? "none", request.sources[0]?.text ?? ""),
    );
    const saveCanonicalCandidateProfile = vi.fn();
    const getLatestCanonicalCandidateProfile = vi.fn(async () => undefined);
    const service = createCanonicalCandidateProfileDerivationService({
      persistence: { getLatestCanonicalCandidateProfile, saveCanonicalCandidateProfile },
      extractor: { extract },
      knowledgeService: { createKnowledgeSelectionSnapshot },
      openKnowledgeStore: async () => handle,
      now: () => createdAt,
    });

    await expect(
      service.deriveCanonicalCandidateProfile({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
        allowProviderData: true,
      }),
    ).rejects.toThrow(canonicalCandidateProfileSelectionStaleErrorMessage);
    expect(extract).toHaveBeenCalledOnce();
    expect(saveCanonicalCandidateProfile).not.toHaveBeenCalled();
  });

  it("persists a path-free blocking omission when selected bytes cannot be normalized", async () => {
    const selected = snapshot();
    const createKnowledgeSelectionSnapshot = vi.fn(async () => selected);
    const close = vi.fn(async () => undefined);
    const handle = {
      descriptor: { schemaVersion: 1, id: "store-1", createdAt },
      readManagedCandidateKnowledgeSourceVersion: vi.fn(async () => ({
        metadata: {
          knowledgeBaseId: "knowledge-1",
          kind: "file",
          id: "version-1",
          sourceId: "source-1",
          version: 1,
          parentVersionId: null,
          mediaType: "application/pdf",
          checksum,
          sizeBytes: 4,
          createdAt,
        },
        bytes: new Uint8Array([0, 1, 2, 3]),
      })),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const extract = vi.fn();
    const saveCanonicalCandidateProfile = vi.fn(async (workspaceId, profile) => ({
      workspaceId,
      profile,
      checksum,
    }));
    const getLatestCanonicalCandidateProfile = vi.fn(async () => undefined);
    const service = createCanonicalCandidateProfileDerivationService({
      persistence: { getLatestCanonicalCandidateProfile, saveCanonicalCandidateProfile },
      extractor: { extract },
      knowledgeService: { createKnowledgeSelectionSnapshot },
      openKnowledgeStore: async () => handle,
      now: () => createdAt,
    });

    const saved = await service.deriveCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: "profile-1",
      selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
      allowProviderData: true,
    });

    expect(saved.profile.facts).toEqual([]);
    expect(saved.profile.issues).toHaveLength(1);
    expect(saved.profile.issues[0]).toMatchObject({ code: "omission", severity: "error" });
    expect(saved.profile.issues[0]?.sourceRefs[0]).toMatchObject({
      sourceId: "source-1",
      versionId: "version-1",
      kind: "candidate-provided",
    });
    expect(JSON.stringify(saved)).not.toContain("/private/store");
    expect(extract).not.toHaveBeenCalled();
  });
});

function createHashForText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
