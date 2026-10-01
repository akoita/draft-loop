import type {
  CanonicalCandidateProfile,
  CanonicalCandidateProfileInput,
} from "@draft-loop/schemas";
import type {
  CanonicalCandidateProfileStoragePort,
  CanonicalCandidateProfileVersionRecord,
} from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import {
  buildCanonicalCandidateProfile,
  canonicalCandidateProfileChecksum,
} from "./candidate-profile.js";
import {
  canonicalCandidateProfileCorruptRecordErrorMessage,
  createCanonicalCandidateProfilePersistenceService,
} from "./candidate-profile-persistence.js";

const workspaceId = "workspace-catalog";
const timestamp = "2026-09-30T10:00:00.000Z";

function profile(
  id: string,
  version = 1,
  parentVersion: number | null = null,
): CanonicalCandidateProfile {
  const input: CanonicalCandidateProfileInput = {
    id,
    version,
    parentVersion,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    candidateKnowledgeSelection: {
      capturedAt: timestamp,
      entries: [
        {
          storeId: "store-1",
          knowledgeBaseId: "knowledge-1",
          sources: [
            {
              sourceId: "source-1",
              versionId: "version-1",
              lifecycleRevision: {
                knowledgeBaseState: "active",
                knowledgeBaseArchivedAt: null,
                versionId: "version-1",
                version: 1,
                createdAt: timestamp,
                managed: true,
                originBoundAt: timestamp,
                observation: null,
                retirement: null,
                provenanceFetchedAt: null,
                directory: null,
              },
            },
          ],
        },
      ],
    },
    facts: [],
    issues: [],
  };
  return buildCanonicalCandidateProfile(input);
}

function record(
  candidateProfile: CanonicalCandidateProfile,
  owner = workspaceId,
): CanonicalCandidateProfileVersionRecord {
  return {
    workspaceId: owner,
    profile: candidateProfile,
    checksum: canonicalCandidateProfileChecksum(candidateProfile),
  };
}

function serviceFor(records: unknown) {
  const listCanonicalCandidateProfileVersions = vi.fn(
    async () => records as readonly CanonicalCandidateProfileVersionRecord[],
  );
  const storage = {
    listCanonicalCandidateProfileVersions,
  } as unknown as CanonicalCandidateProfileStoragePort;
  return {
    listCanonicalCandidateProfileVersions,
    service: createCanonicalCandidateProfilePersistenceService(storage),
  };
}

describe("canonical candidate profile catalog application boundary", () => {
  it("validates and returns complete histories in deterministic name and version order", async () => {
    const zetaV1 = record(profile("zeta"));
    const zetaV2 = record(profile("zeta", 2, 1));
    const alphaV1 = record(profile("alpha"));
    const { service, listCanonicalCandidateProfileVersions } = serviceFor([
      zetaV2,
      zetaV1,
      alphaV1,
    ]);

    const catalog = await service.listCanonicalCandidateProfileVersions(workspaceId);

    expect(listCanonicalCandidateProfileVersions).toHaveBeenCalledWith(workspaceId);
    expect(catalog).toEqual([alphaV1, zetaV1, zetaV2]);
    expect(catalog.map(({ profile: value }) => [value.id, value.version])).toEqual([
      ["alpha", 1],
      ["zeta", 1],
      ["zeta", 2],
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0]?.profile)).toBe(true);
  });

  it("keeps the named history query path and its exact storage arguments", async () => {
    const alpha = record(profile("alpha"));
    const { service, listCanonicalCandidateProfileVersions } = serviceFor([alpha]);

    await expect(
      service.listCanonicalCandidateProfileVersions(workspaceId, "alpha"),
    ).resolves.toEqual([alpha]);
    expect(listCanonicalCandidateProfileVersions).toHaveBeenCalledWith(workspaceId, "alpha");
  });

  it.each([
    ["foreign workspace", [record(profile("alpha"), "another-workspace")]],
    ["malformed record", [{ workspaceId, profile: profile("alpha"), checksum: "bad" }]],
    ["missing first version", [record(profile("alpha", 2, 1))]],
    ["duplicate version", [record(profile("alpha")), record(profile("alpha"))]],
  ])("rejects a %s instead of returning a partial catalog", async (_name, records) => {
    const { service } = serviceFor(records);

    await expect(service.listCanonicalCandidateProfileVersions(workspaceId)).rejects.toThrow(
      canonicalCandidateProfileCorruptRecordErrorMessage,
    );
  });

  it("rejects a malformed storage result and catalogs above the name bound", async () => {
    const malformed = serviceFor(undefined);
    await expect(
      malformed.service.listCanonicalCandidateProfileVersions(workspaceId),
    ).rejects.toThrow(canonicalCandidateProfileCorruptRecordErrorMessage);

    const tooManyNames = Array.from({ length: 257 }, (_, index) =>
      record(profile(`profile-${String(index).padStart(3, "0")}`)),
    );
    const oversized = serviceFor(tooManyNames);
    await expect(
      oversized.service.listCanonicalCandidateProfileVersions(workspaceId),
    ).rejects.toThrow(canonicalCandidateProfileCorruptRecordErrorMessage);
  });
});
