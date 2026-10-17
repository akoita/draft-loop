import type { WritingPolicy } from "@draft-loop/domain";
import {
  type CanonicalCandidateProfile,
  canonicalCandidateProfileSchema,
  type OpportunityBrief,
  opportunityBriefSchema,
} from "@draft-loop/schemas";
import { checksum, payloadChecksum, serialize } from "./audit-event-write.js";
import {
  parse,
  requireNonEmpty,
  rowNullableNumber,
  rowNullableString,
  rowNumber,
  rowString,
} from "./history-record-rows.js";
import type { AuditEventInput } from "./ports/history.js";
import type {
  CanonicalCandidateProfileVersionRecord,
  OpportunityBriefVersionRecord,
  WritingPolicyVersionRecord,
} from "./ports/versioned-records.js";
import {
  StorageConflictError,
  StorageSecurityError,
  StorageValidationError,
} from "./storage-errors.js";
import { validatedWritingPolicy } from "./writing-policy-validation.js";

export {
  canonicalCandidateProfileCatalogLimitErrorMessage,
  maximumCanonicalCandidateProfileCatalogNameCount,
} from "./canonical-profile-catalog.js";

/**
 * The rules of the versioned records (opportunity briefs, canonical candidate profiles and writing
 * policies): validation, append-chain checks, audit events and row mapping. Every storage
 * implementation runs these, and supplies only the queries.
 */

export function validatedOpportunityBrief(value: unknown): OpportunityBrief {
  const parsed = opportunityBriefSchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Opportunity brief data is invalid.");
  }
  return parsed.data;
}

export function validatedCanonicalCandidateProfile(value: unknown): CanonicalCandidateProfile {
  try {
    const parsed = canonicalCandidateProfileSchema.safeParse(value);
    if (!parsed.success) {
      throw new StorageValidationError("Canonical candidate profile data is invalid.");
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageSecurityError) {
      throw error;
    }
    throw new StorageValidationError("Canonical candidate profile data is invalid.");
  }
}

export function requireTimestamp(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    throw new StorageValidationError(`${field} must be a valid ISO timestamp`);
  }
  return normalized;
}

export function requireSha256(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field).trim();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new StorageValidationError(`${field} must be a lowercase SHA-256 value`);
  }
  return normalized;
}

export function opportunityBriefFromRow(
  row: Record<string, unknown>,
): OpportunityBriefVersionRecord {
  try {
    const payload = parse(rowString(row, "payload_json"));
    const checksumValue = rowString(row, "payload_checksum");
    if (payloadChecksum(payload) !== checksumValue) {
      throw new StorageValidationError("The stored opportunity brief checksum is invalid.");
    }
    const brief = validatedOpportunityBrief(payload);
    if (
      brief.id !== rowString(row, "brief_id") ||
      brief.version !== rowNumber(row, "version") ||
      brief.schemaVersion !== rowNumber(row, "schema_version") ||
      brief.priorVersion !== rowNullableNumber(row, "prior_version") ||
      brief.status !== rowString(row, "status") ||
      brief.createdAt !== rowString(row, "created_at") ||
      brief.reviewedAt !== rowNullableString(row, "reviewed_at")
    ) {
      throw new StorageValidationError("The stored opportunity brief metadata is inconsistent.");
    }
    return {
      workspaceId: rowString(row, "workspace_id"),
      brief,
      checksum: checksumValue,
    };
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageSecurityError) {
      throw error;
    }
    throw new StorageValidationError("The stored opportunity brief could not be read.");
  }
}

