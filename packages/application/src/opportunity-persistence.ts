import type { OpportunityBrief } from "@draft-loop/schemas";
import type {
  OpportunityBriefStoragePort,
  OpportunityBriefVersionRecord,
} from "@draft-loop/storage";
import { buildOpportunityBrief } from "./opportunity-brief.js";
import {
  editOpportunityDraft,
  type OpportunityDraftPatch,
  reviewOpportunityDraft,
} from "./opportunity-intake.js";

/** A versioned edit command for the latest opportunity brief. */
export interface EditLatestOpportunityBriefCommand {
  readonly workspaceId: string;
  readonly briefId: string;
  readonly expectedVersion: number;
  readonly patch: OpportunityDraftPatch;
  readonly createdAt: string;
}

/** A reviewed-version command for the latest opportunity brief. */
export interface ReviewLatestOpportunityBriefCommand {
  readonly workspaceId: string;
  readonly briefId: string;
  readonly expectedVersion: number;
  readonly reviewedAt: string;
}

/** Fixed errors used when a versioned latest-brief operation cannot proceed. */
export const opportunityBriefNotFoundErrorMessage = "The opportunity brief was not found.";
export const opportunityBriefVersionStaleErrorMessage = "The opportunity brief version is stale.";
export const opportunityBriefCorruptRecordErrorMessage =
  "The stored opportunity brief record is invalid.";

const opportunityBriefChecksumPattern = /^[a-f0-9]{64}$/u;

/**
 * Storage-backed opportunity brief operations shared by adapters.
 *
 * The service owns validation and freezing at the application boundary. The
 * storage port remains responsible only for durable records.
 */
export interface OpportunityPersistenceService {
  readonly saveOpportunityBrief: (
    workspaceId: string,
    brief: OpportunityBrief,
  ) => Promise<OpportunityBriefVersionRecord>;
  readonly getOpportunityBrief: (
    workspaceId: string,
    briefId: string,
    version: number,
  ) => Promise<OpportunityBriefVersionRecord | undefined>;
  readonly getLatestOpportunityBrief: (
    workspaceId: string,
    briefId: string,
  ) => Promise<OpportunityBriefVersionRecord | undefined>;
  readonly listOpportunityBriefVersions: (
    workspaceId: string,
    briefId: string,
  ) => Promise<readonly OpportunityBriefVersionRecord[]>;
  readonly editLatestOpportunityBrief: (
    command: EditLatestOpportunityBriefCommand,
  ) => Promise<OpportunityBriefVersionRecord>;
  readonly reviewLatestOpportunityBrief: (
    command: ReviewLatestOpportunityBriefCommand,
  ) => Promise<OpportunityBriefVersionRecord>;
}

interface ExpectedRecordIdentity {
  readonly workspaceId: string;
  readonly briefId?: string;
  readonly version?: number;
}

