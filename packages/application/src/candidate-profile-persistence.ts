import type {
  CanonicalCandidateProfile,
  CanonicalCandidateProfileInput,
} from "@draft-loop/schemas";
import type {
  CanonicalCandidateProfileStoragePort,
  CanonicalCandidateProfileVersionRecord,
} from "@draft-loop/storage";

import {
  buildCanonicalCandidateProfile,
  canonicalCandidateProfileChecksum,
} from "./candidate-profile.js";

/** Only canonical facts and issues may be replaced by a profile edit. */
export interface CanonicalCandidateProfilePatch {
  readonly facts?: readonly CanonicalCandidateProfile["facts"][number][];
  readonly issues?: readonly CanonicalCandidateProfileIssuePatch[];
}

type CanonicalCandidateProfileIssueInput = NonNullable<
  CanonicalCandidateProfileInput["issues"]
>[number];
export type CanonicalCandidateProfileIssuePatch = Omit<
  CanonicalCandidateProfileIssueInput,
  "factIds" | "sourceRefs"
> & {
  readonly factIds?: readonly NonNullable<CanonicalCandidateProfileIssueInput["factIds"]>[number][];
  readonly sourceRefs?: readonly NonNullable<
    CanonicalCandidateProfileIssueInput["sourceRefs"]
  >[number][];
};

/** A versioned edit command for the latest canonical candidate profile. */
export interface EditLatestCanonicalCandidateProfileCommand {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly expectedVersion: number;
  readonly updatedAt: string;
  readonly patch: CanonicalCandidateProfilePatch;
}

/** A reviewed-version command for the latest canonical candidate profile. */
export interface ReviewLatestCanonicalCandidateProfileCommand {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly expectedVersion: number;
  readonly reviewedAt: string;
}

/** Fixed errors used when a versioned profile operation cannot proceed. */
export const canonicalCandidateProfileNotFoundErrorMessage =
  "The canonical candidate profile was not found.";
export const canonicalCandidateProfileVersionStaleErrorMessage =
  "The canonical candidate profile version is stale.";
export const canonicalCandidateProfileCorruptRecordErrorMessage =
  "The stored canonical candidate profile record is invalid.";
export const canonicalCandidateProfilePatchErrorMessage =
  "The canonical candidate profile patch is invalid.";
export const canonicalCandidateProfileIdentityErrorMessage =
  "The canonical candidate profile identity is invalid.";

const canonicalCandidateProfileChecksumPattern = /^[a-f0-9]{64}$/u;
const canonicalCandidateProfileTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const canonicalCandidateProfileVersionRecordKeys = new Set(["workspaceId", "profile", "checksum"]);
const editableCanonicalCandidateProfileFields = new Set(["facts", "issues"]);

/** Storage-backed canonical profile operations shared by adapters. */
export interface CanonicalCandidateProfilePersistenceService {
  readonly saveCanonicalCandidateProfile: (
    workspaceId: string,
    profile: CanonicalCandidateProfile,
  ) => Promise<CanonicalCandidateProfileVersionRecord>;
  readonly getCanonicalCandidateProfile: (
    workspaceId: string,
    profileId: string,
    version: number,
  ) => Promise<CanonicalCandidateProfileVersionRecord | undefined>;
  readonly getLatestCanonicalCandidateProfile: (
    workspaceId: string,
    profileId: string,
  ) => Promise<CanonicalCandidateProfileVersionRecord | undefined>;
  readonly listCanonicalCandidateProfileVersions: (
    workspaceId: string,
    profileId: string,
  ) => Promise<readonly CanonicalCandidateProfileVersionRecord[]>;
  readonly editLatestCanonicalCandidateProfile: (
    command: EditLatestCanonicalCandidateProfileCommand,
  ) => Promise<CanonicalCandidateProfileVersionRecord>;
  readonly reviewLatestCanonicalCandidateProfile: (
    command: ReviewLatestCanonicalCandidateProfileCommand,
  ) => Promise<CanonicalCandidateProfileVersionRecord>;
}

interface ExpectedRecordIdentity {
  readonly workspaceId: string;
  readonly profileId?: string;
  readonly version?: number;
}

