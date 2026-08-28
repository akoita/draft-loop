import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CanonicalCandidateProfile,
  CanonicalCandidateProfileInput,
} from "@draft-loop/schemas";
import type {
  CanonicalCandidateProfileStoragePort,
  CanonicalCandidateProfileVersionRecord,
  WorkspaceRecord,
} from "@draft-loop/storage";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import {
  buildCanonicalCandidateProfile,
  canonicalCandidateProfileChecksum,
} from "./candidate-profile.js";
import {
  canonicalCandidateProfileCorruptRecordErrorMessage,
  canonicalCandidateProfileIdentityErrorMessage,
  canonicalCandidateProfileNotFoundErrorMessage,
  canonicalCandidateProfilePatchErrorMessage,
  canonicalCandidateProfileVersionStaleErrorMessage,
  createCanonicalCandidateProfilePersistenceService,
} from "./candidate-profile-persistence.js";

const createdAt = "2026-08-27T10:00:00.000Z";
const editedAt = "2026-08-27T10:05:00.000Z";
const reviewedAt = "2026-08-27T10:10:00.000Z";

function selection() {
  return {
    capturedAt: createdAt,
    entries: [
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        sources: [
          {
            sourceId: "source-1",
            versionId: "version-1",
            lifecycleRevision: {
              knowledgeBaseState: "active" as const,
              knowledgeBaseArchivedAt: null,
              versionId: "version-1",
              version: 1,
              createdAt: "2026-08-27T09:00:00.000Z",
              managed: true,
              originBoundAt: "2026-08-27T09:00:00.000Z",
              observation: null,
              retirement: null,
              provenanceFetchedAt: null,
              directory: null,
            },
          },
        ],
      },
    ],
  };
}

function profileInput(
  overrides: Partial<CanonicalCandidateProfileInput> = {},
): CanonicalCandidateProfileInput {
  return {
    id: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    candidateKnowledgeSelection: selection(),
    facts: [
      {
        id: "fact-1",
        category: "role",
        field: "title",
        value: "Platform Engineer",
        provenance: [
          {
            storeId: "store-1",
            knowledgeBaseId: "knowledge-1",
            sourceId: "source-1",
            versionId: "version-1",
            kind: "candidate-provided",
          },
        ],
      },
    ],
    issues: [],
    ...overrides,
  };
}

function profile(
  overrides: Partial<CanonicalCandidateProfileInput> = {},
): CanonicalCandidateProfile {
  return buildCanonicalCandidateProfile(profileInput(overrides));
}

function createMemoryStorage(): {
  readonly storage: CanonicalCandidateProfileStoragePort;
  readonly records: Map<string, CanonicalCandidateProfileVersionRecord>;
} {
  const records = new Map<string, CanonicalCandidateProfileVersionRecord>();
  const key = (workspaceId: string, profileId: string, version: number): string =>
    `${workspaceId}\u0000${profileId}\u0000${version}`;
  const copy = (record: CanonicalCandidateProfileVersionRecord) => structuredClone(record);

  const storage: CanonicalCandidateProfileStoragePort = {
    saveCanonicalCandidateProfile: vi.fn(async (workspaceId, candidateProfile) => {
      const record: CanonicalCandidateProfileVersionRecord = {
        workspaceId,
        profile: structuredClone(candidateProfile),
        checksum: canonicalCandidateProfileChecksum(candidateProfile),
      };
      records.set(key(workspaceId, candidateProfile.id, candidateProfile.version), record);
      return copy(record);
    }),
    getCanonicalCandidateProfile: vi.fn(async (workspaceId, profileId, version) => {
      const record = records.get(key(workspaceId, profileId, version));
      return record === undefined ? undefined : copy(record);
    }),
    getLatestCanonicalCandidateProfile: vi.fn(async (workspaceId, profileId) => {
      const latest = [...records.values()]
        .filter((record) => record.workspaceId === workspaceId && record.profile.id === profileId)
        .sort((left, right) => right.profile.version - left.profile.version)[0];
      return latest === undefined ? undefined : copy(latest);
    }),
    listCanonicalCandidateProfileVersions: vi.fn(async (workspaceId, profileId) =>
      [...records.values()]
        .filter((record) => record.workspaceId === workspaceId && record.profile.id === profileId)
        .sort((left, right) => left.profile.version - right.profile.version)
        .map(copy),
    ),
  };
  return { storage, records };
}

function storageWith(
  overrides: Partial<CanonicalCandidateProfileStoragePort>,
): CanonicalCandidateProfileStoragePort {
  return { ...createMemoryStorage().storage, ...overrides };
}

