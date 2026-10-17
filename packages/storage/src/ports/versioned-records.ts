import type { WritingPolicy } from "@draft-loop/domain";
import type {
  CanonicalCandidateProfile,
  OpportunityBrief,
  WritingPolicyInput,
} from "@draft-loop/schemas";
import type { JsonValue } from "./workspace.js";

export interface ContextSnapshotInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface ContextSnapshotRecord extends ContextSnapshotInput {
  readonly checksum: string;
}

/** Immutable run context snapshots, addressed by id. */
export interface ContextSnapshotStoragePort {
  readonly saveContextSnapshot: (input: ContextSnapshotInput) => Promise<ContextSnapshotRecord>;
  readonly getContextSnapshot: (id: string) => Promise<ContextSnapshotRecord | undefined>;
}

export interface OpportunityBriefVersionRecord {
  readonly workspaceId: string;
  readonly brief: OpportunityBrief;
  readonly checksum: string;
}

export interface OpportunityBriefStoragePort {
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
}

export interface CanonicalCandidateProfileVersionRecord {
  readonly workspaceId: string;
  readonly profile: CanonicalCandidateProfile;
  readonly checksum: string;
}

export interface CanonicalCandidateProfileStoragePort {
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
    profileId?: string,
  ) => Promise<readonly CanonicalCandidateProfileVersionRecord[]>;
}

export interface WritingPolicyVersionSaveOptions {
  /** Creation time for deterministic tests and imported local history. */
  readonly createdAt?: string;
  /** Previous policy content checksum; omitted to continue the current chain. */
  readonly priorChecksum?: string | null;
}

export interface WritingPolicyVersionInput {
  readonly workspaceId: string;
  readonly policy: WritingPolicyInput;
  readonly createdAt?: string;
  readonly priorChecksum?: string | null;
}

/** Immutable policy history row. Policy content remains local to this store. */
export interface WritingPolicyVersionRecord {
  readonly workspaceId: string;
  readonly policy: WritingPolicy;
  /** Full SHA-256 identity of the policy content. */
  readonly checksum: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly priorChecksum: string | null;
  readonly payloadChecksum: string;
}

export interface WritingPolicyStoragePort {
  readonly saveWritingPolicyVersion: {
    (
      workspaceId: string,
      policy: WritingPolicyInput,
      options?: WritingPolicyVersionSaveOptions,
    ): Promise<WritingPolicyVersionRecord>;
    (input: WritingPolicyVersionInput): Promise<WritingPolicyVersionRecord>;
  };
  readonly getWritingPolicyVersion: (
    workspaceId: string,
    checksum: string,
  ) => Promise<WritingPolicyVersionRecord | undefined>;
  readonly getLatestWritingPolicyVersion: (
    workspaceId: string,
  ) => Promise<WritingPolicyVersionRecord | undefined>;
  readonly listWritingPolicyVersions: (
    workspaceId: string,
  ) => Promise<readonly WritingPolicyVersionRecord[]>;
}