function corruptRecord(): never {
  throw new Error(canonicalCandidateProfileCorruptRecordErrorMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRecord(
  record: CanonicalCandidateProfileVersionRecord,
  expected: ExpectedRecordIdentity,
): CanonicalCandidateProfileVersionRecord {
  try {
    if (!isRecord(record)) corruptRecord();
    if (
      Object.keys(record).some((key) => !canonicalCandidateProfileVersionRecordKeys.has(key)) ||
      typeof record.workspaceId !== "string" ||
      record.workspaceId.trim().length === 0 ||
      record.workspaceId !== expected.workspaceId ||
      typeof record.checksum !== "string" ||
      !canonicalCandidateProfileChecksumPattern.test(record.checksum)
    ) {
      corruptRecord();
    }
    const profile = buildCanonicalCandidateProfile(record.profile);
    if (record.checksum !== canonicalCandidateProfileChecksum(profile)) {
      corruptRecord();
    }
    if (
      (expected.profileId !== undefined && profile.id !== expected.profileId) ||
      (expected.version !== undefined && profile.version !== expected.version)
    ) {
      corruptRecord();
    }
    return Object.freeze({
      workspaceId: record.workspaceId,
      profile,
      checksum: record.checksum,
    });
  } catch {
    corruptRecord();
  }
}

function normalizeOptionalRecord(
  record: CanonicalCandidateProfileVersionRecord | undefined,
  expected: ExpectedRecordIdentity,
): CanonicalCandidateProfileVersionRecord | undefined {
  return record === undefined ? undefined : normalizeRecord(record, expected);
}

function normalizeRecordList(
  records: readonly CanonicalCandidateProfileVersionRecord[],
  expected: ExpectedRecordIdentity,
): readonly CanonicalCandidateProfileVersionRecord[] {
  try {
    if (!Array.isArray(records)) corruptRecord();
    const normalized: CanonicalCandidateProfileVersionRecord[] = [];
    let previousVersion: number | undefined;
    for (const record of records) {
      const normalizedRecord = normalizeRecord(record, expected);
      if (previousVersion !== undefined && normalizedRecord.profile.version <= previousVersion) {
        corruptRecord();
      }
      if (
        normalizedRecord.profile.version !== normalized.length + 1 ||
        (previousVersion === undefined
          ? normalizedRecord.profile.parentVersion !== null
          : normalizedRecord.profile.parentVersion !== previousVersion)
      ) {
        corruptRecord();
      }
      normalized.push(normalizedRecord);
      previousVersion = normalizedRecord.profile.version;
    }
    return Object.freeze(normalized);
  } catch {
    corruptRecord();
  }
}

function assertExpectedVersion(expectedVersion: number, actualVersion: number): void {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion !== actualVersion
  ) {
    throw new Error(canonicalCandidateProfileVersionStaleErrorMessage);
  }
}

function requireLatestRecord(
  record: CanonicalCandidateProfileVersionRecord | undefined,
  expected: ExpectedRecordIdentity,
): CanonicalCandidateProfileVersionRecord {
  if (record === undefined) throw new Error(canonicalCandidateProfileNotFoundErrorMessage);
  return normalizeRecord(record, expected);
}

function assertCanonicalIdentity(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(canonicalCandidateProfileIdentityErrorMessage);
  }
}

function nextVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER) {
    throw new Error(canonicalCandidateProfileVersionStaleErrorMessage);
  }
  return version + 1;
}

function assertTimestampNotBefore(value: string, previous: string): void {
  if (
    !canonicalCandidateProfileTimestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    Date.parse(value) < Date.parse(previous)
  ) {
    throw new Error(canonicalCandidateProfilePatchErrorMessage);
  }
}

function assertEditablePatch(patch: CanonicalCandidateProfilePatch): void {
  if (!isRecord(patch)) throw new Error(canonicalCandidateProfilePatchErrorMessage);
  const keys = Object.keys(patch);
  if (
    keys.length === 0 ||
    keys.some((key) => !editableCanonicalCandidateProfileFields.has(key)) ||
    keys.some((key) => !Array.isArray((patch as Record<string, unknown>)[key]))
  ) {
    throw new Error(canonicalCandidateProfilePatchErrorMessage);
  }
}