export function canonicalCandidateProfileVersionFromRow(
  row: Record<string, unknown>,
): CanonicalCandidateProfileVersionRecord {
  try {
    const payloadJson = rowString(row, "payload_json");
    const payload = parse(payloadJson);
    if (serialize(payload) !== payloadJson) {
      throw new StorageValidationError(
        "The stored canonical candidate profile payload is not canonical.",
      );
    }
    const checksumValue = rowString(row, "payload_checksum");
    if (!/^[a-f0-9]{64}$/u.test(checksumValue) || payloadChecksum(payload) !== checksumValue) {
      throw new StorageValidationError(
        "The stored canonical candidate profile checksum is invalid.",
      );
    }
    const profile = validatedCanonicalCandidateProfile(payload);
    const workspaceId = requireNonEmpty(
      rowString(row, "workspace_id"),
      "canonical candidate profile workspaceId",
    ).trim();
    const profileId = requireNonEmpty(
      rowString(row, "profile_id"),
      "canonical candidate profileId",
    ).trim();
    const version = rowNumber(row, "version");
    const schemaVersion = rowNumber(row, "schema_version");
    const parentVersion = rowNullableNumber(row, "parent_version");
    const status = rowString(row, "status");
    const createdAt = requireTimestamp(
      rowString(row, "created_at"),
      "canonical candidate profile createdAt",
    );
    const updatedAt = requireTimestamp(
      rowString(row, "updated_at"),
      "canonical candidate profile updatedAt",
    );
    const reviewedAt = rowNullableString(row, "reviewed_at");
    if (
      profile.id !== profileId ||
      profile.version !== version ||
      profile.schemaVersion !== schemaVersion ||
      profile.parentVersion !== parentVersion ||
      profile.status !== status ||
      profile.createdAt !== createdAt ||
      profile.updatedAt !== updatedAt ||
      (profile.reviewedAt ?? null) !== reviewedAt
    ) {
      throw new StorageValidationError(
        "The stored canonical candidate profile metadata is inconsistent.",
      );
    }
    return {
      workspaceId,
      profile,
      checksum: checksumValue,
    };
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageSecurityError) {
      throw error;
    }
    throw new StorageValidationError("The stored canonical candidate profile could not be read.");
  }
}

export function writingPolicyVersionFromRow(
  row: Record<string, unknown>,
): WritingPolicyVersionRecord {
  try {
    const payloadJson = rowString(row, "payload_json");
    const payload = parse(payloadJson);
    if (serialize(payload) !== payloadJson) {
      throw new StorageValidationError("The stored writing policy payload is not canonical.");
    }
    const payloadChecksumValue = rowString(row, "payload_checksum");
    if (payloadChecksum(payload) !== payloadChecksumValue) {
      throw new StorageValidationError("The stored writing policy payload checksum is invalid.");
    }
    const policy = validatedWritingPolicy(payload);
    const policyChecksum = rowString(row, "policy_checksum");
    const version = rowString(row, "version");
    const schemaVersion = rowNumber(row, "schema_version");
    const createdAt = requireTimestamp(rowString(row, "created_at"), "writing policy createdAt");
    const priorChecksum = rowNullableString(row, "prior_checksum");
    if (
      policy.checksum !== policyChecksum ||
      policy.version !== version ||
      policy.schemaVersion !== schemaVersion ||
      (priorChecksum !== null && !/^[a-f0-9]{64}$/u.test(priorChecksum))
    ) {
      throw new StorageValidationError("The stored writing policy metadata is inconsistent.");
    }
    return {
      workspaceId: rowString(row, "workspace_id"),
      policy,
      checksum: policyChecksum,
      version,
      schemaVersion,
      createdAt,
      priorChecksum,
      payloadChecksum: payloadChecksumValue,
    };
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageSecurityError) {
      throw error;
    }
    throw new StorageValidationError("The stored writing policy could not be read.");
  }
}

export function canonicalCandidateProfileLeaf(
  records: readonly CanonicalCandidateProfileVersionRecord[],
): CanonicalCandidateProfileVersionRecord | undefined {
  if (records.length === 0) return undefined;
  return records[records.length - 1];
}

export function writingPolicyVersionSelect(): string {
  return "SELECT workspace_id, policy_checksum, version, schema_version, created_at, prior_checksum, payload_json, payload_checksum FROM writing_policy_versions";
}

export function canonicalCandidateProfileVersionSelect(): string {
  return "SELECT workspace_id, profile_id, version, schema_version, parent_version, status, created_at, updated_at, reviewed_at, payload_json, payload_checksum FROM canonical_candidate_profile_versions";
}

export function now(): string {
  return new Date().toISOString();
}

/** A canonical profile's versions, ordered by version, checked as one contiguous chain. */
export function checkCanonicalCandidateProfileHistory(
  records: readonly CanonicalCandidateProfileVersionRecord[],
  workspaceId: string,
  profileId: string,
): readonly CanonicalCandidateProfileVersionRecord[] {
  if (records.length === 0) return [];

  const children = new Set<number>();
  records.forEach((record, index) => {
    if (record.workspaceId !== workspaceId || record.profile.id !== profileId) {
      throw new StorageValidationError(
        "The stored canonical candidate profile identity is inconsistent.",
      );
    }
    if (record.profile.version !== index + 1) {
      throw new StorageConflictError(
        "The canonical candidate profile history is not a contiguous append-only chain.",
      );
    }
    const expectedParent = index === 0 ? null : index;
    if (record.profile.parentVersion !== expectedParent) {
      throw new StorageConflictError(
        "The canonical candidate profile history has an invalid parent version.",
      );
    }
    if (index > 0) {
      const parent = records[index - 1];
      if (parent === undefined) {
        throw new StorageConflictError(
          "The canonical candidate profile history has an invalid parent version.",
        );
      }
      if (Date.parse(record.profile.createdAt) < Date.parse(parent.profile.createdAt)) {
        throw new StorageConflictError(
          "The canonical candidate profile timestamp precedes its parent version.",
        );
      }
      if (Date.parse(record.profile.updatedAt) < Date.parse(parent.profile.updatedAt)) {
        throw new StorageConflictError(
          "The canonical candidate profile timestamp precedes its parent version.",
        );
      }
      children.add(parent.profile.version);
    }
  });

  const leaves = records.filter((record) => !children.has(record.profile.version));
  if (leaves.length !== 1) {
    throw new StorageConflictError(
      "The canonical candidate profile history has multiple current leaves.",
    );
  }
  return records;
}