function corruptRecord(): never {
  throw new Error(opportunityBriefCorruptRecordErrorMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRecord(
  record: OpportunityBriefVersionRecord,
  expected: ExpectedRecordIdentity,
): OpportunityBriefVersionRecord {
  try {
    if (!isRecord(record)) corruptRecord();
    if (
      typeof record.workspaceId !== "string" ||
      record.workspaceId.trim().length === 0 ||
      record.workspaceId !== expected.workspaceId ||
      typeof record.checksum !== "string" ||
      !opportunityBriefChecksumPattern.test(record.checksum)
    ) {
      corruptRecord();
    }
    const brief = buildOpportunityBrief(record.brief);
    if (
      (expected.briefId !== undefined && brief.id !== expected.briefId) ||
      (expected.version !== undefined && brief.version !== expected.version)
    ) {
      corruptRecord();
    }
    return Object.freeze({
      workspaceId: record.workspaceId,
      brief,
      checksum: record.checksum,
    });
  } catch {
    corruptRecord();
  }
}

function normalizeOptionalRecord(
  record: OpportunityBriefVersionRecord | undefined,
  expected: ExpectedRecordIdentity,
): OpportunityBriefVersionRecord | undefined {
  return record === undefined ? undefined : normalizeRecord(record, expected);
}

function normalizeRecordList(
  records: readonly OpportunityBriefVersionRecord[],
  expected: ExpectedRecordIdentity,
): readonly OpportunityBriefVersionRecord[] {
  try {
    if (!Array.isArray(records)) corruptRecord();
    const normalized: OpportunityBriefVersionRecord[] = [];
    let previousVersion: number | undefined;
    for (const record of records) {
      const normalizedRecord = normalizeRecord(record, expected);
      if (previousVersion !== undefined && normalizedRecord.brief.version <= previousVersion) {
        corruptRecord();
      }
      normalized.push(normalizedRecord);
      previousVersion = normalizedRecord.brief.version;
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
    throw new Error(opportunityBriefVersionStaleErrorMessage);
  }
}

function requireLatestRecord(
  record: OpportunityBriefVersionRecord | undefined,
  expected: ExpectedRecordIdentity,
): OpportunityBriefVersionRecord {
  if (record === undefined) throw new Error(opportunityBriefNotFoundErrorMessage);
  return normalizeRecord(record, expected);
}

/** Create an immutable application persistence service over a storage port. */
export function createOpportunityPersistenceService(
  storage: OpportunityBriefStoragePort,
): OpportunityPersistenceService {
  const saveOpportunityBrief = async (
    workspaceId: string,
    brief: OpportunityBrief,
  ): Promise<OpportunityBriefVersionRecord> => {
    const validatedBrief = buildOpportunityBrief(brief);
    return normalizeRecord(await storage.saveOpportunityBrief(workspaceId, validatedBrief), {
      workspaceId,
      briefId: validatedBrief.id,
      version: validatedBrief.version,
    });
  };

  const getOpportunityBrief = async (
    workspaceId: string,
    briefId: string,
    version: number,
  ): Promise<OpportunityBriefVersionRecord | undefined> =>
    normalizeOptionalRecord(await storage.getOpportunityBrief(workspaceId, briefId, version), {
      workspaceId,
      briefId,
      version,
    });

  const getLatestOpportunityBrief = async (
    workspaceId: string,
    briefId: string,
  ): Promise<OpportunityBriefVersionRecord | undefined> =>
    normalizeOptionalRecord(await storage.getLatestOpportunityBrief(workspaceId, briefId), {
      workspaceId,
      briefId,
    });

  const listOpportunityBriefVersions = async (
    workspaceId: string,
    briefId: string,
  ): Promise<readonly OpportunityBriefVersionRecord[]> =>
    normalizeRecordList(await storage.listOpportunityBriefVersions(workspaceId, briefId), {
      workspaceId,
      briefId,
    });

  const editLatestOpportunityBrief = async (
    command: EditLatestOpportunityBriefCommand,
  ): Promise<OpportunityBriefVersionRecord> => {
    const latest = requireLatestRecord(
      await storage.getLatestOpportunityBrief(command.workspaceId, command.briefId),
      { workspaceId: command.workspaceId, briefId: command.briefId },
    );
    assertExpectedVersion(command.expectedVersion, latest.brief.version);
    const edited = editOpportunityDraft(latest.brief, command.patch, command.createdAt);
    return saveOpportunityBrief(command.workspaceId, edited);
  };

  const reviewLatestOpportunityBrief = async (
    command: ReviewLatestOpportunityBriefCommand,
  ): Promise<OpportunityBriefVersionRecord> => {
    const latest = requireLatestRecord(
      await storage.getLatestOpportunityBrief(command.workspaceId, command.briefId),
      { workspaceId: command.workspaceId, briefId: command.briefId },
    );
    assertExpectedVersion(command.expectedVersion, latest.brief.version);
    const reviewed = reviewOpportunityDraft(latest.brief, command.reviewedAt);
    return saveOpportunityBrief(command.workspaceId, reviewed);
  };

  const service: OpportunityPersistenceService = {
    saveOpportunityBrief,
    getOpportunityBrief,
    getLatestOpportunityBrief,
    listOpportunityBriefVersions,
    editLatestOpportunityBrief,
    reviewLatestOpportunityBrief,
  };
  return Object.freeze(service);
}