/** Create an immutable application persistence service over a storage port. */
export function createCanonicalCandidateProfilePersistenceService(
  storage: CanonicalCandidateProfileStoragePort,
): CanonicalCandidateProfilePersistenceService {
  const saveCanonicalCandidateProfile = async (
    workspaceId: string,
    profile: CanonicalCandidateProfile,
  ): Promise<CanonicalCandidateProfileVersionRecord> => {
    assertCanonicalIdentity(workspaceId);
    if (isRecord(profile) && typeof profile.id === "string") {
      assertCanonicalIdentity(profile.id);
    }
    const validatedProfile = buildCanonicalCandidateProfile(profile);
    return normalizeRecord(
      await storage.saveCanonicalCandidateProfile(workspaceId, validatedProfile),
      {
        workspaceId,
        profileId: validatedProfile.id,
        version: validatedProfile.version,
      },
    );
  };

  const getCanonicalCandidateProfile = async (
    workspaceId: string,
    profileId: string,
    version: number,
  ): Promise<CanonicalCandidateProfileVersionRecord | undefined> => {
    assertCanonicalIdentity(workspaceId);
    assertCanonicalIdentity(profileId);
    return normalizeOptionalRecord(
      await storage.getCanonicalCandidateProfile(workspaceId, profileId, version),
      { workspaceId, profileId, version },
    );
  };

  const getLatestCanonicalCandidateProfile = async (
    workspaceId: string,
    profileId: string,
  ): Promise<CanonicalCandidateProfileVersionRecord | undefined> => {
    assertCanonicalIdentity(workspaceId);
    assertCanonicalIdentity(profileId);
    return normalizeOptionalRecord(
      await storage.getLatestCanonicalCandidateProfile(workspaceId, profileId),
      { workspaceId, profileId },
    );
  };

  const listCanonicalCandidateProfileVersions = async (
    workspaceId: string,
    profileId: string,
  ): Promise<readonly CanonicalCandidateProfileVersionRecord[]> => {
    assertCanonicalIdentity(workspaceId);
    assertCanonicalIdentity(profileId);
    return normalizeRecordList(
      await storage.listCanonicalCandidateProfileVersions(workspaceId, profileId),
      { workspaceId, profileId },
    );
  };

  const editLatestCanonicalCandidateProfile = async (
    command: EditLatestCanonicalCandidateProfileCommand,
  ): Promise<CanonicalCandidateProfileVersionRecord> => {
    assertCanonicalIdentity(command.workspaceId);
    assertCanonicalIdentity(command.profileId);
    const latest = requireLatestRecord(
      await storage.getLatestCanonicalCandidateProfile(command.workspaceId, command.profileId),
      { workspaceId: command.workspaceId, profileId: command.profileId },
    );
    assertExpectedVersion(command.expectedVersion, latest.profile.version);
    assertEditablePatch(command.patch);
    assertTimestampNotBefore(command.updatedAt, latest.profile.updatedAt);
    const edited = buildCanonicalCandidateProfile({
      ...latest.profile,
      ...command.patch,
      version: nextVersion(latest.profile.version),
      parentVersion: latest.profile.version,
      status: "draft",
      updatedAt: command.updatedAt,
      reviewedAt: undefined,
    });
    return saveCanonicalCandidateProfile(command.workspaceId, edited);
  };

  const reviewLatestCanonicalCandidateProfile = async (
    command: ReviewLatestCanonicalCandidateProfileCommand,
  ): Promise<CanonicalCandidateProfileVersionRecord> => {
    assertCanonicalIdentity(command.workspaceId);
    assertCanonicalIdentity(command.profileId);
    const latest = requireLatestRecord(
      await storage.getLatestCanonicalCandidateProfile(command.workspaceId, command.profileId),
      { workspaceId: command.workspaceId, profileId: command.profileId },
    );
    assertExpectedVersion(command.expectedVersion, latest.profile.version);
    if (latest.profile.status !== "draft") {
      throw new Error("Only a draft canonical candidate profile can be reviewed.");
    }
    assertTimestampNotBefore(command.reviewedAt, latest.profile.updatedAt);
    const reviewed = buildCanonicalCandidateProfile({
      ...latest.profile,
      version: nextVersion(latest.profile.version),
      parentVersion: latest.profile.version,
      status: "reviewed",
      updatedAt: command.reviewedAt,
      reviewedAt: command.reviewedAt,
    });
    return saveCanonicalCandidateProfile(command.workspaceId, reviewed);
  };

  const service: CanonicalCandidateProfilePersistenceService = {
    saveCanonicalCandidateProfile,
    getCanonicalCandidateProfile,
    getLatestCanonicalCandidateProfile,
    listCanonicalCandidateProfileVersions,
    editLatestCanonicalCandidateProfile,
    reviewLatestCanonicalCandidateProfile,
  };
  return Object.freeze(service);
}
