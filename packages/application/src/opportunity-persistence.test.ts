import { createHash } from "node:crypto";

import type { OpportunityBrief, OpportunityBriefInput } from "@draft-loop/schemas";
import type {
  OpportunityBriefStoragePort,
  OpportunityBriefVersionRecord,
} from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import { buildOpportunityBrief } from "./opportunity-brief.js";
import { editOpportunityDraft, reviewOpportunityDraft } from "./opportunity-intake.js";
import {
  createOpportunityPersistenceService,
  opportunityBriefCorruptRecordErrorMessage,
  opportunityBriefNotFoundErrorMessage,
  opportunityBriefVersionStaleErrorMessage,
} from "./opportunity-persistence.js";

const createdAt = "2026-08-27T10:00:00.000Z";
const editedAt = "2026-08-27T10:05:00.000Z";
const reviewedAt = "2026-08-27T10:10:00.000Z";
const sourceChecksum = createHash("sha256").update("opportunity source", "utf8").digest("hex");

function opportunityBrief(overrides: Partial<OpportunityBriefInput> = {}): OpportunityBrief {
  return buildOpportunityBrief({
    schemaVersion: 1,
    id: "brief-1",
    version: 1,
    priorVersion: null,
    status: "draft",
    createdAt,
    reviewedAt: null,
    sources: [
      {
        id: "job-source",
        classification: "job-posting",
        status: "available",
        provenance: {
          kind: "pasted-content",
          capturedAt: createdAt,
          checksum: sourceChecksum,
        },
      },
    ],
    role: null,
    employer: null,
    responsibilities: [],
    requirements: [],
    priorities: [],
    candidateInstructions: {
      tone: null,
      applicationGoal: null,
      forbiddenLanguage: [],
      focusAreas: [],
    },
    issues: [],
    ...overrides,
  });
}

function createMemoryStorage(): {
  readonly storage: OpportunityBriefStoragePort;
  readonly records: Map<string, OpportunityBriefVersionRecord>;
} {
  const records = new Map<string, OpportunityBriefVersionRecord>();
  const key = (workspaceId: string, briefId: string, version: number): string =>
    `${workspaceId}\u0000${briefId}\u0000${version}`;
  const copy = (record: OpportunityBriefVersionRecord): OpportunityBriefVersionRecord =>
    structuredClone(record);

  const storage: OpportunityBriefStoragePort = {
    saveOpportunityBrief: vi.fn(async (workspaceId, brief) => {
      const record: OpportunityBriefVersionRecord = {
        workspaceId,
        brief: structuredClone(brief),
        checksum: createHash("sha256")
          .update(`${brief.id}\u0000${brief.version}`, "utf8")
          .digest("hex"),
      };
      records.set(key(workspaceId, brief.id, brief.version), record);
      return copy(record);
    }),
    getOpportunityBrief: vi.fn(async (workspaceId, briefId, version) => {
      const record = records.get(key(workspaceId, briefId, version));
      return record === undefined ? undefined : copy(record);
    }),
    getLatestOpportunityBrief: vi.fn(async (workspaceId, briefId) => {
      const latest = [...records.values()]
        .filter((record) => record.workspaceId === workspaceId && record.brief.id === briefId)
        .sort((left, right) => right.brief.version - left.brief.version)[0];
      return latest === undefined ? undefined : copy(latest);
    }),
    listOpportunityBriefVersions: vi.fn(async (workspaceId, briefId) =>
      [...records.values()]
        .filter((record) => record.workspaceId === workspaceId && record.brief.id === briefId)
        .sort((left, right) => left.brief.version - right.brief.version)
        .map(copy),
    ),
  };
  return { storage, records };
}

function storageWith(overrides: Partial<OpportunityBriefStoragePort>): OpportunityBriefStoragePort {
  return { ...createMemoryStorage().storage, ...overrides };
}