/** A new opportunity brief version must follow its parent in time and in review status. */
export function checkOpportunityBriefAppend(
  brief: OpportunityBrief,
  parent: OpportunityBrief | undefined,
): void {
  if (brief.version <= 1) return;
  if (parent === undefined) {
    throw new StorageConflictError("The opportunity brief parent version is missing.");
  }
  if (Date.parse(brief.createdAt) < Date.parse(parent.createdAt)) {
    throw new StorageConflictError("The opportunity brief timestamp precedes its parent version.");
  }
  if (parent.status === "reviewed" && brief.status === "reviewed") {
    throw new StorageConflictError(
      "A reviewed opportunity brief cannot transition directly to reviewed.",
    );
  }
}

/** Audit events name versioned records by an opaque hash, so the trail never holds their ids. */
function opaqueEntityId(workspaceId: string, id: string): string {
  return checksum(`${workspaceId}\u0000${id}`).slice(0, 32);
}

export function opportunityBriefAuditEvent(record: OpportunityBriefVersionRecord): AuditEventInput {
  const { brief } = record;
  const entityId = opaqueEntityId(record.workspaceId, brief.id);
  return {
    id: `opportunity-brief-version:${entityId}:${brief.version}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "opportunity-brief-version.appended",
    entityType: "opportunity-brief",
    entityId,
    payload: {
      checksum: record.checksum,
      schemaVersion: brief.schemaVersion,
      status: brief.status,
      version: brief.version,
    },
    createdAt: brief.createdAt,
  };
}

/** A new canonical profile version must append right after the current leaf, never before it. */
export function checkCanonicalCandidateProfileAppend(
  profile: CanonicalCandidateProfile,
  latest: CanonicalCandidateProfileVersionRecord | undefined,
): void {
  if (profile.version === 1) {
    if (latest !== undefined) {
      throw new StorageConflictError(
        "The canonical candidate profile version must append after the current leaf.",
      );
    }
    if (profile.parentVersion !== null) {
      throw new StorageValidationError(
        "The canonical candidate profile root version cannot have a parent.",
      );
    }
    return;
  }
  if (latest === undefined) {
    throw new StorageConflictError("The canonical candidate profile parent version is missing.");
  }
  if (
    profile.version !== latest.profile.version + 1 ||
    profile.parentVersion !== latest.profile.version
  ) {
    throw new StorageConflictError(
      "The canonical candidate profile version must append after the current leaf.",
    );
  }
  if (
    Date.parse(profile.createdAt) < Date.parse(latest.profile.createdAt) ||
    Date.parse(profile.updatedAt) < Date.parse(latest.profile.updatedAt)
  ) {
    throw new StorageConflictError(
      "The canonical candidate profile timestamp precedes its parent version.",
    );
  }
}

export function canonicalCandidateProfileAuditEvent(
  record: CanonicalCandidateProfileVersionRecord,
): AuditEventInput {
  const { profile } = record;
  const entityId = opaqueEntityId(record.workspaceId, profile.id);
  return {
    id: `canonical-candidate-profile-version:${entityId}:${profile.version}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "canonical-candidate-profile-version.appended",
    entityType: "canonical-candidate-profile",
    entityId,
    payload: {
      checksum: record.checksum,
      schemaVersion: profile.schemaVersion,
      status: profile.status,
      version: profile.version,
      parentVersion: profile.parentVersion,
    },
    createdAt: profile.createdAt,
  };
}

/** A writing policy save, validated and hashed, before it meets the stored history. */
export interface PreparedWritingPolicyVersion {
  readonly workspaceId: string;
  readonly policy: WritingPolicy;
  readonly createdAt: string;
  /** Whether the caller fixed the creation time, which an identical re-save must then match. */
  readonly createdAtRequested: boolean;
  /** `undefined` continues the current chain; `null` asks for a root version. */
  readonly requestedPrior: string | null | undefined;
  readonly payloadJson: string;
  readonly payloadChecksum: string;
}