describe("canonical candidate profile persistence service", () => {
  it("saves, reloads, lists, and freezes records across service restarts", async () => {
    const { storage } = createMemoryStorage();
    const service = createCanonicalCandidateProfilePersistenceService(storage);
    const initial = profile();

    const saved = await service.saveCanonicalCandidateProfile("workspace-1", initial);
    const exact = await service.getCanonicalCandidateProfile("workspace-1", initial.id, 1);
    const restarted = createCanonicalCandidateProfilePersistenceService(storage);
    const latest = await restarted.getLatestCanonicalCandidateProfile("workspace-1", initial.id);
    const versions = await restarted.listCanonicalCandidateProfileVersions(
      "workspace-1",
      initial.id,
    );

    expect(Object.isFrozen(service)).toBe(true);
    expect(saved.profile).toEqual(initial);
    expect(exact?.profile).toEqual(initial);
    expect(latest?.profile).toEqual(initial);
    expect(versions.map((record) => record.profile.version)).toEqual([1]);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.profile)).toBe(true);
    expect(Object.isFrozen(saved.profile.facts)).toBe(true);
    expect(Object.isFrozen(saved.profile.facts[0]?.provenance)).toBe(true);
    expect(Object.isFrozen(versions)).toBe(true);
    expect(Object.isFrozen(versions[0])).toBe(true);
    expect(Object.isFrozen(versions[0]?.profile)).toBe(true);
    expect(storage.saveCanonicalCandidateProfile).toHaveBeenCalledOnce();
    expect(storage.getCanonicalCandidateProfile).toHaveBeenCalledWith("workspace-1", initial.id, 1);
    expect(storage.getLatestCanonicalCandidateProfile).toHaveBeenCalledWith(
      "workspace-1",
      initial.id,
    );
    expect(storage.listCanonicalCandidateProfileVersions).toHaveBeenCalledWith(
      "workspace-1",
      initial.id,
    );
    expect(() => {
      (exact?.profile.facts[0] as { value: string }).value = "changed";
    }).toThrow(TypeError);
  });

  it("matches the SQLite payload checksum and reloads through the application boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-canonical-profile-application-"));
    const filename = join(directory, "history.sqlite");
    const workspace: WorkspaceRecord = {
      id: "workspace-sqlite",
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    };
    const first = openSqliteStorage(filename);

    try {
      await first.saveWorkspace(workspace);
      const service = createCanonicalCandidateProfilePersistenceService(first);
      const saved = await service.saveCanonicalCandidateProfile(workspace.id, profile());

      expect(saved.checksum).toBe(canonicalCandidateProfileChecksum(saved.profile));
      await expect(
        first.getLatestCanonicalCandidateProfile(workspace.id, saved.profile.id),
      ).resolves.toMatchObject({ checksum: canonicalCandidateProfileChecksum(saved.profile) });

      await first.close();
      const reopened = openSqliteStorage(filename);
      try {
        const restarted = createCanonicalCandidateProfilePersistenceService(reopened);
        await expect(
          restarted.getLatestCanonicalCandidateProfile(workspace.id, saved.profile.id),
        ).resolves.toEqual(saved);
      } finally {
        await reopened.close();
      }
    } finally {
      await first.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects whitespace-padded workspace and profile identities at the application boundary", async () => {
    const { storage } = createMemoryStorage();
    const service = createCanonicalCandidateProfilePersistenceService(storage);

    await expect(service.saveCanonicalCandidateProfile(" workspace-1", profile())).rejects.toThrow(
      canonicalCandidateProfileIdentityErrorMessage,
    );
    await expect(
      service.saveCanonicalCandidateProfile(
        "workspace-1",
        profileInput({ id: " profile-1 " }) as never,
      ),
    ).rejects.toThrow(canonicalCandidateProfileIdentityErrorMessage);

    await service.saveCanonicalCandidateProfile("workspace-1", profile());
    await expect(
      service.getCanonicalCandidateProfile("workspace-1", " profile-1", 1),
    ).rejects.toThrow(canonicalCandidateProfileIdentityErrorMessage);
    await expect(
      service.getLatestCanonicalCandidateProfile(" workspace-1", "profile-1"),
    ).rejects.toThrow(canonicalCandidateProfileIdentityErrorMessage);
    await expect(
      service.listCanonicalCandidateProfileVersions("workspace-1", "profile-1 "),
    ).rejects.toThrow(canonicalCandidateProfileIdentityErrorMessage);
  });

  it("creates immediate edit and review children while preserving lineage and provenance", async () => {
    const { storage } = createMemoryStorage();
    const service = createCanonicalCandidateProfilePersistenceService(storage);
    const initial = await service.saveCanonicalCandidateProfile("workspace-1", profile());
    const initialSelection = initial.profile.candidateKnowledgeSelection;
    const initialProvenance = initial.profile.facts[0]?.provenance;
    const initialFact = initial.profile.facts[0];
    if (initialFact === undefined) throw new Error("the profile fixture is incomplete");

    const edited = await service.editLatestCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: initial.profile.id,
      expectedVersion: 1,
      updatedAt: editedAt,
      patch: {
        facts: [
          {
            ...initialFact,
            value: "Staff Platform Engineer",
          },
        ],
        issues: [
          {
            id: "issue-omission",
            code: "omission",
            severity: "warning",
            status: "acknowledged",
            message: "A field needs candidate confirmation.",
          },
        ],
      },
    });
    const reviewed = await service.reviewLatestCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: initial.profile.id,
      expectedVersion: 2,
      reviewedAt,
    });

    expect(edited.profile).toMatchObject({
      id: initial.profile.id,
      version: 2,
      parentVersion: 1,
      status: "draft",
      createdAt: initial.profile.createdAt,
      updatedAt: editedAt,
    });
    expect(edited.profile).not.toHaveProperty("reviewedAt");
    expect(edited.profile.candidateKnowledgeSelection).toEqual(initialSelection);
    expect(edited.profile.facts[0]?.provenance).toEqual(initialProvenance);
    expect(reviewed.profile).toMatchObject({
      id: initial.profile.id,
      version: 3,
      parentVersion: 2,
      status: "reviewed",
      createdAt: initial.profile.createdAt,
      updatedAt: reviewedAt,
      reviewedAt,
    });
    expect(
      (await service.listCanonicalCandidateProfileVersions("workspace-1", initial.profile.id)).map(
        (record) => [record.profile.version, record.profile.parentVersion, record.profile.status],
      ),
    ).toEqual([
      [1, null, "draft"],
      [2, 1, "draft"],
      [3, 2, "reviewed"],
    ]);
    expect(storage.saveCanonicalCandidateProfile).toHaveBeenCalledTimes(3);
    expect(storage.getLatestCanonicalCandidateProfile).toHaveBeenCalledTimes(2);
  });

  it("rejects empty or unknown patches and stale or missing optimistic operations", async () => {
    const { storage } = createMemoryStorage();
    const service = createCanonicalCandidateProfilePersistenceService(storage);
    const workspaceId = "workspace-with-private-content";
    const profileId = "profile-with-private-content";

    await expect(
      service.editLatestCanonicalCandidateProfile({
        workspaceId,
        profileId,
        expectedVersion: 1,
        updatedAt: editedAt,
        patch: {},
      }),
    ).rejects.toThrow(canonicalCandidateProfileNotFoundErrorMessage);
    await expect(
      service.reviewLatestCanonicalCandidateProfile({
        workspaceId,
        profileId,
        expectedVersion: 1,
        reviewedAt,
      }),
    ).rejects.toThrow(canonicalCandidateProfileNotFoundErrorMessage);

    await service.saveCanonicalCandidateProfile(workspaceId, profile({ id: profileId }));
    await expect(
      service.editLatestCanonicalCandidateProfile({
        workspaceId,
        profileId,
        expectedVersion: 1,
        updatedAt: editedAt,
        patch: {},
      }),
    ).rejects.toThrow(canonicalCandidateProfilePatchErrorMessage);
    await expect(
      service.editLatestCanonicalCandidateProfile({
        workspaceId,
        profileId,
        expectedVersion: 1,
        updatedAt: editedAt,
        patch: { candidateKnowledgeSelection: selection() } as never,
      }),
    ).rejects.toThrow(canonicalCandidateProfilePatchErrorMessage);

    await service.editLatestCanonicalCandidateProfile({
      workspaceId,
      profileId,
      expectedVersion: 1,
      updatedAt: editedAt,
      patch: { facts: profile().facts },
    });
    await expect(
      service.reviewLatestCanonicalCandidateProfile({
        workspaceId,
        profileId,
        expectedVersion: 1,
        reviewedAt,
      }),
    ).rejects.toThrow(canonicalCandidateProfileVersionStaleErrorMessage);
  });

  it("normalizes corrupt storage output to a fixed content-free error", async () => {
    const workspaceId = "private-workspace";
    const profileId = "private-profile";
    const validProfile = profile({ id: profileId });
    const validRecord: CanonicalCandidateProfileVersionRecord = {
      workspaceId,
      profile: validProfile,
      checksum: canonicalCandidateProfileChecksum(validProfile),
    };
    const errorText = async (operation: () => Promise<unknown>): Promise<string> =>
      operation().then(
        () => "did not reject",
        (error: unknown) => String(error),
      );
    const expectCorrupt = (error: string): void => {
      expect(error).toBe(`Error: ${canonicalCandidateProfileCorruptRecordErrorMessage}`);
      expect(error).not.toContain(workspaceId);
      expect(error).not.toContain(profileId);
      expect(error).not.toContain("private candidate detail");
    };

    const exactCases: readonly CanonicalCandidateProfileVersionRecord[] = [
      { ...validRecord, workspaceId: "other-workspace" },
      { ...validRecord, profile: profile({ id: "other-profile" }) },
      {
        ...validRecord,
        profile: profile({ id: profileId, version: 2, parentVersion: 1 }),
      },
      { ...validRecord, checksum: "private-checksum" },
      {
        ...validRecord,
        checksum: canonicalCandidateProfileChecksum(profile({ id: "other-profile" })),
      },
      { ...validRecord, extra: "private candidate detail" } as never,
      {
        ...validRecord,
        profile: { ...validProfile, privateContent: "private candidate detail" } as never,
      },
    ];
    for (const record of exactCases) {
      const { storage, records } = createMemoryStorage();
      records.set(`${workspaceId}\u0000${profileId}\u00001`, record);
      expectCorrupt(
        await errorText(() =>
          createCanonicalCandidateProfilePersistenceService(storage).getCanonicalCandidateProfile(
            workspaceId,
            profileId,
            1,
          ),
        ),
      );
    }

    expectCorrupt(
      await errorText(() =>
        createCanonicalCandidateProfilePersistenceService(
          storageWith({
            getLatestCanonicalCandidateProfile: async () => ({
              ...validRecord,
              profile: profile({ id: "other-profile" }),
            }),
          }),
        ).getLatestCanonicalCandidateProfile(workspaceId, profileId),
      ),
    );

    const versionTwo: CanonicalCandidateProfileVersionRecord = {
      ...validRecord,
      profile: profile({ id: profileId, version: 2, parentVersion: 1 }),
      checksum: canonicalCandidateProfileChecksum(
        profile({ id: profileId, version: 2, parentVersion: 1 }),
      ),
    };
    const unorderedAndDuplicateCases: readonly (readonly CanonicalCandidateProfileVersionRecord[])[] =
      [
        [versionTwo, validRecord],
        [validRecord, validRecord],
        [{ ...validRecord, workspaceId: "other-workspace" }],
      ];
    for (const records of unorderedAndDuplicateCases) {
      expectCorrupt(
        await errorText(() =>
          createCanonicalCandidateProfilePersistenceService(
            storageWith({ listCanonicalCandidateProfileVersions: async () => records }),
          ).listCanonicalCandidateProfileVersions(workspaceId, profileId),
        ),
      );
    }
  });

  it("lets the domain block empty and unresolved profiles from review", async () => {
    const emptyStorage = createMemoryStorage();
    const emptyService = createCanonicalCandidateProfilePersistenceService(emptyStorage.storage);
    await emptyService.saveCanonicalCandidateProfile(
      "workspace-empty",
      profile({ facts: [], candidateKnowledgeSelection: undefined }),
    );
    await expect(
      emptyService.reviewLatestCanonicalCandidateProfile({
        workspaceId: "workspace-empty",
        profileId: "profile-1",
        expectedVersion: 1,
        reviewedAt,
      }),
    ).rejects.toThrow(/at least one fact/i);

    const unresolvedStorage = createMemoryStorage();
    const unresolvedService = createCanonicalCandidateProfilePersistenceService(
      unresolvedStorage.storage,
    );
    await unresolvedService.saveCanonicalCandidateProfile(
      "workspace-open",
      profile({
        issues: [
          {
            id: "issue-open",
            code: "omission",
            severity: "warning",
            status: "open",
            message: "A field needs candidate confirmation.",
          },
        ],
      }),
    );
    await expect(
      unresolvedService.reviewLatestCanonicalCandidateProfile({
        workspaceId: "workspace-open",
        profileId: "profile-1",
        expectedVersion: 1,
        reviewedAt,
      }),
    ).rejects.toThrow(/open error|acknowledged|resolved/i);
    expect(unresolvedStorage.storage.saveCanonicalCandidateProfile).toHaveBeenCalledOnce();
  });
});