function completeDraft(): OpportunityBrief {
  return editOpportunityDraft(
    opportunityBrief(),
    {
      role: { value: "Platform Engineer", sourceIds: ["job-source"] },
      employer: { value: "Example Systems", sourceIds: ["job-source"] },
      requirements: [
        {
          id: "requirement-1",
          text: "Production systems experience",
          priority: "critical",
          sourceIds: ["job-source"],
        },
      ],
    },
    editedAt,
  );
}

describe("opportunity persistence service", () => {
  it("saves, loads, and lists deeply frozen brief copies", async () => {
    const { storage } = createMemoryStorage();
    const service = createOpportunityPersistenceService(storage);
    const draft = opportunityBrief();

    const saved = await service.saveOpportunityBrief("workspace-1", draft);
    const exact = await service.getOpportunityBrief("workspace-1", draft.id, draft.version);
    const latest = await service.getLatestOpportunityBrief("workspace-1", draft.id);
    const versions = await service.listOpportunityBriefVersions("workspace-1", draft.id);

    expect(Object.isFrozen(service)).toBe(true);
    expect(saved.brief).toEqual(draft);
    expect(exact?.brief).toEqual(draft);
    expect(latest?.brief).toEqual(draft);
    expect(versions.map((record) => record.brief.version)).toEqual([1]);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.brief)).toBe(true);
    expect(Object.isFrozen(saved.brief.sources)).toBe(true);
    expect(Object.isFrozen(versions)).toBe(true);
    expect(Object.isFrozen(versions[0])).toBe(true);
    expect(Object.isFrozen(versions[0]?.brief)).toBe(true);

    expect(() => {
      (exact?.brief as { id: string }).id = "changed";
    }).toThrow(TypeError);
    await expect(service.getOpportunityBrief("workspace-1", draft.id, 1)).resolves.toMatchObject({
      brief: { id: draft.id },
    });
    expect(storage.saveOpportunityBrief).toHaveBeenCalledOnce();
    expect(storage.getOpportunityBrief).toHaveBeenCalledWith("workspace-1", draft.id, 1);
    expect(storage.getLatestOpportunityBrief).toHaveBeenCalledWith("workspace-1", draft.id);
    expect(storage.listOpportunityBriefVersions).toHaveBeenCalledWith("workspace-1", draft.id);
  });

  it("creates edit and review versions with explicit lineage", async () => {
    const { storage } = createMemoryStorage();
    const service = createOpportunityPersistenceService(storage);
    const initial = await service.saveOpportunityBrief("workspace-1", opportunityBrief());

    const edited = await service.editLatestOpportunityBrief({
      workspaceId: "workspace-1",
      briefId: initial.brief.id,
      expectedVersion: 1,
      createdAt: editedAt,
      patch: {
        role: { value: "Platform Engineer", sourceIds: ["job-source"] },
        employer: { value: "Example Systems", sourceIds: ["job-source"] },
        requirements: [
          {
            id: "requirement-1",
            text: "Production systems experience",
            priority: "critical",
            sourceIds: ["job-source"],
          },
        ],
      },
    });
    const reviewed = await service.reviewLatestOpportunityBrief({
      workspaceId: "workspace-1",
      briefId: initial.brief.id,
      expectedVersion: 2,
      reviewedAt,
    });

    expect(edited.brief).toMatchObject({
      version: 2,
      priorVersion: 1,
      status: "draft",
      createdAt: editedAt,
      reviewedAt: null,
    });
    expect(reviewed.brief).toMatchObject({
      version: 3,
      priorVersion: 2,
      status: "reviewed",
      createdAt: reviewedAt,
      reviewedAt,
    });
    expect((await service.getOpportunityBrief("workspace-1", initial.brief.id, 1))?.brief).toEqual(
      initial.brief,
    );
    expect(
      (await service.listOpportunityBriefVersions("workspace-1", initial.brief.id)).map(
        (record) => [record.brief.version, record.brief.priorVersion, record.brief.status],
      ),
    ).toEqual([
      [1, null, "draft"],
      [2, 1, "draft"],
      [3, 2, "reviewed"],
    ]);
    expect(storage.saveOpportunityBrief).toHaveBeenCalledTimes(3);
    expect(storage.getLatestOpportunityBrief).toHaveBeenCalledTimes(2);
  });

  it("rejects corrupt records with fixed content-free errors at every read boundary", async () => {
    const workspaceId = "private-workspace-id";
    const briefId = "private-brief-id";
    const privateContent = "private candidate content";
    const validBrief = opportunityBrief({ id: briefId });
    const validRecord: OpportunityBriefVersionRecord = {
      workspaceId,
      brief: validBrief,
      checksum: "a".repeat(64),
    };
    const errorText = async (operation: () => Promise<unknown>): Promise<string> =>
      operation().then(
        () => "did not reject",
        (error: unknown) => String(error),
      );
    const expectCorrupt = (error: string): void => {
      expect(error).toBe(`Error: ${opportunityBriefCorruptRecordErrorMessage}`);
      expect(error).not.toContain(workspaceId);
      expect(error).not.toContain(briefId);
      expect(error).not.toContain(privateContent);
    };

    const saveError = await errorText(() =>
      createOpportunityPersistenceService(
        storageWith({
          saveOpportunityBrief: async () => ({
            ...validRecord,
            workspaceId: "other-private-workspace",
            brief: opportunityBrief({ id: "other-private-brief" }),
            checksum: "bad-checksum",
          }),
        }),
      ).saveOpportunityBrief(workspaceId, validBrief),
    );
    expectCorrupt(saveError);

    const exactCases: readonly OpportunityBriefVersionRecord[] = [
      {
        ...validRecord,
        workspaceId: "other-private-workspace",
      },
      {
        ...validRecord,
        brief: opportunityBrief({ id: "other-private-brief" }),
      },
      {
        ...validRecord,
        brief: opportunityBrief({ id: briefId, version: 2, priorVersion: 1 }),
      },
      {
        ...validRecord,
        checksum: "private-checksum",
      },
      {
        ...validRecord,
        brief: {
          ...validBrief,
          role: { value: privateContent, sourceIds: [] },
        } as never,
      },
    ];
    for (const record of exactCases) {
      const { storage, records } = createMemoryStorage();
      records.set(`${workspaceId}\u0000${briefId}\u00001`, record);
      expectCorrupt(
        await errorText(() =>
          createOpportunityPersistenceService(storage).getOpportunityBrief(workspaceId, briefId, 1),
        ),
      );
    }

    const latestCases: readonly OpportunityBriefVersionRecord[] = [
      {
        ...validRecord,
        workspaceId: "other-private-workspace",
      },
      {
        ...validRecord,
        brief: opportunityBrief({ id: "other-private-brief" }),
      },
    ];
    for (const record of latestCases) {
      expectCorrupt(
        await errorText(() =>
          createOpportunityPersistenceService(
            storageWith({ getLatestOpportunityBrief: async () => record }),
          ).getLatestOpportunityBrief(workspaceId, briefId),
        ),
      );
    }

    const versionTwo: OpportunityBriefVersionRecord = {
      ...validRecord,
      brief: opportunityBrief({ id: briefId, version: 2, priorVersion: 1 }),
      checksum: "b".repeat(64),
    };
    const unorderedAndDuplicateCases: readonly (readonly OpportunityBriefVersionRecord[])[] = [
      [versionTwo, validRecord],
      [validRecord, validRecord],
      [{ ...validRecord, workspaceId: "other-private-workspace" }],
      [{ ...validRecord, brief: opportunityBrief({ id: "other-private-brief" }) }],
    ];
    for (const records of unorderedAndDuplicateCases) {
      expectCorrupt(
        await errorText(() =>
          createOpportunityPersistenceService(
            storageWith({ listOpportunityBriefVersions: async () => records }),
          ).listOpportunityBriefVersions(workspaceId, briefId),
        ),
      );
    }
  });

  it("fails missing and stale latest operations with fixed errors", async () => {
    const { storage } = createMemoryStorage();
    const service = createOpportunityPersistenceService(storage);
    const workspaceId = "workspace-with-private-context";
    const briefId = "brief-with-private-content";

    await expect(
      service.editLatestOpportunityBrief({
        workspaceId,
        briefId,
        expectedVersion: 1,
        createdAt: editedAt,
        patch: {},
      }),
    ).rejects.toThrow(opportunityBriefNotFoundErrorMessage);
    await expect(
      service.reviewLatestOpportunityBrief({
        workspaceId,
        briefId,
        expectedVersion: 1,
        reviewedAt,
      }),
    ).rejects.toThrow(opportunityBriefNotFoundErrorMessage);

    await service.saveOpportunityBrief(workspaceId, opportunityBrief({ id: briefId }));
    const stale = await service.editLatestOpportunityBrief({
      workspaceId,
      briefId,
      expectedVersion: 1,
      createdAt: editedAt,
      patch: { role: { value: "Private candidate detail", sourceIds: ["job-source"] } },
    });
    expect(stale.brief.version).toBe(2);

    const staleError = await service
      .reviewLatestOpportunityBrief({
        workspaceId,
        briefId,
        expectedVersion: 1,
        reviewedAt,
      })
      .then(
        () => "did not reject",
        (error: unknown) => String(error),
      );
    expect(staleError).toBe(`Error: ${opportunityBriefVersionStaleErrorMessage}`);
    expect(staleError).not.toContain(workspaceId);
    expect(staleError).not.toContain(briefId);
    expect(staleError).not.toContain("Private candidate detail");
    expect(storage.saveOpportunityBrief).toHaveBeenCalledTimes(2);
  });

  it("propagates existing brief validation failures without saving", async () => {
    const { storage } = createMemoryStorage();
    const service = createOpportunityPersistenceService(storage);
    const draft = await service.saveOpportunityBrief("workspace-1", opportunityBrief());

    await expect(
      service.editLatestOpportunityBrief({
        workspaceId: "workspace-1",
        briefId: draft.brief.id,
        expectedVersion: 1,
        createdAt: editedAt,
        patch: {
          role: { value: "Unresolved source", sourceIds: ["missing-source"] },
        },
      }),
    ).rejects.toThrow(/sourceId must resolve/iu);
    await expect(
      service.reviewLatestOpportunityBrief({
        workspaceId: "workspace-1",
        briefId: draft.brief.id,
        expectedVersion: 1,
        reviewedAt,
      }),
    ).rejects.toThrow(/reviewed opportunity briefs require/iu);
    expect(storage.saveOpportunityBrief).toHaveBeenCalledOnce();
  });

  it("does not invoke intake or refetch sources while persisting existing provenance", async () => {
    const { storage } = createMemoryStorage();
    const service = createOpportunityPersistenceService(storage);
    const brief = opportunityBrief({
      sources: [
        {
          id: "approved-source",
          classification: "job-posting",
          status: "available",
          provenance: {
            kind: "approved-url",
            originalUrl: "https://jobs.example.test/private-role?token=local-only",
            capturedAt: createdAt,
            contentChecksum: sourceChecksum,
          },
        },
      ],
    });

    await service.saveOpportunityBrief("workspace-1", brief);
    await service.getLatestOpportunityBrief("workspace-1", brief.id);
    expect(storage.getLatestOpportunityBrief).toHaveBeenCalledOnce();
    expect(storage.saveOpportunityBrief).toHaveBeenCalledOnce();
  });

  it("can build the representative reviewed fixture without exposing a mutable pointer", async () => {
    const { storage } = createMemoryStorage();
    const service = createOpportunityPersistenceService(storage);
    const draft = completeDraft();
    const reviewed = reviewOpportunityDraft(draft, reviewedAt);
    const saved = await service.saveOpportunityBrief("workspace-1", reviewed);
    const loaded = await service.getLatestOpportunityBrief("workspace-1", reviewed.id);

    expect(saved.brief.status).toBe("reviewed");
    expect(loaded?.brief).toEqual(reviewed);
    expect(loaded).not.toBe(saved);
    expect(loaded?.brief).not.toBe(saved.brief);
    expect(Object.isFrozen(loaded?.brief.requirements)).toBe(true);
  });
});