export function prepareWritingPolicyVersion(input: {
  readonly workspaceId: string;
  readonly policy: unknown;
  readonly createdAt: string | undefined;
  readonly priorChecksum: string | null | undefined;
}): PreparedWritingPolicyVersion {
  const workspaceId = requireNonEmpty(input.workspaceId, "writing policy workspaceId").trim();
  if (input.policy === undefined) {
    throw new StorageValidationError("A writing policy is required.");
  }
  const policy = validatedWritingPolicy(input.policy);
  const createdAt = requireTimestamp(input.createdAt ?? now(), "writing policy createdAt");
  const requestedPrior =
    input.priorChecksum === undefined
      ? undefined
      : input.priorChecksum === null
        ? null
        : requireSha256(input.priorChecksum, "writing policy priorChecksum");
  const payload = JSON.parse(JSON.stringify(policy)) as Parameters<typeof serialize>[0];
  return {
    workspaceId,
    policy,
    createdAt,
    createdAtRequested: input.createdAt !== undefined,
    requestedPrior,
    payloadJson: serialize(payload),
    payloadChecksum: payloadChecksum(payload),
  };
}

/** An identical re-save returns the stored version; anything else about it is a conflict. */
export function checkExistingWritingPolicyVersion(
  existing: WritingPolicyVersionRecord,
  prepared: PreparedWritingPolicyVersion,
): WritingPolicyVersionRecord {
  const priorMatches =
    prepared.requestedPrior === undefined || existing.priorChecksum === prepared.requestedPrior;
  const timestampMatches =
    !prepared.createdAtRequested || existing.createdAt === prepared.createdAt;
  if (
    existing.policy.version !== prepared.policy.version ||
    existing.policy.schemaVersion !== prepared.policy.schemaVersion ||
    existing.payloadChecksum !== prepared.payloadChecksum ||
    !priorMatches ||
    !timestampMatches
  ) {
    throw new StorageConflictError("The writing policy version is immutable.");
  }
  return existing;
}

/** The prior a new policy version links to: the current leaf, which a requested prior must match. */
export function resolveWritingPolicyPrior(
  prepared: PreparedWritingPolicyVersion,
  leafChecksum: string | undefined,
): string | null {
  const inferredPrior = leafChecksum ?? null;
  const priorChecksum =
    prepared.requestedPrior === undefined ? inferredPrior : prepared.requestedPrior;
  if (leafChecksum !== undefined && priorChecksum === null) {
    throw new StorageConflictError("The writing policy parent version is required.");
  }
  if (leafChecksum !== undefined && priorChecksum !== inferredPrior) {
    throw new StorageConflictError("The writing policy parent version must be the current leaf.");
  }
  if (priorChecksum === prepared.policy.checksum) {
    throw new StorageConflictError("A writing policy version cannot link to itself.");
  }
  return priorChecksum;
}

/** A policy version must be created strictly after its parent. */
export function checkWritingPolicyParentTime(createdAt: string, parentCreatedAt: string): void {
  const parentTime = requireTimestamp(parentCreatedAt, "writing policy parent createdAt");
  if (Date.parse(createdAt) <= Date.parse(parentTime)) {
    throw new StorageConflictError(
      "The writing policy timestamp must be later than its parent version.",
    );
  }
}

export function writingPolicyVersionRecord(
  prepared: PreparedWritingPolicyVersion,
  priorChecksum: string | null,
): WritingPolicyVersionRecord {
  return {
    workspaceId: prepared.workspaceId,
    policy: prepared.policy,
    checksum: prepared.policy.checksum,
    version: prepared.policy.version,
    schemaVersion: prepared.policy.schemaVersion ?? 1,
    createdAt: prepared.createdAt,
    priorChecksum,
    payloadChecksum: prepared.payloadChecksum,
  };
}

export function writingPolicyAuditEvent(record: WritingPolicyVersionRecord): AuditEventInput {
  const entityId = opaqueEntityId(record.workspaceId, record.checksum);
  return {
    id: `writing-policy-version:${entityId}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "writing-policy-version.appended",
    entityType: "writing-policy",
    entityId,
    payload: {
      checksum: record.checksum,
      version: record.version,
      schemaVersion: record.schemaVersion,
      priorChecksum: record.priorChecksum,
      payloadChecksum: record.payloadChecksum,
    },
    createdAt: record.createdAt,
  };
}
