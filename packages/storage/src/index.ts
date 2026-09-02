import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  type CandidateKnowledgeBaseState,
  type CandidateKnowledgeLexicalChunk,
  type CandidateKnowledgeLexicalChunkInput,
  type CandidateKnowledgeLexicalIndexIdentity,
  type CandidateKnowledgeLexicalIndexIdentityInput,
  type CandidateKnowledgeLexicalRetrievalRequestInput,
  type CandidateKnowledgeLexicalRetrievalResult,
  type CandidateKnowledgeRetentionClass,
  type CandidateKnowledgeRetentionOverrideKind,
  type CandidateKnowledgeRetentionRule,
  type CandidateKnowledgeRetrievalScope,
  type CandidateKnowledgeRetrievalScopeInput,
  type CandidateKnowledgeRetrievalSourceVersionReference,
  type CandidateKnowledgeRetrievalSourceVersionReferenceInput,
  type CandidateKnowledgeRetrievalStatus,
  type CandidateKnowledgeRetrievalTrace,
  type CandidateKnowledgeRetrievalTraceInput,
  candidateKnowledgeRetentionClasses,
  candidateKnowledgeRetentionOverrideKinds,
  type EvidenceRetrievalInspection,
  type RetrievalOptions,
  type RetrievalPort,
  type ScoredEvidenceChunk,
  validateWritingPolicyInput,
  type WorkflowState,
  type WritingPolicy,
  workflowStates,
} from "@draft-loop/domain";
import {
  type CandidateKnowledgePortableBackupManifest,
  type CanonicalCandidateProfile,
  candidateKnowledgeLexicalChunkSchema,
  candidateKnowledgeLexicalIndexIdentitySchema,
  candidateKnowledgeLexicalRetrievalRequestSchema,
  candidateKnowledgeLexicalRetrievalResultSchema,
  candidateKnowledgePortableBackupManifestSchema,
  candidateKnowledgeRetentionOverrideInputSchema,
  candidateKnowledgeRetentionPolicyUpdateSchema,
  candidateKnowledgeRetrievalScopeSchema,
  candidateKnowledgeRetrievalSourceVersionReferenceSchema,
  candidateKnowledgeRetrievalTraceSchema,
  canonicalCandidateProfileSchema,
  type OpportunityBrief,
  opportunityBriefSchema,
  type WritingPolicyInput,
  writingPolicySchema,
} from "@draft-loop/schemas";
import type { ArtifactVersionInput, ArtifactVersionRecord } from "./artifact-history.js";
import { artifactHistoryMigration, artifactVersionFromRow } from "./artifact-history.js";

export type {
  CandidateKnowledgeRetentionClass,
  CandidateKnowledgeRetentionOverrideKind,
  CandidateKnowledgeRetentionRule,
} from "@draft-loop/domain";
export {
  candidateKnowledgeRetentionClasses,
  candidateKnowledgeRetentionOverrideKinds,
  candidateKnowledgeRetentionRules,
} from "@draft-loop/domain";
export type { ArtifactVersionInput, ArtifactVersionRecord } from "./artifact-history.js";

export interface StoragePort {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
}

export interface WorkspaceBackupResult {
  readonly backupPath: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface WorkspaceRestoreOptions {
  readonly verifyIntegrity?: boolean;
}

export interface MigrationReport {
  readonly appliedCount: number;
  readonly appliedVersions: readonly number[];
  readonly latestVersion: number;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Complete replacement of one CKB's deterministic lexical projection. */
export interface CandidateKnowledgeLexicalIndexRebuildInput {
  readonly scope: CandidateKnowledgeRetrievalScopeInput;
  readonly index: CandidateKnowledgeLexicalIndexIdentityInput;
  readonly chunks: readonly CandidateKnowledgeLexicalChunkInput[];
  readonly createdAt: string;
}

/** Incremental replacement of chunks in the current exact CKB projection. */
export interface CandidateKnowledgeLexicalIndexUpsertInput {
  readonly scope: CandidateKnowledgeRetrievalScopeInput;
  readonly index: CandidateKnowledgeLexicalIndexIdentityInput;
  readonly chunks: readonly CandidateKnowledgeLexicalChunkInput[];
}

export type CandidateKnowledgeLexicalSourceVersionDeletionInput =
  CandidateKnowledgeRetrievalSourceVersionReferenceInput;

export interface CandidateKnowledgeLexicalIndexRecord {
  readonly scope: CandidateKnowledgeRetrievalScope;
  readonly index: CandidateKnowledgeLexicalIndexIdentity;
  readonly indexedChunkCount: number;
  readonly createdAt: string;
  readonly stale: boolean;
}

export type CandidateKnowledgeLexicalIndexInspectionStatus = Extract<
  CandidateKnowledgeRetrievalStatus,
  "matched" | "stale" | "not-indexed"
>;

export interface CandidateKnowledgeLexicalIndexInspection {
  readonly status: CandidateKnowledgeLexicalIndexInspectionStatus;
  readonly requestedScope: CandidateKnowledgeRetrievalScope;
  readonly index: CandidateKnowledgeLexicalIndexIdentity | null;
  readonly indexedScope: CandidateKnowledgeRetrievalScope | null;
  readonly indexedChunkCount: number;
}

export interface CandidateKnowledgeRetrievalTraceListOptions {
  readonly operationId?: string;
  readonly limit?: number;
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly state: WorkflowState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CandidateKnowledgeBaseInput {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
}

export interface CandidateKnowledgeBaseRecord {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly state: CandidateKnowledgeBaseState;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export type CandidateKnowledgeSourceKind = "file" | "url";

export interface CandidateKnowledgeSourceInput {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly kind: CandidateKnowledgeSourceKind;
  readonly displayName: string;
  readonly createdAt: string;
}

export type CandidateKnowledgeSourceRecord = CandidateKnowledgeSourceInput;

/** Sensitive local-only state remembered for a successfully managed file import. */
export interface CandidateKnowledgeSourceOriginBindingRecord {
  readonly sourceId: string;
  readonly originPath: string;
  readonly boundAt: string;
}

export interface CandidateKnowledgeDirectoryBindingInput {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly rootPath: string;
  readonly boundAt: string;
  /** Ordered source IDs whose existing file bindings define membership. */
  readonly sourceIds: readonly string[];
}

export interface CandidateKnowledgeDirectoryBindingRecord {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly rootPath: string;
  readonly boundAt: string;
}

export interface CandidateKnowledgeDirectoryRootRevisionRecord {
  readonly directoryId: string;
  readonly knowledgeBaseId: string;
  readonly revision: number;
  readonly rootPath: string;
  readonly boundAt: string;
}

export interface CandidateKnowledgeDirectoryRootRebindMemberInput {
  readonly sourceId: string;
  /** Canonical physical path verified by the storage handle. */
  readonly originPath: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly expectedVersionId: string;
  readonly expectedOriginBoundAt: string;
}

export interface CandidateKnowledgeDirectoryRootRebindInput {
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly candidateRootPath: string;
  readonly expectedRootPath: string;
  readonly expectedRevision: number;
  readonly reboundAt: string;
  readonly members: readonly CandidateKnowledgeDirectoryRootRebindMemberInput[];
}

export interface CandidateKnowledgeDirectoryRootRebindResult {
  readonly binding: CandidateKnowledgeDirectoryBindingRecord;
  readonly revision: CandidateKnowledgeDirectoryRootRevisionRecord;
  readonly rebound: boolean;
}

export interface CandidateKnowledgeDirectoryMemberRecord {
  readonly directoryId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly relativePathHash: string;
}

export interface CandidateKnowledgeDirectoryMemberRevisionRecord {
  readonly directoryId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly relativePathHash: string;
  readonly boundAt: string;
}

export interface CandidateKnowledgeDirectoryMemberMoveInput {
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly sourceId: string;
  readonly targetOriginPath: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly expectedRootPath: string;
  readonly expectedRootRevision: number;
  readonly expectedMemberRevision: number;
  readonly expectedRelativePathHash: string;
  readonly expectedVersionId: string;
  readonly expectedOriginBoundAt: string;
  readonly movedAt: string;
}

export interface CandidateKnowledgeDirectoryMemberMoveResult {
  readonly member: CandidateKnowledgeDirectoryMemberRecord;
  readonly revision: CandidateKnowledgeDirectoryMemberRevisionRecord;
  readonly binding: CandidateKnowledgeSourceOriginBindingRecord;
  readonly moved: boolean;
}

export type CandidateKnowledgeDirectoryMemberOriginRelation =
  | "same-member"
  | "other-member"
  | "unmatched"
  | "outside-root"
  | "unbound";

export interface CandidateKnowledgeDirectoryMemberOriginRelationRecord {
  readonly directoryId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly relation: CandidateKnowledgeDirectoryMemberOriginRelation;
  /** Present only when the source currently has an origin binding. */
  readonly originBoundAt?: string;
}

export type CandidateKnowledgeDirectoryRefreshObservationStatus = Extract<
  CandidateKnowledgeSourceRefreshObservationStatus,
  "current" | "changed" | "missing"
>;

export interface CandidateKnowledgeDirectoryRefreshObservationInput {
  readonly sourceId: string;
  readonly observedVersionId: string;
  readonly status: CandidateKnowledgeDirectoryRefreshObservationStatus;
  readonly expectedOriginBoundAt: string;
}

export interface CandidateKnowledgeDirectoryRefreshObservationBatchInput {
  readonly checkedAt: string;
  readonly entries: readonly CandidateKnowledgeDirectoryRefreshObservationInput[];
}

export interface CandidateKnowledgeSourceVersionInput {
  readonly id: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface CandidateKnowledgeSourceVersionRecord
  extends CandidateKnowledgeSourceVersionInput {
  readonly sourceId: string;
  readonly version: number;
  readonly parentVersionId: string | null;
}

export const candidateKnowledgeSourceUrlKinds = [
  "github",
  "certification",
  "profile",
  "portfolio",
  "job-description",
  "generic",
] as const;
export type CandidateKnowledgeSourceUrlKind = (typeof candidateKnowledgeSourceUrlKinds)[number];

export interface CandidateKnowledgeSourceUrlProvenanceInput {
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly kind: CandidateKnowledgeSourceUrlKind;
}

export interface CandidateKnowledgeSourceUrlProvenanceRecord
  extends CandidateKnowledgeSourceUrlProvenanceInput {
  readonly sourceId: string;
  readonly versionId: string;
}

export interface CandidateKnowledgeSourcePortableUrlProvenance {
  readonly fetchedAt: string;
  readonly kind: CandidateKnowledgeSourceUrlKind;
}

export interface CandidateKnowledgePortableBackupImportInput {
  readonly manifest: CandidateKnowledgePortableBackupManifest;
  readonly operationId: string;
  readonly manifestChecksum: string;
  readonly restoredAt: string;
}

export interface CandidateKnowledgePortableBackupProvenance {
  readonly operationId: string;
  readonly manifestChecksum: string;
  readonly sourceStoreId: string;
  readonly packageSchemaVersion: number;
  readonly restoredAt: string;
}

export type CandidateKnowledgeSourceRefreshObservationStatus =
  | "current"
  | "changed"
  | "missing"
  | "inaccessible"
  | "unbound";

export interface CandidateKnowledgeSourceRefreshObservationInput {
  readonly observedVersionId: string;
  readonly status: CandidateKnowledgeSourceRefreshObservationStatus;
  readonly checkedAt: string;
  readonly lastRefreshedVersionId?: string | null;
  readonly lastRefreshedAt?: string | null;
}

export interface CandidateKnowledgeSourceRefreshObservationRecord
  extends CandidateKnowledgeSourceRefreshObservationInput {
  readonly sourceId: string;
  readonly lastRefreshedVersionId: string | null;
  readonly lastRefreshedAt: string | null;
  /** Derived from the source's current latest version; never persisted. */
  readonly stale: boolean;
}

export const candidateKnowledgeSourceLifecycleBlockerReasons = [
  "knowledge-base-archived",
  "source-retired",
  "latest-version-unmanaged",
  "source-origin-unbound",
  "directory-origin-conflict",
  "refresh-stale",
  "refresh-changed",
  "refresh-missing",
  "refresh-inaccessible",
  "refresh-unbound",
] as const;
export type CandidateKnowledgeSourceLifecycleBlockerReason =
  (typeof candidateKnowledgeSourceLifecycleBlockerReasons)[number];
export type CandidateKnowledgeSourceLifecycleReadinessStatus = "ready" | "blocked";

export interface CandidateKnowledgeSourceLifecycleObservationRevision {
  readonly observedVersionId: string;
  readonly status: CandidateKnowledgeSourceRefreshObservationStatus;
  readonly checkedAt: string;
  readonly lastRefreshedVersionId: string | null;
  readonly lastRefreshedAt: string | null;
  readonly stale: boolean;
}

export interface CandidateKnowledgeSourceLifecycleRetirementRevision {
  readonly retiredAt: string;
  readonly reason: CandidateKnowledgeSourceRetirementReason;
}

export interface CandidateKnowledgeSourceLifecycleDirectoryRevision {
  readonly directoryId: string;
  readonly rootRevision: number;
  readonly rootBoundAt: string;
  readonly memberRevision: number;
  readonly memberBoundAt: string;
}

export interface CandidateKnowledgeSourceLifecycleRevision {
  readonly knowledgeBaseState: CandidateKnowledgeBaseState;
  readonly knowledgeBaseArchivedAt: string | null;
  readonly versionId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly managed: boolean;
  readonly originBoundAt: string | null;
  readonly observation: CandidateKnowledgeSourceLifecycleObservationRevision | null;
  readonly retirement: CandidateKnowledgeSourceLifecycleRetirementRevision | null;
  readonly provenanceFetchedAt: string | null;
  readonly directory: CandidateKnowledgeSourceLifecycleDirectoryRevision | null;
}

export interface CandidateKnowledgeSourceLifecycleReadinessRecord {
  readonly sourceId: string;
  readonly latestVersionId: string;
  readonly status: CandidateKnowledgeSourceLifecycleReadinessStatus;
  readonly reasons: readonly CandidateKnowledgeSourceLifecycleBlockerReason[];
  readonly lifecycleRevision: CandidateKnowledgeSourceLifecycleRevision;
}

export interface CandidateKnowledgeBaseLifecycleReadinessRecord {
  readonly knowledgeBaseId: string;
  readonly state: CandidateKnowledgeBaseState;
  readonly archivedAt: string | null;
  readonly sources: readonly CandidateKnowledgeSourceLifecycleReadinessRecord[];
}

export const maximumCandidateKnowledgeRetentionExpireAfterDays = 36_500;

export interface CandidateKnowledgeRetentionClassPolicyInput {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly rule: CandidateKnowledgeRetentionRule;
  readonly expireAfterDays?: number | null;
}

export interface CandidateKnowledgeRetentionClassPolicy
  extends CandidateKnowledgeRetentionClassPolicyInput {
  readonly expireAfterDays: number | null;
}

export interface CandidateKnowledgeRetentionPolicyUpdateInput {
  readonly expectedRevision: number;
  readonly updatedAt: string;
  readonly classes: readonly CandidateKnowledgeRetentionClassPolicyInput[];
}

export interface CandidateKnowledgeRetentionOverrideRecord {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly kind: CandidateKnowledgeRetentionOverrideKind;
  readonly state: "applied" | "released";
  readonly sequence: number;
  readonly overrideRevision: number;
  readonly policyRevision: number;
  readonly changedAt: string;
}

export interface CandidateKnowledgeRetentionOverrideInput {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly kind: CandidateKnowledgeRetentionOverrideKind;
  readonly expectedPolicyRevision: number;
  readonly expectedState: "none" | "applied" | "released";
  readonly changedAt: string;
}

export interface CandidateKnowledgeRetentionPolicyRecord {
  readonly knowledgeBaseId: string;
  readonly revision: number;
  readonly overrideRevision: number;
  readonly updatedAt: string;
  readonly classes: readonly CandidateKnowledgeRetentionClassPolicy[];
  readonly activeOverrides: readonly CandidateKnowledgeRetentionOverrideRecord[];
}

export type CandidateKnowledgeRetentionOwnershipStatus = "owned" | "preserved" | "not-materialized";

export interface CandidateKnowledgeRetentionPlanClass {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly rule: CandidateKnowledgeRetentionRule;
  readonly expireAfterDays: number | null;
  readonly ownershipStatus: CandidateKnowledgeRetentionOwnershipStatus;
  readonly eligibleCount: number;
  readonly preservedCount: number;
  readonly unmanagedCount: number;
  readonly unknownCount: number;
  readonly countCapped: boolean;
  readonly preservationReasons: readonly (
    | "retention-rule"
    | "override"
    | "unmanaged"
    | "unknown"
    | "not-materialized"
  )[];
}

export interface CandidateKnowledgeRetentionPlan {
  readonly schemaVersion: 1;
  readonly knowledgeBaseId: string;
  readonly asOf: string;
  readonly policyRevision: number;
  readonly overrideRevision: number;
  readonly classes: readonly CandidateKnowledgeRetentionPlanClass[];
}

export const candidateKnowledgeSourceRetirementReasons = ["user-requested"] as const;
export type CandidateKnowledgeSourceRetirementReason =
  (typeof candidateKnowledgeSourceRetirementReasons)[number];

export interface CandidateKnowledgeSourceRetirementInput {
  readonly retiredAt: string;
  readonly reason: CandidateKnowledgeSourceRetirementReason;
}

export interface CandidateKnowledgeSourceRetirementRecord
  extends CandidateKnowledgeSourceRetirementInput {
  readonly sourceId: string;
}

export interface CandidateKnowledgeDirectoryMemberRetirementInput {
  readonly retiredAt: string;
  /** Current directory root revision observed during the scan. */
  readonly expectedRootPath: string;
  readonly expectedRootRevision: number;
  /** Current immutable-member revision/hash observed during the scan. */
  readonly expectedMemberRevision: number;
  readonly expectedRelativePathHash: string;
  /** The latest managed version observed during the directory scan. */
  readonly expectedVersionId: string;
  /** The origin-binding revision observed during the directory scan. */
  readonly expectedOriginBoundAt: string;
}

export interface CandidateKnowledgeSourceVersionWriteResult {
  readonly source: CandidateKnowledgeSourceRecord;
  readonly version: CandidateKnowledgeSourceVersionRecord;
  readonly created: boolean;
}

export interface ManagedCandidateKnowledgeSourceVersionRecord
  extends CandidateKnowledgeSourceVersionRecord {
  readonly knowledgeBaseId: string;
  readonly kind: CandidateKnowledgeSourceKind;
}

export type ManagedCandidateKnowledgeWriteKind = "create" | "append";
export type ManagedCandidateKnowledgeWriteEventState =
  | "targeted"
  | "published"
  | "committed"
  | "completed"
  | "aborted"
  | "noop";

export const managedCandidateKnowledgeWriteOwnerKind = "draft-loop" as const;
export const managedCandidateKnowledgeWriteOwnerSchemaVersion = 1 as const;

export type ManagedCandidateKnowledgeWriteJournalPhase =
  | "prepared"
  | ManagedCandidateKnowledgeWriteEventState;

export type ManagedCandidateKnowledgeWriteRecoveryOutcome = "aborted" | "completed" | "preserved";

export interface ManagedCandidateKnowledgeWriteOperationInput {
  readonly operationId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly requestedVersionId: string;
  readonly kind: ManagedCandidateKnowledgeWriteKind;
  readonly createdAt: string;
  /** Current candidate-store writer fencing generation; omitted rows are legacy. */
  readonly ownerGeneration?: number;
  /** Requested version integrity metadata for owned recovery. */
  readonly requestedMediaType?: string;
  readonly requestedChecksum?: string;
  readonly requestedSizeBytes?: number;
}

export interface ManagedCandidateKnowledgeWriteStagingIdentity {
  readonly device: number;
  readonly inode: number;
  readonly createdAt: string;
}

export type ManagedCandidateKnowledgeWriteRecoveryClaimPhase =
  | "prepared"
  | "targeted"
  | "published"
  | "committed";

export interface ManagedCandidateKnowledgeWriteRecoveryClaim {
  readonly phase: ManagedCandidateKnowledgeWriteRecoveryClaimPhase;
  readonly generation: number;
  readonly claimedAt: string;
}

export interface ManagedCandidateKnowledgeWriteOperationRecord
  extends ManagedCandidateKnowledgeWriteOperationInput {
  readonly ownerKind: string | null;
  readonly ownerSchemaVersion: number | null;
  readonly latestPhase: ManagedCandidateKnowledgeWriteJournalPhase;
  readonly latestEventCreatedAt: string | null;
  readonly targetVersionId: string | null;
  readonly stagingIdentity: ManagedCandidateKnowledgeWriteStagingIdentity | null;
  readonly recoveryClaim: ManagedCandidateKnowledgeWriteRecoveryClaim | null;
}

export interface ManagedCandidateKnowledgeWriteRecoveryEntry {
  readonly kind: ManagedCandidateKnowledgeWriteKind;
  readonly phase: ManagedCandidateKnowledgeWriteJournalPhase;
  readonly outcome: ManagedCandidateKnowledgeWriteRecoveryOutcome;
}

export interface ManagedCandidateKnowledgeWriteRecoveryReport {
  readonly schemaVersion: 1;
  readonly entries: readonly ManagedCandidateKnowledgeWriteRecoveryEntry[];
}

export type ManagedCandidateKnowledgeWriteCommitInput =
  | {
      readonly kind: "create";
      readonly operationId: string;
      readonly source: CandidateKnowledgeSourceInput;
      readonly version: CandidateKnowledgeSourceVersionInput;
      /** Canonical physical path returned by the verified managed-file capture. */
      readonly originPath?: string;
      /** Runtime-only directory membership context for a new managed file source. */
      readonly directoryId?: string;
      readonly urlProvenance?: CandidateKnowledgeSourceUrlProvenanceInput;
      /** Current candidate-store writer fencing generation; runtime-only. */
      readonly expectedOwnerGeneration?: number;
    }
  | {
      readonly kind: "append";
      readonly operationId: string;
      readonly version: CandidateKnowledgeSourceVersionInput;
      /** Required for URL appends; forbidden for file appends. */
      readonly urlProvenance?: CandidateKnowledgeSourceUrlProvenanceInput;
      /** Runtime lineage guard used by URL refresh; never persisted. */
      readonly expectedCurrentVersionId?: string;
      /** Runtime origin-revision guard used by guarded file refresh; never persisted. */
      readonly expectedOriginBoundAt?: string;
      /** Runtime canonical origin-path guard used by guarded file refresh; never persisted. */
      readonly expectedOriginPath?: string;
      /** Current candidate-store writer fencing generation; runtime-only. */
      readonly expectedOwnerGeneration?: number;
    };

export interface CandidateKnowledgeBaseStoragePort {
  readonly ensureDefaultCandidateKnowledgeBase: (
    input: Omit<CandidateKnowledgeBaseInput, "isDefault">,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly createCandidateKnowledgeBase: (
    input: CandidateKnowledgeBaseInput,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly getCandidateKnowledgeBase: (
    id: string,
  ) => Promise<CandidateKnowledgeBaseRecord | undefined>;
  readonly listCandidateKnowledgeBases: () => Promise<readonly CandidateKnowledgeBaseRecord[]>;
  readonly renameCandidateKnowledgeBase: (
    id: string,
    displayName: string,
    updatedAt: string,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly archiveCandidateKnowledgeBase: (
    id: string,
    archivedAt: string,
  ) => Promise<CandidateKnowledgeBaseRecord>;
  readonly createCandidateKnowledgeSource: (
    source: CandidateKnowledgeSourceInput,
    initialVersion: CandidateKnowledgeSourceVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly appendCandidateKnowledgeSourceVersion: (
    knowledgeBaseId: string,
    sourceId: string,
    version: CandidateKnowledgeSourceVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly getCandidateKnowledgeSource: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceRecord | undefined>;
  readonly listCandidateKnowledgeSources: (
    knowledgeBaseId: string,
  ) => Promise<readonly CandidateKnowledgeSourceRecord[]>;
  readonly listCandidateKnowledgeSourceVersions: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<readonly CandidateKnowledgeSourceVersionRecord[]>;
  readonly getCandidateKnowledgeBaseLifecycleReadiness: (
    knowledgeBaseId: string,
  ) => Promise<CandidateKnowledgeBaseLifecycleReadinessRecord | undefined>;
  readonly createCandidateKnowledgeDirectoryBinding: (
    input: CandidateKnowledgeDirectoryBindingInput,
  ) => Promise<CandidateKnowledgeDirectoryBindingRecord>;
  readonly getCandidateKnowledgeDirectoryBinding: (
    knowledgeBaseId: string,
    directoryId: string,
  ) => Promise<CandidateKnowledgeDirectoryBindingRecord | undefined>;
  readonly getCandidateKnowledgeDirectoryCurrentRootRevision: (
    knowledgeBaseId: string,
    directoryId: string,
  ) => Promise<CandidateKnowledgeDirectoryRootRevisionRecord | undefined>;
  readonly getCandidateKnowledgeDirectoryMemberCurrentRevision: (
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeDirectoryMemberRevisionRecord | undefined>;
  readonly findCandidateKnowledgeDirectoryBinding: (
    knowledgeBaseId: string,
    rootPath: string,
  ) => Promise<CandidateKnowledgeDirectoryBindingRecord | undefined>;
  readonly listCandidateKnowledgeDirectoryMembers: (
    knowledgeBaseId: string,
    directoryId: string,
  ) => Promise<readonly CandidateKnowledgeDirectoryMemberRecord[]>;
  readonly findCandidateKnowledgeDirectoryMemberByPath: (
    knowledgeBaseId: string,
    directoryId: string,
    sourcePath: string,
  ) => Promise<CandidateKnowledgeDirectoryMemberRecord | undefined>;
  /** Resolve a historical member hash using a candidate root without mutating the binding. */
  readonly findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath: (
    knowledgeBaseId: string,
    directoryId: string,
    candidateRootPath: string,
    sourcePath: string,
  ) => Promise<CandidateKnowledgeDirectoryMemberRecord | undefined>;
  readonly getCandidateKnowledgeDirectoryMemberOriginRelation: (
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeDirectoryMemberOriginRelationRecord>;
  readonly upsertCandidateKnowledgeDirectoryRefreshObservations: (
    knowledgeBaseId: string,
    directoryId: string,
    input: CandidateKnowledgeDirectoryRefreshObservationBatchInput,
  ) => Promise<readonly CandidateKnowledgeSourceRefreshObservationRecord[]>;
  readonly getCandidateKnowledgeSourceUrlProvenance: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<CandidateKnowledgeSourceUrlProvenanceRecord | undefined>;
  readonly getCandidateKnowledgeSourcePortableUrlProvenance: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<CandidateKnowledgeSourcePortableUrlProvenance | undefined>;
  readonly getCandidateKnowledgeSourceRefreshObservation: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceRefreshObservationRecord | undefined>;
  readonly upsertCandidateKnowledgeSourceRefreshObservation: (
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRefreshObservationInput,
  ) => Promise<CandidateKnowledgeSourceRefreshObservationRecord>;
  readonly getCandidateKnowledgeSourceRetirement: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceRetirementRecord | undefined>;
  readonly retireCandidateKnowledgeSource: (
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRetirementInput,
  ) => Promise<CandidateKnowledgeSourceRetirementRecord>;
  readonly retireCandidateKnowledgeDirectoryMember: (
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
    input: CandidateKnowledgeDirectoryMemberRetirementInput,
  ) => Promise<CandidateKnowledgeSourceRetirementRecord>;
  readonly getCandidateKnowledgeRetentionPolicy: (
    knowledgeBaseId: string,
  ) => Promise<CandidateKnowledgeRetentionPolicyRecord>;
  readonly setCandidateKnowledgeRetentionPolicy: (
    knowledgeBaseId: string,
    input: CandidateKnowledgeRetentionPolicyUpdateInput,
  ) => Promise<CandidateKnowledgeRetentionPolicyRecord>;
  readonly applyCandidateKnowledgeRetentionOverride: (
    knowledgeBaseId: string,
    input: CandidateKnowledgeRetentionOverrideInput,
  ) => Promise<CandidateKnowledgeRetentionPolicyRecord>;
  readonly releaseCandidateKnowledgeRetentionOverride: (
    knowledgeBaseId: string,
    input: CandidateKnowledgeRetentionOverrideInput,
  ) => Promise<CandidateKnowledgeRetentionPolicyRecord>;
}

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
    profileId: string,
  ) => Promise<readonly CanonicalCandidateProfileVersionRecord[]>;
}

export interface CandidateKnowledgeLexicalStoragePort {
  readonly rebuildCandidateKnowledgeLexicalIndex: (
    input: CandidateKnowledgeLexicalIndexRebuildInput,
  ) => Promise<CandidateKnowledgeLexicalIndexRecord>;
  readonly upsertCandidateKnowledgeLexicalChunks: (
    input: CandidateKnowledgeLexicalIndexUpsertInput,
  ) => Promise<CandidateKnowledgeLexicalIndexRecord>;
  readonly deleteCandidateKnowledgeLexicalSourceVersion: (
    input: CandidateKnowledgeLexicalSourceVersionDeletionInput,
  ) => Promise<void>;
  readonly inspectCandidateKnowledgeLexicalIndex: (
    scope: CandidateKnowledgeRetrievalScopeInput,
    index?: CandidateKnowledgeLexicalIndexIdentityInput,
  ) => Promise<CandidateKnowledgeLexicalIndexInspection>;
  readonly queryCandidateKnowledge: (
    request: CandidateKnowledgeLexicalRetrievalRequestInput,
  ) => Promise<CandidateKnowledgeLexicalRetrievalResult>;
  readonly appendCandidateKnowledgeRetrievalTrace: (
    input: CandidateKnowledgeRetrievalTraceInput,
  ) => Promise<CandidateKnowledgeRetrievalTrace>;
  readonly getCandidateKnowledgeRetrievalTrace: (
    workspaceId: string,
    traceId: string,
  ) => Promise<CandidateKnowledgeRetrievalTrace | undefined>;
  readonly listCandidateKnowledgeRetrievalTraces: (
    workspaceId: string,
    options?: CandidateKnowledgeRetrievalTraceListOptions,
  ) => Promise<readonly CandidateKnowledgeRetrievalTrace[]>;
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

export interface EvidenceSourceRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly createdAt: string;
}

export interface EvidenceChunkRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly ordinal: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly checksum: string;
  readonly text: string;
  readonly createdAt: string;
}

export type StoredRunState = WorkflowState | "provider-error";
export type StoredRunStep = "author" | "critic" | "revision" | null;
export type StoredApprovalStatus = "pending" | "approved" | "rejected";
export type StoredRoundState = Extract<
  StoredRunState,
  | "drafting"
  | "reviewing"
  | "revising"
  | "budget-exhausted"
  | "provider-error"
  | "paused"
  | "stopped"
  | "awaiting-approval"
>;
export type StoredExecutionStep = Exclude<StoredRunStep, null>;
export type StoredExecutionStatus = "completed" | "failed";
export type StoredFindingSeverity = "error" | "warning";
export type StoredDecisionType = "edit" | "accept-finding" | "reject-finding" | "approve";
export type StoredExportStatus = "prepared" | "completed" | "failed";

export interface RunRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly contextSnapshotId: string;
  readonly state: StoredRunState;
  readonly round: number;
  readonly currentStep: StoredRunStep;
  readonly budget: JsonValue;
  readonly artifactId: string | null;
  readonly approval: StoredApprovalStatus;
  readonly totalCostUsd: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RunRecord extends RunRecordInput {
  readonly checksum: string;
}

/**
 * Append-only lifecycle projection input. The full orchestration snapshot is
 * retained in `payload`; the duplicated columns keep current-state queries
 * cheap and independent of the orchestrator package.
 */
export interface RunSnapshotRecordInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly state: StoredRunState;
  readonly round: number;
  readonly currentStep: StoredRunStep;
  readonly budget: JsonValue;
  readonly artifactId: string | null;
  readonly approval: StoredApprovalStatus;
  readonly totalCostUsd: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RunSnapshotRecord extends RunSnapshotRecordInput {
  readonly id: string;
  readonly sequence: number;
  readonly checksum: string;
}

export interface RoundRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly number: number;
  readonly state: StoredRoundState;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly evaluation: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RoundRecord extends RoundRecordInput {
  readonly checksum: string;
}

export interface ExecutionRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string;
  readonly contextSnapshotId: string;
  readonly artifactId: string | null;
  readonly attempt: number;
  readonly step: StoredExecutionStep;
  readonly status: StoredExecutionStatus;
  readonly provider: string;
  readonly modelId: string;
  readonly providerRequestId: string | null;
  readonly outputChecksum: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedUsd: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly output: JsonValue | null;
  readonly payload: JsonValue;
}

export interface ExecutionRecord extends ExecutionRecordInput {
  readonly checksum: string;
}

export interface FindingRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string;
  readonly executionId: string | null;
  readonly artifactId: string | null;
  readonly code: string;
  readonly category: string;
  readonly severity: StoredFindingSeverity;
  readonly message: string;
  readonly claimId: string | null;
  readonly sectionId: string | null;
  readonly requirementId: string | null;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface FindingRecord extends FindingRecordInput {
  readonly checksum: string;
}

export interface DecisionRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string | null;
  readonly artifactId: string | null;
  readonly type: StoredDecisionType;
  readonly rationale: string;
  readonly actor: string;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface DecisionRecord extends DecisionRecordInput {
  readonly checksum: string;
}

export interface ExportRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly format: string;
  readonly status: StoredExportStatus;
  readonly outputPath: string | null;
  readonly outputChecksum: string | null;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface ExportRecord extends ExportRecordInput {
  readonly checksum: string;
}

export interface RetentionPlan {
  readonly before: string;
  readonly auditEventsEligible: number;
  readonly immutableBusinessRecords: true;
}

export interface RetentionPurgeOptions {
  readonly confirmed: boolean;
}

export interface RetentionPurgeResult {
  readonly before: string;
  readonly deletedAuditEventsCount: number;
  readonly executedAt: string;
}

/** Internal journal phase for a confirmed candidate knowledge-base deletion. */
export type CandidateKnowledgeDeletionOperationPhase =
  | "prepared"
  | "staging"
  | "committed"
  | "completed"
  | "aborted";

/**
 * Internal deletion artifact identity. These records are deliberately not
 * exposed by `CandidateKnowledgeStoreHandle`; they let restart recovery prove
 * ownership of a staged managed blob without retaining a filesystem path.
 */
export interface CandidateKnowledgeDeletionArtifactRecord {
  readonly operationId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly device: number;
  readonly inode: number;
}

/** Internal deletion operation journal projection used by the filesystem adapter. */
export interface CandidateKnowledgeDeletionOperationRecord {
  readonly operationId: string;
  readonly knowledgeBaseId: string;
  readonly confirmationToken: string;
  readonly graphDigest: string;
  readonly phase: CandidateKnowledgeDeletionOperationPhase;
  readonly createdAt: string;
  readonly committedAt: string | null;
  readonly completedAt: string | null;
  readonly stagingDevice: number | null;
  readonly stagingInode: number | null;
  readonly managedArtifactCount: number;
  readonly managedArtifactBytes: number;
  readonly preservedUnknownCount: number;
  readonly preservedUnmanagedCount: number;
  readonly countCapped: boolean;
  readonly artifacts: readonly CandidateKnowledgeDeletionArtifactRecord[];
}

/** Internal bounded deletion audit counters retained after graph removal. */
export interface CandidateKnowledgeDeletionAuditCounts {
  readonly managedArtifactCount: number;
  readonly managedArtifactBytes: number;
  readonly preservedUnknownCount: number;
  readonly preservedUnmanagedCount: number;
  readonly countCapped: boolean;
}

/** Content-free deletion audit projection retained after a successful deletion. */
export interface CandidateKnowledgeDeletionAuditRecord {
  readonly auditId: string;
  readonly operationId: string;
  readonly knowledgeBaseId: string;
  readonly confirmationToken: string;
  readonly status: "completed";
  readonly createdAt: string;
  readonly completedAt: string;
  readonly counts: CandidateKnowledgeDeletionAuditCounts;
}

/** Internal graph snapshot used to bind a deletion confirmation token. */
export interface CandidateKnowledgeDeletionDatabaseSnapshot {
  readonly knowledgeBaseId: string;
  readonly state: CandidateKnowledgeBaseState;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly policy: CandidateKnowledgeRetentionPolicyRecord;
  readonly graphDigest: string;
  readonly sourceCount: number;
  readonly versionCount: number;
  readonly managedArtifacts: readonly {
    readonly sourceId: string;
    readonly versionId: string;
    readonly checksum: string;
    readonly sizeBytes: number;
  }[];
  readonly unmanagedSourceCount: number;
  readonly unmanagedVersionCount: number;
  readonly pendingOperationCount: number;
}

/** Internal input for creating an owned deletion operation journal. */
export interface CandidateKnowledgeDeletionOperationInput {
  readonly operationId: string;
  readonly knowledgeBaseId: string;
  readonly confirmationToken: string;
  readonly graphDigest: string;
  readonly createdAt: string;
  readonly managedArtifactCount: number;
  readonly managedArtifactBytes: number;
  readonly preservedUnknownCount: number;
  readonly preservedUnmanagedCount: number;
  readonly countCapped: boolean;
  readonly artifacts: readonly Omit<CandidateKnowledgeDeletionArtifactRecord, "operationId">[];
}

/** Internal input for the logical deletion commit. */
export interface CandidateKnowledgeDeletionCommitInput {
  readonly operationId: string;
  readonly knowledgeBaseId: string;
  readonly confirmationToken: string;
  readonly graphDigest: string;
  readonly committedAt: string;
}

export interface DiagnosticTelemetryReport {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly aggregates: {
    readonly workspacesCount: number;
    readonly totalRunsCount: number;
    readonly totalRoundsCount: number;
    readonly totalExecutionsCount: number;
    readonly executionsByStatus: Readonly<Record<string, number>>;
    readonly executionsByStep: Readonly<Record<string, number>>;
    readonly findingsCount: number;
    readonly findingsBySeverity: Readonly<Record<string, number>>;
    readonly decisionsCount: number;
    readonly totalCostUsd: number;
    readonly totalTokens: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
    };
    readonly providersDistribution: Readonly<Record<string, number>>;
  };
  readonly checksum: string;
}

/** Typed history boundary shared by CLI and future UI adapters. */
export interface HistoryStoragePort {
  readonly saveRun: (input: RunRecordInput) => Promise<RunRecord>;
  readonly getRun: (id: string) => Promise<RunRecord | undefined>;
  readonly listRuns: (workspaceId: string) => Promise<readonly RunRecord[]>;
  readonly saveRunSnapshot: (input: RunSnapshotRecordInput) => Promise<RunSnapshotRecord>;
  readonly getLatestRunSnapshot: (runId: string) => Promise<RunSnapshotRecord | undefined>;
  readonly listRunSnapshots: (runId: string) => Promise<readonly RunSnapshotRecord[]>;
  readonly saveRound: (input: RoundRecordInput) => Promise<RoundRecord>;
  readonly getRound: (id: string) => Promise<RoundRecord | undefined>;
  readonly listRounds: (runId: string) => Promise<readonly RoundRecord[]>;
  readonly saveExecution: (input: ExecutionRecordInput) => Promise<ExecutionRecord>;
  readonly getExecution: (id: string) => Promise<ExecutionRecord | undefined>;
  readonly listExecutions: (runId: string) => Promise<readonly ExecutionRecord[]>;
  readonly saveFinding: (input: FindingRecordInput) => Promise<FindingRecord>;
  readonly getFinding: (id: string) => Promise<FindingRecord | undefined>;
  readonly listFindings: (runId: string) => Promise<readonly FindingRecord[]>;
  readonly saveDecision: (input: DecisionRecordInput) => Promise<DecisionRecord>;
  readonly getDecision: (id: string) => Promise<DecisionRecord | undefined>;
  readonly listDecisions: (runId: string) => Promise<readonly DecisionRecord[]>;
  readonly saveExport: (input: ExportRecordInput) => Promise<ExportRecord>;
  readonly getExport: (id: string) => Promise<ExportRecord | undefined>;
  readonly listExports: (runId: string) => Promise<readonly ExportRecord[]>;
}

export interface AuditEventInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly eventType: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: JsonValue;
  readonly createdAt: string;
}

export interface AuditEvent extends AuditEventInput {
  readonly sequence: number;
  readonly payloadChecksum: string;
  readonly previousEventChecksum: string | null;
  readonly eventChecksum: string;
}

export type { RetrievalOptions, RetrievalPort, ScoredEvidenceChunk };
export type EvidenceSearchHit = ScoredEvidenceChunk;
export type EvidenceSearchOptions = RetrievalOptions;

const maximumEvidenceQueryTerms = 48;
const evidenceQueryStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "will",
  "with",
  "you",
  "your",
]);

function evidenceQueryTerms(query: string): readonly string[] {
  const rawTokens = query.trim().match(/[\p{L}\p{N}_-]+/gu);
  if (rawTokens === null) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of rawTokens) {
    const normalized = token.toLocaleLowerCase("en-US");
    if (normalized.length < 2 || evidenceQueryStopWords.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(token);
    if (terms.length === maximumEvidenceQueryTerms) break;
  }
  return terms;
}

export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

export class StorageSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageSecurityError";
  }
}

export class StorageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConflictError";
  }
}

export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageValidationError";
  }
}

export const storageSchemaVersion = 26 as const;

interface SqliteStatement {
  readonly run: (...parameters: readonly unknown[]) => {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  };
  readonly get: <Row extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: readonly unknown[]
  ) => Row | undefined;
  readonly all: <Row extends Record<string, unknown> = Record<string, unknown>>(
    ...parameters: readonly unknown[]
  ) => readonly Row[];
}

interface SqliteHandle {
  readonly exec: (sql: string) => void;
  readonly pragma: (sql: string) => unknown;
  readonly prepare: (sql: string) => SqliteStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
  readonly backup: (destination: string) => Promise<unknown>;
  readonly close: () => void;
}

interface SqliteConstructor {
  new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }): SqliteHandle;
}

export interface SqliteStorageOpenOptions {
  readonly readOnly?: boolean;
  readonly fileMustExist?: boolean;
}

interface Migration {
  readonly version: number;
  readonly sql: string;
  readonly requiresForeignKeyRebuild?: boolean;
}

const migrationOne: Migration = {
  version: 1,
  sql: `
    CREATE TABLE IF NOT EXISTS key_value (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_sources (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, path, checksum)
    );

    CREATE TABLE IF NOT EXISTS evidence_chunks (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      source_id TEXT NOT NULL REFERENCES evidence_sources(id),
      ordinal INTEGER NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (source_id, ordinal)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS evidence_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      workspace_id UNINDEXED,
      source_id UNINDEXED,
      text
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      version INTEGER NOT NULL,
      parent_version_id TEXT REFERENCES artifact_versions(id),
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL,
      UNIQUE (workspace_id, version)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL,
      previous_event_checksum TEXT,
      event_checksum TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS context_snapshots_immutable_update
      BEFORE UPDATE ON context_snapshots
      BEGIN SELECT RAISE(ABORT, 'context snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS context_snapshots_immutable_delete
      BEFORE DELETE ON context_snapshots
      BEGIN SELECT RAISE(ABORT, 'context snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_sources_immutable_update
      BEFORE UPDATE ON evidence_sources
      BEGIN SELECT RAISE(ABORT, 'evidence sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_sources_immutable_delete
      BEFORE DELETE ON evidence_sources
      BEGIN SELECT RAISE(ABORT, 'evidence sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_chunks_immutable_update
      BEFORE UPDATE ON evidence_chunks
      BEGIN SELECT RAISE(ABORT, 'evidence chunks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_chunks_immutable_delete
      BEFORE DELETE ON evidence_chunks
      BEGIN SELECT RAISE(ABORT, 'evidence chunks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS artifact_versions_immutable_update
      BEFORE UPDATE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS artifact_versions_immutable_delete
      BEFORE DELETE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_immutable_update
      BEFORE UPDATE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_immutable_delete
      BEFORE DELETE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
  `.trim(),
};

const migrationTwo: Migration = {
  version: 2,
  sql: `
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
      state TEXT NOT NULL,
      round INTEGER NOT NULL CHECK (round >= 1),
      current_step TEXT,
      budget_json TEXT NOT NULL,
      artifact_id TEXT REFERENCES artifact_versions(id),
      approval TEXT NOT NULL CHECK (approval IN ('pending', 'approved', 'rejected')),
      total_cost_usd REAL NOT NULL CHECK (total_cost_usd >= 0),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error_json TEXT,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      number INTEGER NOT NULL CHECK (number >= 1),
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      evaluation_json TEXT,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      UNIQUE (run_id, number),
      UNIQUE (id, workspace_id),
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
      artifact_id TEXT REFERENCES artifact_versions(id),
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      step TEXT NOT NULL CHECK (step IN ('author', 'critic', 'revision')),
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      provider_request_id TEXT,
      output_checksum TEXT,
      input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
      output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
      total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
      estimated_usd REAL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error_code TEXT,
      output_json TEXT,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      UNIQUE (run_id, round_id, step, attempt),
      UNIQUE (id, workspace_id),
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id),
      FOREIGN KEY (round_id, workspace_id) REFERENCES rounds(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      execution_id TEXT,
      artifact_id TEXT REFERENCES artifact_versions(id),
      code TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('error', 'warning')),
      message TEXT NOT NULL,
      claim_id TEXT,
      section_id TEXT,
      requirement_id TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id),
      FOREIGN KEY (round_id, workspace_id) REFERENCES rounds(id, workspace_id),
      FOREIGN KEY (execution_id, workspace_id) REFERENCES executions(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      round_id TEXT,
      artifact_id TEXT REFERENCES artifact_versions(id),
      type TEXT NOT NULL CHECK (type IN ('edit', 'accept-finding', 'reject-finding', 'approve')),
      rationale TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id),
      FOREIGN KEY (round_id, workspace_id) REFERENCES rounds(id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES artifact_versions(id),
      format TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('prepared', 'completed', 'failed')),
      output_path TEXT,
      output_checksum TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      FOREIGN KEY (run_id, workspace_id) REFERENCES runs(id, workspace_id)
    );

    CREATE INDEX IF NOT EXISTS runs_workspace_updated_idx ON runs(workspace_id, updated_at, id);
    CREATE INDEX IF NOT EXISTS rounds_run_number_idx ON rounds(run_id, number, id);
    CREATE INDEX IF NOT EXISTS executions_run_started_idx ON executions(run_id, started_at, id);
    CREATE INDEX IF NOT EXISTS findings_run_created_idx ON findings(run_id, created_at, id);
    CREATE INDEX IF NOT EXISTS decisions_run_created_idx ON decisions(run_id, created_at, id);
    CREATE INDEX IF NOT EXISTS exports_run_created_idx ON exports(run_id, created_at, id);

    CREATE TRIGGER IF NOT EXISTS runs_immutable_update
      BEFORE UPDATE ON runs
      BEGIN SELECT RAISE(ABORT, 'runs are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS runs_immutable_delete
      BEFORE DELETE ON runs
      BEGIN SELECT RAISE(ABORT, 'runs are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS rounds_immutable_update
      BEFORE UPDATE ON rounds
      BEGIN SELECT RAISE(ABORT, 'rounds are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS rounds_immutable_delete
      BEFORE DELETE ON rounds
      BEGIN SELECT RAISE(ABORT, 'rounds are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS executions_immutable_update
      BEFORE UPDATE ON executions
      BEGIN SELECT RAISE(ABORT, 'executions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS executions_immutable_delete
      BEFORE DELETE ON executions
      BEGIN SELECT RAISE(ABORT, 'executions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS findings_immutable_update
      BEFORE UPDATE ON findings
      BEGIN SELECT RAISE(ABORT, 'findings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS findings_immutable_delete
      BEFORE DELETE ON findings
      BEGIN SELECT RAISE(ABORT, 'findings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS decisions_immutable_update
      BEFORE UPDATE ON decisions
      BEGIN SELECT RAISE(ABORT, 'decisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS decisions_immutable_delete
      BEFORE DELETE ON decisions
      BEGIN SELECT RAISE(ABORT, 'decisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS exports_immutable_update
      BEFORE UPDATE ON exports
      BEGIN SELECT RAISE(ABORT, 'exports are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS exports_immutable_delete
      BEFORE DELETE ON exports
      BEGIN SELECT RAISE(ABORT, 'exports are immutable'); END;
  `.trim(),
};

const migrationThree: Migration = {
  version: 3,
  sql: `
    CREATE TABLE IF NOT EXISTS run_snapshots (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL,
      context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
      state TEXT NOT NULL,
      round INTEGER NOT NULL CHECK (round >= 1),
      current_step TEXT,
      budget_json TEXT NOT NULL,
      artifact_id TEXT,
      approval TEXT NOT NULL CHECK (approval IN ('pending', 'approved', 'rejected')),
      total_cost_usd REAL NOT NULL CHECK (total_cost_usd >= 0),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error_json TEXT,
      payload_json TEXT NOT NULL,
      record_checksum TEXT NOT NULL,
      UNIQUE (run_id, record_checksum)
    );

    CREATE INDEX IF NOT EXISTS run_snapshots_run_sequence_idx
      ON run_snapshots(run_id, sequence);

    CREATE TRIGGER IF NOT EXISTS run_snapshots_immutable_update
      BEFORE UPDATE ON run_snapshots
      BEGIN SELECT RAISE(ABORT, 'run snapshots are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS run_snapshots_immutable_delete
      BEFORE DELETE ON run_snapshots
      BEGIN SELECT RAISE(ABORT, 'run snapshots are immutable'); END;
  `.trim(),
};

const migrationFour: Migration = {
  version: 4,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_bases (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      CHECK (
        (state = 'active' AND archived_at IS NULL) OR
        (state = 'archived' AND archived_at IS NOT NULL)
      ),
      CHECK (is_default = 0 OR state = 'active')
    );

    CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_bases_one_default_idx
      ON candidate_knowledge_bases(is_default)
      WHERE is_default = 1;
  `.trim(),
};

const migrationFive: Migration = {
  version: 5,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_sources (
      id TEXT PRIMARY KEY NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases(id),
      kind TEXT NOT NULL CHECK (kind IN ('file', 'url')),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
      created_at TEXT NOT NULL,
      UNIQUE (id, candidate_knowledge_base_id)
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_versions (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT NOT NULL REFERENCES candidate_knowledge_sources(id),
      version INTEGER NOT NULL CHECK (version >= 1),
      parent_version_id TEXT,
      media_type TEXT NOT NULL CHECK (length(trim(media_type)) > 0),
      checksum TEXT NOT NULL CHECK (
        length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'
      ),
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND typeof(size_bytes) = 'integer'),
      created_at TEXT NOT NULL,
      UNIQUE (source_id, version),
      UNIQUE (id, source_id),
      FOREIGN KEY (parent_version_id, source_id)
        REFERENCES candidate_knowledge_source_versions(id, source_id),
      CHECK (
        (version = 1 AND parent_version_id IS NULL) OR
        (version > 1 AND parent_version_id IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS candidate_knowledge_sources_ckb_created_idx
      ON candidate_knowledge_sources(candidate_knowledge_base_id, created_at, id);
    CREATE INDEX IF NOT EXISTS candidate_knowledge_source_versions_source_version_idx
      ON candidate_knowledge_source_versions(source_id, version, id);

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_sources_immutable_update
      BEFORE UPDATE ON candidate_knowledge_sources
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_sources_immutable_delete
      BEFORE DELETE ON candidate_knowledge_sources
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge sources are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_versions_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_versions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_versions_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_versions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source versions are immutable'); END;
  `.trim(),
};

const migrationSix: Migration = {
  version: 6,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_source_versions (
      version_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_source_versions(id)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_require_file
      BEFORE INSERT ON candidate_knowledge_managed_source_versions
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_source_versions AS v
        JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
        WHERE v.id = NEW.version_id AND s.kind = 'file'
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions require a file source'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_source_versions
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_source_versions
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions are immutable'); END;
  `.trim(),
};

const migrationSeven: Migration = {
  version: 7,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_write_operations (
      operation_id TEXT PRIMARY KEY NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases(id),
      source_id TEXT NOT NULL,
      requested_version_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('create', 'append')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_write_events (
      operation_id TEXT NOT NULL
        REFERENCES candidate_knowledge_managed_write_operations(operation_id),
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      state TEXT NOT NULL CHECK (
        state IN ('targeted', 'published', 'committed', 'completed', 'aborted', 'noop')
      ),
      target_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (operation_id, sequence)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_operations_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_write_operations
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write operations are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_operations_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_write_operations
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write operations are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_write_events
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_write_events
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write events are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_contiguous_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NEW.sequence <> COALESCE((
        SELECT MAX(sequence) + 1
        FROM candidate_knowledge_managed_write_events
        WHERE operation_id = NEW.operation_id
      ), 1)
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event sequence is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_target_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN (
        EXISTS (
          SELECT 1 FROM candidate_knowledge_managed_write_events
          WHERE operation_id = NEW.operation_id AND target_version_id <> NEW.target_version_id
        ) OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_managed_write_operations AS operation
          WHERE operation.operation_id = NEW.operation_id
            AND (
              operation.requested_version_id = NEW.target_version_id OR
              (
                operation.kind = 'append' AND EXISTS (
                  SELECT 1 FROM candidate_knowledge_source_versions AS version
                  WHERE version.id = NEW.target_version_id
                    AND version.source_id = operation.source_id
                )
              )
            )
        )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event target is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_timestamp_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN julianday(NEW.created_at) IS NULL OR EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        WHERE operation.operation_id = NEW.operation_id
          AND julianday(NEW.created_at) < julianday(operation.created_at)
      ) OR EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_events AS event
        WHERE event.operation_id = NEW.operation_id
          AND julianday(NEW.created_at) < julianday(event.created_at)
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event timestamp is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_transition_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NOT (
        (NEW.sequence = 1 AND NEW.state IN ('targeted', 'noop')) OR
        (
          NEW.sequence > 1 AND EXISTS (
            SELECT 1
            FROM candidate_knowledge_managed_write_events AS previous
            WHERE previous.operation_id = NEW.operation_id
              AND previous.sequence = NEW.sequence - 1
              AND (
                (previous.state = 'targeted' AND NEW.state IN ('published', 'aborted')) OR
                (previous.state = 'published' AND NEW.state IN ('committed', 'aborted')) OR
                (previous.state = 'committed' AND NEW.state = 'completed')
              )
          )
        )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event transition is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_commit_target_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NEW.state IN ('committed', 'completed') AND NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        JOIN candidate_knowledge_sources AS source
          ON source.id = operation.source_id
         AND source.candidate_knowledge_base_id = operation.candidate_knowledge_base_id
        JOIN candidate_knowledge_source_versions AS version
          ON version.id = NEW.target_version_id
         AND version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE operation.operation_id = NEW.operation_id
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write commit target is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_noop_target_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NEW.state = 'noop' AND NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        JOIN candidate_knowledge_sources AS source
          ON source.id = operation.source_id
         AND source.candidate_knowledge_base_id = operation.candidate_knowledge_base_id
        JOIN candidate_knowledge_source_versions AS version
          ON version.id = NEW.target_version_id
         AND version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE operation.operation_id = NEW.operation_id
          AND operation.kind = 'append'
          AND version.version = (
            SELECT MAX(current.version)
            FROM candidate_knowledge_source_versions AS current
            WHERE current.source_id = source.id
          )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write noop target is invalid'); END;
  `.trim(),
};

const migrationEight: Migration = {
  version: 8,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_origin_bindings (
      source_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      origin_path TEXT NOT NULL CHECK (length(trim(origin_path)) > 0),
      bound_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_require_managed_file
      BEFORE INSERT ON candidate_knowledge_source_origin_bindings
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_sources AS source
        JOIN candidate_knowledge_source_versions AS version
          ON version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE source.id = NEW.source_id AND source.kind = 'file'
      )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin bindings require a managed file source'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_origin_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_origin_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin bindings are immutable'); END;
  `.trim(),
};

const migrationNine: Migration = {
  version: 9,
  sql: `
    DROP TRIGGER IF EXISTS candidate_knowledge_source_origin_bindings_immutable_update;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_origin_bindings_guarded_update
      BEFORE UPDATE ON candidate_knowledge_source_origin_bindings
      WHEN NEW.source_id <> OLD.source_id
        OR length(trim(NEW.origin_path)) = 0
        OR julianday(NEW.bound_at) IS NULL
        OR julianday(OLD.bound_at) IS NULL
        OR julianday(NEW.bound_at) < julianday(OLD.bound_at)
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_sources AS source
          JOIN candidate_knowledge_source_versions AS version
            ON version.source_id = source.id
          JOIN candidate_knowledge_managed_source_versions AS managed
            ON managed.version_id = version.id
          WHERE source.id = NEW.source_id AND source.kind = 'file'
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin binding replacement is invalid'); END;
  `.trim(),
};

const migrationTen: Migration = {
  version: 10,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_refresh_observations (
      source_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      observed_version_id TEXT NOT NULL
        REFERENCES candidate_knowledge_source_versions(id),
      status TEXT NOT NULL CHECK (status IN ('current', 'changed', 'missing', 'inaccessible', 'unbound')),
      checked_at TEXT NOT NULL,
      last_refreshed_version_id TEXT NULL
        REFERENCES candidate_knowledge_source_versions(id),
      last_refreshed_at TEXT NULL,
      CHECK ((last_refreshed_version_id IS NULL) = (last_refreshed_at IS NULL))
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_refresh_observations_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_source_refresh_observations
      WHEN julianday(NEW.checked_at) IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_source_versions AS version
          WHERE version.id = NEW.observed_version_id
            AND version.source_id = NEW.source_id
        )
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_versions AS version
            WHERE version.id = NEW.last_refreshed_version_id
              AND version.source_id = NEW.source_id
          )
        )
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) IS NULL
        )
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) > julianday(NEW.checked_at)
        )
        OR ((NEW.last_refreshed_version_id IS NULL) <> (NEW.last_refreshed_at IS NULL))
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND (
            NEW.status <> 'current'
            OR NEW.observed_version_id <> NEW.last_refreshed_version_id
            OR julianday(NEW.checked_at) <> julianday(NEW.last_refreshed_at)
          )
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source refresh observation is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_refresh_observations_guarded_update
      BEFORE UPDATE ON candidate_knowledge_source_refresh_observations
      WHEN NEW.source_id <> OLD.source_id
        OR julianday(NEW.checked_at) IS NULL
        OR julianday(OLD.checked_at) IS NULL
        OR julianday(NEW.checked_at) < julianday(OLD.checked_at)
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_source_versions AS version
          WHERE version.id = NEW.observed_version_id
            AND version.source_id = NEW.source_id
        )
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_versions AS version
            WHERE version.id = NEW.last_refreshed_version_id
              AND version.source_id = NEW.source_id
          )
        )
        OR ((NEW.last_refreshed_version_id IS NULL) <> (NEW.last_refreshed_at IS NULL))
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) IS NULL
        )
        OR (
          NEW.last_refreshed_at IS NOT NULL
          AND julianday(NEW.last_refreshed_at) > julianday(NEW.checked_at)
        )
        OR (
          OLD.last_refreshed_at IS NOT NULL
          AND (
            NEW.last_refreshed_at IS NULL
            OR julianday(NEW.last_refreshed_at) < julianday(OLD.last_refreshed_at)
          )
        )
        OR (
          OLD.last_refreshed_version_id IS NOT NULL
          AND NEW.last_refreshed_version_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_versions AS old_version
            JOIN candidate_knowledge_source_versions AS new_version
              ON new_version.id = NEW.last_refreshed_version_id
             AND new_version.source_id = NEW.source_id
            WHERE old_version.id = OLD.last_refreshed_version_id
              AND old_version.source_id = OLD.source_id
              AND new_version.version >= old_version.version
          )
        )
        OR (
          NEW.last_refreshed_version_id IS NOT NULL
          AND (
            OLD.last_refreshed_version_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM candidate_knowledge_source_versions AS old_version
              JOIN candidate_knowledge_source_versions AS new_version
                ON new_version.id = NEW.last_refreshed_version_id
               AND new_version.source_id = NEW.source_id
              WHERE old_version.id = OLD.last_refreshed_version_id
                AND old_version.source_id = OLD.source_id
                AND new_version.version > old_version.version
            )
          )
          AND (
            NEW.status <> 'current'
            OR NEW.observed_version_id <> NEW.last_refreshed_version_id
            OR julianday(NEW.checked_at) <> julianday(NEW.last_refreshed_at)
          )
        )
        OR (
          OLD.last_refreshed_version_id IS NOT NULL
          AND NEW.last_refreshed_version_id = OLD.last_refreshed_version_id
          AND julianday(NEW.last_refreshed_at) <> julianday(OLD.last_refreshed_at)
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source refresh observation replacement is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_refresh_observations_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_refresh_observations
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source refresh observations are immutable'); END;
  `.trim(),
};

const migrationEleven: Migration = {
  version: 11,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_retirements (
      source_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      retired_at TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason = 'user-requested')
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_retirements_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_source_retirements
      WHEN julianday(NEW.retired_at) IS NULL
        OR NEW.reason <> 'user-requested'
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_sources AS source
          JOIN candidate_knowledge_bases AS knowledge_base
            ON knowledge_base.id = source.candidate_knowledge_base_id
           AND knowledge_base.state = 'active'
          WHERE source.id = NEW.source_id
            AND julianday(NEW.retired_at) >= julianday(source.created_at)
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source retirement is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_retirements_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_retirements
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source retirements are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_retirements_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_retirements
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source retirements are immutable'); END;
  `.trim(),
};

const migrationTwelve: Migration = {
  version: 12,
  sql: `
    DROP TRIGGER IF EXISTS candidate_knowledge_managed_source_versions_require_file;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_source_versions_require_supported_source
      BEFORE INSERT ON candidate_knowledge_managed_source_versions
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_source_versions AS version
        JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
        WHERE version.id = NEW.version_id
          AND source.kind IN ('file', 'url')
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge source versions require a supported source'); END;

    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_url_provenance (
      version_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_source_versions(id),
      source_id TEXT NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      original_url TEXT NOT NULL CHECK (length(trim(original_url)) > 0),
      final_url TEXT NOT NULL CHECK (length(trim(final_url)) > 0),
      fetched_at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('github', 'certification', 'profile', 'portfolio', 'job-description', 'generic')),
      UNIQUE (source_id, version_id)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_url_provenance_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_source_url_provenance
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_source_versions AS version
        JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE version.id = NEW.version_id
          AND version.source_id = NEW.source_id
          AND source.kind = 'url'
          AND julianday(NEW.fetched_at) IS NOT NULL
          AND julianday(NEW.fetched_at) = julianday(version.created_at)
      )
        OR lower(NEW.original_url) NOT LIKE 'https://%'
        OR lower(NEW.final_url) NOT LIKE 'https://%'
        OR instr(NEW.original_url, '#') > 0
        OR instr(NEW.final_url, '#') > 0
        OR (
          instr(substr(NEW.original_url, 9), '@') > 0
          AND instr(substr(NEW.original_url, 9), '@') < min(
            CASE WHEN instr(substr(NEW.original_url, 9), '/') = 0
              THEN length(substr(NEW.original_url, 9)) + 1
              ELSE instr(substr(NEW.original_url, 9), '/') END,
            CASE WHEN instr(substr(NEW.original_url, 9), '?') = 0
              THEN length(substr(NEW.original_url, 9)) + 1
              ELSE instr(substr(NEW.original_url, 9), '?') END
          )
        )
        OR (
          instr(substr(NEW.final_url, 9), '@') > 0
          AND instr(substr(NEW.final_url, 9), '@') < min(
            CASE WHEN instr(substr(NEW.final_url, 9), '/') = 0
              THEN length(substr(NEW.final_url, 9)) + 1
              ELSE instr(substr(NEW.final_url, 9), '/') END,
            CASE WHEN instr(substr(NEW.final_url, 9), '?') = 0
              THEN length(substr(NEW.final_url, 9)) + 1
              ELSE instr(substr(NEW.final_url, 9), '?') END
          )
        )
        OR EXISTS (
          SELECT 1
          FROM candidate_knowledge_source_url_provenance AS prior
          WHERE prior.source_id = NEW.source_id
            AND prior.original_url <> NEW.original_url
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source URL provenance is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_url_provenance_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_url_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source URL provenance is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_url_provenance_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_url_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source URL provenance is immutable'); END;
  `.trim(),
};

const migrationThirteen: Migration = {
  version: 13,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_directory_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL
        REFERENCES candidate_knowledge_bases(id),
      root_path TEXT NOT NULL CHECK (length(trim(root_path)) > 0),
      bound_at TEXT NOT NULL,
      UNIQUE (id, candidate_knowledge_base_id),
      UNIQUE (candidate_knowledge_base_id, root_path)
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_directory_members (
      directory_id TEXT NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      relative_path_hash TEXT NOT NULL CHECK (
        length(relative_path_hash) = 64
        AND relative_path_hash NOT GLOB '*[^0-9a-f]*'
      ),
      PRIMARY KEY (directory_id, relative_path_hash),
      UNIQUE (source_id),
      FOREIGN KEY (directory_id, candidate_knowledge_base_id)
        REFERENCES candidate_knowledge_directory_bindings(id, candidate_knowledge_base_id),
      FOREIGN KEY (source_id, candidate_knowledge_base_id)
        REFERENCES candidate_knowledge_sources(id, candidate_knowledge_base_id)
    );

    CREATE INDEX IF NOT EXISTS candidate_knowledge_directory_members_scope_idx
      ON candidate_knowledge_directory_members(candidate_knowledge_base_id, directory_id);

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_bindings_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_directory_bindings
      WHEN length(trim(NEW.id)) = 0
        OR julianday(NEW.bound_at) IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_bases AS knowledge_base
          WHERE knowledge_base.id = NEW.candidate_knowledge_base_id
            AND knowledge_base.state = 'active'
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory binding is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_members_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_directory_members
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_sources AS source
        JOIN candidate_knowledge_source_origin_bindings AS binding
          ON binding.source_id = source.id
        JOIN candidate_knowledge_source_versions AS version
          ON version.source_id = source.id
        JOIN candidate_knowledge_managed_source_versions AS managed
          ON managed.version_id = version.id
        WHERE source.id = NEW.source_id
          AND source.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
          AND source.kind = 'file'
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_source_retirements AS retirement
            WHERE retirement.source_id = source.id
          )
      )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory member source is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_bindings_immutable_update
      BEFORE UPDATE ON candidate_knowledge_directory_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_bindings_immutable_delete
      BEFORE DELETE ON candidate_knowledge_directory_bindings
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory bindings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_members_immutable_update
      BEFORE UPDATE ON candidate_knowledge_directory_members
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory members are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_members_immutable_delete
      BEFORE DELETE ON candidate_knowledge_directory_members
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory members are immutable'); END;
  `.trim(),
};

const migrationFourteen: Migration = {
  version: 14,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_directory_root_revisions (
      directory_id TEXT NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1 AND typeof(revision) = 'integer'),
      root_path TEXT NOT NULL CHECK (length(trim(root_path)) > 0),
      bound_at TEXT NOT NULL,
      PRIMARY KEY (directory_id, revision),
      UNIQUE (candidate_knowledge_base_id, root_path),
      FOREIGN KEY (directory_id, candidate_knowledge_base_id)
        REFERENCES candidate_knowledge_directory_bindings(id, candidate_knowledge_base_id)
    );

    INSERT INTO candidate_knowledge_directory_root_revisions
      (directory_id, candidate_knowledge_base_id, revision, root_path, bound_at)
    SELECT id, candidate_knowledge_base_id, 1, root_path, bound_at
    FROM candidate_knowledge_directory_bindings;

    CREATE INDEX IF NOT EXISTS candidate_knowledge_directory_root_revisions_scope_idx
      ON candidate_knowledge_directory_root_revisions(candidate_knowledge_base_id, directory_id, revision);

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_bindings_create_root_revision
      AFTER INSERT ON candidate_knowledge_directory_bindings
      BEGIN
        INSERT INTO candidate_knowledge_directory_root_revisions
          (directory_id, candidate_knowledge_base_id, revision, root_path, bound_at)
        VALUES (NEW.id, NEW.candidate_knowledge_base_id, 1, NEW.root_path, NEW.bound_at);
      END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_root_revisions_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_directory_root_revisions
      WHEN length(trim(NEW.directory_id)) = 0
        OR length(trim(NEW.candidate_knowledge_base_id)) = 0
        OR NEW.revision < 1
        OR julianday(NEW.bound_at) IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_bases AS knowledge_base
          WHERE knowledge_base.id = NEW.candidate_knowledge_base_id
            AND knowledge_base.state = 'active'
        )
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_directory_bindings AS binding
          WHERE binding.id = NEW.directory_id
            AND binding.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
            AND julianday(NEW.bound_at) >= julianday(binding.bound_at)
        )
        OR NEW.revision <> COALESCE(
          (
            SELECT MAX(prior.revision) + 1
            FROM candidate_knowledge_directory_root_revisions AS prior
            WHERE prior.directory_id = NEW.directory_id
              AND prior.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
          ),
          1
        )
        OR EXISTS (
          SELECT 1
          FROM candidate_knowledge_directory_root_revisions AS prior
          WHERE prior.directory_id = NEW.directory_id
            AND prior.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
            AND julianday(NEW.bound_at) < julianday(prior.bound_at)
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory root revision is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_root_revisions_immutable_update
      BEFORE UPDATE ON candidate_knowledge_directory_root_revisions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory root revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_root_revisions_immutable_delete
      BEFORE DELETE ON candidate_knowledge_directory_root_revisions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory root revisions are immutable'); END;

    CREATE VIEW IF NOT EXISTS candidate_knowledge_directory_current_roots AS
    SELECT revision.directory_id AS id,
           revision.candidate_knowledge_base_id,
           revision.root_path,
           revision.bound_at,
           revision.revision
    FROM candidate_knowledge_directory_root_revisions AS revision
    WHERE revision.revision = (
      SELECT MAX(current.revision)
      FROM candidate_knowledge_directory_root_revisions AS current
      WHERE current.directory_id = revision.directory_id
        AND current.candidate_knowledge_base_id = revision.candidate_knowledge_base_id
    );
  `.trim(),
};

const migrationFifteen: Migration = {
  version: 15,
  sql: `
    CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_directory_members_identity_idx
      ON candidate_knowledge_directory_members(directory_id, candidate_knowledge_base_id, source_id);

    CREATE TABLE IF NOT EXISTS candidate_knowledge_directory_member_revisions (
      directory_id TEXT NOT NULL,
      candidate_knowledge_base_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1 AND typeof(revision) = 'integer'),
      relative_path_hash TEXT NOT NULL CHECK (
        length(relative_path_hash) = 64
        AND relative_path_hash NOT GLOB '*[^0-9a-f]*'
      ),
      bound_at TEXT NOT NULL,
      PRIMARY KEY (directory_id, source_id, revision),
      FOREIGN KEY (directory_id, candidate_knowledge_base_id, source_id)
        REFERENCES candidate_knowledge_directory_members(directory_id, candidate_knowledge_base_id, source_id)
    );

    CREATE INDEX IF NOT EXISTS candidate_knowledge_directory_member_revisions_scope_idx
      ON candidate_knowledge_directory_member_revisions(candidate_knowledge_base_id, directory_id, source_id, revision);

    INSERT INTO candidate_knowledge_directory_member_revisions
      (directory_id, candidate_knowledge_base_id, source_id, revision, relative_path_hash, bound_at)
    SELECT member.directory_id,
           member.candidate_knowledge_base_id,
           member.source_id,
           1,
           member.relative_path_hash,
           CASE
             WHEN julianday(binding.bound_at) >= julianday(source.created_at)
             THEN binding.bound_at
             ELSE source.created_at
           END
    FROM candidate_knowledge_directory_members AS member
    JOIN candidate_knowledge_directory_bindings AS binding
      ON binding.id = member.directory_id
     AND binding.candidate_knowledge_base_id = member.candidate_knowledge_base_id
    JOIN candidate_knowledge_sources AS source
      ON source.id = member.source_id
     AND source.candidate_knowledge_base_id = member.candidate_knowledge_base_id;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_member_revisions_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_directory_member_revisions
      WHEN length(trim(NEW.directory_id)) = 0
        OR length(trim(NEW.candidate_knowledge_base_id)) = 0
        OR length(trim(NEW.source_id)) = 0
        OR NEW.revision < 1
        OR typeof(NEW.revision) <> 'integer'
        OR length(NEW.relative_path_hash) <> 64
        OR NEW.relative_path_hash GLOB '*[^0-9a-f]*'
        OR julianday(NEW.bound_at) IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_bases AS knowledge_base
          WHERE knowledge_base.id = NEW.candidate_knowledge_base_id
            AND knowledge_base.state = 'active'
        )
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_directory_members AS member
          WHERE member.directory_id = NEW.directory_id
            AND member.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
            AND member.source_id = NEW.source_id
        )
        OR (
          NEW.revision = 1
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_directory_members AS member
            JOIN candidate_knowledge_directory_bindings AS binding
              ON binding.id = member.directory_id
             AND binding.candidate_knowledge_base_id = member.candidate_knowledge_base_id
            JOIN candidate_knowledge_sources AS source
              ON source.id = member.source_id
             AND source.candidate_knowledge_base_id = member.candidate_knowledge_base_id
            WHERE member.directory_id = NEW.directory_id
              AND member.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
              AND member.source_id = NEW.source_id
              AND member.relative_path_hash = NEW.relative_path_hash
              AND NEW.bound_at = CASE
                WHEN julianday(binding.bound_at) >= julianday(source.created_at)
                THEN binding.bound_at
                ELSE source.created_at
              END
          )
        )
        OR NOT EXISTS (
          SELECT 1
          FROM candidate_knowledge_sources AS source
          JOIN candidate_knowledge_managed_source_versions AS managed
            ON managed.version_id IN (
              SELECT version.id
              FROM candidate_knowledge_source_versions AS version
              WHERE version.source_id = source.id
            )
          WHERE source.id = NEW.source_id
            AND source.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
            AND source.kind = 'file'
            AND NOT EXISTS (
              SELECT 1
              FROM candidate_knowledge_source_retirements AS retirement
              WHERE retirement.source_id = source.id
            )
        )
        OR EXISTS (
          SELECT 1
          FROM candidate_knowledge_sources AS source
          WHERE source.id = NEW.source_id
            AND julianday(NEW.bound_at) < julianday(source.created_at)
        )
        OR NEW.revision <> COALESCE(
          (
            SELECT MAX(prior.revision) + 1
            FROM candidate_knowledge_directory_member_revisions AS prior
            WHERE prior.directory_id = NEW.directory_id
              AND prior.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
              AND prior.source_id = NEW.source_id
          ),
          1
        )
        OR EXISTS (
          SELECT 1
          FROM candidate_knowledge_directory_member_revisions AS prior
          WHERE prior.directory_id = NEW.directory_id
            AND prior.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
            AND prior.source_id = NEW.source_id
            AND julianday(NEW.bound_at) < julianday(prior.bound_at)
        )
        OR EXISTS (
          SELECT 1
          FROM candidate_knowledge_directory_member_revisions AS prior
          WHERE prior.directory_id = NEW.directory_id
            AND prior.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
            AND prior.source_id = NEW.source_id
            AND prior.revision = (
              SELECT MAX(current.revision)
              FROM candidate_knowledge_directory_member_revisions AS current
              WHERE current.directory_id = NEW.directory_id
                AND current.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
                AND current.source_id = NEW.source_id
            )
            AND prior.relative_path_hash = NEW.relative_path_hash
        )
        OR EXISTS (
          SELECT 1
          FROM candidate_knowledge_directory_member_revisions AS prior
          WHERE prior.directory_id = NEW.directory_id
            AND prior.relative_path_hash = NEW.relative_path_hash
            AND prior.source_id <> NEW.source_id
        )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory member revision is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_member_revisions_immutable_update
      BEFORE UPDATE ON candidate_knowledge_directory_member_revisions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory member revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_member_revisions_immutable_delete
      BEFORE DELETE ON candidate_knowledge_directory_member_revisions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge directory member revisions are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_directory_members_create_revision
      AFTER INSERT ON candidate_knowledge_directory_members
      BEGIN
        INSERT INTO candidate_knowledge_directory_member_revisions
          (directory_id, candidate_knowledge_base_id, source_id, revision, relative_path_hash, bound_at)
        SELECT NEW.directory_id,
               NEW.candidate_knowledge_base_id,
               NEW.source_id,
               1,
               NEW.relative_path_hash,
               CASE
                 WHEN julianday(binding.bound_at) >= julianday(source.created_at)
                 THEN binding.bound_at
                 ELSE source.created_at
               END
        FROM candidate_knowledge_directory_bindings AS binding
        JOIN candidate_knowledge_sources AS source
          ON source.id = NEW.source_id
         AND source.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id
        WHERE binding.id = NEW.directory_id
          AND binding.candidate_knowledge_base_id = NEW.candidate_knowledge_base_id;
      END;

    CREATE VIEW IF NOT EXISTS candidate_knowledge_directory_current_members AS
    SELECT revision.directory_id,
           revision.candidate_knowledge_base_id,
           revision.source_id,
           revision.revision,
           revision.relative_path_hash,
           revision.bound_at
    FROM candidate_knowledge_directory_member_revisions AS revision
    WHERE revision.revision = (
      SELECT MAX(current.revision)
      FROM candidate_knowledge_directory_member_revisions AS current
      WHERE current.directory_id = revision.directory_id
        AND current.candidate_knowledge_base_id = revision.candidate_knowledge_base_id
        AND current.source_id = revision.source_id
    );
  `.trim(),
};

const migrationSixteen: Migration = {
  version: 16,
  sql: `
    ALTER TABLE candidate_knowledge_managed_write_operations
      ADD COLUMN owner_kind TEXT;
    ALTER TABLE candidate_knowledge_managed_write_operations
      ADD COLUMN owner_schema_version INTEGER;
    ALTER TABLE candidate_knowledge_managed_write_operations
      ADD COLUMN owner_generation INTEGER;
    ALTER TABLE candidate_knowledge_managed_write_operations
      ADD COLUMN requested_media_type TEXT;
    ALTER TABLE candidate_knowledge_managed_write_operations
      ADD COLUMN requested_checksum TEXT;
    ALTER TABLE candidate_knowledge_managed_write_operations
      ADD COLUMN requested_size_bytes INTEGER;

    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_write_staging_identities (
      operation_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_managed_write_operations(operation_id),
      device INTEGER NOT NULL CHECK (typeof(device) = 'integer' AND device >= 0),
      inode INTEGER NOT NULL CHECK (typeof(inode) = 'integer' AND inode >= 0),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_staging_identities_require_prepared_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_staging_identities
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        WHERE operation.operation_id = NEW.operation_id
          AND operation.owner_kind = 'draft-loop'
          AND operation.owner_schema_version = 1
          AND typeof(operation.owner_generation) = 'integer'
          AND operation.owner_generation >= 1
          AND julianday(NEW.created_at) >= julianday(operation.created_at)
          AND NOT EXISTS (
            SELECT 1
            FROM candidate_knowledge_managed_write_events AS event
            WHERE event.operation_id = operation.operation_id
          )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge staging identity requires a prepared owned operation'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_staging_identities_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_write_staging_identities
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge staging identities are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_staging_identities_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_write_staging_identities
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge staging identities are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_operations_ownership_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_operations
      WHEN NOT (
        (
          NEW.owner_kind IS NULL AND
          NEW.owner_schema_version IS NULL AND
          NEW.owner_generation IS NULL AND
          NEW.requested_media_type IS NULL AND
          NEW.requested_checksum IS NULL AND
          NEW.requested_size_bytes IS NULL
        ) OR (
          NEW.owner_kind IS NOT NULL AND
          NEW.owner_schema_version IS NOT NULL AND
          NEW.owner_generation IS NOT NULL AND
          NEW.requested_media_type IS NOT NULL AND
          NEW.requested_checksum IS NOT NULL AND
          NEW.requested_size_bytes IS NOT NULL AND
          NEW.owner_kind = 'draft-loop' AND
          NEW.owner_schema_version = 1 AND
          typeof(NEW.owner_generation) = 'integer' AND
          NEW.owner_generation >= 1 AND
          length(trim(NEW.requested_media_type)) > 0 AND
          length(NEW.requested_checksum) = 64 AND
          NEW.requested_checksum NOT GLOB '*[^0-9a-f]*' AND
          typeof(NEW.requested_size_bytes) = 'integer' AND
          NEW.requested_size_bytes >= 0
        )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write ownership metadata is invalid'); END;

    DROP TRIGGER IF EXISTS candidate_knowledge_managed_write_events_transition_insert;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_events_transition_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_events
      WHEN NOT (
        (NEW.sequence = 1 AND NEW.state IN ('targeted', 'noop', 'aborted')) OR
        (
          NEW.sequence > 1 AND EXISTS (
            SELECT 1
            FROM candidate_knowledge_managed_write_events AS previous
            WHERE previous.operation_id = NEW.operation_id
              AND previous.sequence = NEW.sequence - 1
              AND (
                (previous.state = 'targeted' AND NEW.state IN ('published', 'aborted')) OR
                (previous.state = 'published' AND NEW.state IN ('committed', 'aborted')) OR
                (previous.state = 'committed' AND NEW.state = 'completed')
              )
          )
        )
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge write event transition is invalid'); END;
  `.trim(),
};

const migrationSeventeen: Migration = {
  version: 17,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_managed_write_recovery_claims (
      operation_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_managed_write_operations(operation_id),
      phase TEXT NOT NULL CHECK (phase IN ('prepared', 'targeted', 'published', 'committed')),
      claim_generation INTEGER NOT NULL
        CHECK (typeof(claim_generation) = 'integer' AND claim_generation >= 1),
      claimed_at TEXT NOT NULL CHECK (julianday(claimed_at) IS NOT NULL)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_recovery_claims_insert
      BEFORE INSERT ON candidate_knowledge_managed_write_recovery_claims
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_managed_write_operations AS operation
        WHERE operation.operation_id = NEW.operation_id
          AND operation.owner_kind = 'draft-loop'
          AND operation.owner_schema_version = 1
          AND typeof(operation.owner_generation) = 'integer'
          AND operation.owner_generation >= 1
          AND NEW.claim_generation > operation.owner_generation
          AND julianday(NEW.claimed_at) >= julianday(operation.created_at)
      )
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge recovery claim is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_recovery_claims_immutable_update
      BEFORE UPDATE ON candidate_knowledge_managed_write_recovery_claims
      WHEN NEW.operation_id <> OLD.operation_id
        OR NEW.phase <> OLD.phase
        OR typeof(NEW.claim_generation) <> 'integer'
        OR NEW.claim_generation < OLD.claim_generation
        OR NEW.claim_generation < 1
        OR julianday(NEW.claimed_at) IS NULL
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge recovery claims are append-only by phase'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_managed_write_recovery_claims_immutable_delete
      BEFORE DELETE ON candidate_knowledge_managed_write_recovery_claims
      BEGIN SELECT RAISE(ABORT, 'managed candidate knowledge recovery claims are immutable'); END;
  `.trim(),
};

const migrationEighteen: Migration = {
  version: 18,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_retention_policy_events (
      knowledge_base_id TEXT NOT NULL
        REFERENCES candidate_knowledge_bases(id),
      revision INTEGER NOT NULL
        CHECK (typeof(revision) = 'integer' AND revision >= 1),
      retention_class TEXT NOT NULL CHECK (
        retention_class IN (
          'raw-sources',
          'normalized-facts',
          'indexes',
          'run-snapshots',
          'exports',
          'backups'
        )
      ),
      rule TEXT NOT NULL CHECK (rule IN ('retain-until-deletion', 'expire-after-days')),
      expire_after_days INTEGER,
      updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
      PRIMARY KEY (knowledge_base_id, revision, retention_class),
      CHECK (
        (rule = 'retain-until-deletion' AND expire_after_days IS NULL)
        OR
        (
          rule = 'expire-after-days' AND
          typeof(expire_after_days) = 'integer' AND
          expire_after_days >= 1 AND
          expire_after_days <= 36500
        )
      )
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retention_policy_events_immutable_update
      BEFORE UPDATE ON candidate_knowledge_retention_policy_events
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retention policy events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retention_policy_events_immutable_delete
      BEFORE DELETE ON candidate_knowledge_retention_policy_events
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retention policy events are immutable'); END;

    CREATE TABLE IF NOT EXISTS candidate_knowledge_retention_override_events (
      knowledge_base_id TEXT NOT NULL
        REFERENCES candidate_knowledge_bases(id),
      retention_class TEXT NOT NULL CHECK (
        retention_class IN (
          'raw-sources',
          'normalized-facts',
          'indexes',
          'run-snapshots',
          'exports',
          'backups'
        )
      ),
      override_kind TEXT NOT NULL CHECK (override_kind IN ('legal-hold', 'manual-preservation')),
      sequence INTEGER NOT NULL
        CHECK (typeof(sequence) = 'integer' AND sequence >= 1),
      state TEXT NOT NULL CHECK (state IN ('applied', 'released')),
      override_revision INTEGER NOT NULL
        CHECK (typeof(override_revision) = 'integer' AND override_revision >= 1),
      policy_revision INTEGER NOT NULL
        CHECK (typeof(policy_revision) = 'integer' AND policy_revision >= 0),
      changed_at TEXT NOT NULL CHECK (julianday(changed_at) IS NOT NULL),
      PRIMARY KEY (knowledge_base_id, retention_class, override_kind, sequence)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retention_override_events_immutable_update
      BEFORE UPDATE ON candidate_knowledge_retention_override_events
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retention override events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retention_override_events_immutable_delete
      BEFORE DELETE ON candidate_knowledge_retention_override_events
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retention override events are immutable'); END;

  `.trim(),
};

const migrationNineteen: Migration = {
  version: 19,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_restored_url_provenance (
      version_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_source_versions(id),
      source_id TEXT NOT NULL
        REFERENCES candidate_knowledge_sources(id),
      fetched_at TEXT NOT NULL CHECK (julianday(fetched_at) IS NOT NULL),
      kind TEXT NOT NULL CHECK (kind IN ('github', 'certification', 'profile', 'portfolio', 'job-description', 'generic')),
      UNIQUE (source_id, version_id)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_restored_url_provenance_require_valid_insert
      BEFORE INSERT ON candidate_knowledge_source_restored_url_provenance
      WHEN NOT EXISTS (
        SELECT 1
        FROM candidate_knowledge_source_versions AS version
        JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
        JOIN candidate_knowledge_managed_source_versions AS managed ON managed.version_id = version.id
        WHERE version.id = NEW.version_id
          AND version.source_id = NEW.source_id
          AND source.kind = 'url'
          AND julianday(NEW.fetched_at) = julianday(version.created_at)
      )
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge restored URL provenance is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_restored_url_provenance_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_restored_url_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge restored URL provenance is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_restored_url_provenance_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_restored_url_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge restored URL provenance is immutable'); END;

    CREATE TABLE IF NOT EXISTS candidate_knowledge_retention_override_revision_snapshots (
      knowledge_base_id TEXT PRIMARY KEY NOT NULL
        REFERENCES candidate_knowledge_bases(id),
      override_revision INTEGER NOT NULL
        CHECK (typeof(override_revision) = 'integer' AND override_revision >= 0)
    );

    INSERT INTO candidate_knowledge_retention_override_revision_snapshots
      (knowledge_base_id, override_revision)
    SELECT knowledge_base_id, COALESCE(MAX(override_revision), 0)
    FROM candidate_knowledge_retention_override_events
    GROUP BY knowledge_base_id
    ON CONFLICT(knowledge_base_id) DO UPDATE SET
      override_revision = MAX(
        candidate_knowledge_retention_override_revision_snapshots.override_revision,
        excluded.override_revision
      );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retention_override_revision_snapshot_after_insert
      AFTER INSERT ON candidate_knowledge_retention_override_events
      BEGIN
        INSERT INTO candidate_knowledge_retention_override_revision_snapshots
          (knowledge_base_id, override_revision)
        VALUES (NEW.knowledge_base_id, NEW.override_revision)
        ON CONFLICT(knowledge_base_id) DO UPDATE SET
          override_revision = MAX(
            candidate_knowledge_retention_override_revision_snapshots.override_revision,
            excluded.override_revision
          );
      END;
  `.trim(),
};

const migrationTwenty: Migration = {
  version: 20,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_portable_restore_provenance (
      operation_id TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(operation_id)) > 0),
      manifest_checksum TEXT NOT NULL CHECK (
        length(manifest_checksum) = 64 AND manifest_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      source_store_id TEXT NOT NULL CHECK (length(trim(source_store_id)) > 0),
      package_schema_version INTEGER NOT NULL
        CHECK (typeof(package_schema_version) = 'integer' AND package_schema_version >= 1),
      restored_at TEXT NOT NULL CHECK (julianday(restored_at) IS NOT NULL)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_portable_restore_provenance_immutable_update
      BEFORE UPDATE ON candidate_knowledge_portable_restore_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge portable restore provenance is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_portable_restore_provenance_immutable_delete
      BEFORE DELETE ON candidate_knowledge_portable_restore_provenance
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge portable restore provenance is immutable'); END;
  `.trim(),
};

const migrationTwentyOne: Migration = {
  version: 21,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_deletion_operations (
      operation_id TEXT PRIMARY KEY NOT NULL CHECK (
        length(operation_id) = 64 AND operation_id NOT GLOB '*[^0-9a-f]*'
      ),
      knowledge_base_id TEXT NOT NULL CHECK (length(trim(knowledge_base_id)) > 0),
      confirmation_token TEXT NOT NULL CHECK (
        length(confirmation_token) = 64 AND confirmation_token NOT GLOB '*[^0-9a-f]*'
      ),
      graph_digest TEXT NOT NULL CHECK (
        length(graph_digest) = 64 AND graph_digest NOT GLOB '*[^0-9a-f]*'
      ),
      phase TEXT NOT NULL CHECK (phase IN ('prepared', 'staging', 'committed', 'completed', 'aborted')),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      committed_at TEXT,
      completed_at TEXT,
      staging_device INTEGER CHECK (staging_device IS NULL OR (typeof(staging_device) = 'integer' AND staging_device >= 0)),
      staging_inode INTEGER CHECK (staging_inode IS NULL OR (typeof(staging_inode) = 'integer' AND staging_inode >= 0)),
      managed_artifact_count INTEGER NOT NULL CHECK (typeof(managed_artifact_count) = 'integer' AND managed_artifact_count >= 0 AND managed_artifact_count <= 1024),
      managed_artifact_bytes INTEGER NOT NULL CHECK (typeof(managed_artifact_bytes) = 'integer' AND managed_artifact_bytes >= 0),
      preserved_unknown_count INTEGER NOT NULL CHECK (typeof(preserved_unknown_count) = 'integer' AND preserved_unknown_count >= 0 AND preserved_unknown_count <= 1024),
      preserved_unmanaged_count INTEGER NOT NULL CHECK (typeof(preserved_unmanaged_count) = 'integer' AND preserved_unmanaged_count >= 0 AND preserved_unmanaged_count <= 1024),
      count_capped INTEGER NOT NULL CHECK (count_capped IN (0, 1)),
      CHECK ((phase IN ('committed', 'completed') AND committed_at IS NOT NULL) OR phase IN ('prepared', 'staging', 'aborted')),
      CHECK ((phase = 'completed' AND completed_at IS NOT NULL) OR phase <> 'completed'),
      CHECK ((staging_device IS NULL) = (staging_inode IS NULL))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_deletion_operations_token_idx
      ON candidate_knowledge_deletion_operations(confirmation_token);

    CREATE TABLE IF NOT EXISTS candidate_knowledge_deletion_artifacts (
      operation_id TEXT NOT NULL REFERENCES candidate_knowledge_deletion_operations(operation_id),
      source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
      version_id TEXT NOT NULL CHECK (length(trim(version_id)) > 0),
      checksum TEXT NOT NULL CHECK (
        length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'
      ),
      size_bytes INTEGER NOT NULL CHECK (typeof(size_bytes) = 'integer' AND size_bytes >= 0),
      device INTEGER NOT NULL CHECK (typeof(device) = 'integer' AND device >= 0),
      inode INTEGER NOT NULL CHECK (typeof(inode) = 'integer' AND inode >= 0),
      PRIMARY KEY (operation_id, version_id),
      UNIQUE (operation_id, source_id, version_id)
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_deletion_artifacts_immutable_update
      BEFORE UPDATE ON candidate_knowledge_deletion_artifacts
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge deletion artifacts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_deletion_artifacts_immutable_delete
      BEFORE DELETE ON candidate_knowledge_deletion_artifacts
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge deletion artifacts are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_deletion_operations_guarded_update
      BEFORE UPDATE ON candidate_knowledge_deletion_operations
      WHEN NEW.operation_id <> OLD.operation_id
        OR NEW.knowledge_base_id <> OLD.knowledge_base_id
        OR NEW.confirmation_token <> OLD.confirmation_token
        OR NEW.graph_digest <> OLD.graph_digest
        OR NEW.created_at <> OLD.created_at
        OR NEW.managed_artifact_count <> OLD.managed_artifact_count
        OR NEW.managed_artifact_bytes <> OLD.managed_artifact_bytes
        OR NEW.preserved_unknown_count <> OLD.preserved_unknown_count
        OR NEW.preserved_unmanaged_count <> OLD.preserved_unmanaged_count
        OR NEW.count_capped <> OLD.count_capped
        OR (NEW.phase = 'staging' AND OLD.phase <> 'prepared')
        OR (NEW.phase = 'committed' AND OLD.phase <> 'staging')
        OR (NEW.phase = 'completed' AND OLD.phase <> 'committed')
        OR (NEW.phase = 'aborted' AND OLD.phase NOT IN ('prepared', 'staging'))
        OR (NEW.phase = 'prepared' AND OLD.phase NOT IN ('prepared', 'aborted'))
        OR (NEW.phase = 'staging' AND (NEW.committed_at IS NOT OLD.committed_at OR NEW.completed_at IS NOT OLD.completed_at))
        OR (NEW.phase = 'committed' AND (NEW.committed_at IS NULL OR NEW.completed_at IS NOT NULL))
        OR (NEW.phase = 'completed' AND (NEW.committed_at IS NULL OR NEW.completed_at IS NULL))
        OR (NEW.phase = 'aborted' AND (NEW.committed_at IS NOT NULL OR NEW.completed_at IS NOT NULL))
        OR (NEW.phase IN ('prepared', 'staging') AND (NEW.committed_at IS NOT OLD.committed_at OR NEW.completed_at IS NOT OLD.completed_at))
        OR (OLD.staging_device IS NOT NULL
          AND NEW.staging_device IS NOT OLD.staging_device
          AND NOT (NEW.phase = 'aborted' AND OLD.phase IN ('prepared', 'staging')))
        OR (OLD.staging_inode IS NOT NULL
          AND NEW.staging_inode IS NOT OLD.staging_inode
          AND NOT (NEW.phase = 'aborted' AND OLD.phase IN ('prepared', 'staging')))
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge deletion operation transition is invalid'); END;

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_deletion_operations_immutable_delete
      BEFORE DELETE ON candidate_knowledge_deletion_operations
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge deletion operations are immutable'); END;

    CREATE TABLE IF NOT EXISTS candidate_knowledge_deletion_audits (
      audit_id TEXT PRIMARY KEY NOT NULL CHECK (
        length(audit_id) = 64 AND audit_id NOT GLOB '*[^0-9a-f]*'
      ),
      operation_id TEXT NOT NULL UNIQUE
        REFERENCES candidate_knowledge_deletion_operations(operation_id),
      knowledge_base_id TEXT NOT NULL CHECK (length(trim(knowledge_base_id)) > 0),
      confirmation_token TEXT NOT NULL CHECK (
        length(confirmation_token) = 64 AND confirmation_token NOT GLOB '*[^0-9a-f]*'
      ),
      status TEXT NOT NULL CHECK (status = 'completed'),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      completed_at TEXT NOT NULL CHECK (julianday(completed_at) IS NOT NULL),
      managed_artifact_count INTEGER NOT NULL CHECK (typeof(managed_artifact_count) = 'integer' AND managed_artifact_count >= 0 AND managed_artifact_count <= 1024),
      managed_artifact_bytes INTEGER NOT NULL CHECK (typeof(managed_artifact_bytes) = 'integer' AND managed_artifact_bytes >= 0),
      preserved_unknown_count INTEGER NOT NULL CHECK (typeof(preserved_unknown_count) = 'integer' AND preserved_unknown_count >= 0 AND preserved_unknown_count <= 1024),
      preserved_unmanaged_count INTEGER NOT NULL CHECK (typeof(preserved_unmanaged_count) = 'integer' AND preserved_unmanaged_count >= 0 AND preserved_unmanaged_count <= 1024),
      count_capped INTEGER NOT NULL CHECK (count_capped IN (0, 1))
    );

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_deletion_audits_immutable_update
      BEFORE UPDATE ON candidate_knowledge_deletion_audits
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge deletion audits are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_deletion_audits_immutable_delete
      BEFORE DELETE ON candidate_knowledge_deletion_audits
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge deletion audits are immutable'); END;
  `.trim(),
};

const migrationTwentyTwo: Migration = {
  version: 22,
  sql: `
    CREATE TABLE IF NOT EXISTS opportunity_brief_versions (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      brief_id TEXT NOT NULL CHECK (length(trim(brief_id)) > 0),
      version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      prior_version INTEGER,
      status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed')),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      reviewed_at TEXT CHECK (reviewed_at IS NULL OR julianday(reviewed_at) IS NOT NULL),
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL CHECK (
        length(payload_checksum) = 64 AND payload_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      PRIMARY KEY (workspace_id, brief_id, version),
      FOREIGN KEY (workspace_id, brief_id, prior_version)
        REFERENCES opportunity_brief_versions(workspace_id, brief_id, version),
      CHECK (
        (version = 1 AND prior_version IS NULL)
        OR (version > 1 AND prior_version = version - 1)
      ),
      CHECK (
        (status = 'draft' AND reviewed_at IS NULL)
        OR (status = 'reviewed' AND reviewed_at IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS opportunity_brief_versions_latest_idx
      ON opportunity_brief_versions(workspace_id, brief_id, version DESC);

    CREATE TRIGGER IF NOT EXISTS opportunity_brief_versions_immutable_update
      BEFORE UPDATE ON opportunity_brief_versions
      BEGIN SELECT RAISE(ABORT, 'opportunity brief versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS opportunity_brief_versions_immutable_delete
      BEFORE DELETE ON opportunity_brief_versions
      BEGIN SELECT RAISE(ABORT, 'opportunity brief versions are immutable'); END;
  `.trim(),
};

const migrationTwentyThree: Migration = {
  version: 23,
  sql: `
    CREATE TABLE IF NOT EXISTS writing_policy_versions (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      policy_checksum TEXT NOT NULL CHECK (
        length(policy_checksum) = 64 AND policy_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      version TEXT NOT NULL CHECK (length(trim(version)) > 0),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      prior_checksum TEXT,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL CHECK (
        length(payload_checksum) = 64 AND payload_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      PRIMARY KEY (workspace_id, policy_checksum),
      UNIQUE (workspace_id, version),
      FOREIGN KEY (workspace_id, prior_checksum)
        REFERENCES writing_policy_versions(workspace_id, policy_checksum),
      CHECK (prior_checksum IS NULL OR prior_checksum <> policy_checksum)
    );

    CREATE INDEX IF NOT EXISTS writing_policy_versions_latest_idx
      ON writing_policy_versions(workspace_id, created_at DESC, policy_checksum DESC);
    CREATE INDEX IF NOT EXISTS writing_policy_versions_list_idx
      ON writing_policy_versions(workspace_id, created_at, policy_checksum);

    CREATE TRIGGER IF NOT EXISTS writing_policy_versions_immutable_update
      BEFORE UPDATE ON writing_policy_versions
      BEGIN SELECT RAISE(ABORT, 'writing policy versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS writing_policy_versions_immutable_delete
      BEFORE DELETE ON writing_policy_versions
      BEGIN SELECT RAISE(ABORT, 'writing policy versions are immutable'); END;
  `.trim(),
};

const migrationTwentyFour: Migration = {
  version: 24,
  sql: `
    CREATE TABLE IF NOT EXISTS canonical_candidate_profile_versions (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      profile_id TEXT NOT NULL CHECK (length(trim(profile_id)) > 0),
      version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      parent_version INTEGER,
      status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed')),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
      reviewed_at TEXT CHECK (reviewed_at IS NULL OR julianday(reviewed_at) IS NOT NULL),
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL CHECK (
        length(payload_checksum) = 64 AND payload_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      PRIMARY KEY (workspace_id, profile_id, version),
      FOREIGN KEY (workspace_id, profile_id, parent_version)
        REFERENCES canonical_candidate_profile_versions(workspace_id, profile_id, version),
      CHECK (
        (version = 1 AND parent_version IS NULL)
        OR (version > 1 AND parent_version = version - 1)
      ),
      CHECK (
        (status = 'draft' AND reviewed_at IS NULL)
        OR (status = 'reviewed' AND reviewed_at IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS canonical_candidate_profile_versions_latest_idx
      ON canonical_candidate_profile_versions(workspace_id, profile_id, version DESC);
    CREATE INDEX IF NOT EXISTS canonical_candidate_profile_versions_list_idx
      ON canonical_candidate_profile_versions(workspace_id, profile_id, version);

    CREATE TRIGGER IF NOT EXISTS canonical_candidate_profile_versions_immutable_update
      BEFORE UPDATE ON canonical_candidate_profile_versions
      BEGIN SELECT RAISE(ABORT, 'canonical candidate profile versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS canonical_candidate_profile_versions_immutable_delete
      BEFORE DELETE ON canonical_candidate_profile_versions
      BEGIN SELECT RAISE(ABORT, 'canonical candidate profile versions are immutable'); END;
  `.trim(),
};

const migrationTwentyFive: Migration = {
  version: 25,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_lexical_indexes (
      store_id TEXT NOT NULL CHECK (length(trim(store_id)) > 0),
      knowledge_base_id TEXT NOT NULL CHECK (length(trim(knowledge_base_id)) > 0),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      indexer_id TEXT NOT NULL CHECK (length(trim(indexer_id)) > 0),
      manifest_checksum TEXT NOT NULL CHECK (
        length(manifest_checksum) = 64 AND manifest_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      scope_json TEXT NOT NULL,
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
      PRIMARY KEY (store_id, knowledge_base_id),
      FOREIGN KEY (knowledge_base_id) REFERENCES candidate_knowledge_bases(id)
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_lexical_chunks (
      store_id TEXT NOT NULL CHECK (length(trim(store_id)) > 0),
      knowledge_base_id TEXT NOT NULL CHECK (length(trim(knowledge_base_id)) > 0),
      source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
      version_id TEXT NOT NULL CHECK (length(trim(version_id)) > 0),
      chunk_id TEXT NOT NULL CHECK (length(trim(chunk_id)) > 0),
      ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal >= 0),
      line_start INTEGER NOT NULL CHECK (typeof(line_start) = 'integer' AND line_start >= 0),
      line_end INTEGER NOT NULL CHECK (typeof(line_end) = 'integer' AND line_end >= line_start),
      text TEXT NOT NULL CHECK (length(trim(text)) > 0),
      metadata_json TEXT NOT NULL,
      PRIMARY KEY (store_id, knowledge_base_id, chunk_id),
      UNIQUE (store_id, knowledge_base_id, source_id, version_id, ordinal),
      FOREIGN KEY (store_id, knowledge_base_id)
        REFERENCES candidate_knowledge_lexical_indexes(store_id, knowledge_base_id),
      FOREIGN KEY (source_id, knowledge_base_id)
        REFERENCES candidate_knowledge_sources(id, candidate_knowledge_base_id),
      FOREIGN KEY (version_id, source_id)
        REFERENCES candidate_knowledge_source_versions(id, source_id)
    );

    CREATE INDEX IF NOT EXISTS candidate_knowledge_lexical_chunks_source_idx
      ON candidate_knowledge_lexical_chunks(store_id, knowledge_base_id, source_id, version_id, ordinal, chunk_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS candidate_knowledge_lexical_chunks_fts USING fts5(
      chunk_key UNINDEXED,
      store_id UNINDEXED,
      knowledge_base_id UNINDEXED,
      source_id UNINDEXED,
      version_id UNINDEXED,
      text
    );

    CREATE TABLE IF NOT EXISTS candidate_knowledge_retrieval_traces (
      workspace_id TEXT NOT NULL CHECK (length(trim(workspace_id)) > 0),
      trace_id TEXT NOT NULL CHECK (length(trim(trace_id)) > 0),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      operation_id TEXT NOT NULL CHECK (length(trim(operation_id)) > 0),
      purpose TEXT NOT NULL CHECK (
        purpose IN (
          'opportunity-requirements',
          'achievement-recall',
          'factual-checks',
          'contradiction-detection',
          'critic-review'
        )
      ),
      query_checksum TEXT NOT NULL CHECK (
        length(query_checksum) = 64 AND query_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL CHECK (
        length(payload_checksum) = 64 AND payload_checksum NOT GLOB '*[^0-9a-f]*'
      ),
      created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
      PRIMARY KEY (workspace_id, trace_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE INDEX IF NOT EXISTS candidate_knowledge_retrieval_traces_operation_idx
      ON candidate_knowledge_retrieval_traces(workspace_id, operation_id, created_at, trace_id);

    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retrieval_traces_immutable_update
      BEFORE UPDATE ON candidate_knowledge_retrieval_traces
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retrieval traces are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_retrieval_traces_immutable_delete
      BEFORE DELETE ON candidate_knowledge_retrieval_traces
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge retrieval traces are immutable'); END;
  `.trim(),
};

const migrations: readonly Migration[] = [
  migrationOne,
  migrationTwo,
  migrationThree,
  migrationFour,
  migrationFive,
  migrationSix,
  migrationSeven,
  migrationEight,
  migrationNine,
  migrationTen,
  migrationEleven,
  migrationTwelve,
  migrationThirteen,
  migrationFourteen,
  migrationFifteen,
  migrationSixteen,
  migrationSeventeen,
  migrationEighteen,
  migrationNineteen,
  migrationTwenty,
  migrationTwentyOne,
  migrationTwentyTwo,
  migrationTwentyThree,
  migrationTwentyFour,
  migrationTwentyFive,
  artifactHistoryMigration,
];
const sensitiveKeyPattern =
  /(?:api(?:[-_ ]?key)|(?:api|access|refresh|provider|auth)[-_ ]?token|(?:^|[-_.])token$|secret|password|credential|authorization)/iu;
const hiddenContentKeyPattern =
  /(?:^|[-_.])(?:prompt|response|raw[-_ ]?response|chain[-_ ]?of[-_ ]?thought|reasoning)(?:$|[-_ ])/iu;

function now(): string {
  return new Date().toISOString();
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function serialize(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

function assertSafePayload(value: JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafePayload);
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) {
      throw new StorageSecurityError(`Sensitive field ${key} is not persisted.`);
    }
    if (hiddenContentKeyPattern.test(key)) {
      throw new StorageSecurityError(`Raw model content field ${key} is not persisted.`);
    }
    assertSafePayload(child);
  }
}

function parse(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function payloadChecksum(payload: JsonValue): string {
  assertSafePayload(payload);
  return checksum(serialize(payload));
}

function validatedOpportunityBrief(value: unknown): OpportunityBrief {
  const parsed = opportunityBriefSchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Opportunity brief data is invalid.");
  }
  return parsed.data;
}

function validatedWritingPolicy(value: unknown): WritingPolicy {
  const parsed = writingPolicySchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Writing policy data is invalid.");
  }
  const domainValidation = validateWritingPolicyInput(parsed.data);
  if (!domainValidation.valid) {
    throw new StorageValidationError("Writing policy data is invalid.");
  }
  const normalizedChecksum = parsed.data.checksum.toLowerCase();
  if (checksum(parsed.data.content) !== normalizedChecksum) {
    throw new StorageValidationError("The writing policy content checksum is invalid.");
  }
  const preferences = parsed.data.preferences;
  return {
    schemaVersion: parsed.data.schemaVersion,
    content: parsed.data.content,
    checksum: normalizedChecksum,
    version: parsed.data.version,
    ...(parsed.data.rules === undefined ? {} : { rules: parsed.data.rules }),
    ...(preferences === undefined
      ? {}
      : {
          preferences: {
            ...(preferences.tone === undefined ? {} : { tone: preferences.tone }),
            ...(preferences.spellingLocale === undefined
              ? {}
              : { spellingLocale: preferences.spellingLocale }),
            ...(preferences.verbosity === undefined ? {} : { verbosity: preferences.verbosity }),
            ...(preferences.pageTarget === undefined ? {} : { pageTarget: preferences.pageTarget }),
            ...(preferences.sectionOrder === undefined
              ? {}
              : { sectionOrder: preferences.sectionOrder }),
            ...(preferences.emphasisAreas === undefined
              ? {}
              : { emphasisAreas: preferences.emphasisAreas }),
          },
        }),
    lineage: parsed.data.lineage ?? { kind: "workspace" },
  };
}

function validatedCanonicalCandidateProfile(value: unknown): CanonicalCandidateProfile {
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

const candidateKnowledgeLexicalIndexRebuildKeys = new Set([
  "scope",
  "index",
  "chunks",
  "createdAt",
]);
const candidateKnowledgeLexicalIndexUpsertKeys = new Set(["scope", "index", "chunks"]);
const candidateKnowledgeLexicalSourceVersionDeletionKeys = new Set([
  "storeId",
  "knowledgeBaseId",
  "sourceId",
  "versionId",
]);
const maximumCandidateKnowledgeLexicalIndexChunkCount = 100_000;
const maximumCandidateKnowledgeRetrievalTraceListCount = 1_024;
const candidateKnowledgeLexicalIndexManifestSchemaVersion = 1;

function requireStrictStorageObject(
  value: unknown,
  keys: ReadonlySet<string>,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorageValidationError(`${field} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.has(key)) throw new StorageValidationError(`${field} contains unsupported fields`);
  }
  return record;
}

function validatedCandidateKnowledgeRetrievalScope(
  value: unknown,
): CandidateKnowledgeRetrievalScope {
  const parsed = candidateKnowledgeRetrievalScopeSchema.safeParse(value);
  if (!parsed.success)
    throw new StorageValidationError("Candidate knowledge retrieval scope is invalid");
  return parsed.data;
}

function validatedCandidateKnowledgeLexicalIndexIdentity(
  value: unknown,
): CandidateKnowledgeLexicalIndexIdentity {
  const parsed = candidateKnowledgeLexicalIndexIdentitySchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge lexical index identity is invalid");
  }
  return parsed.data;
}

function validatedCandidateKnowledgeLexicalChunk(value: unknown): CandidateKnowledgeLexicalChunk {
  const parsed = candidateKnowledgeLexicalChunkSchema.safeParse(value);
  if (!parsed.success)
    throw new StorageValidationError("Candidate knowledge lexical chunk is invalid");
  return parsed.data;
}

function validatedCandidateKnowledgeRetrievalRequest(
  value: unknown,
): CandidateKnowledgeLexicalRetrievalRequestInput & {
  readonly scope: CandidateKnowledgeRetrievalScope;
} {
  const parsed = candidateKnowledgeLexicalRetrievalRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge retrieval request is invalid");
  }
  return parsed.data;
}

function validatedCandidateKnowledgeRetrievalResult(
  value: unknown,
): CandidateKnowledgeLexicalRetrievalResult {
  const parsed = candidateKnowledgeLexicalRetrievalResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Candidate knowledge retrieval result is invalid");
  }
  return parsed.data;
}

function validatedCandidateKnowledgeRetrievalTrace(
  value: unknown,
): CandidateKnowledgeRetrievalTrace {
  const parsed = candidateKnowledgeRetrievalTraceSchema.safeParse(value);
  if (!parsed.success)
    throw new StorageValidationError("Candidate knowledge retrieval trace is invalid");
  return parsed.data;
}

function candidateKnowledgeLexicalReferenceKey(
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
  ]);
}

function candidateKnowledgeLexicalScopeJson(scope: CandidateKnowledgeRetrievalScope): string {
  return serialize({
    sources: scope.sources.map((source) => ({
      storeId: source.storeId,
      knowledgeBaseId: source.knowledgeBaseId,
      sourceId: source.sourceId,
      versionId: source.versionId,
    })),
  });
}

/** Deterministic identity of the exact source-version manifest, without paths or checksums. */
export function computeCandidateKnowledgeLexicalManifestChecksum(
  scope: CandidateKnowledgeRetrievalScopeInput,
): string {
  const normalizedScope = validatedCandidateKnowledgeRetrievalScope(scope);
  return checksum(
    serialize({
      schemaVersion: candidateKnowledgeLexicalIndexManifestSchemaVersion,
      scope: recordToJson(normalizedScope),
    }),
  );
}

function requireCandidateKnowledgeLexicalManifestBinding(
  scope: CandidateKnowledgeRetrievalScope,
  index: CandidateKnowledgeLexicalIndexIdentity,
): void {
  if (index.manifestChecksum !== computeCandidateKnowledgeLexicalManifestChecksum(scope)) {
    throw new StorageValidationError("Candidate knowledge lexical index manifest is invalid");
  }
}

function requireSingleCandidateKnowledgeLexicalScope(scope: CandidateKnowledgeRetrievalScope): {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
} {
  const first = scope.sources[0];
  if (first === undefined) throw new StorageValidationError("Candidate knowledge scope is empty");
  if (
    scope.sources.some(
      (source) =>
        source.storeId !== first.storeId || source.knowledgeBaseId !== first.knowledgeBaseId,
    )
  ) {
    throw new StorageValidationError(
      "Candidate knowledge lexical index operations require one store and knowledge base",
    );
  }
  return { storeId: first.storeId, knowledgeBaseId: first.knowledgeBaseId };
}

function requireSafeLexicalIdentifier(value: string, field: string, maximum = 120): string {
  const normalized = requireNonEmpty(value, field).trim();
  if (
    normalized.length > maximum ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(normalized)
  ) {
    throw new StorageValidationError(`${field} must be a safe opaque identifier`);
  }
  return normalized;
}

function lexicalScopeEquals(
  left: CandidateKnowledgeRetrievalScope,
  right: CandidateKnowledgeRetrievalScope,
): boolean {
  return candidateKnowledgeLexicalScopeJson(left) === candidateKnowledgeLexicalScopeJson(right);
}

function lexicalIndexEquals(
  left: CandidateKnowledgeLexicalIndexIdentity,
  right: CandidateKnowledgeLexicalIndexIdentity,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.indexerId === right.indexerId &&
    left.manifestChecksum === right.manifestChecksum
  );
}

function candidateKnowledgeLexicalIndexRecordFromRow(
  database: SqliteHandle,
  row: Record<string, unknown>,
): CandidateKnowledgeLexicalIndexRecord {
  const scope = validatedCandidateKnowledgeRetrievalScope(parse(rowString(row, "scope_json")));
  const index = validatedCandidateKnowledgeLexicalIndexIdentity({
    schemaVersion: rowNumber(row, "schema_version"),
    indexerId: rowString(row, "indexer_id"),
    manifestChecksum: rowString(row, "manifest_checksum"),
  });
  requireCandidateKnowledgeLexicalManifestBinding(scope, index);
  const indexedChunkCount = Number(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM candidate_knowledge_lexical_chunks WHERE store_id = ? AND knowledge_base_id = ?",
      )
      .get<{ readonly count: number }>(
        rowString(row, "store_id"),
        rowString(row, "knowledge_base_id"),
      )?.count ?? 0,
  );
  return {
    scope,
    index,
    indexedChunkCount,
    createdAt: requireTimestamp(rowString(row, "created_at"), "lexical index createdAt"),
    stale: rowNumber(row, "stale") === 1,
  };
}

function candidateKnowledgeRetrievalTraceFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeRetrievalTrace {
  const payloadJson = rowString(row, "payload_json");
  const payload = parse(payloadJson);
  if (checksum(serialize(payload)) !== rowString(row, "payload_checksum")) {
    throw new StorageValidationError("Stored candidate knowledge retrieval trace is invalid");
  }
  const trace = validatedCandidateKnowledgeRetrievalTrace(payload);
  if (
    trace.workspaceId !== rowString(row, "workspace_id") ||
    trace.id !== rowString(row, "trace_id") ||
    trace.operationId !== rowString(row, "operation_id") ||
    trace.queryChecksum !== rowString(row, "query_checksum")
  ) {
    throw new StorageValidationError(
      "Stored candidate knowledge retrieval trace identity is invalid",
    );
  }
  return trace;
}

function validatedCandidateKnowledgeLexicalChunks(
  value: unknown,
  scope: CandidateKnowledgeRetrievalScope,
): readonly CandidateKnowledgeLexicalChunk[] {
  if (!Array.isArray(value)) {
    throw new StorageValidationError("Candidate knowledge lexical chunks must be an array");
  }
  if (value.length > maximumCandidateKnowledgeLexicalIndexChunkCount) {
    throw new StorageValidationError("Candidate knowledge lexical chunks exceed the maximum");
  }
  const scopeKeys = new Set(scope.sources.map(candidateKnowledgeLexicalReferenceKey));
  const chunks = value.map((entry) => validatedCandidateKnowledgeLexicalChunk(entry));
  const chunkIds = new Set<string>();
  const ordinals = new Set<string>();
  for (const chunk of chunks) {
    if (!scopeKeys.has(candidateKnowledgeLexicalReferenceKey(chunk.metadata.provenance))) {
      throw new StorageValidationError(
        "Candidate knowledge lexical chunk is outside the index scope",
      );
    }
    if (chunkIds.has(chunk.chunkId)) {
      throw new StorageValidationError("Candidate knowledge lexical chunk ids must be unique");
    }
    chunkIds.add(chunk.chunkId);
    const ordinalKey = `${candidateKnowledgeLexicalReferenceKey(chunk.metadata.provenance)}\u0000${chunk.ordinal}`;
    if (ordinals.has(ordinalKey)) {
      throw new StorageValidationError("Candidate knowledge lexical chunk ordinals must be unique");
    }
    ordinals.add(ordinalKey);
  }
  return chunks.sort((left, right) => {
    const leftReference = candidateKnowledgeLexicalReferenceKey(left.metadata.provenance);
    const rightReference = candidateKnowledgeLexicalReferenceKey(right.metadata.provenance);
    if (leftReference !== rightReference) return leftReference < rightReference ? -1 : 1;
    if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
    return left.chunkId < right.chunkId ? -1 : left.chunkId > right.chunkId ? 1 : 0;
  });
}

function writingPolicyVersionSelect(): string {
  return "SELECT workspace_id, policy_checksum, version, schema_version, created_at, prior_checksum, payload_json, payload_checksum FROM writing_policy_versions";
}

function writingPolicyVersionLeafSelect(): string {
  return `SELECT candidate.workspace_id,
                 candidate.policy_checksum,
                 candidate.version,
                 candidate.schema_version,
                 candidate.created_at,
                 candidate.prior_checksum,
                 candidate.payload_json,
                 candidate.payload_checksum
          FROM writing_policy_versions AS candidate
          WHERE candidate.workspace_id = ?
            AND NOT EXISTS (
              SELECT 1
              FROM writing_policy_versions AS child
              WHERE child.workspace_id = candidate.workspace_id
                AND child.prior_checksum = candidate.policy_checksum
            )`;
}

function currentWritingPolicyLeaf(
  database: SqliteHandle,
  workspaceId: string,
): Record<string, unknown> | undefined {
  const leaves = database.prepare(writingPolicyVersionLeafSelect()).all(workspaceId);
  if (leaves.length > 1) {
    throw new StorageConflictError("The writing policy history has multiple current leaves.");
  }
  if (leaves.length === 1) return leaves[0];
  const history = database
    .prepare("SELECT 1 FROM writing_policy_versions WHERE workspace_id = ? LIMIT 1")
    .get(workspaceId);
  if (history !== undefined) {
    throw new StorageConflictError("The writing policy history has no current leaf.");
  }
  return undefined;
}

function canonicalCandidateProfileVersionSelect(): string {
  return "SELECT workspace_id, profile_id, version, schema_version, parent_version, status, created_at, updated_at, reviewed_at, payload_json, payload_checksum FROM canonical_candidate_profile_versions";
}

function canonicalCandidateProfileHistory(
  database: SqliteHandle,
  workspaceId: string,
  profileId: string,
): readonly CanonicalCandidateProfileVersionRecord[] {
  const records = database
    .prepare(
      `${canonicalCandidateProfileVersionSelect()} WHERE workspace_id = ? AND profile_id = ? ORDER BY version`,
    )
    .all(workspaceId, profileId)
    .map((row) => canonicalCandidateProfileVersionFromRow(row));
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

function canonicalCandidateProfileLeaf(
  records: readonly CanonicalCandidateProfileVersionRecord[],
): CanonicalCandidateProfileVersionRecord | undefined {
  if (records.length === 0) return undefined;
  return records[records.length - 1];
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim() === "") {
    throw new StorageValidationError(`${field} must not be empty`);
  }
  return value;
}

function requireAbsolutePath(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (!isAbsolute(normalized)) {
    throw new StorageValidationError(`${field} must be an absolute path`);
  }
  return normalized;
}

function requireCanonicalAbsolutePath(value: string, field: string): string {
  const absolutePath = requireAbsolutePath(value, field);
  const canonicalPath = resolve(absolutePath);
  if (canonicalPath !== absolutePath) {
    throw new StorageValidationError(`${field} must be canonical`);
  }
  return canonicalPath;
}

function directoryMemberRelativePathSegments(
  rootPath: string,
  originPath: string,
): readonly string[] | undefined {
  const canonicalRoot = requireCanonicalAbsolutePath(
    rootPath,
    "candidate knowledge directory root path",
  );
  const canonicalOrigin = requireCanonicalAbsolutePath(
    originPath,
    "candidate knowledge source origin path",
  );
  const memberRelativePath = relative(canonicalRoot, canonicalOrigin);
  if (memberRelativePath === "" || isAbsolute(memberRelativePath)) return undefined;
  const segments = memberRelativePath.split(sep);
  if (segments[0] === ".." || segments.some((segment) => segment === "" || segment === ".")) {
    return undefined;
  }
  return segments;
}

function directoryMemberRelativePathHash(rootPath: string, originPath: string): string {
  const segments = directoryMemberRelativePathSegments(rootPath, originPath);
  if (segments === undefined) {
    throw new StorageValidationError(
      "candidate knowledge directory member origin must be strictly inside its root",
    );
  }
  return checksum(segments.join("/"));
}

function directoryMemberOriginRelation(
  rootPath: string,
  originPath: string,
  memberRelativePathHash: string,
  memberRelativePathHashes: ReadonlySet<string>,
): CandidateKnowledgeDirectoryMemberOriginRelation {
  const segments = directoryMemberRelativePathSegments(rootPath, originPath);
  if (segments === undefined) return "outside-root";
  const originRelativePathHash = checksum(segments.join("/"));
  if (originRelativePathHash === memberRelativePathHash) return "same-member";
  return memberRelativePathHashes.has(originRelativePathHash) ? "other-member" : "unmatched";
}

function requireTimestamp(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    throw new StorageValidationError(`${field} must be a valid ISO timestamp`);
  }
  return normalized;
}

function requireRetentionTimestampNotFuture(value: string, field: string): string {
  const normalized = requireTimestamp(value, field);
  if (Date.parse(normalized) > Date.now()) {
    throw new StorageValidationError(`${field} must not be in the future`);
  }
  return normalized;
}

function directoryMemberRevisionBaselineBoundAt(
  directoryBoundAt: string,
  sourceCreatedAt: string,
): string {
  return Date.parse(directoryBoundAt) >= Date.parse(sourceCreatedAt)
    ? directoryBoundAt
    : sourceCreatedAt;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

function moduleRequire(): NodeRequire {
  try {
    return createRequire(import.meta.url);
  } catch {
    // Electron Forge emits the main bundle as CommonJS. In that bundle Vite
    // can leave import.meta.url undefined, so use an absolute cwd anchor.
    return createRequire(join(process.cwd(), "package.json"));
  }
}

function loadSqlite(filename: string, options: SqliteStorageOpenOptions = {}): SqliteHandle {
  let loaded: unknown;
  const require = moduleRequire();
  try {
    loaded = require("better-sqlite3");
  } catch (error) {
    const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string })
      .resourcesPath;
    if (resourcesPath === undefined) {
      throw new StorageUnavailableError(
        "SQLite storage requires the optional better-sqlite3 dependency.",
        { cause: error },
      );
    }
    try {
      loaded = require(join(resourcesPath, "better-sqlite3"));
    } catch {
      throw new StorageUnavailableError(
        "SQLite storage requires the optional better-sqlite3 dependency.",
        { cause: error },
      );
    }
  }
  const Constructor = (loaded as { readonly default?: unknown }).default ?? loaded;
  if (typeof Constructor !== "function") {
    throw new StorageUnavailableError("The better-sqlite3 module did not expose a constructor.");
  }
  const sqliteOptions: { readonly?: boolean; fileMustExist?: boolean } = {};
  if (options.readOnly !== undefined) sqliteOptions.readonly = options.readOnly;
  if (options.fileMustExist !== undefined) sqliteOptions.fileMustExist = options.fileMustExist;
  return new (Constructor as SqliteConstructor)(filename, sqliteOptions);
}

function rowString(row: Record<string, unknown>, field: string): string {
  return String(row[field]);
}

function rowNumber(row: Record<string, unknown>, field: string): number {
  return Number(row[field]);
}

function rowNullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return value === null || value === undefined ? null : String(value);
}

function rowNullableJson(row: Record<string, unknown>, field: string): JsonValue | null {
  const value = row[field];
  return value === null || value === undefined ? null : parse(String(value));
}

function rowNullableNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  return value === null || value === undefined ? null : Number(value);
}

function recordChecksum(input: unknown): string {
  return checksum(serialize(recordToJson(input)));
}

function assertSafeRecordFields(input: unknown, fields: readonly string[]): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return;
  const record = input as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (value !== null && value !== undefined) {
      payloadChecksum(recordToJson(value));
    }
  }
}

function requirePositive(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new StorageValidationError(`${field} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

function requireSha256(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field).trim();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new StorageValidationError(`${field} must be a lowercase SHA-256 value`);
  }
  return normalized;
}

function requireBoundedDeletionCount(value: number, field: string): number {
  const normalized = requireNonNegativeInteger(value, field);
  if (normalized > 1_024) {
    throw new StorageValidationError(`${field} must be at most 1024`);
  }
  return normalized;
}

const candidateKnowledgeDeletionImmutableDeleteTriggers: readonly {
  readonly name: string;
  readonly table: string;
  readonly message: string;
}[] = [
  {
    name: "candidate_knowledge_sources_immutable_delete",
    table: "candidate_knowledge_sources",
    message: "candidate knowledge sources are immutable",
  },
  {
    name: "candidate_knowledge_source_versions_immutable_delete",
    table: "candidate_knowledge_source_versions",
    message: "candidate knowledge source versions are immutable",
  },
  {
    name: "candidate_knowledge_managed_source_versions_immutable_delete",
    table: "candidate_knowledge_managed_source_versions",
    message: "managed candidate knowledge source versions are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_operations_immutable_delete",
    table: "candidate_knowledge_managed_write_operations",
    message: "managed candidate knowledge write operations are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_events_immutable_delete",
    table: "candidate_knowledge_managed_write_events",
    message: "managed candidate knowledge write events are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_staging_identities_immutable_delete",
    table: "candidate_knowledge_managed_write_staging_identities",
    message: "managed candidate knowledge staging identities are immutable",
  },
  {
    name: "candidate_knowledge_managed_write_recovery_claims_immutable_delete",
    table: "candidate_knowledge_managed_write_recovery_claims",
    message: "managed candidate knowledge recovery claims are immutable",
  },
  {
    name: "candidate_knowledge_source_origin_bindings_immutable_delete",
    table: "candidate_knowledge_source_origin_bindings",
    message: "candidate knowledge source origin bindings are immutable",
  },
  {
    name: "candidate_knowledge_source_refresh_observations_immutable_delete",
    table: "candidate_knowledge_source_refresh_observations",
    message: "candidate knowledge source refresh observations are immutable",
  },
  {
    name: "candidate_knowledge_source_retirements_immutable_delete",
    table: "candidate_knowledge_source_retirements",
    message: "candidate knowledge source retirements are immutable",
  },
  {
    name: "candidate_knowledge_source_url_provenance_immutable_delete",
    table: "candidate_knowledge_source_url_provenance",
    message: "candidate knowledge source URL provenance is immutable",
  },
  {
    name: "candidate_knowledge_source_restored_url_provenance_immutable_delete",
    table: "candidate_knowledge_source_restored_url_provenance",
    message: "candidate knowledge restored URL provenance is immutable",
  },
  {
    name: "candidate_knowledge_directory_bindings_immutable_delete",
    table: "candidate_knowledge_directory_bindings",
    message: "candidate knowledge directory bindings are immutable",
  },
  {
    name: "candidate_knowledge_directory_members_immutable_delete",
    table: "candidate_knowledge_directory_members",
    message: "candidate knowledge directory members are immutable",
  },
  {
    name: "candidate_knowledge_directory_root_revisions_immutable_delete",
    table: "candidate_knowledge_directory_root_revisions",
    message: "candidate knowledge directory root revisions are immutable",
  },
  {
    name: "candidate_knowledge_directory_member_revisions_immutable_delete",
    table: "candidate_knowledge_directory_member_revisions",
    message: "candidate knowledge directory member revisions are immutable",
  },
  {
    name: "candidate_knowledge_retention_policy_events_immutable_delete",
    table: "candidate_knowledge_retention_policy_events",
    message: "candidate knowledge retention policy events are immutable",
  },
  {
    name: "candidate_knowledge_retention_override_events_immutable_delete",
    table: "candidate_knowledge_retention_override_events",
    message: "candidate knowledge retention override events are immutable",
  },
];

function dropCandidateKnowledgeDeletionImmutableDeleteTriggers(database: SqliteHandle): void {
  for (const trigger of candidateKnowledgeDeletionImmutableDeleteTriggers) {
    database.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
  }
}

function recreateCandidateKnowledgeDeletionImmutableDeleteTriggers(database: SqliteHandle): void {
  for (const trigger of candidateKnowledgeDeletionImmutableDeleteTriggers) {
    database.exec(
      `CREATE TRIGGER IF NOT EXISTS ${trigger.name}
       BEFORE DELETE ON ${trigger.table}
       BEGIN SELECT RAISE(ABORT, '${trigger.message}'); END;`,
    );
  }
}

function requireNonNegativeNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a finite non-negative number`);
  }
  return value;
}

function requireStoredRunState(state: StoredRunState, field: string): void {
  if (state !== "provider-error" && !workflowStates.includes(state)) {
    throw new StorageValidationError(`Unsupported ${field}: ${state}`);
  }
}

function requireStoredStep(step: StoredRunStep, field: string): void {
  if (step !== null && step !== "author" && step !== "critic" && step !== "revision") {
    throw new StorageValidationError(`Unsupported ${field}: ${step}`);
  }
}

export class SqliteStorage
  implements
    StoragePort,
    HistoryStoragePort,
    RetrievalPort,
    CandidateKnowledgeBaseStoragePort,
    CandidateKnowledgeLexicalStoragePort,
    OpportunityBriefStoragePort,
    CanonicalCandidateProfileStoragePort,
    WritingPolicyStoragePort
{
  private readonly database: SqliteHandle;
  private closed = false;
  private readonly readOnly: boolean;

  public constructor(filename: string, options: SqliteStorageOpenOptions = {}) {
    this.readOnly = options.readOnly === true;
    this.database = loadSqlite(requireNonEmpty(filename, "filename"), options);
    this.database.pragma("foreign_keys = ON");
    if (!this.readOnly) this.migrate();
  }

  public migrate(): void {
    this.ensureOpen();
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    for (const migration of migrations) {
      const migrationChecksum = checksum(migration.sql);
      const applied = this.database
        .prepare("SELECT checksum FROM schema_migrations WHERE version = ?")
        .get<{ readonly checksum: string }>(migration.version);
      if (applied !== undefined) {
        if (applied.checksum !== migrationChecksum) {
          throw new StorageConflictError(
            `migration ${migration.version} has changed after it was applied`,
          );
        }
        continue;
      }
      const requiresForeignKeyRebuild = migration.requiresForeignKeyRebuild === true;
      if (requiresForeignKeyRebuild) this.database.pragma("foreign_keys = OFF");
      try {
        const apply = this.database.transaction(() => {
          this.database.exec(migration.sql);
          if (requiresForeignKeyRebuild) {
            const violations = this.database.prepare("PRAGMA foreign_key_check").all();
            if (violations.length > 0) {
              throw new StorageConflictError(
                `migration ${migration.version} would leave invalid foreign keys`,
              );
            }
          }
          this.database
            .prepare(
              "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)",
            )
            .run(migration.version, migrationChecksum, now());
        });
        apply();
      } finally {
        if (requiresForeignKeyRebuild) {
          this.database.pragma("legacy_alter_table = OFF");
          this.database.pragma("foreign_keys = ON");
        }
      }
    }
  }

  public appliedMigrationVersions(): readonly number[] {
    this.ensureOpen();
    return this.database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all<{ readonly version: number }>()
      .map((row) => row.version);
  }

  public async get(key: string): Promise<string | undefined> {
    this.ensureOpen();
    requireNonEmpty(key, "key");
    const row = this.database
      .prepare("SELECT value FROM key_value WHERE key = ?")
      .get<{ readonly value: string }>(key);
    return row?.value;
  }

  public async set(key: string, value: string): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(key, "key");
    if (sensitiveKeyPattern.test(key)) {
      throw new StorageSecurityError("Sensitive provider or credential values are not persisted.");
    }
    this.database
      .prepare(
        "INSERT INTO key_value (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, value, now());
  }

  public async ensureDefaultCandidateKnowledgeBase(
    input: Omit<CandidateKnowledgeBaseInput, "isDefault">,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeBaseInput({ ...input, isDefault: true });
    let result: CandidateKnowledgeBaseRecord | undefined;
    this.database.transaction(() => {
      const existingDefault = this.database
        .prepare(
          "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases WHERE is_default = 1",
        )
        .get();
      if (existingDefault !== undefined) {
        result = candidateKnowledgeBaseFromRow(existingDefault);
        return;
      }
      const conflictingId = this.database
        .prepare("SELECT id FROM candidate_knowledge_bases WHERE id = ?")
        .get(normalized.id);
      if (conflictingId !== undefined) {
        throw new StorageConflictError(
          `candidate knowledge base ${normalized.id} already exists and is not the default`,
        );
      }
      this.insertCandidateKnowledgeBase(normalized);
      result = normalized;
    })();
    return result as CandidateKnowledgeBaseRecord;
  }

  public async createCandidateKnowledgeBase(
    input: CandidateKnowledgeBaseInput,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeBaseInput(input);
    this.database.transaction(() => {
      if (
        this.database
          .prepare("SELECT id FROM candidate_knowledge_bases WHERE id = ?")
          .get(normalized.id) !== undefined
      ) {
        throw new StorageConflictError(`candidate knowledge base ${normalized.id} already exists`);
      }
      if (
        normalized.isDefault &&
        this.database
          .prepare("SELECT id FROM candidate_knowledge_bases WHERE is_default = 1")
          .get() !== undefined
      ) {
        throw new StorageConflictError("a default candidate knowledge base already exists");
      }
      this.insertCandidateKnowledgeBase(normalized);
    })();
    return normalized;
  }

  public async getCandidateKnowledgeBase(
    id: string,
  ): Promise<CandidateKnowledgeBaseRecord | undefined> {
    this.ensureOpen();
    const normalizedId = requireNonEmpty(id, "candidate knowledge base id").trim();
    const row = this.database
      .prepare(
        "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases WHERE id = ?",
      )
      .get(normalizedId);
    return row === undefined ? undefined : candidateKnowledgeBaseFromRow(row);
  }

  public async listCandidateKnowledgeBases(): Promise<readonly CandidateKnowledgeBaseRecord[]> {
    this.ensureOpen();
    return this.database
      .prepare(
        "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases ORDER BY is_default DESC, created_at, id",
      )
      .all()
      .map(candidateKnowledgeBaseFromRow);
  }

  public async renameCandidateKnowledgeBase(
    id: string,
    displayName: string,
    updatedAt: string,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalizedId = requireNonEmpty(id, "candidate knowledge base id").trim();
    const normalizedName = requireNonEmpty(
      displayName,
      "candidate knowledge base displayName",
    ).trim();
    const normalizedUpdatedAt = requireTimestamp(updatedAt, "candidate knowledge base updatedAt");
    let result: CandidateKnowledgeBaseRecord | undefined;
    this.database.transaction(() => {
      const current = this.requireCandidateKnowledgeBase(normalizedId);
      if (Date.parse(normalizedUpdatedAt) < Date.parse(current.updatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge base updatedAt must not precede its current updatedAt",
        );
      }
      this.database
        .prepare(
          "UPDATE candidate_knowledge_bases SET display_name = ?, updated_at = ? WHERE id = ?",
        )
        .run(normalizedName, normalizedUpdatedAt, normalizedId);
      result = {
        ...current,
        displayName: normalizedName,
        updatedAt: normalizedUpdatedAt,
      };
    })();
    return result as CandidateKnowledgeBaseRecord;
  }

  public async archiveCandidateKnowledgeBase(
    id: string,
    archivedAt: string,
  ): Promise<CandidateKnowledgeBaseRecord> {
    this.ensureOpen();
    const normalizedId = requireNonEmpty(id, "candidate knowledge base id").trim();
    const normalizedArchivedAt = requireTimestamp(
      archivedAt,
      "candidate knowledge base archivedAt",
    );
    let result: CandidateKnowledgeBaseRecord | undefined;
    this.database.transaction(() => {
      const current = this.requireCandidateKnowledgeBase(normalizedId);
      if (current.isDefault) {
        throw new StorageConflictError("the default candidate knowledge base cannot be archived");
      }
      if (current.state === "archived") {
        throw new StorageConflictError(
          `candidate knowledge base ${normalizedId} is already archived`,
        );
      }
      if (Date.parse(normalizedArchivedAt) < Date.parse(current.updatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge base archivedAt must not precede its current updatedAt",
        );
      }
      this.database
        .prepare(
          "UPDATE candidate_knowledge_bases SET state = 'archived', updated_at = ?, archived_at = ? WHERE id = ?",
        )
        .run(normalizedArchivedAt, normalizedArchivedAt, normalizedId);
      result = {
        ...current,
        state: "archived",
        updatedAt: normalizedArchivedAt,
        archivedAt: normalizedArchivedAt,
      };
    })();
    return result as CandidateKnowledgeBaseRecord;
  }

  /**
   * Import a fully inspected portable backup into an empty, freshly migrated
   * candidate-knowledge database. The caller owns package and byte integrity
   * validation; this method is intentionally narrower than the public source
   * mutation APIs and never creates origin bindings or managed-write journal rows.
   */
  public async importCandidateKnowledgePortableBackup(
    input: CandidateKnowledgePortableBackupImportInput,
  ): Promise<void> {
    this.ensureOpen();
    let manifest: CandidateKnowledgePortableBackupManifest;
    try {
      manifest = candidateKnowledgePortableBackupManifestSchema.parse(input.manifest);
    } catch {
      throw new StorageValidationError("Portable candidate knowledge backup manifest is invalid.");
    }
    const operationId = requireNonEmpty(
      input.operationId,
      "Portable candidate knowledge restore operation id",
    ).trim();
    if (!/^[0-9a-f]{64}$/.test(operationId)) {
      throw new StorageValidationError(
        "Portable candidate knowledge restore operation id is invalid.",
      );
    }
    const manifestChecksum = requireNonEmpty(
      input.manifestChecksum,
      "Portable candidate knowledge restore manifest checksum",
    ).trim();
    if (!/^[0-9a-f]{64}$/.test(manifestChecksum)) {
      throw new StorageValidationError(
        "Portable candidate knowledge restore manifest checksum is invalid.",
      );
    }
    const restoredAt = requireTimestamp(
      input.restoredAt,
      "Portable candidate knowledge restore restoredAt",
    );
    if (Date.parse(restoredAt) > Date.now()) {
      throw new StorageValidationError(
        "Portable candidate knowledge restore restoredAt is in the future.",
      );
    }
    this.database.transaction(() => {
      const existingKnowledgeBase = this.database
        .prepare("SELECT id FROM candidate_knowledge_bases LIMIT 1")
        .get();
      if (existingKnowledgeBase !== undefined) {
        throw new StorageConflictError("Portable candidate knowledge restore target is not empty.");
      }
      this.database
        .prepare(
          `INSERT INTO candidate_knowledge_portable_restore_provenance
           (operation_id, manifest_checksum, source_store_id, package_schema_version, restored_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          operationId,
          manifestChecksum,
          manifest.descriptor.id,
          manifest.schemaVersion,
          restoredAt,
        );

      for (const entry of manifest.knowledgeBases) {
        const knowledgeBase = entry.knowledgeBase;
        this.insertCandidateKnowledgeBase({
          id: knowledgeBase.id,
          displayName: knowledgeBase.displayName,
          description: knowledgeBase.description,
          state: knowledgeBase.state,
          isDefault: knowledgeBase.isDefault,
          createdAt: knowledgeBase.createdAt,
          updatedAt: knowledgeBase.updatedAt,
          archivedAt: knowledgeBase.archivedAt,
        });
        if (entry.retentionPolicy.revision > 0) {
          const insertPolicy = this.database.prepare(
            "INSERT INTO candidate_knowledge_retention_policy_events (knowledge_base_id, revision, retention_class, rule, expire_after_days, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          );
          for (const policy of entry.retentionPolicy.classes) {
            insertPolicy.run(
              knowledgeBase.id,
              entry.retentionPolicy.revision,
              policy.class,
              policy.rule,
              policy.expireAfterDays,
              entry.retentionPolicy.updatedAt,
            );
          }
        }
        for (const override of entry.retentionPolicy.activeOverrides) {
          this.database
            .prepare(
              `INSERT INTO candidate_knowledge_retention_override_events
               (knowledge_base_id, retention_class, override_kind, sequence, state,
                override_revision, policy_revision, changed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              knowledgeBase.id,
              override.class,
              override.kind,
              override.sequence,
              override.state,
              override.overrideRevision,
              override.policyRevision,
              override.changedAt,
            );
        }
        this.database
          .prepare(
            `INSERT INTO candidate_knowledge_retention_override_revision_snapshots
             (knowledge_base_id, override_revision)
             VALUES (?, ?)
             ON CONFLICT(knowledge_base_id) DO UPDATE SET override_revision = excluded.override_revision`,
          )
          .run(knowledgeBase.id, entry.retentionPolicy.overrideRevision);

        for (const source of entry.sources) {
          this.insertCandidateKnowledgeSource({
            id: source.id,
            knowledgeBaseId: source.knowledgeBaseId,
            kind: source.kind,
            displayName: source.displayName,
            createdAt: source.createdAt,
          });
          for (const version of source.versions) {
            this.insertCandidateKnowledgeSourceVersion({
              id: version.id,
              sourceId: source.id,
              version: version.version,
              parentVersionId: version.parentVersionId,
              mediaType: version.mediaType,
              checksum: version.checksum,
              sizeBytes: version.sizeBytes,
              createdAt: version.createdAt,
            });
            this.insertManagedCandidateKnowledgeSourceVersion(version.id);
            if (source.kind === "url") {
              const provenance = version.urlProvenance;
              if (provenance === undefined) {
                throw new StorageValidationError(
                  "Portable candidate knowledge URL provenance is missing.",
                );
              }
              this.database
                .prepare(
                  `INSERT INTO candidate_knowledge_source_restored_url_provenance
                   (version_id, source_id, fetched_at, kind) VALUES (?, ?, ?, ?)`,
                )
                .run(version.id, source.id, provenance.fetchedAt, provenance.kind);
            }
          }
          if (source.refreshObservation !== null) {
            this.database
              .prepare(
                `INSERT INTO candidate_knowledge_source_refresh_observations
                 (source_id, observed_version_id, status, checked_at,
                  last_refreshed_version_id, last_refreshed_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .run(
                source.id,
                source.refreshObservation.observedVersionId,
                source.refreshObservation.status,
                source.refreshObservation.checkedAt,
                source.refreshObservation.lastRefreshedVersionId,
                source.refreshObservation.lastRefreshedAt,
              );
          }
          if (source.retirement !== null) {
            this.database
              .prepare(
                `INSERT INTO candidate_knowledge_source_retirements
                 (source_id, retired_at, reason) VALUES (?, ?, ?)`,
              )
              .run(source.id, source.retirement.retiredAt, source.retirement.reason);
          }
        }
      }
    })();
    this.validateCandidateKnowledgeSourceGraph();
    this.validateCandidateKnowledgeRetentionContract();
  }

  public getCandidateKnowledgePortableBackupProvenance():
    | CandidateKnowledgePortableBackupProvenance
    | undefined {
    this.ensureOpen();
    const row = this.database
      .prepare(
        `SELECT operation_id, manifest_checksum, source_store_id,
                package_schema_version, restored_at
         FROM candidate_knowledge_portable_restore_provenance
         ORDER BY restored_at DESC, operation_id DESC
         LIMIT 1`,
      )
      .get();
    if (row === undefined) return undefined;
    return {
      operationId: rowString(row, "operation_id"),
      manifestChecksum: rowString(row, "manifest_checksum"),
      sourceStoreId: rowString(row, "source_store_id"),
      packageSchemaVersion: requirePositive(
        rowNumber(row, "package_schema_version"),
        "Portable candidate knowledge restore package schema version",
      ),
      restoredAt: requireTimestamp(
        rowString(row, "restored_at"),
        "Portable candidate knowledge restore restoredAt",
      ),
    };
  }

  public async createCandidateKnowledgeSource(
    sourceInput: CandidateKnowledgeSourceInput,
    initialVersionInput: CandidateKnowledgeSourceVersionInput,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const source = normalizeCandidateKnowledgeSourceInput(sourceInput);
    const initialVersion = normalizeCandidateKnowledgeSourceVersionInput(initialVersionInput);
    if (Date.parse(initialVersion.createdAt) < Date.parse(source.createdAt)) {
      throw new StorageValidationError(
        "candidate knowledge source version createdAt must not precede its source createdAt",
      );
    }
    const version: CandidateKnowledgeSourceVersionRecord = {
      ...initialVersion,
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
    };
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(source.knowledgeBaseId);
      if (
        this.database
          .prepare("SELECT id FROM candidate_knowledge_sources WHERE id = ?")
          .get(source.id) !== undefined
      ) {
        throw new StorageConflictError(`candidate knowledge source ${source.id} already exists`);
      }
      this.insertCandidateKnowledgeSource(source);
      this.insertCandidateKnowledgeSourceVersion(version);
    })();
    return { source, version, created: true };
  }

  public async appendCandidateKnowledgeSourceVersion(
    knowledgeBaseId: string,
    sourceId: string,
    versionInput: CandidateKnowledgeSourceVersionInput,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedVersion = normalizeCandidateKnowledgeSourceVersionInput(versionInput);
    let result: CandidateKnowledgeSourceVersionWriteResult | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
      );
      this.requireCandidateKnowledgeSourceActive(normalizedSourceId);
      const currentRow = this.database
        .prepare(
          "SELECT id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(normalizedSourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${normalizedSourceId} has no versions`,
        );
      }
      const current = candidateKnowledgeSourceVersionFromRow(currentRow);
      if (Date.parse(normalizedVersion.createdAt) < Date.parse(current.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source version createdAt must not precede the current version createdAt",
        );
      }
      if (current.checksum === normalizedVersion.checksum) {
        if (
          current.mediaType !== normalizedVersion.mediaType ||
          current.sizeBytes !== normalizedVersion.sizeBytes
        ) {
          throw new StorageConflictError(
            "candidate knowledge source version checksum conflicts with its integrity metadata",
          );
        }
        result = { source, version: current, created: false };
        return;
      }
      const version: CandidateKnowledgeSourceVersionRecord = {
        ...normalizedVersion,
        sourceId: normalizedSourceId,
        version: current.version + 1,
        parentVersionId: current.id,
      };
      this.insertCandidateKnowledgeSourceVersion(version);
      result = { source, version, created: true };
    })();
    return result as CandidateKnowledgeSourceVersionWriteResult;
  }

  public async prepareManagedCandidateKnowledgeWrite(
    input: ManagedCandidateKnowledgeWriteOperationInput,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      input.operationId,
      "managed candidate knowledge write operation id",
    ).trim();
    const knowledgeBaseId = requireNonEmpty(
      input.knowledgeBaseId,
      "managed candidate knowledge write candidate knowledge base id",
    ).trim();
    const sourceId = requireNonEmpty(
      input.sourceId,
      "managed candidate knowledge write source id",
    ).trim();
    const requestedVersionId = requireNonEmpty(
      input.requestedVersionId,
      "managed candidate knowledge write requested version id",
    ).trim();
    if (input.kind !== "create" && input.kind !== "append") {
      throw new StorageValidationError(
        `Unsupported managed candidate knowledge write kind: ${input.kind}`,
      );
    }
    const createdAt = requireTimestamp(
      input.createdAt,
      "managed candidate knowledge write createdAt",
    );
    const integrityValues = [
      input.requestedMediaType,
      input.requestedChecksum,
      input.requestedSizeBytes,
    ];
    const hasIntegrityMetadata = integrityValues.some((value) => value !== undefined);
    const ownerGeneration =
      input.ownerGeneration === undefined
        ? undefined
        : requirePositive(input.ownerGeneration, "managed candidate knowledge owner generation");
    if (ownerGeneration !== undefined && !integrityValues.every((value) => value !== undefined)) {
      throw new StorageValidationError(
        "Managed candidate knowledge write ownership requires requested integrity metadata.",
      );
    }
    if (ownerGeneration === undefined && hasIntegrityMetadata) {
      throw new StorageValidationError(
        "Managed candidate knowledge write integrity metadata requires ownership.",
      );
    }
    const requestedMediaType =
      ownerGeneration === undefined
        ? undefined
        : requireNonEmpty(
            input.requestedMediaType as string,
            "managed candidate knowledge requested media type",
          ).trim();
    const requestedChecksum =
      ownerGeneration === undefined ? undefined : (input.requestedChecksum as string);
    if (requestedChecksum !== undefined && !/^[0-9a-f]{64}$/.test(requestedChecksum)) {
      throw new StorageValidationError(
        "Managed candidate knowledge requested checksum must be a lowercase SHA-256 checksum.",
      );
    }
    const requestedSizeBytes =
      ownerGeneration === undefined
        ? undefined
        : requireNonNegativeInteger(
            input.requestedSizeBytes as number,
            "managed candidate knowledge requested size",
          );
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(knowledgeBaseId);
      const existingOperation = this.database
        .prepare(
          "SELECT operation_id FROM candidate_knowledge_managed_write_operations WHERE operation_id = ?",
        )
        .get(operationId);
      if (existingOperation !== undefined) {
        throw new StorageConflictError(
          `managed candidate knowledge write operation ${operationId} already exists`,
        );
      }
      const existingSource = this.database
        .prepare(
          "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE id = ?",
        )
        .get(sourceId);
      if (input.kind === "create") {
        if (existingSource !== undefined) {
          throw new StorageConflictError(`candidate knowledge source ${sourceId} already exists`);
        }
      } else {
        const source = this.requireCandidateKnowledgeSource(knowledgeBaseId, sourceId);
        if (source.kind !== "file" && source.kind !== "url") {
          throw new StorageValidationError(
            "managed candidate knowledge source versions require a supported source",
          );
        }
        this.requireCandidateKnowledgeSourceActive(sourceId);
      }
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_managed_write_operations (operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at, owner_kind, owner_schema_version, owner_generation, requested_media_type, requested_checksum, requested_size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          operationId,
          knowledgeBaseId,
          sourceId,
          requestedVersionId,
          input.kind,
          createdAt,
          ownerGeneration === undefined ? null : managedCandidateKnowledgeWriteOwnerKind,
          ownerGeneration === undefined ? null : managedCandidateKnowledgeWriteOwnerSchemaVersion,
          ownerGeneration ?? null,
          requestedMediaType ?? null,
          requestedChecksum ?? null,
          requestedSizeBytes ?? null,
        );
    })();
  }

  public async recordManagedCandidateKnowledgeWriteStagingIdentity(
    operationIdInput: string,
    identityInput: ManagedCandidateKnowledgeWriteStagingIdentity,
    expectedOwnerGenerationInput: number,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      operationIdInput,
      "managed candidate knowledge write operation id",
    ).trim();
    if (
      typeof identityInput !== "object" ||
      identityInput === null ||
      !Number.isInteger(identityInput.device) ||
      !Number.isInteger(identityInput.inode)
    ) {
      throw new StorageValidationError("Managed candidate knowledge staging identity is invalid.");
    }
    const device = requireNonNegativeInteger(
      identityInput.device,
      "managed candidate knowledge staging device",
    );
    const inode = requireNonNegativeInteger(
      identityInput.inode,
      "managed candidate knowledge staging inode",
    );
    const createdAt = requireTimestamp(
      identityInput.createdAt,
      "managed candidate knowledge staging identity createdAt",
    );
    const expectedOwnerGeneration = requirePositive(
      expectedOwnerGenerationInput,
      "managed candidate knowledge expected owner generation",
    );
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      this.requireManagedCandidateKnowledgeWriteMutationOwner(operation, expectedOwnerGeneration);
      if (Date.parse(createdAt) < Date.parse(operation.createdAt)) {
        throw new StorageValidationError(
          "Managed candidate knowledge staging identity createdAt cannot precede its operation.",
        );
      }
      if (
        operation.ownerKind !== managedCandidateKnowledgeWriteOwnerKind ||
        operation.ownerSchemaVersion !== managedCandidateKnowledgeWriteOwnerSchemaVersion ||
        operation.ownerGeneration !== expectedOwnerGeneration
      ) {
        throw new StorageConflictError(
          "managed candidate knowledge write ownership generation changed while recording staging",
        );
      }
      this.requireManagedCandidateKnowledgeWriteState(operationId, undefined, undefined);
      const existing = this.database
        .prepare(
          "SELECT device, inode, created_at FROM candidate_knowledge_managed_write_staging_identities WHERE operation_id = ?",
        )
        .get<{
          readonly device: number;
          readonly inode: number;
          readonly created_at: string;
        }>(operationId);
      if (existing !== undefined) {
        throw new StorageConflictError(
          "managed candidate knowledge staging identity is already recorded",
        );
      }
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_managed_write_staging_identities (operation_id, device, inode, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(operationId, device, inode, createdAt);
    })();
  }

  public async claimManagedCandidateKnowledgeWriteRecovery(
    operationIdInput: string,
    phaseInput: ManagedCandidateKnowledgeWriteRecoveryClaimPhase,
    claimGenerationInput: number,
    claimedAtInput: string,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      operationIdInput,
      "managed candidate knowledge write operation id",
    ).trim();
    if (
      phaseInput !== "prepared" &&
      phaseInput !== "targeted" &&
      phaseInput !== "published" &&
      phaseInput !== "committed"
    ) {
      throw new StorageValidationError(
        "Managed candidate knowledge recovery claim phase is invalid.",
      );
    }
    const claimGeneration = requirePositive(
      claimGenerationInput,
      "managed candidate knowledge recovery claim generation",
    );
    const claimedAt = requireTimestamp(
      claimedAtInput,
      "managed candidate knowledge recovery claim claimedAt",
    );
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      if (
        operation.ownerKind !== managedCandidateKnowledgeWriteOwnerKind ||
        operation.ownerSchemaVersion !== managedCandidateKnowledgeWriteOwnerSchemaVersion ||
        operation.ownerGeneration === undefined ||
        operation.ownerGeneration >= claimGeneration
      ) {
        throw new StorageConflictError(
          "managed candidate knowledge write recovery claim generation is stale",
        );
      }
      const latest = this.database
        .prepare(
          "SELECT state FROM candidate_knowledge_managed_write_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get<{ readonly state: string }>(operationId);
      const phase = latest?.state ?? "prepared";
      if (phase !== phaseInput) {
        throw new StorageConflictError(
          "managed candidate knowledge write recovery claim phase changed",
        );
      }
      const existing = this.database
        .prepare(
          "SELECT phase, claim_generation FROM candidate_knowledge_managed_write_recovery_claims WHERE operation_id = ?",
        )
        .get<{
          readonly phase: ManagedCandidateKnowledgeWriteRecoveryClaimPhase;
          readonly claim_generation: number;
        }>(operationId);
      if (existing !== undefined) {
        if (existing.phase !== phaseInput || existing.claim_generation > claimGeneration) {
          throw new StorageConflictError(
            "managed candidate knowledge write recovery claim is held by a newer generation",
          );
        }
        if (existing.claim_generation === claimGeneration) return;
        this.database
          .prepare(
            "UPDATE candidate_knowledge_managed_write_recovery_claims SET claim_generation = ?, claimed_at = ? WHERE operation_id = ?",
          )
          .run(claimGeneration, claimedAt, operationId);
        return;
      }
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_managed_write_recovery_claims (operation_id, phase, claim_generation, claimed_at) VALUES (?, ?, ?, ?)",
        )
        .run(operationId, phaseInput, claimGeneration, claimedAt);
    })();
  }

  public async listManagedCandidateKnowledgeWriteOperations(): Promise<
    readonly ManagedCandidateKnowledgeWriteOperationRecord[]
  > {
    this.ensureOpen();
    const rows = this.database
      .prepare(
        `SELECT operation.operation_id,
                operation.candidate_knowledge_base_id,
                operation.source_id,
                operation.requested_version_id,
                operation.kind,
                operation.created_at,
                operation.owner_kind,
                operation.owner_schema_version,
                operation.owner_generation,
                operation.requested_media_type,
                operation.requested_checksum,
                operation.requested_size_bytes,
                latest.state AS latest_phase,
                latest.target_version_id,
                latest.created_at AS latest_event_created_at,
                staging.device AS staging_device,
                staging.inode AS staging_inode,
                staging.created_at AS staging_created_at,
                claim.phase AS recovery_claim_phase,
                claim.claim_generation AS recovery_claim_generation,
                claim.claimed_at AS recovery_claimed_at
         FROM candidate_knowledge_managed_write_operations AS operation
         LEFT JOIN candidate_knowledge_managed_write_events AS latest
           ON latest.operation_id = operation.operation_id
          AND latest.sequence = (
            SELECT MAX(event.sequence)
            FROM candidate_knowledge_managed_write_events AS event
            WHERE event.operation_id = operation.operation_id
          )
         LEFT JOIN candidate_knowledge_managed_write_staging_identities AS staging
           ON staging.operation_id = operation.operation_id
         LEFT JOIN candidate_knowledge_managed_write_recovery_claims AS claim
           ON claim.operation_id = operation.operation_id
         ORDER BY operation.operation_id`,
      )
      .all();
    return rows.map(managedCandidateKnowledgeWriteOperationFromRow);
  }

  public async terminalizePreparedManagedCandidateKnowledgeWrite(
    operationIdInput: string,
    state: "aborted" | "completed",
    targetVersionIdInput: string,
    createdAtInput: string,
    expectedOwnerGeneration?: number,
    expectedRecoveryClaimGeneration?: number,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      operationIdInput,
      "managed candidate knowledge write operation id",
    ).trim();
    const targetVersionId = requireNonEmpty(
      targetVersionIdInput,
      "managed candidate knowledge write target version id",
    ).trim();
    const createdAt = requireTimestamp(
      createdAtInput,
      "managed candidate knowledge write event createdAt",
    );
    if (state !== "aborted" && state !== "completed") {
      throw new StorageValidationError("Managed candidate knowledge terminal state is invalid.");
    }
    if (expectedOwnerGeneration !== undefined) {
      requirePositive(
        expectedOwnerGeneration,
        "managed candidate knowledge expected owner generation",
      );
    }
    if (expectedRecoveryClaimGeneration !== undefined) {
      requirePositive(
        expectedRecoveryClaimGeneration,
        "managed candidate knowledge expected recovery claim generation",
      );
    }
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      const latest = this.database
        .prepare(
          "SELECT state, target_version_id FROM candidate_knowledge_managed_write_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get<{ readonly state: string; readonly target_version_id: string }>(operationId);
      if (latest?.state === state && latest.target_version_id === targetVersionId) return;
      if (
        expectedOwnerGeneration !== undefined &&
        operation.ownerGeneration !== expectedOwnerGeneration
      ) {
        throw new StorageConflictError(
          "managed candidate knowledge write ownership generation changed during recovery",
        );
      }
      const currentPhase = latest?.state ?? "prepared";
      if (expectedRecoveryClaimGeneration !== undefined) {
        if (
          currentPhase !== "prepared" &&
          currentPhase !== "targeted" &&
          currentPhase !== "published" &&
          currentPhase !== "committed"
        ) {
          throw new StorageConflictError(
            "managed candidate knowledge write recovery claim phase is no longer active",
          );
        }
        this.requireManagedCandidateKnowledgeWriteRecoveryClaim(
          operationId,
          currentPhase,
          expectedRecoveryClaimGeneration,
        );
      } else if (
        this.database
          .prepare(
            "SELECT operation_id FROM candidate_knowledge_managed_write_recovery_claims WHERE operation_id = ?",
          )
          .get(operationId) !== undefined
      ) {
        throw new StorageConflictError("managed candidate knowledge write is claimed for recovery");
      }
      if (state === "aborted") {
        if (latest !== undefined && latest.state !== "targeted" && latest.state !== "published") {
          throw new StorageConflictError(
            "managed candidate knowledge write is not abortable from its current phase",
          );
        }
        if (latest !== undefined && latest.target_version_id !== targetVersionId) {
          throw new StorageConflictError(
            "managed candidate knowledge write abort target does not match its journal",
          );
        }
      } else if (latest?.state !== "committed" || latest.target_version_id !== targetVersionId) {
        throw new StorageConflictError(
          "managed candidate knowledge write is not committed for completion",
        );
      }
      this.insertManagedCandidateKnowledgeWriteEvent(
        operationId,
        state,
        targetVersionId,
        createdAt,
      );
    })();
  }

  public async recordManagedCandidateKnowledgeWriteEvent(
    operationIdInput: string,
    state: Exclude<ManagedCandidateKnowledgeWriteEventState, "committed" | "noop">,
    targetVersionIdInput: string,
    createdAtInput: string,
    expectedOwnerGeneration?: number,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      operationIdInput,
      "managed candidate knowledge write operation id",
    ).trim();
    const targetVersionId = requireNonEmpty(
      targetVersionIdInput,
      "managed candidate knowledge write target version id",
    ).trim();
    if (
      state !== "targeted" &&
      state !== "published" &&
      state !== "completed" &&
      state !== "aborted"
    ) {
      throw new StorageValidationError(
        `Unsupported managed candidate knowledge write event state: ${state}`,
      );
    }
    const createdAt = requireTimestamp(
      createdAtInput,
      "managed candidate knowledge write event createdAt",
    );
    if (expectedOwnerGeneration !== undefined) {
      requirePositive(
        expectedOwnerGeneration,
        "managed candidate knowledge expected owner generation",
      );
    }
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      this.requireManagedCandidateKnowledgeWriteMutationOwner(operation, expectedOwnerGeneration);
      this.insertManagedCandidateKnowledgeWriteEvent(
        operationId,
        state,
        targetVersionId,
        createdAt,
      );
    })();
  }

  public async recordManagedCandidateKnowledgeWriteNoop(
    operationIdInput: string,
    versionInput: CandidateKnowledgeSourceVersionInput,
    expectedCurrentVersionId?: string,
    expectedOriginBoundAt?: string,
    expectedOriginPath?: string,
    expectedOwnerGeneration?: number,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      operationIdInput,
      "managed candidate knowledge write operation id",
    ).trim();
    const requestedVersion = normalizeCandidateKnowledgeSourceVersionInput(versionInput);
    if (expectedOwnerGeneration !== undefined) {
      requirePositive(
        expectedOwnerGeneration,
        "managed candidate knowledge expected owner generation",
      );
    }
    let result: CandidateKnowledgeSourceVersionWriteResult | undefined;
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      this.requireManagedCandidateKnowledgeWriteMutationOwner(operation, expectedOwnerGeneration);
      if (operation.kind !== "append" || requestedVersion.id !== operation.requestedVersionId) {
        throw new StorageConflictError(
          "managed candidate knowledge write noop does not match its intent",
        );
      }
      this.requireManagedCandidateKnowledgeWriteState(operationId, undefined, undefined);
      this.requireActiveCandidateKnowledgeBase(operation.knowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        operation.knowledgeBaseId,
        operation.sourceId,
      );
      if (source.kind !== "file" && source.kind !== "url") {
        throw new StorageValidationError(
          "managed candidate knowledge source versions require a supported source",
        );
      }
      this.requireCandidateKnowledgeSourceActive(operation.sourceId);
      const currentRow = this.database
        .prepare(
          "SELECT id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(operation.sourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${operation.sourceId} has no versions`,
        );
      }
      const current = candidateKnowledgeSourceVersionFromRow(currentRow);
      this.requireManagedCandidateKnowledgeWriteGuards(
        operation,
        source,
        current,
        expectedCurrentVersionId,
        expectedOriginBoundAt,
        expectedOriginPath,
      );
      if (source.kind === "url") {
        const provenance = this.database
          .prepare(
            `SELECT version_id
             FROM candidate_knowledge_source_url_provenance
             WHERE source_id = ? AND version_id = ?
             UNION ALL
             SELECT version_id
             FROM candidate_knowledge_source_restored_url_provenance
             WHERE source_id = ? AND version_id = ?`,
          )
          .get(operation.sourceId, current.id, operation.sourceId, current.id);
        if (provenance === undefined) {
          throw new StorageValidationError(
            "managed candidate knowledge URL noop requires URL provenance",
          );
        }
      }
      if (
        current.checksum !== requestedVersion.checksum ||
        current.mediaType !== requestedVersion.mediaType ||
        current.sizeBytes !== requestedVersion.sizeBytes ||
        !this.hasManagedCandidateKnowledgeSourceVersion(current.id)
      ) {
        throw new StorageConflictError(
          "managed candidate knowledge write noop no longer matches the current managed version",
        );
      }
      if (Date.parse(requestedVersion.createdAt) < Date.parse(current.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source version createdAt must not precede the current version createdAt",
        );
      }
      this.insertManagedCandidateKnowledgeWriteEvent(
        operationId,
        "noop",
        current.id,
        requestedVersion.createdAt,
      );
      result = { source, version: current, created: false };
    })();
    return result as CandidateKnowledgeSourceVersionWriteResult;
  }

  public async commitManagedCandidateKnowledgeWrite(
    input: ManagedCandidateKnowledgeWriteCommitInput,
  ): Promise<CandidateKnowledgeSourceVersionWriteResult> {
    this.ensureOpen();
    const operationId = requireNonEmpty(
      input.operationId,
      "managed candidate knowledge write operation id",
    ).trim();
    const requestedVersion = normalizeCandidateKnowledgeSourceVersionInput(input.version);
    const originPath =
      input.kind === "create" && input.source.kind === "file"
        ? requireAbsolutePath(
            input.originPath ?? "",
            "managed candidate knowledge source origin path",
          )
        : undefined;
    const urlProvenance =
      input.urlProvenance === undefined
        ? undefined
        : normalizeCandidateKnowledgeSourceUrlProvenance(input.urlProvenance);
    if (input.expectedOwnerGeneration !== undefined) {
      requirePositive(
        input.expectedOwnerGeneration,
        "managed candidate knowledge expected owner generation",
      );
    }
    let result: CandidateKnowledgeSourceVersionWriteResult | undefined;
    this.database.transaction(() => {
      const operation = this.requireManagedCandidateKnowledgeWriteOperation(operationId);
      this.requireManagedCandidateKnowledgeWriteMutationOwner(
        operation,
        input.expectedOwnerGeneration,
      );
      if (operation.kind !== input.kind) {
        throw new StorageConflictError(
          "managed candidate knowledge write operation kind does not match its commit",
        );
      }
      if (requestedVersion.id !== operation.requestedVersionId) {
        throw new StorageConflictError(
          "managed candidate knowledge write requested version does not match its intent",
        );
      }
      this.requireActiveCandidateKnowledgeBase(operation.knowledgeBaseId);

      if (input.kind === "create") {
        const source = normalizeCandidateKnowledgeSourceInput(input.source);
        const directoryId =
          input.directoryId === undefined
            ? undefined
            : requireNonEmpty(input.directoryId, "managed candidate knowledge directory id").trim();
        if (
          source.id !== operation.sourceId ||
          source.knowledgeBaseId !== operation.knowledgeBaseId
        ) {
          throw new StorageConflictError(
            "managed candidate knowledge write source does not match its intent",
          );
        }
        if (source.kind !== "file" && source.kind !== "url") {
          throw new StorageValidationError(
            "managed candidate knowledge source versions require a supported source",
          );
        }
        if (Date.parse(requestedVersion.createdAt) < Date.parse(source.createdAt)) {
          throw new StorageValidationError(
            "candidate knowledge source version createdAt must not precede its source createdAt",
          );
        }
        if (
          this.database
            .prepare("SELECT id FROM candidate_knowledge_sources WHERE id = ?")
            .get(source.id) !== undefined
        ) {
          throw new StorageConflictError(`candidate knowledge source ${source.id} already exists`);
        }
        const member =
          directoryId === undefined
            ? undefined
            : this.validateManagedCandidateKnowledgeDirectoryMemberCreate(
                source,
                requestedVersion,
                directoryId,
                originPath,
              );
        this.requireManagedCandidateKnowledgeWriteState(
          operationId,
          "published",
          requestedVersion.id,
        );
        const version: CandidateKnowledgeSourceVersionRecord = {
          ...requestedVersion,
          sourceId: source.id,
          version: 1,
          parentVersionId: null,
        };
        this.insertCandidateKnowledgeSource(source);
        this.insertCandidateKnowledgeSourceVersion(version);
        this.insertManagedCandidateKnowledgeSourceVersion(version.id);
        if (source.kind === "file") {
          if (urlProvenance !== undefined) {
            throw new StorageValidationError(
              "Candidate knowledge source URL provenance is forbidden for file sources",
            );
          }
          this.insertCandidateKnowledgeSourceOriginBinding({
            sourceId: source.id,
            originPath: originPath as string,
            boundAt: requestedVersion.createdAt,
          });
          if (member !== undefined) {
            this.insertCandidateKnowledgeDirectoryMember(member);
          }
        } else {
          if (directoryId !== undefined) {
            throw new StorageValidationError(
              "Managed candidate knowledge directory membership requires a file source",
            );
          }
          if (urlProvenance === undefined) {
            throw new StorageValidationError(
              "Candidate knowledge source URL provenance is required",
            );
          }
          this.insertCandidateKnowledgeSourceUrlProvenance({
            sourceId: source.id,
            versionId: version.id,
            ...urlProvenance,
          });
        }
        this.insertManagedCandidateKnowledgeWriteEvent(
          operationId,
          "committed",
          version.id,
          requestedVersion.createdAt,
        );
        result = { source, version, created: true };
        return;
      }

      const source = this.requireCandidateKnowledgeSource(
        operation.knowledgeBaseId,
        operation.sourceId,
      );
      if (source.kind !== "file" && source.kind !== "url") {
        throw new StorageValidationError(
          "managed candidate knowledge source versions require a supported source",
        );
      }
      if (source.kind === "file" && urlProvenance !== undefined) {
        throw new StorageValidationError(
          "Candidate knowledge source URL provenance is forbidden for file sources",
        );
      }
      if (source.kind === "url" && urlProvenance === undefined) {
        throw new StorageValidationError("Candidate knowledge source URL provenance is required");
      }
      this.requireCandidateKnowledgeSourceActive(operation.sourceId);
      const currentRow = this.database
        .prepare(
          "SELECT id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(operation.sourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${operation.sourceId} has no versions`,
        );
      }
      const current = candidateKnowledgeSourceVersionFromRow(currentRow);
      this.requireManagedCandidateKnowledgeWriteGuards(
        operation,
        source,
        current,
        input.expectedCurrentVersionId,
        input.expectedOriginBoundAt,
        input.expectedOriginPath,
      );
      if (Date.parse(requestedVersion.createdAt) < Date.parse(current.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source version createdAt must not precede the current version createdAt",
        );
      }
      if (current.checksum === requestedVersion.checksum) {
        if (
          current.mediaType !== requestedVersion.mediaType ||
          current.sizeBytes !== requestedVersion.sizeBytes
        ) {
          throw new StorageConflictError(
            "candidate knowledge source version checksum conflicts with its integrity metadata",
          );
        }
        if (source.kind === "url") {
          throw new StorageConflictError(
            "managed candidate knowledge URL write must use the non-owning noop path",
          );
        }
        this.requireManagedCandidateKnowledgeWriteState(operationId, "published", current.id);
        if (this.hasManagedCandidateKnowledgeSourceVersion(current.id)) {
          throw new StorageConflictError(
            "managed candidate knowledge write must use the non-owning noop path",
          );
        }
        this.insertManagedCandidateKnowledgeSourceVersion(current.id);
        this.insertManagedCandidateKnowledgeWriteEvent(
          operationId,
          "committed",
          current.id,
          requestedVersion.createdAt,
        );
        result = { source, version: current, created: false };
        return;
      }

      this.requireManagedCandidateKnowledgeWriteState(
        operationId,
        "published",
        requestedVersion.id,
      );
      const version: CandidateKnowledgeSourceVersionRecord = {
        ...requestedVersion,
        sourceId: operation.sourceId,
        version: current.version + 1,
        parentVersionId: current.id,
      };
      this.insertCandidateKnowledgeSourceVersion(version);
      this.insertManagedCandidateKnowledgeSourceVersion(version.id);
      if (source.kind === "url") {
        this.insertCandidateKnowledgeSourceUrlProvenance({
          sourceId: source.id,
          versionId: version.id,
          ...(urlProvenance as CandidateKnowledgeSourceUrlProvenanceInput),
        });
      }
      this.insertManagedCandidateKnowledgeWriteEvent(
        operationId,
        "committed",
        version.id,
        requestedVersion.createdAt,
      );
      result = { source, version, created: true };
    })();
    return result as CandidateKnowledgeSourceVersionWriteResult;
  }

  public async isCandidateKnowledgeSourceVersionManaged(
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ): Promise<boolean> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedVersionId = requireNonEmpty(
      versionId,
      "candidate knowledge source version id",
    ).trim();
    const row = this.database
      .prepare(
        `SELECT m.version_id
         FROM candidate_knowledge_managed_source_versions AS m
         JOIN candidate_knowledge_source_versions AS v ON v.id = m.version_id
         JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
         WHERE s.candidate_knowledge_base_id = ? AND v.source_id = ? AND v.id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId, normalizedVersionId);
    return row !== undefined;
  }

  public listManagedCandidateKnowledgeSourceVersions(): readonly ManagedCandidateKnowledgeSourceVersionRecord[] {
    this.ensureOpen();
    return this.database
      .prepare(
        `SELECT s.candidate_knowledge_base_id, s.kind,
                v.id, v.source_id, v.version, v.parent_version_id, v.media_type,
                v.checksum, v.size_bytes, v.created_at
         FROM candidate_knowledge_managed_source_versions AS m
         JOIN candidate_knowledge_source_versions AS v ON v.id = m.version_id
         JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
         ORDER BY s.candidate_knowledge_base_id, v.source_id, v.version, v.id`,
      )
      .all()
      .map((row) => ({
        ...candidateKnowledgeSourceVersionFromRow(row),
        knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
        kind: rowString(row, "kind") as CandidateKnowledgeSourceKind,
      }));
  }

  /**
   * Return the database facts that a confirmed CKB deletion binds to its
   * confirmation token. The knowledge-store adapter keeps this internal
   * coordination projection out of its public deletion plan.
   */
  public getCandidateKnowledgeDeletionDatabaseSnapshot(
    knowledgeBaseIdInput: string,
  ): CandidateKnowledgeDeletionDatabaseSnapshot {
    this.ensureOpen();
    const knowledgeBaseId = requireNonEmpty(
      knowledgeBaseIdInput,
      "candidate knowledge base deletion knowledge base id",
    ).trim();
    const knowledgeBase = this.requireCandidateKnowledgeBase(knowledgeBaseId);
    const policy = this.readCandidateKnowledgeRetentionPolicy(knowledgeBaseId);
    const sources = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, kind, display_name, created_at
         FROM candidate_knowledge_sources
         WHERE candidate_knowledge_base_id = ?
         ORDER BY id`,
      )
      .all(knowledgeBaseId);
    const versions = this.database
      .prepare(
        `SELECT version.id, version.source_id, version.version, version.parent_version_id,
                version.media_type, version.checksum, version.size_bytes, version.created_at
         FROM candidate_knowledge_source_versions AS version
         JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
         WHERE source.candidate_knowledge_base_id = ?
         ORDER BY version.source_id, version.version, version.id`,
      )
      .all(knowledgeBaseId);
    const managedVersions = this.database
      .prepare(
        `SELECT managed.version_id, version.source_id, source.kind,
                version.checksum, version.size_bytes
         FROM candidate_knowledge_managed_source_versions AS managed
         JOIN candidate_knowledge_source_versions AS version
           ON version.id = managed.version_id
         JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
         WHERE source.candidate_knowledge_base_id = ?
         ORDER BY version.source_id, version.version, version.id`,
      )
      .all(knowledgeBaseId);
    const managedKeys = new Set(
      managedVersions.map(
        (row) => `${rowString(row, "source_id")}\u0000${rowString(row, "version_id")}`,
      ),
    );
    const sourceIds = new Set(sources.map((row) => rowString(row, "id")));
    const versionRecords = versions.map((row) => ({
      sourceId: rowString(row, "source_id"),
      versionId: rowString(row, "id"),
    }));
    const unmanagedVersionCount = versionRecords.filter(
      (version) => !managedKeys.has(`${version.sourceId}\u0000${version.versionId}`),
    ).length;
    const versionsBySource = new Map<string, number>();
    for (const version of versionRecords) {
      versionsBySource.set(version.sourceId, (versionsBySource.get(version.sourceId) ?? 0) + 1);
    }
    const unmanagedSourceCount = [...sourceIds].filter(
      (sourceId) =>
        (versionsBySource.get(sourceId) ?? 0) === 0 ||
        versionRecords.some(
          (version) =>
            version.sourceId === sourceId &&
            !managedKeys.has(`${version.sourceId}\u0000${version.versionId}`),
        ),
    ).length;
    const pendingOperationRow = this.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM candidate_knowledge_managed_write_operations AS operation
         LEFT JOIN candidate_knowledge_managed_write_events AS event
           ON event.operation_id = operation.operation_id
          AND event.sequence = (
            SELECT MAX(latest.sequence)
            FROM candidate_knowledge_managed_write_events AS latest
            WHERE latest.operation_id = operation.operation_id
          )
         WHERE operation.candidate_knowledge_base_id = ?
           AND COALESCE(event.state, 'prepared') NOT IN ('completed', 'aborted', 'noop')`,
      )
      .get<{ readonly count: number }>(knowledgeBaseId);

    // Keep every CKB-owned persisted row in the digest. Values such as source
    // names, origins, and URLs are internal token material and never leave the
    // storage boundary as part of the public deletion plan.
    const graph = {
      knowledgeBase: this.database
        .prepare(
          `SELECT id, display_name, description, state, is_default,
                  created_at, updated_at, archived_at
           FROM candidate_knowledge_bases WHERE id = ?`,
        )
        .all(knowledgeBaseId),
      sources,
      versions,
      managedVersions: this.database
        .prepare(
          `SELECT managed.version_id
           FROM candidate_knowledge_managed_source_versions AS managed
           JOIN candidate_knowledge_source_versions AS version
             ON version.id = managed.version_id
           JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
           WHERE source.candidate_knowledge_base_id = ?
           ORDER BY managed.version_id`,
        )
        .all(knowledgeBaseId),
      writeOperations: this.database
        .prepare(
          `SELECT operation.operation_id, operation.candidate_knowledge_base_id,
                  operation.source_id, operation.requested_version_id, operation.kind,
                  operation.created_at, operation.owner_kind, operation.owner_schema_version,
                  operation.owner_generation, operation.requested_media_type,
                  operation.requested_checksum, operation.requested_size_bytes
           FROM candidate_knowledge_managed_write_operations AS operation
           WHERE operation.candidate_knowledge_base_id = ?
           ORDER BY operation.operation_id`,
        )
        .all(knowledgeBaseId),
      writeEvents: this.database
        .prepare(
          `SELECT event.operation_id, event.sequence, event.state,
                  event.target_version_id, event.created_at
           FROM candidate_knowledge_managed_write_events AS event
           JOIN candidate_knowledge_managed_write_operations AS operation
             ON operation.operation_id = event.operation_id
           WHERE operation.candidate_knowledge_base_id = ?
           ORDER BY event.operation_id, event.sequence`,
        )
        .all(knowledgeBaseId),
      writeStaging: this.database
        .prepare(
          `SELECT staging.operation_id, staging.device, staging.inode, staging.created_at
           FROM candidate_knowledge_managed_write_staging_identities AS staging
           JOIN candidate_knowledge_managed_write_operations AS operation
             ON operation.operation_id = staging.operation_id
           WHERE operation.candidate_knowledge_base_id = ?
           ORDER BY staging.operation_id`,
        )
        .all(knowledgeBaseId),
      writeClaims: this.database
        .prepare(
          `SELECT claim.operation_id, claim.phase, claim.claim_generation, claim.claimed_at
           FROM candidate_knowledge_managed_write_recovery_claims AS claim
           JOIN candidate_knowledge_managed_write_operations AS operation
             ON operation.operation_id = claim.operation_id
           WHERE operation.candidate_knowledge_base_id = ?
           ORDER BY claim.operation_id`,
        )
        .all(knowledgeBaseId),
      origins: this.database
        .prepare(
          `SELECT binding.source_id, binding.origin_path, binding.bound_at
           FROM candidate_knowledge_source_origin_bindings AS binding
           JOIN candidate_knowledge_sources AS source ON source.id = binding.source_id
           WHERE source.candidate_knowledge_base_id = ?
           ORDER BY binding.source_id`,
        )
        .all(knowledgeBaseId),
      observations: this.database
        .prepare(
          `SELECT observation.source_id, observation.observed_version_id, observation.status,
                  observation.checked_at, observation.last_refreshed_version_id,
                  observation.last_refreshed_at
           FROM candidate_knowledge_source_refresh_observations AS observation
           JOIN candidate_knowledge_sources AS source ON source.id = observation.source_id
           WHERE source.candidate_knowledge_base_id = ?
           ORDER BY observation.source_id`,
        )
        .all(knowledgeBaseId),
      retirements: this.database
        .prepare(
          `SELECT retirement.source_id, retirement.retired_at, retirement.reason
           FROM candidate_knowledge_source_retirements AS retirement
           JOIN candidate_knowledge_sources AS source ON source.id = retirement.source_id
           WHERE source.candidate_knowledge_base_id = ?
           ORDER BY retirement.source_id`,
        )
        .all(knowledgeBaseId),
      urlProvenance: this.database
        .prepare(
          `SELECT provenance.version_id, provenance.source_id, provenance.original_url,
                  provenance.final_url, provenance.fetched_at, provenance.kind
           FROM candidate_knowledge_source_url_provenance AS provenance
           JOIN candidate_knowledge_sources AS source ON source.id = provenance.source_id
           WHERE source.candidate_knowledge_base_id = ?
           ORDER BY provenance.source_id, provenance.version_id`,
        )
        .all(knowledgeBaseId),
      restoredUrlProvenance: this.database
        .prepare(
          `SELECT provenance.version_id, provenance.source_id,
                  provenance.fetched_at, provenance.kind
           FROM candidate_knowledge_source_restored_url_provenance AS provenance
           JOIN candidate_knowledge_sources AS source ON source.id = provenance.source_id
           WHERE source.candidate_knowledge_base_id = ?
           ORDER BY provenance.source_id, provenance.version_id`,
        )
        .all(knowledgeBaseId),
      directoryBindings: this.database
        .prepare(
          `SELECT id, candidate_knowledge_base_id, root_path, bound_at
           FROM candidate_knowledge_directory_bindings
           WHERE candidate_knowledge_base_id = ?
           ORDER BY id`,
        )
        .all(knowledgeBaseId),
      directoryRoots: this.database
        .prepare(
          `SELECT directory_id, candidate_knowledge_base_id, revision, root_path, bound_at
           FROM candidate_knowledge_directory_root_revisions
           WHERE candidate_knowledge_base_id = ?
           ORDER BY directory_id, revision`,
        )
        .all(knowledgeBaseId),
      directoryMembers: this.database
        .prepare(
          `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
           FROM candidate_knowledge_directory_members
           WHERE candidate_knowledge_base_id = ?
           ORDER BY directory_id, source_id`,
        )
        .all(knowledgeBaseId),
      directoryMemberRevisions: this.database
        .prepare(
          `SELECT directory_id, candidate_knowledge_base_id, source_id, revision,
                  relative_path_hash, bound_at
           FROM candidate_knowledge_directory_member_revisions
           WHERE candidate_knowledge_base_id = ?
           ORDER BY directory_id, source_id, revision`,
        )
        .all(knowledgeBaseId),
      retentionPolicies: this.database
        .prepare(
          `SELECT knowledge_base_id, revision, retention_class, rule,
                  expire_after_days, updated_at
           FROM candidate_knowledge_retention_policy_events
           WHERE knowledge_base_id = ?
           ORDER BY revision, retention_class`,
        )
        .all(knowledgeBaseId),
      retentionOverrides: this.database
        .prepare(
          `SELECT knowledge_base_id, retention_class, override_kind, sequence,
                  state, override_revision, policy_revision, changed_at
           FROM candidate_knowledge_retention_override_events
           WHERE knowledge_base_id = ?
           ORDER BY retention_class, override_kind, sequence`,
        )
        .all(knowledgeBaseId),
      retentionOverrideSnapshots: this.database
        .prepare(
          `SELECT knowledge_base_id, override_revision
           FROM candidate_knowledge_retention_override_revision_snapshots
           WHERE knowledge_base_id = ?`,
        )
        .all(knowledgeBaseId),
    };
    const graphDigest = checksum(serialize(recordToJson(graph)));
    const managedArtifacts = managedVersions.map((row) => ({
      sourceId: rowString(row, "source_id"),
      versionId: rowString(row, "version_id"),
      checksum: rowString(row, "checksum"),
      sizeBytes: rowNumber(row, "size_bytes"),
    }));
    return Object.freeze({
      knowledgeBaseId,
      state: knowledgeBase.state,
      isDefault: knowledgeBase.isDefault,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      archivedAt: knowledgeBase.archivedAt,
      policy,
      graphDigest,
      sourceCount: sources.length,
      versionCount: versions.length,
      managedArtifacts: Object.freeze(managedArtifacts.map((artifact) => Object.freeze(artifact))),
      unmanagedSourceCount,
      unmanagedVersionCount,
      pendingOperationCount: Number(pendingOperationRow?.count ?? 0),
    });
  }

  public async beginCandidateKnowledgeDeletion(
    input: CandidateKnowledgeDeletionOperationInput,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireSha256(
      input.operationId,
      "candidate knowledge deletion operation id",
    );
    const knowledgeBaseId = requireNonEmpty(
      input.knowledgeBaseId,
      "candidate knowledge deletion knowledge base id",
    ).trim();
    const confirmationToken = requireSha256(
      input.confirmationToken,
      "candidate knowledge deletion confirmation token",
    );
    const graphDigest = requireSha256(
      input.graphDigest,
      "candidate knowledge deletion graph digest",
    );
    const createdAt = requireTimestamp(input.createdAt, "candidate knowledge deletion createdAt");
    const managedArtifactCount = requireBoundedDeletionCount(
      input.managedArtifactCount,
      "candidate knowledge deletion managed artifact count",
    );
    const managedArtifactBytes = requireNonNegativeInteger(
      input.managedArtifactBytes,
      "candidate knowledge deletion managed artifact bytes",
    );
    const preservedUnknownCount = requireBoundedDeletionCount(
      input.preservedUnknownCount,
      "candidate knowledge deletion preserved unknown count",
    );
    const preservedUnmanagedCount = requireBoundedDeletionCount(
      input.preservedUnmanagedCount,
      "candidate knowledge deletion preserved unmanaged count",
    );
    if (typeof input.countCapped !== "boolean") {
      throw new StorageValidationError("candidate knowledge deletion count capped is invalid");
    }
    if (!Array.isArray(input.artifacts)) {
      throw new StorageValidationError("candidate knowledge deletion artifacts are required");
    }
    const artifacts = input.artifacts.map((artifact) => ({
      sourceId: requireNonEmpty(artifact.sourceId, "candidate knowledge deletion source id").trim(),
      versionId: requireNonEmpty(
        artifact.versionId,
        "candidate knowledge deletion version id",
      ).trim(),
      checksum: requireSha256(artifact.checksum, "candidate knowledge deletion artifact checksum"),
      sizeBytes: requireNonNegativeInteger(
        artifact.sizeBytes,
        "candidate knowledge deletion artifact size",
      ),
      device: requireNonNegativeInteger(
        artifact.device,
        "candidate knowledge deletion artifact device",
      ),
      inode: requireNonNegativeInteger(
        artifact.inode,
        "candidate knowledge deletion artifact inode",
      ),
    }));
    if (artifacts.length !== managedArtifactCount) {
      throw new StorageConflictError("candidate knowledge deletion artifact count changed");
    }
    const artifactBytes = artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
    if (artifactBytes !== managedArtifactBytes) {
      throw new StorageConflictError("candidate knowledge deletion artifact sizes changed");
    }
    const artifactKeys = new Set<string>();
    for (const artifact of artifacts) {
      const key = `${artifact.sourceId}\u0000${artifact.versionId}`;
      if (artifactKeys.has(key)) {
        throw new StorageConflictError("candidate knowledge deletion artifacts are not unique");
      }
      artifactKeys.add(key);
    }
    this.database.transaction(() => {
      const snapshot = this.getCandidateKnowledgeDeletionDatabaseSnapshot(knowledgeBaseId);
      if (snapshot.state !== "archived" || snapshot.isDefault) {
        throw new StorageConflictError(
          "candidate knowledge base is not an archived non-default target",
        );
      }
      if (
        snapshot.policy.activeOverrides.some(
          (override) => override.kind === "legal-hold" || override.kind === "manual-preservation",
        )
      ) {
        throw new StorageConflictError(
          "candidate knowledge deletion is blocked by an active preservation override",
        );
      }
      if (snapshot.graphDigest !== graphDigest) {
        throw new StorageConflictError("candidate knowledge deletion confirmation is stale");
      }
      if (snapshot.pendingOperationCount > 0) {
        throw new StorageConflictError(
          "candidate knowledge deletion has an unfinished managed write",
        );
      }
      if (
        snapshot.unmanagedSourceCount > 0 ||
        snapshot.unmanagedVersionCount > 0 ||
        snapshot.managedArtifacts.length !== artifacts.length
      ) {
        throw new StorageConflictError(
          "candidate knowledge deletion contains unmanaged database records",
        );
      }
      const expectedArtifacts = new Map(
        snapshot.managedArtifacts.map((artifact) => [
          `${artifact.sourceId}\u0000${artifact.versionId}`,
          artifact,
        ]),
      );
      for (const artifact of artifacts) {
        const expected = expectedArtifacts.get(`${artifact.sourceId}\u0000${artifact.versionId}`);
        if (
          expected === undefined ||
          expected.checksum !== artifact.checksum ||
          expected.sizeBytes !== artifact.sizeBytes
        ) {
          throw new StorageConflictError("candidate knowledge deletion artifact inventory changed");
        }
      }
      const existingRow = this.database
        .prepare(
          `SELECT operation_id, knowledge_base_id, confirmation_token, graph_digest, phase,
                  created_at, committed_at, completed_at, staging_device, staging_inode,
                  managed_artifact_count, managed_artifact_bytes, preserved_unknown_count,
                  preserved_unmanaged_count, count_capped
           FROM candidate_knowledge_deletion_operations
           WHERE operation_id = ? OR confirmation_token = ?`,
        )
        .get(operationId, confirmationToken);
      if (existingRow !== undefined) {
        const existingOperation = this.requireCandidateKnowledgeDeletionOperation(
          rowString(existingRow, "operation_id"),
        );
        if (
          existingOperation.operationId !== operationId ||
          existingOperation.knowledgeBaseId !== knowledgeBaseId ||
          existingOperation.confirmationToken !== confirmationToken ||
          existingOperation.graphDigest !== graphDigest ||
          existingOperation.managedArtifactCount !== managedArtifactCount ||
          existingOperation.managedArtifactBytes !== managedArtifactBytes ||
          existingOperation.preservedUnknownCount !== preservedUnknownCount ||
          existingOperation.preservedUnmanagedCount !== preservedUnmanagedCount ||
          existingOperation.countCapped !== input.countCapped ||
          existingOperation.artifacts.length !== artifacts.length ||
          existingOperation.artifacts.some((artifact, index) => {
            const current = artifacts[index];
            return (
              current === undefined ||
              artifact.sourceId !== current.sourceId ||
              artifact.versionId !== current.versionId ||
              artifact.checksum !== current.checksum ||
              artifact.sizeBytes !== current.sizeBytes ||
              artifact.device !== current.device ||
              artifact.inode !== current.inode
            );
          })
        ) {
          throw new StorageConflictError("candidate knowledge deletion operation is mismatched");
        }
        if (existingOperation.phase !== "aborted") {
          throw new StorageConflictError("candidate knowledge deletion operation already exists");
        }
        this.database
          .prepare(
            `UPDATE candidate_knowledge_deletion_operations
             SET phase = 'prepared', staging_device = NULL, staging_inode = NULL
             WHERE operation_id = ? AND phase = 'aborted'`,
          )
          .run(operationId);
        return;
      }
      this.database
        .prepare(
          `INSERT INTO candidate_knowledge_deletion_operations
           (operation_id, knowledge_base_id, confirmation_token, graph_digest, phase,
            created_at, committed_at, completed_at, staging_device, staging_inode,
            managed_artifact_count, managed_artifact_bytes, preserved_unknown_count,
            preserved_unmanaged_count, count_capped)
           VALUES (?, ?, ?, ?, 'prepared', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(
          operationId,
          knowledgeBaseId,
          confirmationToken,
          graphDigest,
          createdAt,
          managedArtifactCount,
          managedArtifactBytes,
          preservedUnknownCount,
          preservedUnmanagedCount,
          input.countCapped ? 1 : 0,
        );
      const insertArtifact = this.database.prepare(
        `INSERT INTO candidate_knowledge_deletion_artifacts
         (operation_id, source_id, version_id, checksum, size_bytes, device, inode)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const artifact of artifacts) {
        insertArtifact.run(
          operationId,
          artifact.sourceId,
          artifact.versionId,
          artifact.checksum,
          artifact.sizeBytes,
          artifact.device,
          artifact.inode,
        );
      }
    })();
  }

  public async stageCandidateKnowledgeDeletion(
    operationIdInput: string,
    stagingDeviceInput: number,
    stagingInodeInput: number,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireSha256(
      operationIdInput,
      "candidate knowledge deletion operation id",
    );
    const stagingDevice = requireNonNegativeInteger(
      stagingDeviceInput,
      "candidate knowledge deletion staging device",
    );
    const stagingInode = requireNonNegativeInteger(
      stagingInodeInput,
      "candidate knowledge deletion staging inode",
    );
    this.database.transaction(() => {
      const operation = this.requireCandidateKnowledgeDeletionOperation(operationId);
      if (operation.phase !== "prepared") {
        throw new StorageConflictError("candidate knowledge deletion is not prepared for staging");
      }
      this.database
        .prepare(
          `UPDATE candidate_knowledge_deletion_operations
           SET phase = 'staging', staging_device = ?, staging_inode = ?
           WHERE operation_id = ? AND phase = 'prepared'`,
        )
        .run(stagingDevice, stagingInode, operationId);
    })();
  }

  public async listCandidateKnowledgeDeletionOperations(): Promise<
    readonly CandidateKnowledgeDeletionOperationRecord[]
  > {
    this.ensureOpen();
    const rows = this.database
      .prepare(
        `SELECT operation_id, knowledge_base_id, confirmation_token, graph_digest, phase,
                created_at, committed_at, completed_at, staging_device, staging_inode,
                managed_artifact_count, managed_artifact_bytes, preserved_unknown_count,
                preserved_unmanaged_count, count_capped
         FROM candidate_knowledge_deletion_operations
         ORDER BY operation_id`,
      )
      .all();
    const artifacts = this.database.prepare(
      `SELECT operation_id, source_id, version_id, checksum, size_bytes, device, inode
       FROM candidate_knowledge_deletion_artifacts
       WHERE operation_id = ?
       ORDER BY source_id, version_id`,
    );
    return rows.map((row) =>
      candidateKnowledgeDeletionOperationFromRow(
        row,
        artifacts.all(rowString(row, "operation_id")),
      ),
    );
  }

  public async commitCandidateKnowledgeDeletion(
    input: CandidateKnowledgeDeletionCommitInput,
  ): Promise<void> {
    this.ensureOpen();
    const operationId = requireSha256(
      input.operationId,
      "candidate knowledge deletion operation id",
    );
    const knowledgeBaseId = requireNonEmpty(
      input.knowledgeBaseId,
      "candidate knowledge deletion knowledge base id",
    ).trim();
    const confirmationToken = requireSha256(
      input.confirmationToken,
      "candidate knowledge deletion confirmation token",
    );
    const graphDigest = requireSha256(
      input.graphDigest,
      "candidate knowledge deletion graph digest",
    );
    const committedAt = requireTimestamp(
      input.committedAt,
      "candidate knowledge deletion committedAt",
    );
    this.database.transaction(() => {
      const operation = this.requireCandidateKnowledgeDeletionOperation(operationId);
      if (
        operation.knowledgeBaseId !== knowledgeBaseId ||
        operation.confirmationToken !== confirmationToken ||
        operation.graphDigest !== graphDigest
      ) {
        throw new StorageConflictError("candidate knowledge deletion confirmation is mismatched");
      }
      if (operation.phase !== "staging") {
        throw new StorageConflictError("candidate knowledge deletion is not staged");
      }
      const snapshot = this.getCandidateKnowledgeDeletionDatabaseSnapshot(knowledgeBaseId);
      if (snapshot.state !== "archived" || snapshot.isDefault) {
        throw new StorageConflictError(
          "candidate knowledge base lifecycle changed during deletion",
        );
      }
      if (
        snapshot.policy.activeOverrides.some(
          (override) => override.kind === "legal-hold" || override.kind === "manual-preservation",
        )
      ) {
        throw new StorageConflictError(
          "candidate knowledge deletion is blocked by an active preservation override",
        );
      }
      if (snapshot.graphDigest !== graphDigest) {
        throw new StorageConflictError("candidate knowledge deletion confirmation is stale");
      }
      if (snapshot.pendingOperationCount > 0) {
        throw new StorageConflictError(
          "candidate knowledge deletion has an unfinished managed write",
        );
      }
      if (snapshot.unmanagedSourceCount > 0 || snapshot.unmanagedVersionCount > 0) {
        throw new StorageConflictError(
          "candidate knowledge deletion contains unmanaged database records",
        );
      }
      dropCandidateKnowledgeDeletionImmutableDeleteTriggers(this.database);
      try {
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_directory_member_revisions
             WHERE candidate_knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_directory_members
             WHERE candidate_knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_directory_root_revisions
             WHERE candidate_knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_directory_bindings
             WHERE candidate_knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_source_refresh_observations
             WHERE source_id IN (
               SELECT id FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_source_retirements
             WHERE source_id IN (
               SELECT id FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_source_origin_bindings
             WHERE source_id IN (
               SELECT id FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_source_url_provenance
             WHERE source_id IN (
               SELECT id FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_source_restored_url_provenance
             WHERE source_id IN (
               SELECT id FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_managed_write_recovery_claims
             WHERE operation_id IN (
               SELECT operation_id FROM candidate_knowledge_managed_write_operations
               WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_managed_write_staging_identities
             WHERE operation_id IN (
               SELECT operation_id FROM candidate_knowledge_managed_write_operations
               WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_managed_write_events
             WHERE operation_id IN (
               SELECT operation_id FROM candidate_knowledge_managed_write_operations
               WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_managed_write_operations
             WHERE candidate_knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_managed_source_versions
             WHERE version_id IN (
               SELECT version.id
               FROM candidate_knowledge_source_versions AS version
               JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
               WHERE source.candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_source_versions
             WHERE source_id IN (
               SELECT id FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ?
             )`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(`DELETE FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ?`)
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_retention_override_events
             WHERE knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_retention_override_revision_snapshots
             WHERE knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        this.database
          .prepare(
            `DELETE FROM candidate_knowledge_retention_policy_events
             WHERE knowledge_base_id = ?`,
          )
          .run(knowledgeBaseId);
        const removed = this.database
          .prepare("DELETE FROM candidate_knowledge_bases WHERE id = ?")
          .run(knowledgeBaseId);
        if (removed.changes !== 1) {
          throw new StorageConflictError("candidate knowledge base disappeared during deletion");
        }
        this.database
          .prepare(
            `UPDATE candidate_knowledge_deletion_operations
             SET phase = 'committed', committed_at = ?
             WHERE operation_id = ? AND phase = 'staging'`,
          )
          .run(committedAt, operationId);
      } finally {
        recreateCandidateKnowledgeDeletionImmutableDeleteTriggers(this.database);
      }
    })();
  }

  public async completeCandidateKnowledgeDeletion(
    operationIdInput: string,
    completedAtInput: string,
  ): Promise<CandidateKnowledgeDeletionAuditRecord> {
    this.ensureOpen();
    const operationId = requireSha256(
      operationIdInput,
      "candidate knowledge deletion operation id",
    );
    const completedAt = requireTimestamp(
      completedAtInput,
      "candidate knowledge deletion completedAt",
    );
    let result: CandidateKnowledgeDeletionAuditRecord | undefined;
    this.database.transaction(() => {
      const operation = this.requireCandidateKnowledgeDeletionOperation(operationId);
      if (operation.phase === "completed") {
        const existing = this.database
          .prepare(
            `SELECT audit_id, operation_id, knowledge_base_id, confirmation_token, status,
                    created_at, completed_at, managed_artifact_count, managed_artifact_bytes,
                    preserved_unknown_count, preserved_unmanaged_count, count_capped
             FROM candidate_knowledge_deletion_audits WHERE operation_id = ?`,
          )
          .get(operationId);
        if (existing === undefined) {
          throw new StorageConflictError("candidate knowledge deletion audit is missing");
        }
        result = candidateKnowledgeDeletionAuditFromRow(existing);
        return;
      }
      if (operation.phase !== "committed") {
        throw new StorageConflictError("candidate knowledge deletion is not logically committed");
      }
      this.database
        .prepare(
          `UPDATE candidate_knowledge_deletion_operations
           SET phase = 'completed', completed_at = ?
           WHERE operation_id = ? AND phase = 'committed'`,
        )
        .run(completedAt, operationId);
      const auditId = checksum(`${operation.operationId}\u0000${operation.confirmationToken}`);
      this.database
        .prepare(
          `INSERT INTO candidate_knowledge_deletion_audits
           (audit_id, operation_id, knowledge_base_id, confirmation_token, status,
            created_at, completed_at, managed_artifact_count, managed_artifact_bytes,
            preserved_unknown_count, preserved_unmanaged_count, count_capped)
           VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          auditId,
          operation.operationId,
          operation.knowledgeBaseId,
          operation.confirmationToken,
          operation.createdAt,
          completedAt,
          operation.managedArtifactCount,
          operation.managedArtifactBytes,
          operation.preservedUnknownCount,
          operation.preservedUnmanagedCount,
          operation.countCapped ? 1 : 0,
        );
      const inserted = this.database
        .prepare(
          `SELECT audit_id, operation_id, knowledge_base_id, confirmation_token, status,
                  created_at, completed_at, managed_artifact_count, managed_artifact_bytes,
                  preserved_unknown_count, preserved_unmanaged_count, count_capped
           FROM candidate_knowledge_deletion_audits WHERE operation_id = ?`,
        )
        .get(operationId);
      if (inserted === undefined) {
        throw new StorageConflictError("candidate knowledge deletion audit could not be retained");
      }
      result = candidateKnowledgeDeletionAuditFromRow(inserted);
    })();
    return result as CandidateKnowledgeDeletionAuditRecord;
  }

  public async abortCandidateKnowledgeDeletion(operationIdInput: string): Promise<void> {
    this.ensureOpen();
    const operationId = requireSha256(
      operationIdInput,
      "candidate knowledge deletion operation id",
    );
    this.database.transaction(() => {
      const operation = this.requireCandidateKnowledgeDeletionOperation(operationId);
      if (operation.phase === "aborted") return;
      if (operation.phase !== "prepared" && operation.phase !== "staging") {
        throw new StorageConflictError("candidate knowledge deletion cannot be aborted");
      }
      this.database
        .prepare(
          `UPDATE candidate_knowledge_deletion_operations
           SET phase = 'aborted', staging_device = NULL, staging_inode = NULL
           WHERE operation_id = ?`,
        )
        .run(operationId);
    })();
  }

  public async getCandidateKnowledgeDeletionAuditByToken(
    confirmationTokenInput: string,
  ): Promise<CandidateKnowledgeDeletionAuditRecord | undefined> {
    this.ensureOpen();
    const confirmationToken = requireSha256(
      confirmationTokenInput,
      "candidate knowledge deletion confirmation token",
    );
    const row = this.database
      .prepare(
        `SELECT audit_id, operation_id, knowledge_base_id, confirmation_token, status,
                created_at, completed_at, managed_artifact_count, managed_artifact_bytes,
                preserved_unknown_count, preserved_unmanaged_count, count_capped
         FROM candidate_knowledge_deletion_audits
         WHERE confirmation_token = ?`,
      )
      .get(confirmationToken);
    return row === undefined ? undefined : candidateKnowledgeDeletionAuditFromRow(row);
  }

  public async getCandidateKnowledgeRetentionPolicy(
    knowledgeBaseIdInput: string,
  ): Promise<CandidateKnowledgeRetentionPolicyRecord> {
    this.ensureOpen();
    const knowledgeBaseId = requireNonEmpty(
      knowledgeBaseIdInput,
      "candidate knowledge base id",
    ).trim();
    this.requireCandidateKnowledgeBase(knowledgeBaseId);
    return this.readCandidateKnowledgeRetentionPolicy(knowledgeBaseId);
  }

  /** Effective policy state for a deterministic enforcement timestamp. */
  public async getCandidateKnowledgeRetentionPolicyAtAsOf(
    knowledgeBaseIdInput: string,
    asOfInput: string,
  ): Promise<CandidateKnowledgeRetentionPolicyRecord> {
    this.ensureOpen();
    const knowledgeBaseId = requireNonEmpty(
      knowledgeBaseIdInput,
      "candidate knowledge base id",
    ).trim();
    const asOf = requireRetentionTimestampNotFuture(
      asOfInput,
      "candidate knowledge retention asOf",
    );
    return this.readCandidateKnowledgeRetentionPolicyAtAsOf(knowledgeBaseId, asOf);
  }

  public async setCandidateKnowledgeRetentionPolicy(
    knowledgeBaseIdInput: string,
    input: CandidateKnowledgeRetentionPolicyUpdateInput,
  ): Promise<CandidateKnowledgeRetentionPolicyRecord> {
    this.ensureOpen();
    const knowledgeBaseId = requireNonEmpty(
      knowledgeBaseIdInput,
      "candidate knowledge base id",
    ).trim();
    const normalized = normalizeCandidateKnowledgeRetentionPolicyUpdateInput(input);
    this.database.transaction(() => {
      const current = this.readCandidateKnowledgeRetentionPolicy(knowledgeBaseId);
      if (current.revision !== normalized.expectedRevision) {
        throw new StorageConflictError(
          "candidate knowledge retention policy revision changed during update",
        );
      }
      if (Date.parse(normalized.updatedAt) < Date.parse(current.updatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge retention policy updatedAt must not move backwards",
        );
      }
      const revision = current.revision + 1;
      const insert = this.database.prepare(
        "INSERT INTO candidate_knowledge_retention_policy_events (knowledge_base_id, revision, retention_class, rule, expire_after_days, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const policy of normalized.classes) {
        insert.run(
          knowledgeBaseId,
          revision,
          policy.class,
          policy.rule,
          policy.expireAfterDays,
          normalized.updatedAt,
        );
      }
    })();
    return this.readCandidateKnowledgeRetentionPolicy(knowledgeBaseId);
  }

  public async applyCandidateKnowledgeRetentionOverride(
    knowledgeBaseIdInput: string,
    input: CandidateKnowledgeRetentionOverrideInput,
  ): Promise<CandidateKnowledgeRetentionPolicyRecord> {
    return this.writeCandidateKnowledgeRetentionOverride(
      knowledgeBaseIdInput,
      normalizeCandidateKnowledgeRetentionOverrideInput(input),
      "applied",
    );
  }

  public async releaseCandidateKnowledgeRetentionOverride(
    knowledgeBaseIdInput: string,
    input: CandidateKnowledgeRetentionOverrideInput,
  ): Promise<CandidateKnowledgeRetentionPolicyRecord> {
    return this.writeCandidateKnowledgeRetentionOverride(
      knowledgeBaseIdInput,
      normalizeCandidateKnowledgeRetentionOverrideInput(input),
      "released",
    );
  }

  public async getCandidateKnowledgeSourceUrlProvenance(
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ): Promise<CandidateKnowledgeSourceUrlProvenanceRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedVersionId = requireNonEmpty(
      versionId,
      "candidate knowledge source version id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT provenance.source_id, provenance.version_id, provenance.original_url,
                provenance.final_url, provenance.fetched_at, provenance.kind
         FROM candidate_knowledge_source_url_provenance AS provenance
         JOIN candidate_knowledge_sources AS source ON source.id = provenance.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND provenance.source_id = ?
           AND provenance.version_id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId, normalizedVersionId);
    return row === undefined ? undefined : candidateKnowledgeSourceUrlProvenanceFromRow(row);
  }

  public async getCandidateKnowledgeSourcePortableUrlProvenance(
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ): Promise<CandidateKnowledgeSourcePortableUrlProvenance | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedVersionId = requireNonEmpty(
      versionId,
      "candidate knowledge source version id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT provenance.fetched_at, provenance.kind
         FROM candidate_knowledge_source_url_provenance AS provenance
         JOIN candidate_knowledge_sources AS source ON source.id = provenance.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND provenance.source_id = ?
           AND provenance.version_id = ?
         UNION ALL
         SELECT provenance.fetched_at, provenance.kind
         FROM candidate_knowledge_source_restored_url_provenance AS provenance
         JOIN candidate_knowledge_sources AS source ON source.id = provenance.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND provenance.source_id = ?
           AND provenance.version_id = ?`,
      )
      .get(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
        normalizedVersionId,
        normalizedKnowledgeBaseId,
        normalizedSourceId,
        normalizedVersionId,
      );
    if (row === undefined) return undefined;
    return {
      fetchedAt: requireTimestamp(
        rowString(row, "fetched_at"),
        "candidate knowledge URL fetchedAt",
      ),
      kind: rowString(row, "kind") as CandidateKnowledgeSourceUrlKind,
    };
  }

  public async getCandidateKnowledgeSource(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ? AND id = ?",
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    return row === undefined ? undefined : candidateKnowledgeSourceFromRow(row);
  }

  public async getCandidateKnowledgeSourceOriginBinding(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceOriginBindingRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT binding.source_id, binding.origin_path, binding.bound_at
         FROM candidate_knowledge_source_origin_bindings AS binding
         JOIN candidate_knowledge_sources AS source ON source.id = binding.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND source.id = ?
           AND source.kind = 'file'
           AND EXISTS (
             SELECT 1
             FROM candidate_knowledge_source_versions AS version
             JOIN candidate_knowledge_managed_source_versions AS managed
               ON managed.version_id = version.id
             WHERE version.source_id = source.id
           )`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    return row === undefined ? undefined : candidateKnowledgeSourceOriginBindingFromRow(row);
  }

  public async createCandidateKnowledgeDirectoryBinding(
    input: CandidateKnowledgeDirectoryBindingInput,
  ): Promise<CandidateKnowledgeDirectoryBindingRecord> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeDirectoryBindingInput(input);
    let result: CandidateKnowledgeDirectoryBindingRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalized.knowledgeBaseId);
      const existingRoot = this.database
        .prepare(
          `SELECT directory_id AS id
           FROM candidate_knowledge_directory_root_revisions
           WHERE candidate_knowledge_base_id = ? AND root_path = ?`,
        )
        .get(normalized.knowledgeBaseId, normalized.rootPath);
      if (existingRoot !== undefined) {
        throw new StorageConflictError(
          "candidate knowledge directory root is already bound in this candidate knowledge base",
        );
      }
      const existingId = this.database
        .prepare("SELECT id FROM candidate_knowledge_directory_bindings WHERE id = ?")
        .get(normalized.id);
      if (existingId !== undefined) {
        throw new StorageConflictError("candidate knowledge directory id already exists");
      }

      const members = normalized.sourceIds.map((sourceId) => {
        const source = this.requireCandidateKnowledgeSource(normalized.knowledgeBaseId, sourceId);
        if (source.kind !== "file") {
          throw new StorageValidationError(
            "candidate knowledge directory members require file sources",
          );
        }
        this.requireCandidateKnowledgeSourceActive(sourceId);
        requireTimestamp(source.createdAt, `candidate knowledge source ${sourceId} createdAt`);

        const originRow = this.database
          .prepare(
            "SELECT source_id, origin_path, bound_at FROM candidate_knowledge_source_origin_bindings WHERE source_id = ?",
          )
          .get(sourceId);
        if (originRow === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory members require an origin binding",
          );
        }
        const origin = candidateKnowledgeSourceOriginBindingFromRow(originRow);
        const managed = this.database
          .prepare(
            `SELECT version.id
             FROM candidate_knowledge_source_versions AS version
             JOIN candidate_knowledge_managed_source_versions AS managed
               ON managed.version_id = version.id
             WHERE version.source_id = ?
             LIMIT 1`,
          )
          .get(sourceId);
        if (managed === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory members require managed file sources",
          );
        }
        const latestRow = this.database
          .prepare(
            `SELECT version.id, version.created_at
             FROM candidate_knowledge_source_versions AS version
             WHERE version.source_id = ?
             ORDER BY version.version DESC, version.id DESC
             LIMIT 1`,
          )
          .get(sourceId);
        if (latestRow === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory members require source versions",
          );
        }
        const latestCreatedAt = requireTimestamp(
          rowString(latestRow, "created_at"),
          `candidate knowledge source ${sourceId} latest version createdAt`,
        );
        const originBoundAt = requireTimestamp(
          origin.boundAt,
          `candidate knowledge source ${sourceId} origin binding boundAt`,
        );
        if (
          Date.parse(source.createdAt) > Date.parse(normalized.boundAt) ||
          Date.parse(originBoundAt) > Date.parse(normalized.boundAt) ||
          Date.parse(latestCreatedAt) > Date.parse(normalized.boundAt)
        ) {
          throw new StorageValidationError(
            "candidate knowledge directory boundAt must not precede its member source state",
          );
        }
        return {
          directoryId: normalized.id,
          knowledgeBaseId: normalized.knowledgeBaseId,
          sourceId,
          relativePathHash: directoryMemberRelativePathHash(normalized.rootPath, origin.originPath),
        } satisfies CandidateKnowledgeDirectoryMemberRecord;
      });
      if (new Set(members.map((member) => member.relativePathHash)).size !== members.length) {
        throw new StorageConflictError(
          "candidate knowledge directory members must have unique relative paths",
        );
      }

      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_directory_bindings (id, candidate_knowledge_base_id, root_path, bound_at) VALUES (?, ?, ?, ?)",
        )
        .run(normalized.id, normalized.knowledgeBaseId, normalized.rootPath, normalized.boundAt);
      const insertMember = this.database.prepare(
        "INSERT INTO candidate_knowledge_directory_members (directory_id, candidate_knowledge_base_id, source_id, relative_path_hash) VALUES (?, ?, ?, ?)",
      );
      for (const member of members) {
        insertMember.run(
          member.directoryId,
          member.knowledgeBaseId,
          member.sourceId,
          member.relativePathHash,
        );
      }
      result = {
        id: normalized.id,
        knowledgeBaseId: normalized.knowledgeBaseId,
        rootPath: normalized.rootPath,
        boundAt: normalized.boundAt,
      };
    })();
    return result as CandidateKnowledgeDirectoryBindingRecord;
  }

  public async getCandidateKnowledgeDirectoryBinding(
    knowledgeBaseId: string,
    directoryId: string,
  ): Promise<CandidateKnowledgeDirectoryBindingRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_current_roots
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    return row === undefined ? undefined : candidateKnowledgeDirectoryBindingFromRow(row);
  }

  public async getCandidateKnowledgeDirectoryCurrentRootRevision(
    knowledgeBaseId: string,
    directoryId: string,
  ): Promise<CandidateKnowledgeDirectoryRootRevisionRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT id AS directory_id, candidate_knowledge_base_id, revision, root_path, bound_at
         FROM candidate_knowledge_directory_current_roots
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    return row === undefined ? undefined : candidateKnowledgeDirectoryRootRevisionFromRow(row);
  }

  public async getCandidateKnowledgeDirectoryMemberCurrentRevision(
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeDirectoryMemberRevisionRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id,
                revision, relative_path_hash, bound_at
         FROM candidate_knowledge_directory_current_members
         WHERE candidate_knowledge_base_id = ?
           AND directory_id = ?
           AND source_id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId, normalizedSourceId);
    return row === undefined ? undefined : candidateKnowledgeDirectoryMemberRevisionFromRow(row);
  }

  public async rebindCandidateKnowledgeDirectoryRoot(
    input: CandidateKnowledgeDirectoryRootRebindInput,
  ): Promise<CandidateKnowledgeDirectoryRootRebindResult> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeDirectoryRootRebindInput(input);
    let result: CandidateKnowledgeDirectoryRootRebindResult | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalized.knowledgeBaseId);
      const currentRow = this.database
        .prepare(
          `SELECT id, candidate_knowledge_base_id, revision, root_path, bound_at
           FROM candidate_knowledge_directory_current_roots
           WHERE candidate_knowledge_base_id = ? AND id = ?`,
        )
        .get(normalized.knowledgeBaseId, normalized.directoryId);
      if (currentRow === undefined) {
        throw new StorageValidationError("candidate knowledge directory binding was not found");
      }
      const currentRoot = requireCanonicalAbsolutePath(
        rowString(currentRow, "root_path"),
        `candidate knowledge directory ${normalized.directoryId} root path`,
      );
      const currentRevision = rowNumber(currentRow, "revision");
      if (
        rowString(currentRow, "id") !== normalized.directoryId ||
        rowString(currentRow, "candidate_knowledge_base_id") !== normalized.knowledgeBaseId ||
        currentRoot !== normalized.expectedRootPath ||
        currentRevision !== normalized.expectedRevision
      ) {
        throw new StorageConflictError("candidate knowledge directory root changed during rebind");
      }
      const currentBoundAt = requireTimestamp(
        rowString(currentRow, "bound_at"),
        `candidate knowledge directory ${normalized.directoryId} boundAt`,
      );
      const reboundAtMillis = Date.parse(normalized.reboundAt);
      if (reboundAtMillis < Date.parse(currentBoundAt)) {
        throw new StorageValidationError(
          "candidate knowledge directory root reboundAt must not precede its current revision",
        );
      }

      const memberRows = this.database
        .prepare(
          `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
           FROM candidate_knowledge_directory_current_members
           WHERE candidate_knowledge_base_id = ? AND directory_id = ?
           ORDER BY source_id`,
        )
        .all(normalized.knowledgeBaseId, normalized.directoryId)
        .map(candidateKnowledgeDirectoryMemberFromRow);
      const membersBySource = new Map<string, CandidateKnowledgeDirectoryMemberRecord>();
      const memberHashes = new Set<string>();
      for (const member of memberRows) {
        if (
          member.directoryId !== normalized.directoryId ||
          member.knowledgeBaseId !== normalized.knowledgeBaseId ||
          !/^[0-9a-f]{64}$/.test(member.relativePathHash) ||
          memberHashes.has(member.relativePathHash) ||
          membersBySource.has(member.sourceId)
        ) {
          throw new StorageValidationError("candidate knowledge directory membership is malformed");
        }
        memberHashes.add(member.relativePathHash);
        membersBySource.set(member.sourceId, member);
      }
      if (
        memberRows.length !== normalized.members.length ||
        normalized.members.some((member) => !membersBySource.has(member.sourceId))
      ) {
        throw new StorageValidationError(
          "candidate knowledge directory root rebind members do not match immutable membership",
        );
      }

      const reservedRoot = this.database
        .prepare(
          `SELECT directory_id, candidate_knowledge_base_id, revision, root_path, bound_at
           FROM candidate_knowledge_directory_root_revisions
           WHERE candidate_knowledge_base_id = ? AND root_path = ?`,
        )
        .get(normalized.knowledgeBaseId, normalized.candidateRootPath);
      if (normalized.candidateRootPath !== currentRoot && reservedRoot !== undefined) {
        throw new StorageConflictError(
          "candidate knowledge directory root has already been used in this candidate knowledge base",
        );
      }

      for (const memberInput of normalized.members) {
        const member = membersBySource.get(memberInput.sourceId);
        if (member === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory root rebind member was not found",
          );
        }
        const candidateHash = directoryMemberRelativePathHash(
          normalized.candidateRootPath,
          memberInput.originPath,
        );
        if (candidateHash !== member.relativePathHash) {
          throw new StorageConflictError(
            "candidate knowledge directory root rebind source path does not match membership",
          );
        }
        const source = this.requireCandidateKnowledgeSource(
          normalized.knowledgeBaseId,
          memberInput.sourceId,
        );
        if (source.kind !== "file") {
          throw new StorageValidationError(
            "candidate knowledge directory root rebind requires file sources",
          );
        }
        this.requireCandidateKnowledgeSourceActive(memberInput.sourceId);
        const sourceCreatedAt = requireTimestamp(
          source.createdAt,
          `candidate knowledge source ${memberInput.sourceId} createdAt`,
        );
        const latestRow = this.database
          .prepare(
            `SELECT id, source_id, version, parent_version_id, media_type,
                    checksum, size_bytes, created_at
             FROM candidate_knowledge_source_versions
             WHERE source_id = ?
             ORDER BY version DESC, id DESC
             LIMIT 1`,
          )
          .get(memberInput.sourceId);
        if (latestRow === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory root rebind source has no latest version",
          );
        }
        const latest = candidateKnowledgeSourceVersionFromRow(latestRow);
        if (
          latest.id !== memberInput.expectedVersionId ||
          latest.mediaType !== memberInput.mediaType ||
          latest.checksum !== memberInput.checksum ||
          latest.sizeBytes !== memberInput.sizeBytes
        ) {
          throw new StorageConflictError(
            "candidate knowledge directory root rebind latest version changed",
          );
        }
        const managed = this.database
          .prepare(
            `SELECT version_id
             FROM candidate_knowledge_managed_source_versions
             WHERE version_id = ?`,
          )
          .get(latest.id);
        if (managed === undefined) {
          throw new StorageValidationError(
            "candidate knowledge directory root rebind requires a managed latest version",
          );
        }
        const latestCreatedAt = requireTimestamp(
          latest.createdAt,
          `candidate knowledge source ${memberInput.sourceId} latest version createdAt`,
        );
        const originRow = this.database
          .prepare(
            `SELECT source_id, origin_path, bound_at
             FROM candidate_knowledge_source_origin_bindings
             WHERE source_id = ?`,
          )
          .get(memberInput.sourceId);
        if (originRow === undefined) {
          throw new StorageConflictError(
            "candidate knowledge directory root rebind source origin changed",
          );
        }
        const origin = candidateKnowledgeSourceOriginBindingFromRow(originRow);
        const originBoundAt = requireTimestamp(
          origin.boundAt,
          `candidate knowledge source ${memberInput.sourceId} origin boundAt`,
        );
        const currentOriginPath = requireCanonicalAbsolutePath(
          origin.originPath,
          `candidate knowledge source ${memberInput.sourceId} origin path`,
        );
        if (origin.sourceId !== memberInput.sourceId) {
          throw new StorageValidationError("candidate knowledge source origin is malformed");
        }
        if (originBoundAt !== memberInput.expectedOriginBoundAt) {
          throw new StorageConflictError(
            "candidate knowledge directory root rebind source origin changed",
          );
        }
        if (
          directoryMemberRelativePathHash(currentRoot, currentOriginPath) !==
          member.relativePathHash
        ) {
          throw new StorageConflictError(
            "candidate knowledge directory root rebind source origin is not a current member",
          );
        }
        const observationRow = this.database
          .prepare(
            `SELECT checked_at
             FROM candidate_knowledge_source_refresh_observations
             WHERE source_id = ?`,
          )
          .get(memberInput.sourceId);
        const observationCheckedAt =
          observationRow === undefined
            ? undefined
            : requireTimestamp(
                rowString(observationRow, "checked_at"),
                `candidate knowledge source ${memberInput.sourceId} refresh checkedAt`,
              );
        if (
          reboundAtMillis < Date.parse(sourceCreatedAt) ||
          reboundAtMillis < Date.parse(latestCreatedAt) ||
          reboundAtMillis < Date.parse(originBoundAt) ||
          (observationCheckedAt !== undefined && reboundAtMillis < Date.parse(observationCheckedAt))
        ) {
          throw new StorageValidationError(
            "candidate knowledge directory root reboundAt must not precede member state",
          );
        }
      }

      const currentBinding: CandidateKnowledgeDirectoryBindingRecord = {
        id: normalized.directoryId,
        knowledgeBaseId: normalized.knowledgeBaseId,
        rootPath: currentRoot,
        boundAt: currentBoundAt,
      };
      const currentRevisionRecord: CandidateKnowledgeDirectoryRootRevisionRecord = {
        directoryId: normalized.directoryId,
        knowledgeBaseId: normalized.knowledgeBaseId,
        revision: currentRevision,
        rootPath: currentRoot,
        boundAt: currentBoundAt,
      };
      if (normalized.candidateRootPath === currentRoot) {
        result = { binding: currentBinding, revision: currentRevisionRecord, rebound: false };
        return;
      }

      const nextRevision = currentRevision + 1;
      this.database
        .prepare(
          `INSERT INTO candidate_knowledge_directory_root_revisions
             (directory_id, candidate_knowledge_base_id, revision, root_path, bound_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          normalized.directoryId,
          normalized.knowledgeBaseId,
          nextRevision,
          normalized.candidateRootPath,
          normalized.reboundAt,
        );
      const updateOrigin = this.database.prepare(
        `UPDATE candidate_knowledge_source_origin_bindings
         SET origin_path = ?, bound_at = ?
         WHERE source_id = ?`,
      );
      for (const member of normalized.members) {
        const update = updateOrigin.run(member.originPath, normalized.reboundAt, member.sourceId);
        if (update.changes !== 1) {
          throw new StorageConflictError(
            "candidate knowledge directory root rebind source origin could not be updated",
          );
        }
      }
      const nextRevisionRecord: CandidateKnowledgeDirectoryRootRevisionRecord = {
        directoryId: normalized.directoryId,
        knowledgeBaseId: normalized.knowledgeBaseId,
        revision: nextRevision,
        rootPath: normalized.candidateRootPath,
        boundAt: normalized.reboundAt,
      };
      result = {
        binding: {
          id: normalized.directoryId,
          knowledgeBaseId: normalized.knowledgeBaseId,
          rootPath: normalized.candidateRootPath,
          boundAt: normalized.reboundAt,
        },
        revision: nextRevisionRecord,
        rebound: true,
      };
    })();
    return result as CandidateKnowledgeDirectoryRootRebindResult;
  }

  public async moveCandidateKnowledgeDirectoryMember(
    input: CandidateKnowledgeDirectoryMemberMoveInput,
  ): Promise<CandidateKnowledgeDirectoryMemberMoveResult> {
    this.ensureOpen();
    const normalized = normalizeCandidateKnowledgeDirectoryMemberMoveInput(input);
    let result: CandidateKnowledgeDirectoryMemberMoveResult | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalized.knowledgeBaseId);
      const currentRootRow = this.database
        .prepare(
          `SELECT id, candidate_knowledge_base_id, revision, root_path, bound_at
           FROM candidate_knowledge_directory_current_roots
           WHERE candidate_knowledge_base_id = ? AND id = ?`,
        )
        .get(normalized.knowledgeBaseId, normalized.directoryId);
      if (currentRootRow === undefined) {
        throw new StorageValidationError("candidate knowledge directory binding was not found");
      }
      const currentRoot = requireCanonicalAbsolutePath(
        rowString(currentRootRow, "root_path"),
        "candidate knowledge directory root path",
      );
      const currentRootRevision = rowNumber(currentRootRow, "revision");
      const currentRootBoundAt = requireTimestamp(
        rowString(currentRootRow, "bound_at"),
        `candidate knowledge directory ${normalized.directoryId} boundAt`,
      );
      if (
        rowString(currentRootRow, "id") !== normalized.directoryId ||
        rowString(currentRootRow, "candidate_knowledge_base_id") !== normalized.knowledgeBaseId ||
        currentRoot !== normalized.expectedRootPath ||
        currentRootRevision !== normalized.expectedRootRevision
      ) {
        throw new StorageConflictError(
          "candidate knowledge directory root changed during member move",
        );
      }

      const currentMemberRows = this.database
        .prepare(
          `SELECT directory_id, candidate_knowledge_base_id, source_id,
                  revision, relative_path_hash, bound_at
           FROM candidate_knowledge_directory_current_members
           WHERE candidate_knowledge_base_id = ? AND directory_id = ?
           ORDER BY source_id`,
        )
        .all(normalized.knowledgeBaseId, normalized.directoryId);
      const currentHashes = new Set<string>();
      const currentMembersBySource = new Map<
        string,
        CandidateKnowledgeDirectoryMemberRevisionRecord
      >();
      for (const row of currentMemberRows) {
        const current = candidateKnowledgeDirectoryMemberRevisionFromRow(row);
        if (
          current.directoryId !== normalized.directoryId ||
          current.knowledgeBaseId !== normalized.knowledgeBaseId ||
          !/^[0-9a-f]{64}$/.test(current.relativePathHash) ||
          currentHashes.has(current.relativePathHash) ||
          currentMembersBySource.has(current.sourceId)
        ) {
          throw new StorageValidationError("candidate knowledge directory membership is malformed");
        }
        currentHashes.add(current.relativePathHash);
        currentMembersBySource.set(current.sourceId, current);
      }
      const currentMember = currentMembersBySource.get(normalized.sourceId);
      if (currentMember === undefined) {
        throw new StorageValidationError("candidate knowledge directory member was not found");
      }
      if (
        currentMember.revision !== normalized.expectedMemberRevision ||
        currentMember.relativePathHash !== normalized.expectedRelativePathHash
      ) {
        throw new StorageConflictError("candidate knowledge directory member changed during move");
      }
      const memberRecord: CandidateKnowledgeDirectoryMemberRecord = {
        directoryId: currentMember.directoryId,
        knowledgeBaseId: currentMember.knowledgeBaseId,
        sourceId: currentMember.sourceId,
        relativePathHash: currentMember.relativePathHash,
      };

      const source = this.requireCandidateKnowledgeSource(
        normalized.knowledgeBaseId,
        normalized.sourceId,
      );
      if (source.kind !== "file") {
        throw new StorageValidationError(
          "candidate knowledge directory member move requires a file source",
        );
      }
      this.requireCandidateKnowledgeSourceActive(normalized.sourceId);
      const sourceCreatedAt = requireTimestamp(
        source.createdAt,
        `candidate knowledge source ${normalized.sourceId} createdAt`,
      );
      const latestRow = this.database
        .prepare(
          `SELECT id, source_id, version, parent_version_id, media_type,
                  checksum, size_bytes, created_at
           FROM candidate_knowledge_source_versions AS version
           WHERE version.source_id = ?
           ORDER BY version.version DESC, version.id DESC
           LIMIT 1`,
        )
        .get(normalized.sourceId);
      if (latestRow === undefined) {
        throw new StorageValidationError(
          "candidate knowledge directory member move source has no latest version",
        );
      }
      const latest = candidateKnowledgeSourceVersionFromRow(latestRow);
      if (
        latest.id !== normalized.expectedVersionId ||
        latest.mediaType !== normalized.mediaType ||
        latest.checksum !== normalized.checksum ||
        latest.sizeBytes !== normalized.sizeBytes
      ) {
        throw new StorageConflictError(
          "candidate knowledge directory member move latest version changed",
        );
      }
      if (!this.hasManagedCandidateKnowledgeSourceVersion(latest.id)) {
        throw new StorageValidationError(
          "candidate knowledge directory member move requires a managed latest version",
        );
      }
      const latestCreatedAt = requireTimestamp(
        latest.createdAt,
        `candidate knowledge source ${normalized.sourceId} latest version createdAt`,
      );
      const originRow = this.database
        .prepare(
          `SELECT source_id, origin_path, bound_at
           FROM candidate_knowledge_source_origin_bindings
           WHERE source_id = ?`,
        )
        .get(normalized.sourceId);
      if (originRow === undefined) {
        throw new StorageConflictError("candidate knowledge source origin changed during move");
      }
      const currentOrigin = candidateKnowledgeSourceOriginBindingFromRow(originRow);
      if (currentOrigin.sourceId !== normalized.sourceId) {
        throw new StorageValidationError("candidate knowledge source origin is malformed");
      }
      const currentOriginBoundAt = requireTimestamp(
        currentOrigin.boundAt,
        `candidate knowledge source ${normalized.sourceId} origin boundAt`,
      );
      const currentOriginPath = requireCanonicalAbsolutePath(
        currentOrigin.originPath,
        `candidate knowledge source ${normalized.sourceId} origin path`,
      );
      if (currentOriginBoundAt !== normalized.expectedOriginBoundAt) {
        throw new StorageConflictError("candidate knowledge source origin changed during move");
      }
      if (
        directoryMemberOriginRelation(
          currentRoot,
          currentOriginPath,
          currentMember.relativePathHash,
          currentHashes,
        ) !== "same-member"
      ) {
        throw new StorageConflictError(
          "candidate knowledge directory member origin is not its current member",
        );
      }
      const observationRow = this.database
        .prepare(
          `SELECT checked_at
           FROM candidate_knowledge_source_refresh_observations
           WHERE source_id = ?`,
        )
        .get(normalized.sourceId);
      const observationCheckedAt =
        observationRow === undefined
          ? undefined
          : requireTimestamp(
              rowString(observationRow, "checked_at"),
              `candidate knowledge source ${normalized.sourceId} refresh checkedAt`,
            );
      const movedAtMillis = Date.parse(normalized.movedAt);
      if (
        movedAtMillis < Date.parse(currentRootBoundAt) ||
        movedAtMillis < Date.parse(currentMember.boundAt) ||
        movedAtMillis < Date.parse(sourceCreatedAt) ||
        movedAtMillis < Date.parse(latestCreatedAt) ||
        movedAtMillis < Date.parse(currentOriginBoundAt) ||
        (observationCheckedAt !== undefined && movedAtMillis < Date.parse(observationCheckedAt))
      ) {
        throw new StorageValidationError(
          "candidate knowledge directory member movedAt must not precede member state",
        );
      }

      const targetHash = directoryMemberRelativePathHash(currentRoot, normalized.targetOriginPath);
      const foreignHistoricalHash = this.database
        .prepare(
          `SELECT source_id
           FROM candidate_knowledge_directory_member_revisions
           WHERE directory_id = ?
             AND relative_path_hash = ?
             AND source_id <> ?
           LIMIT 1`,
        )
        .get(normalized.directoryId, targetHash, normalized.sourceId);
      if (foreignHistoricalHash !== undefined) {
        throw new StorageConflictError(
          "candidate knowledge directory member target path belongs to another source",
        );
      }
      const currentBinding: CandidateKnowledgeSourceOriginBindingRecord = {
        sourceId: normalized.sourceId,
        originPath: currentOriginPath,
        boundAt: currentOriginBoundAt,
      };
      const currentRevisionRecord = currentMember;
      if (targetHash === currentMember.relativePathHash) {
        result = {
          member: memberRecord,
          revision: currentRevisionRecord,
          binding: currentBinding,
          moved: false,
        };
        return;
      }

      const nextRevision = currentMember.revision + 1;
      this.database
        .prepare(
          `INSERT INTO candidate_knowledge_directory_member_revisions
             (directory_id, candidate_knowledge_base_id, source_id, revision, relative_path_hash, bound_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          normalized.directoryId,
          normalized.knowledgeBaseId,
          normalized.sourceId,
          nextRevision,
          targetHash,
          normalized.movedAt,
        );
      const update = this.database
        .prepare(
          `UPDATE candidate_knowledge_source_origin_bindings
           SET origin_path = ?, bound_at = ?
           WHERE source_id = ? AND origin_path = ? AND bound_at = ?`,
        )
        .run(
          normalized.targetOriginPath,
          normalized.movedAt,
          normalized.sourceId,
          currentOriginPath,
          currentOriginBoundAt,
        );
      if (update.changes !== 1) {
        throw new StorageConflictError("candidate knowledge source origin changed during move");
      }
      const nextMember: CandidateKnowledgeDirectoryMemberRecord = {
        ...memberRecord,
        relativePathHash: targetHash,
      };
      result = {
        member: nextMember,
        revision: {
          directoryId: normalized.directoryId,
          knowledgeBaseId: normalized.knowledgeBaseId,
          sourceId: normalized.sourceId,
          revision: nextRevision,
          relativePathHash: targetHash,
          boundAt: normalized.movedAt,
        },
        binding: {
          sourceId: normalized.sourceId,
          originPath: normalized.targetOriginPath,
          boundAt: normalized.movedAt,
        },
        moved: true,
      };
    })();
    return result as CandidateKnowledgeDirectoryMemberMoveResult;
  }

  public async findCandidateKnowledgeDirectoryBinding(
    knowledgeBaseId: string,
    rootPath: string,
  ): Promise<CandidateKnowledgeDirectoryBindingRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedRootPath = requireCanonicalAbsolutePath(
      rootPath,
      "candidate knowledge directory root path",
    );
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT directory_id AS id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_root_revisions
         WHERE candidate_knowledge_base_id = ? AND root_path = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedRootPath);
    return row === undefined ? undefined : candidateKnowledgeDirectoryBindingFromRow(row);
  }

  public async listCandidateKnowledgeDirectoryMembers(
    knowledgeBaseId: string,
    directoryId: string,
  ): Promise<readonly CandidateKnowledgeDirectoryMemberRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const binding = this.database
      .prepare(
        "SELECT id FROM candidate_knowledge_directory_current_roots WHERE candidate_knowledge_base_id = ? AND id = ?",
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    return this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_current_members
         WHERE candidate_knowledge_base_id = ? AND directory_id = ?
         ORDER BY relative_path_hash`,
      )
      .all(normalizedKnowledgeBaseId, normalizedDirectoryId)
      .map(candidateKnowledgeDirectoryMemberFromRow);
  }

  public async findCandidateKnowledgeDirectoryMemberByPath(
    knowledgeBaseId: string,
    directoryId: string,
    sourcePath: string,
  ): Promise<CandidateKnowledgeDirectoryMemberRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalizedSourcePath = requireCanonicalAbsolutePath(
      sourcePath,
      "candidate knowledge directory member source path",
    );
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const binding = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path
         FROM candidate_knowledge_directory_current_roots
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    const rootPath = requireCanonicalAbsolutePath(
      rowString(binding, "root_path"),
      "candidate knowledge directory root path",
    );
    const relativePathHash = directoryMemberRelativePathHash(rootPath, normalizedSourcePath);
    const row = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_current_members
         WHERE candidate_knowledge_base_id = ?
           AND directory_id = ?
           AND relative_path_hash = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId, relativePathHash);
    return row === undefined ? undefined : candidateKnowledgeDirectoryMemberFromRow(row);
  }

  public async findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
    knowledgeBaseId: string,
    directoryId: string,
    candidateRootPath: string,
    sourcePath: string,
  ): Promise<CandidateKnowledgeDirectoryMemberRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalizedCandidateRootPath = requireCanonicalAbsolutePath(
      candidateRootPath,
      "candidate knowledge directory candidate root path",
    );
    const normalizedSourcePath = requireCanonicalAbsolutePath(
      sourcePath,
      "candidate knowledge directory candidate source path",
    );
    this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const binding = this.database
      .prepare(
        `SELECT id
         FROM candidate_knowledge_directory_current_roots
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    const relativePathHash = directoryMemberRelativePathHash(
      normalizedCandidateRootPath,
      normalizedSourcePath,
    );
    const row = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_current_members
         WHERE candidate_knowledge_base_id = ?
           AND directory_id = ?
           AND relative_path_hash = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedDirectoryId, relativePathHash);
    return row === undefined ? undefined : candidateKnowledgeDirectoryMemberFromRow(row);
  }

  public async getCandidateKnowledgeDirectoryMemberOriginRelation(
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeDirectoryMemberOriginRelationRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    return this.readCandidateKnowledgeDirectoryMemberOriginRelation(
      normalizedKnowledgeBaseId,
      normalizedDirectoryId,
      normalizedSourceId,
    );
  }

  public async upsertCandidateKnowledgeDirectoryRefreshObservations(
    knowledgeBaseId: string,
    directoryId: string,
    input: CandidateKnowledgeDirectoryRefreshObservationBatchInput,
  ): Promise<readonly CandidateKnowledgeSourceRefreshObservationRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalized = normalizeCandidateKnowledgeDirectoryRefreshObservationBatchInput(input);
    let result: readonly CandidateKnowledgeSourceRefreshObservationRecord[] | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const binding = this.database
        .prepare(
          `SELECT id, candidate_knowledge_base_id, root_path, bound_at
           FROM candidate_knowledge_directory_current_roots
           WHERE candidate_knowledge_base_id = ? AND id = ?`,
        )
        .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
      if (binding === undefined) {
        throw new StorageValidationError("candidate knowledge directory binding was not found");
      }
      if (rowString(binding, "candidate_knowledge_base_id") !== normalizedKnowledgeBaseId) {
        throw new StorageValidationError("candidate knowledge directory binding is malformed");
      }
      requireCanonicalAbsolutePath(
        rowString(binding, "root_path"),
        "candidate knowledge directory root path",
      );
      if (rowString(binding, "id") !== normalizedDirectoryId) {
        throw new StorageValidationError("candidate knowledge directory binding is malformed");
      }
      const directoryBoundAt = requireTimestamp(
        rowString(binding, "bound_at"),
        `candidate knowledge directory ${normalizedDirectoryId} boundAt`,
      );
      if (Date.parse(normalized.checkedAt) < Date.parse(directoryBoundAt)) {
        throw new StorageValidationError(
          "candidate knowledge directory refresh checkedAt must not precede directory binding",
        );
      }

      const pending = [...normalized.entries]
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
        .map((entry) => {
          const member = this.database
            .prepare(
              `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
               FROM candidate_knowledge_directory_current_members
               WHERE candidate_knowledge_base_id = ?
                 AND directory_id = ?
                 AND source_id = ?`,
            )
            .get(normalizedKnowledgeBaseId, normalizedDirectoryId, entry.sourceId);
          if (member === undefined) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observation source is not a member",
            );
          }
          const memberRecord = candidateKnowledgeDirectoryMemberFromRow(member);
          if (
            memberRecord.directoryId !== normalizedDirectoryId ||
            memberRecord.knowledgeBaseId !== normalizedKnowledgeBaseId ||
            !/^[0-9a-f]{64}$/.test(memberRecord.relativePathHash)
          ) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh membership is malformed",
            );
          }
          const source = this.requireCandidateKnowledgeSource(
            normalizedKnowledgeBaseId,
            entry.sourceId,
          );
          if (source.kind !== "file") {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observations require file sources",
            );
          }
          this.requireCandidateKnowledgeSourceActive(entry.sourceId);
          const managed = this.database
            .prepare(
              `SELECT version.id
               FROM candidate_knowledge_source_versions AS version
               JOIN candidate_knowledge_managed_source_versions AS managed
                 ON managed.version_id = version.id
               WHERE version.source_id = ?
               LIMIT 1`,
            )
            .get(entry.sourceId);
          if (managed === undefined) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observations require managed files",
            );
          }
          const latestRow = this.database
            .prepare(
              `SELECT id, version, created_at
               FROM candidate_knowledge_source_versions
               WHERE source_id = ?
               ORDER BY version DESC, id DESC
               LIMIT 1`,
            )
            .get(entry.sourceId);
          if (latestRow === undefined || rowString(latestRow, "id") !== entry.observedVersionId) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observed version is not latest",
            );
          }
          const sourceCreatedAt = requireTimestamp(
            source.createdAt,
            `candidate knowledge source ${entry.sourceId} createdAt`,
          );
          const latestVersionCreatedAt = requireTimestamp(
            rowString(latestRow, "created_at"),
            `candidate knowledge source ${entry.sourceId} latest version createdAt`,
          );
          if (Date.parse(normalized.checkedAt) < Date.parse(sourceCreatedAt)) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh checkedAt must not precede source creation",
            );
          }
          if (Date.parse(normalized.checkedAt) < Date.parse(latestVersionCreatedAt)) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh checkedAt must not precede latest version",
            );
          }
          const observedVersion = this.database
            .prepare(
              "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
            )
            .get(entry.observedVersionId, entry.sourceId);
          if (observedVersion === undefined) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh observed version does not belong to its source",
            );
          }
          const relation = this.readCandidateKnowledgeDirectoryMemberOriginRelation(
            normalizedKnowledgeBaseId,
            normalizedDirectoryId,
            entry.sourceId,
          );
          if (
            relation.relation !== "same-member" ||
            relation.originBoundAt !== entry.expectedOriginBoundAt
          ) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh origin revision is no longer current",
            );
          }
          if (
            relation.originBoundAt !== undefined &&
            Date.parse(normalized.checkedAt) < Date.parse(relation.originBoundAt)
          ) {
            throw new StorageValidationError(
              "candidate knowledge directory refresh checkedAt must not precede origin binding",
            );
          }

          const currentRow = this.database
            .prepare(
              `SELECT source_id, observed_version_id, status, checked_at,
                      last_refreshed_version_id, last_refreshed_at
               FROM candidate_knowledge_source_refresh_observations
               WHERE source_id = ?`,
            )
            .get(entry.sourceId);
          const current =
            currentRow === undefined
              ? undefined
              : candidateKnowledgeSourceRefreshObservationFromRow(
                  currentRow,
                  rowString(latestRow, "id"),
                );
          if (current !== undefined) {
            requireCandidateKnowledgeSourceRefreshObservationStatus(current.status);
            requireTimestamp(
              current.checkedAt,
              `candidate knowledge source ${entry.sourceId} refresh checkedAt`,
            );
            if (current.sourceId !== entry.sourceId) {
              throw new StorageValidationError(
                "candidate knowledge source refresh observation is malformed",
              );
            }
            if (Date.parse(normalized.checkedAt) < Date.parse(current.checkedAt)) {
              throw new StorageValidationError(
                "candidate knowledge directory refresh checkedAt must not precede current observation",
              );
            }
            const currentObserved = this.database
              .prepare(
                "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
              )
              .get(current.observedVersionId, entry.sourceId);
            if (currentObserved === undefined) {
              throw new StorageValidationError(
                "candidate knowledge source refresh observed version is malformed",
              );
            }
            if (current.lastRefreshedVersionId !== null) {
              const refreshed = this.database
                .prepare(
                  "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
                )
                .get(current.lastRefreshedVersionId, entry.sourceId);
              if (refreshed === undefined || current.lastRefreshedAt === null) {
                throw new StorageValidationError(
                  "candidate knowledge source refresh last-refreshed state is malformed",
                );
              }
              requireTimestamp(
                current.lastRefreshedAt,
                `candidate knowledge source ${entry.sourceId} lastRefreshedAt`,
              );
              if (Date.parse(current.lastRefreshedAt) > Date.parse(current.checkedAt)) {
                throw new StorageValidationError(
                  "candidate knowledge source refresh lastRefreshedAt must not follow checkedAt",
                );
              }
            } else if (current.lastRefreshedAt !== null) {
              throw new StorageValidationError(
                "candidate knowledge source refresh last-refreshed state is malformed",
              );
            }
          }
          return {
            sourceId: entry.sourceId,
            observedVersionId: entry.observedVersionId,
            status: entry.status,
            checkedAt: normalized.checkedAt,
            lastRefreshedVersionId: current?.lastRefreshedVersionId ?? null,
            lastRefreshedAt: current?.lastRefreshedAt ?? null,
            hasExisting: current !== undefined,
          } satisfies Omit<CandidateKnowledgeSourceRefreshObservationRecord, "stale"> & {
            readonly hasExisting: boolean;
          };
        });

      const insert = this.database.prepare(
        `INSERT INTO candidate_knowledge_source_refresh_observations
           (source_id, observed_version_id, status, checked_at,
            last_refreshed_version_id, last_refreshed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const update = this.database.prepare(
        `UPDATE candidate_knowledge_source_refresh_observations
         SET observed_version_id = ?, status = ?, checked_at = ?,
             last_refreshed_version_id = ?, last_refreshed_at = ?
         WHERE source_id = ?`,
      );
      for (const entry of pending) {
        const values = [
          entry.observedVersionId,
          entry.status,
          entry.checkedAt,
          entry.lastRefreshedVersionId,
          entry.lastRefreshedAt,
        ];
        if (entry.hasExisting) {
          update.run(...values, entry.sourceId);
        } else {
          insert.run(entry.sourceId, ...values);
        }
      }
      result = pending.map((entry) =>
        candidateKnowledgeSourceRefreshObservationFromRow(
          {
            source_id: entry.sourceId,
            observed_version_id: entry.observedVersionId,
            status: entry.status,
            checked_at: entry.checkedAt,
            last_refreshed_version_id: entry.lastRefreshedVersionId,
            last_refreshed_at: entry.lastRefreshedAt,
          },
          entry.observedVersionId,
        ),
      );
    })();
    return result as readonly CandidateKnowledgeSourceRefreshObservationRecord[];
  }

  public async getCandidateKnowledgeSourceRetirement(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceRetirementRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT retirement.source_id, retirement.retired_at, retirement.reason
         FROM candidate_knowledge_source_retirements AS retirement
         JOIN candidate_knowledge_sources AS source ON source.id = retirement.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND source.id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    return row === undefined ? undefined : candidateKnowledgeSourceRetirementFromRow(row);
  }

  public async retireCandidateKnowledgeSource(
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRetirementInput,
  ): Promise<CandidateKnowledgeSourceRetirementRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const retiredAt = requireTimestamp(
      input.retiredAt,
      "candidate knowledge source retirement retiredAt",
    );
    const reason = requireCandidateKnowledgeSourceRetirementReason(input.reason);
    let result: CandidateKnowledgeSourceRetirementRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
      );
      if (Date.parse(retiredAt) < Date.parse(source.createdAt)) {
        throw new StorageValidationError(
          "candidate knowledge source retirement retiredAt must not precede source createdAt",
        );
      }
      const currentRow = this.database
        .prepare(
          "SELECT source_id, retired_at, reason FROM candidate_knowledge_source_retirements WHERE source_id = ?",
        )
        .get(normalizedSourceId);
      if (currentRow !== undefined) {
        const current = candidateKnowledgeSourceRetirementFromRow(currentRow);
        if (current.retiredAt !== retiredAt || current.reason !== reason) {
          throw new StorageConflictError(
            "candidate knowledge source retirement conflicts with its existing marker",
          );
        }
        result = current;
        return;
      }
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_source_retirements (source_id, retired_at, reason) VALUES (?, ?, ?)",
        )
        .run(normalizedSourceId, retiredAt, reason);
      result = { sourceId: normalizedSourceId, retiredAt, reason };
    })();
    return result as CandidateKnowledgeSourceRetirementRecord;
  }

  public async retireCandidateKnowledgeDirectoryMember(
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
    input: CandidateKnowledgeDirectoryMemberRetirementInput,
  ): Promise<CandidateKnowledgeSourceRetirementRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedDirectoryId = requireNonEmpty(
      directoryId,
      "candidate knowledge directory id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const retiredAt = requireTimestamp(
      input.retiredAt,
      "candidate knowledge directory member retirement retiredAt",
    );
    const expectedVersionId = requireNonEmpty(
      input.expectedVersionId,
      "candidate knowledge directory member expected version id",
    ).trim();
    const expectedOriginBoundAt = requireTimestamp(
      input.expectedOriginBoundAt,
      "candidate knowledge directory member expected origin boundAt",
    );
    const expectedRootPath = requireCanonicalAbsolutePath(
      input.expectedRootPath,
      "candidate knowledge directory member expected root path",
    );
    if (!Number.isSafeInteger(input.expectedRootRevision) || input.expectedRootRevision < 1) {
      throw new StorageValidationError(
        "candidate knowledge directory member expected root revision must be a positive safe integer",
      );
    }
    if (!Number.isSafeInteger(input.expectedMemberRevision) || input.expectedMemberRevision < 1) {
      throw new StorageValidationError(
        "candidate knowledge directory member expected member revision must be a positive safe integer",
      );
    }
    if (!/^[0-9a-f]{64}$/.test(input.expectedRelativePathHash)) {
      throw new StorageValidationError(
        "candidate knowledge directory member expected relative path hash is invalid",
      );
    }
    let result: CandidateKnowledgeSourceRetirementRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const binding = this.database
        .prepare(
          `SELECT id, candidate_knowledge_base_id, revision, root_path, bound_at
           FROM candidate_knowledge_directory_current_roots
           WHERE candidate_knowledge_base_id = ? AND id = ?`,
        )
        .get(normalizedKnowledgeBaseId, normalizedDirectoryId);
      if (binding === undefined) {
        throw new StorageValidationError("candidate knowledge directory binding was not found");
      }
      if (
        rowString(binding, "id") !== normalizedDirectoryId ||
        rowString(binding, "candidate_knowledge_base_id") !== normalizedKnowledgeBaseId ||
        rowNumber(binding, "revision") !== input.expectedRootRevision ||
        rowString(binding, "root_path") !== expectedRootPath
      ) {
        throw new StorageConflictError(
          "candidate knowledge directory root changed during retirement",
        );
      }
      requireCanonicalAbsolutePath(
        rowString(binding, "root_path"),
        `candidate knowledge directory ${normalizedDirectoryId} root path`,
      );
      const directoryBoundAt = requireTimestamp(
        rowString(binding, "bound_at"),
        `candidate knowledge directory ${normalizedDirectoryId} boundAt`,
      );
      if (Date.parse(retiredAt) < Date.parse(directoryBoundAt)) {
        throw new StorageValidationError(
          "candidate knowledge directory member retirement must not precede directory binding",
        );
      }

      const member = this.database
        .prepare(
          `SELECT directory_id, candidate_knowledge_base_id, source_id,
                  revision, relative_path_hash, bound_at
          FROM candidate_knowledge_directory_current_members
           WHERE candidate_knowledge_base_id = ?
             AND directory_id = ?
             AND source_id = ?`,
        )
        .get(normalizedKnowledgeBaseId, normalizedDirectoryId, normalizedSourceId);
      if (member === undefined) {
        throw new StorageValidationError("candidate knowledge directory member was not found");
      }
      const memberRecord = candidateKnowledgeDirectoryMemberFromRow(member);
      if (
        memberRecord.directoryId !== normalizedDirectoryId ||
        memberRecord.knowledgeBaseId !== normalizedKnowledgeBaseId ||
        memberRecord.sourceId !== normalizedSourceId ||
        !/^[0-9a-f]{64}$/.test(memberRecord.relativePathHash)
      ) {
        throw new StorageValidationError("candidate knowledge directory member is malformed");
      }
      if (
        rowNumber(member, "revision") !== input.expectedMemberRevision ||
        memberRecord.relativePathHash !== input.expectedRelativePathHash
      ) {
        throw new StorageConflictError(
          "candidate knowledge directory member revision changed during retirement",
        );
      }

      const source = this.requireCandidateKnowledgeSource(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
      );
      if (source.kind !== "file") {
        throw new StorageValidationError(
          "candidate knowledge directory member is not a file source",
        );
      }
      const managed = this.database
        .prepare(
          `SELECT version.id
           FROM candidate_knowledge_source_versions AS version
           JOIN candidate_knowledge_managed_source_versions AS managed
             ON managed.version_id = version.id
           WHERE version.source_id = ?
           LIMIT 1`,
        )
        .get(normalizedSourceId);
      if (managed === undefined) {
        throw new StorageValidationError("candidate knowledge directory member is not managed");
      }

      const currentRow = this.database
        .prepare(
          "SELECT source_id, retired_at, reason FROM candidate_knowledge_source_retirements WHERE source_id = ?",
        )
        .get(normalizedSourceId);
      if (currentRow !== undefined) {
        const current = candidateKnowledgeSourceRetirementFromRow(currentRow);
        if (current.sourceId !== normalizedSourceId || current.reason !== "user-requested") {
          throw new StorageValidationError(
            "candidate knowledge source retirement marker is malformed",
          );
        }
        requireTimestamp(
          current.retiredAt,
          `candidate knowledge source ${normalizedSourceId} retirement retiredAt`,
        );
        result = current;
        return;
      }

      this.requireCandidateKnowledgeSourceActive(normalizedSourceId);
      const sourceCreatedAt = requireTimestamp(
        source.createdAt,
        `candidate knowledge source ${normalizedSourceId} createdAt`,
      );
      if (Date.parse(retiredAt) < Date.parse(sourceCreatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge directory member retirement must not precede source creation",
        );
      }
      const latestRow = this.database
        .prepare(
          `SELECT version.id, version.source_id, version.version,
                  version.parent_version_id, version.media_type, version.checksum,
                  version.size_bytes, version.created_at
           FROM candidate_knowledge_source_versions AS version
           JOIN candidate_knowledge_managed_source_versions AS managed
             ON managed.version_id = version.id
           WHERE version.source_id = ?
           ORDER BY version.version DESC, version.id DESC
           LIMIT 1`,
        )
        .get(normalizedSourceId);
      if (latestRow === undefined) {
        throw new StorageValidationError(
          "candidate knowledge directory member latest managed version was not found",
        );
      }
      const latestVersion = candidateKnowledgeSourceVersionFromRow(latestRow);
      if (latestVersion.id !== expectedVersionId) {
        throw new StorageConflictError(
          "candidate knowledge directory member latest version changed",
        );
      }
      const latestVersionCreatedAt = requireTimestamp(
        latestVersion.createdAt,
        `candidate knowledge source ${normalizedSourceId} latest version createdAt`,
      );
      if (Date.parse(retiredAt) < Date.parse(latestVersionCreatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge directory member retirement must not precede latest version",
        );
      }

      const relation = this.readCandidateKnowledgeDirectoryMemberOriginRelation(
        normalizedKnowledgeBaseId,
        normalizedDirectoryId,
        normalizedSourceId,
      );
      if (relation.relation !== "same-member" || relation.originBoundAt !== expectedOriginBoundAt) {
        throw new StorageConflictError(
          "candidate knowledge directory member origin revision changed",
        );
      }
      if (Date.parse(retiredAt) < Date.parse(expectedOriginBoundAt)) {
        throw new StorageValidationError(
          "candidate knowledge directory member retirement must not precede origin binding",
        );
      }

      const observationRow = this.database
        .prepare(
          `SELECT source_id, checked_at
           FROM candidate_knowledge_source_refresh_observations
           WHERE source_id = ?`,
        )
        .get(normalizedSourceId);
      if (observationRow !== undefined) {
        if (rowString(observationRow, "source_id") !== normalizedSourceId) {
          throw new StorageValidationError(
            "candidate knowledge source refresh observation is malformed",
          );
        }
        const observationCheckedAt = requireTimestamp(
          rowString(observationRow, "checked_at"),
          `candidate knowledge source ${normalizedSourceId} refresh checkedAt`,
        );
        if (Date.parse(retiredAt) < Date.parse(observationCheckedAt)) {
          throw new StorageValidationError(
            "candidate knowledge directory member retirement must not precede refresh observation",
          );
        }
      }

      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_source_retirements (source_id, retired_at, reason) VALUES (?, ?, ?)",
        )
        .run(normalizedSourceId, retiredAt, "user-requested");
      result = {
        sourceId: normalizedSourceId,
        retiredAt,
        reason: "user-requested",
      };
    })();
    return result as CandidateKnowledgeSourceRetirementRecord;
  }

  public async getCandidateKnowledgeSourceRefreshObservation(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<CandidateKnowledgeSourceRefreshObservationRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    const row = this.database
      .prepare(
        `SELECT observation.source_id, observation.observed_version_id, observation.status,
                observation.checked_at, observation.last_refreshed_version_id,
                observation.last_refreshed_at
         FROM candidate_knowledge_source_refresh_observations AS observation
         JOIN candidate_knowledge_sources AS source
           ON source.id = observation.source_id
         WHERE source.candidate_knowledge_base_id = ?
           AND source.id = ?`,
      )
      .get(normalizedKnowledgeBaseId, normalizedSourceId);
    if (row === undefined) return undefined;
    const latestRow = this.database
      .prepare(
        "SELECT id FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC, id DESC LIMIT 1",
      )
      .get(normalizedSourceId);
    if (latestRow === undefined) {
      throw new StorageValidationError(
        `candidate knowledge source ${normalizedSourceId} has no versions`,
      );
    }
    return candidateKnowledgeSourceRefreshObservationFromRow(row, rowString(latestRow, "id"));
  }

  public async upsertCandidateKnowledgeSourceRefreshObservation(
    knowledgeBaseId: string,
    sourceId: string,
    input: CandidateKnowledgeSourceRefreshObservationInput,
  ): Promise<CandidateKnowledgeSourceRefreshObservationRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const observedVersionId = requireNonEmpty(
      input.observedVersionId,
      "candidate knowledge source refresh observed version id",
    ).trim();
    const status = requireCandidateKnowledgeSourceRefreshObservationStatus(input.status);
    const checkedAt = requireTimestamp(
      input.checkedAt,
      "candidate knowledge source refresh checkedAt",
    );
    const hasLastRefreshedVersion = input.lastRefreshedVersionId !== undefined;
    const hasLastRefreshedAt = input.lastRefreshedAt !== undefined;
    if (hasLastRefreshedVersion !== hasLastRefreshedAt) {
      throw new StorageValidationError(
        "candidate knowledge source refresh last-refreshed version and timestamp must be paired",
      );
    }
    const requestedLastRefreshedVersion = hasLastRefreshedVersion
      ? input.lastRefreshedVersionId === null
        ? null
        : requireNonEmpty(
            input.lastRefreshedVersionId as string,
            "candidate knowledge source refresh last-refreshed version id",
          ).trim()
      : undefined;
    const requestedLastRefreshedAt = hasLastRefreshedAt
      ? input.lastRefreshedAt === null
        ? null
        : requireTimestamp(
            input.lastRefreshedAt as string,
            "candidate knowledge source refresh lastRefreshedAt",
          )
      : undefined;
    if (
      requestedLastRefreshedAt !== undefined &&
      requestedLastRefreshedAt !== null &&
      Date.parse(requestedLastRefreshedAt) > Date.parse(checkedAt)
    ) {
      throw new StorageValidationError(
        "candidate knowledge source refresh lastRefreshedAt must not follow checkedAt",
      );
    }

    let result: CandidateKnowledgeSourceRefreshObservationRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      this.requireCandidateKnowledgeSource(normalizedKnowledgeBaseId, normalizedSourceId);
      this.requireCandidateKnowledgeSourceActive(normalizedSourceId);
      const latestRow = this.database
        .prepare(
          "SELECT id, version FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version DESC, id DESC LIMIT 1",
        )
        .get(normalizedSourceId);
      if (latestRow === undefined) {
        throw new StorageValidationError(
          `candidate knowledge source ${normalizedSourceId} has no versions`,
        );
      }
      const observed = this.database
        .prepare(
          "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
        )
        .get(observedVersionId, normalizedSourceId);
      if (observed === undefined) {
        throw new StorageValidationError(
          "candidate knowledge source refresh observed version does not belong to its source",
        );
      }
      if (requestedLastRefreshedVersion !== undefined && requestedLastRefreshedVersion !== null) {
        const refreshed = this.database
          .prepare(
            "SELECT id FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
          )
          .get(requestedLastRefreshedVersion, normalizedSourceId);
        if (refreshed === undefined) {
          throw new StorageValidationError(
            "candidate knowledge source refresh last-refreshed version does not belong to its source",
          );
        }
      }
      const currentRow = this.database
        .prepare(
          `SELECT source_id, observed_version_id, status, checked_at,
                  last_refreshed_version_id, last_refreshed_at
           FROM candidate_knowledge_source_refresh_observations
           WHERE source_id = ?`,
        )
        .get(normalizedSourceId);
      const current =
        currentRow === undefined
          ? undefined
          : candidateKnowledgeSourceRefreshObservationFromRow(
              currentRow,
              rowString(latestRow, "id"),
            );
      const lastRefreshedVersion =
        requestedLastRefreshedVersion === undefined
          ? (current?.lastRefreshedVersionId ?? null)
          : requestedLastRefreshedVersion;
      const lastRefreshedAt =
        requestedLastRefreshedAt === undefined
          ? (current?.lastRefreshedAt ?? null)
          : requestedLastRefreshedAt;
      if (requestedLastRefreshedVersion !== undefined && requestedLastRefreshedVersion !== null) {
        const currentRefreshVersion =
          current?.lastRefreshedVersionId === null || current?.lastRefreshedVersionId === undefined
            ? undefined
            : this.database
                .prepare(
                  "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
                )
                .get(current.lastRefreshedVersionId, normalizedSourceId);
        const requestedRefreshVersion = this.database
          .prepare(
            "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
          )
          .get(requestedLastRefreshedVersion, normalizedSourceId);
        const advances =
          currentRefreshVersion === undefined ||
          (requestedRefreshVersion !== undefined &&
            rowNumber(requestedRefreshVersion, "version") >
              rowNumber(currentRefreshVersion, "version"));
        if (
          advances &&
          (status !== "current" ||
            observedVersionId !== requestedLastRefreshedVersion ||
            lastRefreshedAt !== checkedAt)
        ) {
          throw new StorageValidationError(
            "candidate knowledge source refresh success must observe its refreshed version at its refresh time",
          );
        }
      }
      if (current !== undefined) {
        if (Date.parse(checkedAt) < Date.parse(current.checkedAt)) {
          throw new StorageValidationError(
            "candidate knowledge source refresh checkedAt must not precede its current checkedAt",
          );
        }
        if (current.lastRefreshedAt !== null) {
          if (lastRefreshedAt === null) {
            throw new StorageValidationError(
              "candidate knowledge source refresh cannot drop its last successful refresh",
            );
          }
          if (Date.parse(lastRefreshedAt) < Date.parse(current.lastRefreshedAt)) {
            throw new StorageValidationError(
              "candidate knowledge source refresh lastRefreshedAt must not precede its current value",
            );
          }
          if (
            current.lastRefreshedVersionId === lastRefreshedVersion &&
            Date.parse(lastRefreshedAt) !== Date.parse(current.lastRefreshedAt)
          ) {
            throw new StorageValidationError(
              "candidate knowledge source refresh cannot change the time of its last successful refresh",
            );
          }
          if (current.lastRefreshedVersionId !== null && lastRefreshedVersion !== null) {
            const currentRefreshVersion = this.database
              .prepare(
                "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
              )
              .get(current.lastRefreshedVersionId, normalizedSourceId);
            const nextRefreshVersion = this.database
              .prepare(
                "SELECT version FROM candidate_knowledge_source_versions WHERE id = ? AND source_id = ?",
              )
              .get(lastRefreshedVersion, normalizedSourceId);
            if (
              currentRefreshVersion !== undefined &&
              nextRefreshVersion !== undefined &&
              rowNumber(nextRefreshVersion, "version") < rowNumber(currentRefreshVersion, "version")
            ) {
              throw new StorageValidationError(
                "candidate knowledge source refresh version must not move backward",
              );
            }
          }
        }
      }
      if (currentRow === undefined) {
        this.database
          .prepare(
            `INSERT INTO candidate_knowledge_source_refresh_observations
               (source_id, observed_version_id, status, checked_at,
                last_refreshed_version_id, last_refreshed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            normalizedSourceId,
            observedVersionId,
            status,
            checkedAt,
            lastRefreshedVersion,
            lastRefreshedAt,
          );
      } else {
        this.database
          .prepare(
            `UPDATE candidate_knowledge_source_refresh_observations
             SET observed_version_id = ?, status = ?, checked_at = ?,
                 last_refreshed_version_id = ?, last_refreshed_at = ?
             WHERE source_id = ?`,
          )
          .run(
            observedVersionId,
            status,
            checkedAt,
            lastRefreshedVersion,
            lastRefreshedAt,
            normalizedSourceId,
          );
      }
      result = candidateKnowledgeSourceRefreshObservationFromRow(
        {
          source_id: normalizedSourceId,
          observed_version_id: observedVersionId,
          status,
          checked_at: checkedAt,
          last_refreshed_version_id: lastRefreshedVersion,
          last_refreshed_at: lastRefreshedAt,
        },
        rowString(latestRow, "id"),
      );
    })();
    return result as CandidateKnowledgeSourceRefreshObservationRecord;
  }

  public async rebindCandidateKnowledgeSourceOrigin(
    knowledgeBaseId: string,
    sourceId: string,
    originPath: string,
    boundAt: string,
  ): Promise<CandidateKnowledgeSourceOriginBindingRecord> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    const normalizedOriginPath = resolve(
      requireAbsolutePath(originPath, "candidate knowledge source origin path"),
    );
    const normalizedBoundAt = requireTimestamp(
      boundAt,
      "candidate knowledge source origin binding boundAt",
    );
    let result: CandidateKnowledgeSourceOriginBindingRecord | undefined;
    this.database.transaction(() => {
      this.requireActiveCandidateKnowledgeBase(normalizedKnowledgeBaseId);
      const source = this.requireCandidateKnowledgeSource(
        normalizedKnowledgeBaseId,
        normalizedSourceId,
      );
      if (source.kind !== "file") {
        throw new StorageValidationError(
          "Candidate knowledge source origin bindings require a file source",
        );
      }
      this.requireCandidateKnowledgeSourceActive(normalizedSourceId);
      const managed = this.database
        .prepare(
          `SELECT 1
           FROM candidate_knowledge_source_versions AS version
           JOIN candidate_knowledge_managed_source_versions AS managed
             ON managed.version_id = version.id
           WHERE version.source_id = ?
           LIMIT 1`,
        )
        .get(normalizedSourceId);
      if (managed === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge source origin bindings require a managed file source",
        );
      }
      const currentRow = this.database
        .prepare(
          "SELECT source_id, origin_path, bound_at FROM candidate_knowledge_source_origin_bindings WHERE source_id = ?",
        )
        .get(normalizedSourceId);
      if (currentRow === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge source origin binding does not exist",
        );
      }
      const current = candidateKnowledgeSourceOriginBindingFromRow(currentRow);
      if (current.originPath === normalizedOriginPath) {
        result = current;
        return;
      }
      if (Date.parse(normalizedBoundAt) < Date.parse(current.boundAt)) {
        throw new StorageValidationError(
          "Candidate knowledge source origin binding boundAt must not precede its current boundAt",
        );
      }
      const update = this.database
        .prepare(
          "UPDATE candidate_knowledge_source_origin_bindings SET origin_path = ?, bound_at = ? WHERE source_id = ?",
        )
        .run(normalizedOriginPath, normalizedBoundAt, normalizedSourceId);
      if (update.changes !== 1) {
        throw new StorageConflictError(
          "Candidate knowledge source origin binding could not be replaced",
        );
      }
      result = {
        sourceId: normalizedSourceId,
        originPath: normalizedOriginPath,
        boundAt: normalizedBoundAt,
      };
    })();
    return result as CandidateKnowledgeSourceOriginBindingRecord;
  }

  public async listCandidateKnowledgeSources(
    knowledgeBaseId: string,
  ): Promise<readonly CandidateKnowledgeSourceRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    return this.database
      .prepare(
        "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ? ORDER BY created_at, id",
      )
      .all(normalizedKnowledgeBaseId)
      .map(candidateKnowledgeSourceFromRow);
  }

  public async listCandidateKnowledgeSourceVersions(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<readonly CandidateKnowledgeSourceVersionRecord[]> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    const normalizedSourceId = requireNonEmpty(sourceId, "candidate knowledge source id").trim();
    this.requireCandidateKnowledgeBase(normalizedKnowledgeBaseId);
    this.requireCandidateKnowledgeSource(normalizedKnowledgeBaseId, normalizedSourceId);
    return this.database
      .prepare(
        "SELECT v.id, v.source_id, v.version, v.parent_version_id, v.media_type, v.checksum, v.size_bytes, v.created_at FROM candidate_knowledge_source_versions AS v JOIN candidate_knowledge_sources AS s ON s.id = v.source_id WHERE s.candidate_knowledge_base_id = ? AND v.source_id = ? ORDER BY v.version, v.id",
      )
      .all(normalizedKnowledgeBaseId, normalizedSourceId)
      .map(candidateKnowledgeSourceVersionFromRow);
  }

  public async getCandidateKnowledgeBaseLifecycleReadiness(
    knowledgeBaseId: string,
  ): Promise<CandidateKnowledgeBaseLifecycleReadinessRecord | undefined> {
    this.ensureOpen();
    const normalizedKnowledgeBaseId = requireNonEmpty(
      knowledgeBaseId,
      "candidate knowledge base id",
    ).trim();
    let result: CandidateKnowledgeBaseLifecycleReadinessRecord | undefined;
    this.database.transaction(() => {
      const knowledgeBaseRow = this.database
        .prepare(
          `SELECT id, display_name, description, state, is_default,
                  created_at, updated_at, archived_at
           FROM candidate_knowledge_bases
           WHERE id = ?`,
        )
        .get(normalizedKnowledgeBaseId);
      if (knowledgeBaseRow === undefined) {
        result = undefined;
        return;
      }
      const knowledgeBase = candidateKnowledgeBaseFromRow(knowledgeBaseRow);
      if (
        knowledgeBase.id !== normalizedKnowledgeBaseId ||
        (knowledgeBase.state !== "active" && knowledgeBase.state !== "archived") ||
        !isValidCandidateKnowledgeBaseLifecycleState(knowledgeBase)
      ) {
        throw new StorageValidationError("candidate knowledge base lifecycle state is malformed");
      }

      const sourceRows = this.database
        .prepare(
          `SELECT id, candidate_knowledge_base_id, kind, display_name, created_at
           FROM candidate_knowledge_sources
           WHERE candidate_knowledge_base_id = ?
           ORDER BY id`,
        )
        .all(normalizedKnowledgeBaseId);
      const sources: CandidateKnowledgeSourceLifecycleReadinessRecord[] = [];
      for (const sourceRow of sourceRows) {
        const source = candidateKnowledgeSourceFromRow(sourceRow);
        if (
          source.knowledgeBaseId !== normalizedKnowledgeBaseId ||
          (source.kind !== "file" && source.kind !== "url") ||
          source.id.trim() === "" ||
          source.displayName.trim() === ""
        ) {
          throw new StorageValidationError(
            "candidate knowledge source lifecycle state is malformed",
          );
        }
        const sourceCreatedAt = requireTimestamp(
          source.createdAt,
          `candidate knowledge source ${source.id} createdAt`,
        );

        const versionRows = this.database
          .prepare(
            `SELECT id, source_id, version, parent_version_id,
                    media_type, checksum, size_bytes, created_at
             FROM candidate_knowledge_source_versions
             WHERE source_id = ?
             ORDER BY version, id`,
          )
          .all(source.id);
        if (versionRows.length === 0) {
          throw new StorageValidationError(
            `candidate knowledge source ${source.id} has no source versions`,
          );
        }
        const versions = versionRows.map(candidateKnowledgeSourceVersionFromRow);
        const versionIds = new Set<string>();
        let previousVersionId: string | null = null;
        let previousVersionCreatedAt = sourceCreatedAt;
        for (const [index, version] of versions.entries()) {
          if (
            version.sourceId !== source.id ||
            version.id.trim() === "" ||
            versionIds.has(version.id) ||
            !Number.isSafeInteger(version.version) ||
            version.version !== index + 1 ||
            version.parentVersionId !== previousVersionId ||
            version.mediaType.trim() === "" ||
            !/^[0-9a-f]{64}$/.test(version.checksum) ||
            !Number.isSafeInteger(version.sizeBytes) ||
            version.sizeBytes < 0
          ) {
            throw new StorageValidationError(
              `candidate knowledge source ${source.id} version chain is malformed`,
            );
          }
          const versionCreatedAt = requireTimestamp(
            version.createdAt,
            `candidate knowledge source version ${version.id} createdAt`,
          );
          if (Date.parse(versionCreatedAt) < Date.parse(previousVersionCreatedAt)) {
            throw new StorageValidationError(
              `candidate knowledge source ${source.id} version chronology is malformed`,
            );
          }
          versionIds.add(version.id);
          previousVersionId = version.id;
          previousVersionCreatedAt = versionCreatedAt;
        }
        const latestVersion = versions[versions.length - 1];
        if (latestVersion === undefined) {
          throw new StorageValidationError(
            `candidate knowledge source ${source.id} has no latest version`,
          );
        }
        const latestVersionCreatedAt = requireTimestamp(
          latestVersion.createdAt,
          `candidate knowledge source ${source.id} latest version createdAt`,
        );
        const managedRow = this.database
          .prepare(
            `SELECT version_id
             FROM candidate_knowledge_managed_source_versions
             WHERE version_id = ?`,
          )
          .get(latestVersion.id);
        const managed = managedRow !== undefined;

        const provenanceRows = this.database
          .prepare(
            `SELECT provenance.source_id, provenance.version_id,
                    provenance.original_url, provenance.final_url,
                    provenance.fetched_at, provenance.kind,
                    0 AS restored,
                    version.source_id AS version_source_id,
                    source.candidate_knowledge_base_id AS version_knowledge_base_id
             FROM candidate_knowledge_source_url_provenance AS provenance
             LEFT JOIN candidate_knowledge_source_versions AS version
               ON version.id = provenance.version_id
             LEFT JOIN candidate_knowledge_sources AS source
               ON source.id = version.source_id
             WHERE provenance.source_id = ? OR version.source_id = ?
             UNION ALL
             SELECT provenance.source_id, provenance.version_id,
                    NULL AS original_url, NULL AS final_url,
                    provenance.fetched_at, provenance.kind,
                    1 AS restored,
                    version.source_id AS version_source_id,
                    source.candidate_knowledge_base_id AS version_knowledge_base_id
             FROM candidate_knowledge_source_restored_url_provenance AS provenance
             LEFT JOIN candidate_knowledge_source_versions AS version
               ON version.id = provenance.version_id
             LEFT JOIN candidate_knowledge_sources AS source
               ON source.id = version.source_id
             WHERE provenance.source_id = ? OR version.source_id = ?
             ORDER BY provenance.version_id`,
          )
          .all(source.id, source.id, source.id, source.id);
        const provenanceByVersion = new Map<
          string,
          CandidateKnowledgeSourcePortableUrlProvenance
        >();
        let provenanceOriginalUrl: string | undefined;
        for (const provenanceRow of provenanceRows) {
          const versionSourceId = rowNullableString(provenanceRow, "version_source_id");
          const versionKnowledgeBaseId = rowNullableString(
            provenanceRow,
            "version_knowledge_base_id",
          );
          const restored = rowNumber(provenanceRow, "restored") === 1;
          const provenanceSourceId = rowString(provenanceRow, "source_id");
          const provenanceVersionId = rowString(provenanceRow, "version_id");
          if (
            provenanceSourceId !== source.id ||
            versionSourceId !== source.id ||
            versionKnowledgeBaseId !== normalizedKnowledgeBaseId ||
            !versionIds.has(provenanceVersionId)
          ) {
            throw new StorageValidationError(
              "candidate knowledge source URL provenance is malformed or out of scope",
            );
          }
          const version = versions.find((candidate) => candidate.id === provenanceVersionId);
          if (version === undefined) {
            throw new StorageValidationError(
              "candidate knowledge source URL provenance version is malformed",
            );
          }
          const fetchedAt = requireTimestamp(
            rowString(provenanceRow, "fetched_at"),
            "candidate knowledge source URL fetchedAt",
          );
          if (Date.parse(fetchedAt) !== Date.parse(version.createdAt)) {
            throw new StorageValidationError(
              "candidate knowledge source URL provenance is malformed",
            );
          }
          const kind = rowString(provenanceRow, "kind") as CandidateKnowledgeSourceUrlKind;
          if (!candidateKnowledgeSourceUrlKinds.includes(kind)) {
            throw new StorageValidationError(
              "candidate knowledge source URL provenance is malformed",
            );
          }
          if (!restored) {
            const provenance = candidateKnowledgeSourceUrlProvenanceFromRow(provenanceRow);
            const normalizedProvenance = normalizeCandidateKnowledgeSourceUrlProvenance(provenance);
            if (
              normalizedProvenance.originalUrl !== provenance.originalUrl ||
              normalizedProvenance.finalUrl !== provenance.finalUrl
            ) {
              throw new StorageValidationError(
                "candidate knowledge source URL provenance is malformed",
              );
            }
            if (
              provenanceOriginalUrl !== undefined &&
              provenanceOriginalUrl !== normalizedProvenance.originalUrl
            ) {
              throw new StorageValidationError(
                "candidate knowledge source URL provenance is contradictory",
              );
            }
            provenanceOriginalUrl = normalizedProvenance.originalUrl;
          }
          if (provenanceByVersion.has(provenanceVersionId)) {
            throw new StorageValidationError(
              "candidate knowledge source URL provenance is duplicated",
            );
          }
          provenanceByVersion.set(provenanceVersionId, { fetchedAt, kind });
        }
        if (source.kind === "file" && provenanceRows.length > 0) {
          throw new StorageValidationError(
            "candidate knowledge source file contains URL provenance",
          );
        }
        if (source.kind === "url" && managed && !provenanceByVersion.has(latestVersion.id)) {
          throw new StorageValidationError(
            "managed candidate knowledge URL source has no latest provenance",
          );
        }
        const latestProvenance = provenanceByVersion.get(latestVersion.id);

        const originRows = this.database
          .prepare(
            `SELECT source_id, origin_path, bound_at
             FROM candidate_knowledge_source_origin_bindings
             WHERE source_id = ?`,
          )
          .all(source.id);
        if (originRows.length > 1) {
          throw new StorageValidationError(
            "candidate knowledge source origin binding is duplicated",
          );
        }
        let origin: CandidateKnowledgeSourceOriginBindingRecord | undefined;
        if (originRows[0] !== undefined) {
          origin = candidateKnowledgeSourceOriginBindingFromRow(originRows[0]);
          if (origin.sourceId !== source.id || source.kind !== "file") {
            throw new StorageValidationError(
              "candidate knowledge source origin binding is malformed",
            );
          }
          requireCanonicalAbsolutePath(
            origin.originPath,
            `candidate knowledge source ${source.id} origin path`,
          );
          const originBoundAt = requireTimestamp(
            origin.boundAt,
            `candidate knowledge source ${source.id} origin boundAt`,
          );
          if (Date.parse(originBoundAt) < Date.parse(sourceCreatedAt)) {
            throw new StorageValidationError(
              `candidate knowledge source ${source.id} origin chronology is malformed`,
            );
          }
        }

        const observationRows = this.database
          .prepare(
            `SELECT source_id, observed_version_id, status, checked_at,
                    last_refreshed_version_id, last_refreshed_at
             FROM candidate_knowledge_source_refresh_observations
             WHERE source_id = ?`,
          )
          .all(source.id);
        if (observationRows.length > 1) {
          throw new StorageValidationError(
            "candidate knowledge source refresh observation is duplicated",
          );
        }
        let observation: CandidateKnowledgeSourceLifecycleObservationRevision | null = null;
        if (observationRows[0] !== undefined) {
          const observed = candidateKnowledgeSourceRefreshObservationFromRow(
            observationRows[0],
            latestVersion.id,
          );
          if (
            observed.sourceId !== source.id ||
            !versionIds.has(observed.observedVersionId) ||
            (observed.lastRefreshedVersionId !== null &&
              !versionIds.has(observed.lastRefreshedVersionId)) ||
            (observed.lastRefreshedVersionId === null) !== (observed.lastRefreshedAt === null)
          ) {
            throw new StorageValidationError(
              "candidate knowledge source refresh observation is malformed",
            );
          }
          requireCandidateKnowledgeSourceRefreshObservationStatus(observed.status);
          const checkedAt = requireTimestamp(
            observed.checkedAt,
            `candidate knowledge source ${source.id} refresh checkedAt`,
          );
          const observedVersion = versions.find(
            (version) => version.id === observed.observedVersionId,
          );
          if (observedVersion === undefined) {
            throw new StorageValidationError(
              `candidate knowledge source ${source.id} refresh observed version is malformed`,
            );
          }
          const observedVersionCreatedAt = requireTimestamp(
            observedVersion.createdAt,
            `candidate knowledge source ${source.id} observed version createdAt`,
          );
          if (Date.parse(checkedAt) < Date.parse(observedVersionCreatedAt)) {
            throw new StorageValidationError(
              `candidate knowledge source ${source.id} refresh chronology is malformed`,
            );
          }
          if (observed.lastRefreshedAt !== null) {
            const lastRefreshedAt = requireTimestamp(
              observed.lastRefreshedAt,
              `candidate knowledge source ${source.id} lastRefreshedAt`,
            );
            if (Date.parse(lastRefreshedAt) > Date.parse(checkedAt)) {
              throw new StorageValidationError(
                `candidate knowledge source ${source.id} refresh chronology is malformed`,
              );
            }
            const lastRefreshedVersion = versions.find(
              (version) => version.id === observed.lastRefreshedVersionId,
            );
            if (lastRefreshedVersion === undefined) {
              throw new StorageValidationError(
                `candidate knowledge source ${source.id} last-refreshed version is malformed`,
              );
            }
            const lastRefreshedVersionCreatedAt = requireTimestamp(
              lastRefreshedVersion.createdAt,
              `candidate knowledge source ${source.id} last-refreshed version createdAt`,
            );
            if (Date.parse(lastRefreshedAt) < Date.parse(lastRefreshedVersionCreatedAt)) {
              throw new StorageValidationError(
                `candidate knowledge source ${source.id} refresh chronology is malformed`,
              );
            }
          }
          observation = {
            observedVersionId: observed.observedVersionId,
            status: observed.status,
            checkedAt,
            lastRefreshedVersionId: observed.lastRefreshedVersionId,
            lastRefreshedAt: observed.lastRefreshedAt,
            stale: observed.stale,
          };
        }

        const retirementRows = this.database
          .prepare(
            `SELECT source_id, retired_at, reason
             FROM candidate_knowledge_source_retirements
             WHERE source_id = ?`,
          )
          .all(source.id);
        if (retirementRows.length > 1) {
          throw new StorageValidationError("candidate knowledge source retirement is duplicated");
        }
        let retirement: CandidateKnowledgeSourceLifecycleRetirementRevision | null = null;
        if (retirementRows[0] !== undefined) {
          const record = candidateKnowledgeSourceRetirementFromRow(retirementRows[0]);
          if (record.sourceId !== source.id || record.reason !== "user-requested") {
            throw new StorageValidationError("candidate knowledge source retirement is malformed");
          }
          const retiredAt = requireTimestamp(
            record.retiredAt,
            `candidate knowledge source ${source.id} retiredAt`,
          );
          if (Date.parse(retiredAt) < Date.parse(latestVersionCreatedAt)) {
            throw new StorageValidationError(
              `candidate knowledge source ${source.id} retirement chronology is malformed`,
            );
          }
          retirement = { retiredAt, reason: record.reason };
        }

        const directoryRows = this.database
          .prepare(
            `SELECT directory_id, candidate_knowledge_base_id, source_id,
                    revision, relative_path_hash, bound_at
             FROM candidate_knowledge_directory_current_members
             WHERE candidate_knowledge_base_id = ? AND source_id = ?`,
          )
          .all(normalizedKnowledgeBaseId, source.id);
        const allScopedDirectoryRows = this.database
          .prepare(
            `SELECT directory_id, candidate_knowledge_base_id, source_id,
                    revision, relative_path_hash, bound_at
             FROM candidate_knowledge_directory_current_members
             WHERE source_id = ?`,
          )
          .all(source.id);
        if (allScopedDirectoryRows.length > 1 || directoryRows.length > 1) {
          throw new StorageValidationError(
            `candidate knowledge source ${source.id} has ambiguous directory membership`,
          );
        }
        if (allScopedDirectoryRows.length !== directoryRows.length) {
          throw new StorageValidationError(
            `candidate knowledge source ${source.id} directory membership is out of scope`,
          );
        }
        let directory: CandidateKnowledgeSourceLifecycleDirectoryRevision | null = null;
        let directoryOriginConflict = false;
        if (directoryRows[0] !== undefined) {
          const member = candidateKnowledgeDirectoryMemberRevisionFromRow(directoryRows[0]);
          if (
            member.directoryId.trim() === "" ||
            member.knowledgeBaseId !== normalizedKnowledgeBaseId ||
            member.sourceId !== source.id ||
            !Number.isSafeInteger(member.revision) ||
            member.revision < 1 ||
            !/^[0-9a-f]{64}$/.test(member.relativePathHash)
          ) {
            throw new StorageValidationError("candidate knowledge directory member is malformed");
          }
          const rootRows = this.database
            .prepare(
              `SELECT id, candidate_knowledge_base_id, root_path, bound_at, revision
               FROM candidate_knowledge_directory_current_roots
               WHERE candidate_knowledge_base_id = ? AND id = ?`,
            )
            .all(normalizedKnowledgeBaseId, member.directoryId);
          if (rootRows.length !== 1) {
            throw new StorageValidationError("candidate knowledge directory root is malformed");
          }
          const root = rootRows[0];
          if (root === undefined) {
            throw new StorageValidationError("candidate knowledge directory root is malformed");
          }
          if (
            rowString(root, "id") !== member.directoryId ||
            rowString(root, "candidate_knowledge_base_id") !== normalizedKnowledgeBaseId ||
            !Number.isSafeInteger(rowNumber(root, "revision")) ||
            rowNumber(root, "revision") < 1
          ) {
            throw new StorageValidationError("candidate knowledge directory root is malformed");
          }
          const rootPath = requireCanonicalAbsolutePath(
            rowString(root, "root_path"),
            `candidate knowledge directory ${member.directoryId} root path`,
          );
          const rootBoundAt = requireTimestamp(
            rowString(root, "bound_at"),
            `candidate knowledge directory ${member.directoryId} root boundAt`,
          );
          const memberBoundAt = requireTimestamp(
            member.boundAt,
            `candidate knowledge directory member ${source.id} boundAt`,
          );
          if (Date.parse(memberBoundAt) < Date.parse(sourceCreatedAt)) {
            throw new StorageValidationError(
              `candidate knowledge directory member ${source.id} chronology is malformed`,
            );
          }
          const memberRows = this.database
            .prepare(
              `SELECT directory_id, candidate_knowledge_base_id, source_id,
                      revision, relative_path_hash, bound_at
               FROM candidate_knowledge_directory_current_members
               WHERE candidate_knowledge_base_id = ? AND directory_id = ?
               ORDER BY source_id`,
            )
            .all(normalizedKnowledgeBaseId, member.directoryId);
          const memberHashes = new Set<string>();
          const memberSources = new Set<string>();
          for (const memberRow of memberRows) {
            const current = candidateKnowledgeDirectoryMemberRevisionFromRow(memberRow);
            if (
              current.directoryId !== member.directoryId ||
              current.knowledgeBaseId !== normalizedKnowledgeBaseId ||
              current.sourceId.trim() === "" ||
              !/^[0-9a-f]{64}$/.test(current.relativePathHash) ||
              memberHashes.has(current.relativePathHash) ||
              memberSources.has(current.sourceId) ||
              !Number.isSafeInteger(current.revision) ||
              current.revision < 1
            ) {
              throw new StorageValidationError(
                "candidate knowledge directory membership is malformed",
              );
            }
            const currentMemberBoundAt = requireTimestamp(
              current.boundAt,
              `candidate knowledge directory member ${current.sourceId} boundAt`,
            );
            const currentSource = this.requireCandidateKnowledgeSource(
              normalizedKnowledgeBaseId,
              current.sourceId,
            );
            if (currentSource.kind !== "file") {
              throw new StorageValidationError(
                "candidate knowledge directory membership contains a non-file source",
              );
            }
            const currentSourceCreatedAt = requireTimestamp(
              currentSource.createdAt,
              `candidate knowledge source ${current.sourceId} createdAt`,
            );
            if (Date.parse(currentMemberBoundAt) < Date.parse(currentSourceCreatedAt)) {
              throw new StorageValidationError(
                "candidate knowledge directory membership chronology is malformed",
              );
            }
            const currentManaged = this.database
              .prepare(
                `SELECT version.id
                 FROM candidate_knowledge_source_versions AS version
                 JOIN candidate_knowledge_managed_source_versions AS managed
                   ON managed.version_id = version.id
                 WHERE version.source_id = ?
                 LIMIT 1`,
              )
              .get(current.sourceId);
            if (currentManaged === undefined) {
              throw new StorageValidationError(
                "candidate knowledge directory membership contains an unmanaged source",
              );
            }
            memberHashes.add(current.relativePathHash);
            memberSources.add(current.sourceId);
          }
          if (!memberHashes.has(member.relativePathHash)) {
            throw new StorageValidationError(
              "candidate knowledge directory membership is incomplete",
            );
          }
          if (origin !== undefined) {
            directoryOriginConflict =
              directoryMemberOriginRelation(
                rootPath,
                origin.originPath,
                member.relativePathHash,
                memberHashes,
              ) !== "same-member";
          } else {
            directoryOriginConflict = true;
          }
          directory = {
            directoryId: member.directoryId,
            rootRevision: rowNumber(root, "revision"),
            rootBoundAt,
            memberRevision: member.revision,
            memberBoundAt,
          };
        }

        const reasons: CandidateKnowledgeSourceLifecycleBlockerReason[] = [];
        if (knowledgeBase.state === "archived") reasons.push("knowledge-base-archived");
        if (retirement !== null) reasons.push("source-retired");
        if (!managed) reasons.push("latest-version-unmanaged");
        if (source.kind === "file" && origin === undefined) {
          reasons.push("source-origin-unbound");
        }
        if (directory !== null && directoryOriginConflict) {
          reasons.push("directory-origin-conflict");
        }
        if (observation !== null) {
          if (observation.stale) reasons.push("refresh-stale");
          if (observation.status !== "current") {
            reasons.push(
              `refresh-${observation.status}` as CandidateKnowledgeSourceLifecycleBlockerReason,
            );
          }
        }
        const lifecycleRevision: CandidateKnowledgeSourceLifecycleRevision = {
          knowledgeBaseState: knowledgeBase.state,
          knowledgeBaseArchivedAt: knowledgeBase.archivedAt,
          versionId: latestVersion.id,
          version: latestVersion.version,
          createdAt: latestVersion.createdAt,
          managed,
          originBoundAt: origin?.boundAt ?? null,
          observation,
          retirement,
          provenanceFetchedAt: latestProvenance?.fetchedAt ?? null,
          directory,
        };
        sources.push({
          sourceId: source.id,
          latestVersionId: latestVersion.id,
          status: reasons.length === 0 ? "ready" : "blocked",
          reasons,
          lifecycleRevision,
        });
      }
      result = freezeCandidateKnowledgeBaseLifecycleReadiness({
        knowledgeBaseId: normalizedKnowledgeBaseId,
        state: knowledgeBase.state,
        archivedAt: knowledgeBase.archivedAt,
        sources,
      });
    })();
    return result;
  }

  public validateCandidateKnowledgeSourceGraph(): void {
    this.ensureOpen();
    const foreignKeyViolations = this.database.pragma("foreign_key_check");
    if (Array.isArray(foreignKeyViolations) && foreignKeyViolations.length > 0) {
      throw new StorageValidationError(
        "Candidate knowledge store contains invalid source relationships.",
      );
    }
    const sources = this.database
      .prepare("SELECT id, created_at FROM candidate_knowledge_sources ORDER BY id")
      .all<{ readonly id: string; readonly created_at: string }>();
    const selectVersions = this.database.prepare(
      "SELECT id, version, parent_version_id, created_at FROM candidate_knowledge_source_versions WHERE source_id = ? ORDER BY version, id",
    );
    for (const source of sources) {
      const sourceCreatedAt = requireTimestamp(
        source.created_at,
        `candidate knowledge source ${source.id} createdAt`,
      );
      const versions = selectVersions.all<{
        readonly id: string;
        readonly version: number;
        readonly parent_version_id: string | null;
        readonly created_at: string;
      }>(source.id);
      if (versions.length === 0) {
        throw new StorageValidationError(
          `Candidate knowledge source ${source.id} has no source versions.`,
        );
      }
      let previousId: string | null = null;
      let previousCreatedAt = sourceCreatedAt;
      for (const [index, version] of versions.entries()) {
        if (version.version !== index + 1 || version.parent_version_id !== previousId) {
          throw new StorageValidationError(
            `Candidate knowledge source ${source.id} has an invalid version chain.`,
          );
        }
        const versionCreatedAt = requireTimestamp(
          version.created_at,
          `candidate knowledge source version ${version.id} createdAt`,
        );
        if (Date.parse(versionCreatedAt) < Date.parse(previousCreatedAt)) {
          throw new StorageValidationError(
            `Candidate knowledge source ${source.id} has an invalid version timestamp order.`,
          );
        }
        previousId = version.id;
        previousCreatedAt = versionCreatedAt;
      }
    }
    const managedVersions = this.database
      .prepare(
        `SELECT m.version_id, v.source_id, v.created_at, s.kind
         FROM candidate_knowledge_managed_source_versions AS m
         JOIN candidate_knowledge_source_versions AS v ON v.id = m.version_id
         JOIN candidate_knowledge_sources AS s ON s.id = v.source_id
         ORDER BY v.source_id, v.version, v.id`,
      )
      .all<{
        readonly version_id: string;
        readonly source_id: string;
        readonly created_at: string;
        readonly kind: string;
      }>();
    const selectUrlProvenance = this.database.prepare(
      `SELECT source_id, version_id, original_url, final_url, fetched_at, kind, 0 AS restored
       FROM candidate_knowledge_source_url_provenance
       WHERE version_id = ?
       UNION ALL
       SELECT source_id, version_id, NULL AS original_url, NULL AS final_url,
              fetched_at, kind, 1 AS restored
       FROM candidate_knowledge_source_restored_url_provenance
       WHERE version_id = ?`,
    );
    for (const managed of managedVersions) {
      if (managed.kind === "file") {
        if (selectUrlProvenance.get(managed.version_id, managed.version_id) !== undefined) {
          throw new StorageValidationError(
            "Candidate knowledge store contains URL provenance for a file version.",
          );
        }
        continue;
      }
      if (managed.kind !== "url") {
        throw new StorageValidationError(
          "Candidate knowledge store contains a managed version for an unsupported source.",
        );
      }
      const provenanceRow = selectUrlProvenance.get(managed.version_id, managed.version_id);
      if (provenanceRow === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a managed URL version without provenance.",
        );
      }
      if (rowNumber(provenanceRow, "restored") === 1) {
        if (
          rowString(provenanceRow, "source_id") !== managed.source_id ||
          rowString(provenanceRow, "version_id") !== managed.version_id ||
          Date.parse(
            requireTimestamp(
              rowString(provenanceRow, "fetched_at"),
              "candidate knowledge restored URL fetchedAt",
            ),
          ) !== Date.parse(managed.created_at) ||
          !candidateKnowledgeSourceUrlKinds.includes(
            rowString(provenanceRow, "kind") as CandidateKnowledgeSourceUrlKind,
          )
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains invalid restored URL provenance.",
          );
        }
      } else {
        const provenance = candidateKnowledgeSourceUrlProvenanceFromRow(provenanceRow);
        const normalizedProvenance = normalizeCandidateKnowledgeSourceUrlProvenance(provenance);
        if (
          provenance.sourceId !== managed.source_id ||
          provenance.versionId !== managed.version_id ||
          normalizedProvenance.originalUrl !== provenance.originalUrl ||
          normalizedProvenance.finalUrl !== provenance.finalUrl ||
          Date.parse(normalizedProvenance.fetchedAt) !== Date.parse(managed.created_at)
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains invalid managed URL provenance.",
          );
        }
      }
    }
    const originBindings = this.database
      .prepare(
        `SELECT binding.source_id, binding.origin_path, binding.bound_at, source.kind,
                EXISTS (
                  SELECT 1
                  FROM candidate_knowledge_source_versions AS version
                  JOIN candidate_knowledge_managed_source_versions AS managed
                    ON managed.version_id = version.id
                  WHERE version.source_id = source.id
                ) AS has_managed_version
         FROM candidate_knowledge_source_origin_bindings AS binding
         JOIN candidate_knowledge_sources AS source ON source.id = binding.source_id
         ORDER BY binding.source_id`,
      )
      .all<{
        readonly source_id: string;
        readonly origin_path: string;
        readonly bound_at: string;
        readonly kind: string;
        readonly has_managed_version: number;
      }>();
    for (const binding of originBindings) {
      if (binding.kind !== "file" || binding.has_managed_version !== 1) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an origin binding for an unmanaged source.",
        );
      }
      requireAbsolutePath(
        binding.origin_path,
        `candidate knowledge source ${binding.source_id} origin path`,
      );
      requireTimestamp(
        binding.bound_at,
        `candidate knowledge source ${binding.source_id} origin binding boundAt`,
      );
    }

    const directoryRootRevisions = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, revision, root_path, bound_at
         FROM candidate_knowledge_directory_root_revisions
         ORDER BY candidate_knowledge_base_id, directory_id, revision`,
      )
      .all<{
        readonly directory_id: string;
        readonly candidate_knowledge_base_id: string;
        readonly revision: number;
        readonly root_path: string;
        readonly bound_at: string;
      }>();
    const revisionByDirectory = new Map<string, number>();
    for (const revision of directoryRootRevisions) {
      const directoryId = requireNonEmpty(
        revision.directory_id,
        "candidate knowledge directory root revision directory id",
      );
      const directoryKnowledgeBaseId = requireNonEmpty(
        revision.candidate_knowledge_base_id,
        "candidate knowledge directory root revision knowledgeBaseId",
      );
      this.requireCandidateKnowledgeBase(directoryKnowledgeBaseId);
      const rootPath = requireCanonicalAbsolutePath(
        revision.root_path,
        `candidate knowledge directory ${directoryId} root revision path`,
      );
      if (rootPath !== revision.root_path || !Number.isSafeInteger(revision.revision)) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid directory root revision.",
        );
      }
      const boundAt = requireTimestamp(
        revision.bound_at,
        `candidate knowledge directory ${directoryId} root revision boundAt`,
      );
      const key = `${directoryKnowledgeBaseId}\u0000${directoryId}`;
      const previousRevision = revisionByDirectory.get(key);
      if (
        (previousRevision === undefined && revision.revision !== 1) ||
        (previousRevision !== undefined && revision.revision !== previousRevision + 1)
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a non-contiguous directory root revision.",
        );
      }
      if (previousRevision !== undefined) {
        const previous = directoryRootRevisions.find(
          (candidate) =>
            candidate.candidate_knowledge_base_id === directoryKnowledgeBaseId &&
            candidate.directory_id === directoryId &&
            candidate.revision === previousRevision,
        );
        if (previous !== undefined && Date.parse(boundAt) < Date.parse(previous.bound_at)) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a directory root revision timestamp regression.",
          );
        }
      }
      const binding = this.database
        .prepare(
          `SELECT id, root_path, bound_at
           FROM candidate_knowledge_directory_bindings
           WHERE id = ? AND candidate_knowledge_base_id = ?`,
        )
        .get(directoryId, directoryKnowledgeBaseId);
      if (binding === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a directory root revision without a binding.",
        );
      }
      const bindingBoundAt = requireTimestamp(
        rowString(binding, "bound_at"),
        `candidate knowledge directory ${directoryId} binding boundAt`,
      );
      const bindingRootPath = requireCanonicalAbsolutePath(
        rowString(binding, "root_path"),
        `candidate knowledge directory ${directoryId} binding root path`,
      );
      if (revision.revision === 1 && (rootPath !== bindingRootPath || boundAt !== bindingBoundAt)) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a revision-one root baseline mismatch.",
        );
      }
      if (Date.parse(boundAt) < Date.parse(bindingBoundAt)) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a directory root revision before its binding.",
        );
      }
      revisionByDirectory.set(key, revision.revision);
    }
    const directoryBindingKeys = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id
         FROM candidate_knowledge_directory_bindings`,
      )
      .all<{
        readonly id: string;
        readonly candidate_knowledge_base_id: string;
      }>();
    for (const binding of directoryBindingKeys) {
      const key = `${binding.candidate_knowledge_base_id}\u0000${binding.id}`;
      if (!revisionByDirectory.has(key)) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a directory binding without root revisions.",
        );
      }
    }

    const directoryBaselineMembers = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_members
         ORDER BY candidate_knowledge_base_id, directory_id, source_id`,
      )
      .all<{
        readonly directory_id: string;
        readonly candidate_knowledge_base_id: string;
        readonly source_id: string;
        readonly relative_path_hash: string;
      }>();
    const baselineByMember = new Map<string, (typeof directoryBaselineMembers)[number]>();
    for (const member of directoryBaselineMembers) {
      const key = `${member.candidate_knowledge_base_id}\u0000${member.directory_id}\u0000${member.source_id}`;
      if (baselineByMember.has(key)) {
        throw new StorageValidationError(
          "Candidate knowledge store contains duplicate directory member identity.",
        );
      }
      baselineByMember.set(key, member);
    }
    const directoryMemberRevisions = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id,
                revision, relative_path_hash, bound_at
         FROM candidate_knowledge_directory_member_revisions
         ORDER BY candidate_knowledge_base_id, directory_id, source_id, revision`,
      )
      .all<{
        readonly directory_id: string;
        readonly candidate_knowledge_base_id: string;
        readonly source_id: string;
        readonly revision: number;
        readonly relative_path_hash: string;
        readonly bound_at: string;
      }>();
    const selectDirectoryRevisionManaged = this.database.prepare(
      `SELECT version.id
       FROM candidate_knowledge_source_versions AS version
       JOIN candidate_knowledge_managed_source_versions AS managed
         ON managed.version_id = version.id
       WHERE version.source_id = ?
       LIMIT 1`,
    );
    const memberRevisionByIdentity = new Map<
      string,
      { readonly revision: number; readonly hash: string; readonly boundAt: string }
    >();
    const memberHistoricalHashes = new Map<string, string>();
    const memberRevisionKeys = new Set<string>();
    for (const revision of directoryMemberRevisions) {
      const directoryId = requireNonEmpty(
        revision.directory_id,
        "candidate knowledge directory member revision directory id",
      );
      const directoryKnowledgeBaseId = requireNonEmpty(
        revision.candidate_knowledge_base_id,
        "candidate knowledge directory member revision knowledgeBaseId",
      );
      const sourceId = requireNonEmpty(
        revision.source_id,
        "candidate knowledge directory member revision source id",
      );
      this.requireCandidateKnowledgeBase(directoryKnowledgeBaseId);
      if (
        !Number.isSafeInteger(revision.revision) ||
        revision.revision < 1 ||
        !/^[0-9a-f]{64}$/.test(revision.relative_path_hash)
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid directory member revision.",
        );
      }
      const boundAt = requireTimestamp(
        revision.bound_at,
        `candidate knowledge directory member ${sourceId} revision boundAt`,
      );
      const identity = `${directoryKnowledgeBaseId}\u0000${directoryId}\u0000${sourceId}`;
      const baseline = baselineByMember.get(identity);
      if (baseline === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a directory member revision without a baseline member.",
        );
      }
      if (
        baseline.directory_id !== directoryId ||
        baseline.candidate_knowledge_base_id !== directoryKnowledgeBaseId ||
        baseline.source_id !== sourceId
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a malformed directory member revision scope.",
        );
      }
      const source = this.requireCandidateKnowledgeSource(directoryKnowledgeBaseId, sourceId);
      if (source.kind !== "file") {
        throw new StorageValidationError(
          "Candidate knowledge store contains a non-file directory member revision.",
        );
      }
      const sourceCreatedAt = requireTimestamp(
        source.createdAt,
        `candidate knowledge source ${sourceId} createdAt`,
      );
      if (Date.parse(boundAt) < Date.parse(sourceCreatedAt)) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a directory member revision before source creation.",
        );
      }
      if (selectDirectoryRevisionManaged.get(sourceId) === undefined) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an unmanaged directory member revision.",
        );
      }
      const previous = memberRevisionByIdentity.get(identity);
      if (
        (previous === undefined && revision.revision !== 1) ||
        (previous !== undefined && revision.revision !== previous.revision + 1)
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a non-contiguous directory member revision.",
        );
      }
      if (previous !== undefined && Date.parse(boundAt) < Date.parse(previous.boundAt)) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a directory member revision timestamp regression.",
        );
      }
      if (revision.revision === 1) {
        const binding = this.database
          .prepare(
            `SELECT bound_at
             FROM candidate_knowledge_directory_bindings
             WHERE id = ? AND candidate_knowledge_base_id = ?`,
          )
          .get(directoryId, directoryKnowledgeBaseId);
        if (binding === undefined) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a directory member revision without a binding.",
          );
        }
        const directoryBoundAt = requireTimestamp(
          rowString(binding, "bound_at"),
          `candidate knowledge directory ${directoryId} binding boundAt`,
        );
        const expectedBaselineBoundAt = directoryMemberRevisionBaselineBoundAt(
          directoryBoundAt,
          sourceCreatedAt,
        );
        if (
          revision.relative_path_hash !== baseline.relative_path_hash ||
          boundAt !== expectedBaselineBoundAt
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains invalid directory membership revision-one baseline mismatch.",
          );
        }
      }
      const historicalHashKey = `${directoryKnowledgeBaseId}\u0000${directoryId}\u0000${revision.relative_path_hash}`;
      const historicalOwner = memberHistoricalHashes.get(historicalHashKey);
      if (historicalOwner !== undefined && historicalOwner !== sourceId) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a directory member hash claimed by multiple sources.",
        );
      }
      memberHistoricalHashes.set(historicalHashKey, sourceId);
      memberRevisionKeys.add(identity);
      memberRevisionByIdentity.set(identity, {
        revision: revision.revision,
        hash: revision.relative_path_hash,
        boundAt,
      });
    }
    if (memberRevisionKeys.size !== baselineByMember.size) {
      throw new StorageValidationError(
        "Candidate knowledge store contains a directory member without a complete revision history.",
      );
    }
    const currentDirectoryMemberRows = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id,
                revision, relative_path_hash, bound_at
         FROM candidate_knowledge_directory_current_members
         ORDER BY candidate_knowledge_base_id, directory_id, source_id`,
      )
      .all<{
        readonly directory_id: string;
        readonly candidate_knowledge_base_id: string;
        readonly source_id: string;
        readonly revision: number;
        readonly relative_path_hash: string;
        readonly bound_at: string;
      }>();
    const currentMemberKeys = new Set<string>();
    const currentMemberSourceDirectories = new Map<string, string>();
    for (const member of currentDirectoryMemberRows) {
      const identity = `${member.candidate_knowledge_base_id}\u0000${member.directory_id}\u0000${member.source_id}`;
      const expected = memberRevisionByIdentity.get(identity);
      if (
        expected === undefined ||
        expected.revision !== member.revision ||
        expected.hash !== member.relative_path_hash ||
        expected.boundAt !== member.bound_at
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an incomplete current directory member view.",
        );
      }
      const sourceDirectoryKey = `${member.candidate_knowledge_base_id}\u0000${member.source_id}`;
      const priorDirectory = currentMemberSourceDirectories.get(sourceDirectoryKey);
      if (priorDirectory !== undefined && priorDirectory !== member.directory_id) {
        throw new StorageValidationError(
          "Candidate knowledge store assigns a source to multiple current directories.",
        );
      }
      currentMemberSourceDirectories.set(sourceDirectoryKey, member.directory_id);
      currentMemberKeys.add(identity);
    }
    if (currentMemberKeys.size !== memberRevisionByIdentity.size) {
      throw new StorageValidationError(
        "Candidate knowledge store current directory member view is incomplete.",
      );
    }

    const directoryBindings = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_current_roots
         ORDER BY candidate_knowledge_base_id, id`,
      )
      .all<{
        readonly id: string;
        readonly candidate_knowledge_base_id: string;
        readonly root_path: string;
        readonly bound_at: string;
      }>();
    const selectDirectoryMembers = this.database.prepare(
      `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
       FROM candidate_knowledge_directory_current_members
       WHERE candidate_knowledge_base_id = ? AND directory_id = ?
       ORDER BY relative_path_hash`,
    );
    const selectDirectoryManaged = this.database.prepare(
      `SELECT version.id
       FROM candidate_knowledge_source_versions AS version
       JOIN candidate_knowledge_managed_source_versions AS managed
         ON managed.version_id = version.id
       WHERE version.source_id = ?
       LIMIT 1`,
    );
    const selectDirectoryOrigin = this.database.prepare(
      `SELECT source_id, origin_path, bound_at
       FROM candidate_knowledge_source_origin_bindings
       WHERE source_id = ?`,
    );
    for (const directory of directoryBindings) {
      const directoryId = requireNonEmpty(directory.id, "candidate knowledge directory id");
      const directoryKnowledgeBaseId = requireNonEmpty(
        directory.candidate_knowledge_base_id,
        "candidate knowledge directory knowledgeBaseId",
      );
      this.requireCandidateKnowledgeBase(directoryKnowledgeBaseId);
      const directoryRoot = requireCanonicalAbsolutePath(
        directory.root_path,
        `candidate knowledge directory ${directoryId} root path`,
      );
      if (directoryRoot !== directory.root_path) {
        throw new StorageValidationError(
          "Candidate knowledge store contains a non-canonical directory root path.",
        );
      }
      requireTimestamp(directory.bound_at, `candidate knowledge directory ${directoryId} boundAt`);
      const members = selectDirectoryMembers.all<{
        readonly directory_id: string;
        readonly candidate_knowledge_base_id: string;
        readonly source_id: string;
        readonly relative_path_hash: string;
      }>(directoryKnowledgeBaseId, directoryId);
      const seenHashes = new Set<string>();
      const seenSources = new Set<string>();
      for (const member of members) {
        if (
          member.directory_id !== directoryId ||
          member.candidate_knowledge_base_id !== directoryKnowledgeBaseId ||
          !/^[0-9a-f]{64}$/.test(member.relative_path_hash) ||
          seenHashes.has(member.relative_path_hash) ||
          seenSources.has(member.source_id)
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains invalid directory membership.",
          );
        }
        seenHashes.add(member.relative_path_hash);
        seenSources.add(member.source_id);
        const source = this.requireCandidateKnowledgeSource(
          directoryKnowledgeBaseId,
          member.source_id,
        );
        if (source.kind !== "file") {
          throw new StorageValidationError(
            "Candidate knowledge store contains a non-file directory member.",
          );
        }
        requireTimestamp(
          source.createdAt,
          `candidate knowledge source ${member.source_id} createdAt`,
        );
        if (selectDirectoryManaged.get(member.source_id) === undefined) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an unmanaged directory member.",
          );
        }
        const originRow = selectDirectoryOrigin.get(member.source_id);
        if (originRow === undefined) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a directory member without an origin binding.",
          );
        }
        requireTimestamp(
          rowString(originRow, "bound_at"),
          `candidate knowledge source ${member.source_id} origin binding boundAt`,
        );
      }
    }
    this.validateManagedCandidateKnowledgeWriteJournal();
    this.validateCandidateKnowledgeRetentionContract();
  }

  public validateCandidateKnowledgeRetentionContract(): void {
    this.ensureOpen();
    const hasPortableRestoreProvenance =
      this.database
        .prepare("SELECT 1 FROM candidate_knowledge_portable_restore_provenance LIMIT 1")
        .get() !== undefined;
    const knowledgeBases = this.database
      .prepare("SELECT id, created_at FROM candidate_knowledge_bases ORDER BY id")
      .all<{ readonly id: string; readonly created_at: string }>();
    const knownKnowledgeBaseIds = new Set(knowledgeBases.map((row) => row.id));
    for (const knowledgeBase of knowledgeBases) {
      requireTimestamp(
        knowledgeBase.created_at,
        `candidate knowledge base ${knowledgeBase.id} createdAt`,
      );
      const policyRows = this.database
        .prepare(
          `SELECT knowledge_base_id, revision, retention_class, rule,
                  expire_after_days, updated_at
           FROM candidate_knowledge_retention_policy_events
           WHERE knowledge_base_id = ?
           ORDER BY revision, retention_class`,
        )
        .all(knowledgeBase.id);
      const revisions = new Map<number, Record<string, unknown>[]>();
      for (const row of policyRows) {
        if (rowString(row, "knowledge_base_id") !== knowledgeBase.id) {
          throw new StorageValidationError("candidate knowledge retention policy scope is invalid");
        }
        const revision = requirePositive(
          rowNumber(row, "revision"),
          "candidate knowledge retention policy revision",
        );
        const bucket = revisions.get(revision) ?? [];
        bucket.push(row);
        revisions.set(revision, bucket);
      }
      let previousUpdatedAt = knowledgeBase.created_at;
      let expectedRevision =
        hasPortableRestoreProvenance && revisions.size > 0 ? Math.min(...revisions.keys()) : 1;
      for (const [revision, rows] of revisions) {
        if (
          revision !== expectedRevision ||
          rows.length !== candidateKnowledgeRetentionClasses.length
        ) {
          throw new StorageValidationError(
            "candidate knowledge retention policy revisions must be contiguous and complete",
          );
        }
        const policy = this.readCandidateKnowledgeRetentionPolicyAtRevision(
          knowledgeBase.id,
          revision,
          this.requireCandidateKnowledgeBase(knowledgeBase.id),
        );
        if (Date.parse(policy.updatedAt) < Date.parse(previousUpdatedAt)) {
          throw new StorageValidationError(
            "candidate knowledge retention policy updatedAt must be monotonic",
          );
        }
        previousUpdatedAt = policy.updatedAt;
        expectedRevision += 1;
      }

      const overrideRows = this.database
        .prepare(
          `SELECT knowledge_base_id, retention_class, override_kind, sequence,
                  state, override_revision, policy_revision, changed_at
           FROM candidate_knowledge_retention_override_events
           WHERE knowledge_base_id = ?
           ORDER BY retention_class, override_kind, sequence`,
        )
        .all(knowledgeBase.id);
      const overrideGroups = new Map<string, CandidateKnowledgeRetentionOverrideRecord[]>();
      for (const row of overrideRows) {
        if (rowString(row, "knowledge_base_id") !== knowledgeBase.id) {
          throw new StorageValidationError(
            "candidate knowledge retention override scope is invalid",
          );
        }
        const record = candidateKnowledgeRetentionOverrideFromRow(row);
        const key = `${record.class}\u0000${record.kind}`;
        const bucket = overrideGroups.get(key) ?? [];
        bucket.push(record);
        overrideGroups.set(key, bucket);
      }
      const currentPolicy = this.readCandidateKnowledgeRetentionPolicy(knowledgeBase.id);
      for (const records of overrideGroups.values()) {
        let previous: CandidateKnowledgeRetentionOverrideRecord | undefined;
        let expectedSequence =
          hasPortableRestoreProvenance && records.length > 0 ? (records.at(0)?.sequence ?? 1) : 1;
        for (const record of records) {
          if (record.sequence !== expectedSequence) {
            throw new StorageValidationError(
              "candidate knowledge retention override sequences must be contiguous",
            );
          }
          if (
            previous === undefined &&
            !hasPortableRestoreProvenance &&
            record.state !== "applied"
          ) {
            throw new StorageValidationError(
              "candidate knowledge retention override cannot be released before applying",
            );
          }
          if (previous !== undefined) {
            if (previous.state === record.state) {
              throw new StorageValidationError(
                "candidate knowledge retention override states must alternate",
              );
            }
            if (Date.parse(record.changedAt) < Date.parse(previous.changedAt)) {
              throw new StorageValidationError(
                "candidate knowledge retention override changedAt must be monotonic",
              );
            }
          }
          const policyAtRevision = this.readCandidateKnowledgeRetentionPolicyAtRevision(
            knowledgeBase.id,
            record.policyRevision,
          );
          if (Date.parse(record.changedAt) < Date.parse(policyAtRevision.updatedAt)) {
            throw new StorageValidationError(
              "candidate knowledge retention override changedAt precedes its policy",
            );
          }
          if (record.policyRevision > currentPolicy.revision) {
            throw new StorageValidationError(
              "candidate knowledge retention override references a future policy",
            );
          }
          previous = record;
          expectedSequence = record.sequence + 1;
        }
      }
      const globalOverrideRows = this.database
        .prepare(
          `SELECT override_revision
           FROM candidate_knowledge_retention_override_events
           WHERE knowledge_base_id = ?
           ORDER BY override_revision`,
        )
        .all(knowledgeBase.id);
      let expectedOverrideRevision =
        hasPortableRestoreProvenance && globalOverrideRows.length > 0
          ? Math.min(...globalOverrideRows.map((row) => rowNumber(row, "override_revision")))
          : 1;
      for (const row of globalOverrideRows) {
        if (rowNumber(row, "override_revision") !== expectedOverrideRevision) {
          throw new StorageValidationError(
            "candidate knowledge retention override revisions must be contiguous",
          );
        }
        expectedOverrideRevision += 1;
      }
    }
    const retentionTables = [
      ["candidate_knowledge_retention_policy_events", "candidate knowledge retention policy"],
      ["candidate_knowledge_retention_override_events", "candidate knowledge retention override"],
    ] as const;
    for (const [table, label] of retentionTables) {
      const foreignKeys = this.database
        .prepare(`SELECT DISTINCT knowledge_base_id FROM ${table}`)
        .all<{ readonly knowledge_base_id: string }>();
      for (const row of foreignKeys) {
        if (!knownKnowledgeBaseIds.has(row.knowledge_base_id)) {
          throw new StorageValidationError(`${label} references an unknown knowledge base`);
        }
      }
    }
  }

  private validateManagedCandidateKnowledgeWriteJournal(): void {
    const operations = this.database
      .prepare(
        `SELECT operation.operation_id,
                operation.candidate_knowledge_base_id,
                operation.source_id,
                operation.requested_version_id,
                operation.kind,
                operation.created_at,
                operation.owner_kind,
                operation.owner_schema_version,
                operation.owner_generation,
                operation.requested_media_type,
                operation.requested_checksum,
                operation.requested_size_bytes,
                staging.device AS staging_device,
                staging.inode AS staging_inode,
                staging.created_at AS staging_created_at,
                claim.phase AS recovery_claim_phase,
                claim.claim_generation AS recovery_claim_generation,
                claim.claimed_at AS recovery_claimed_at
         FROM candidate_knowledge_managed_write_operations AS operation
         LEFT JOIN candidate_knowledge_managed_write_staging_identities AS staging
           ON staging.operation_id = operation.operation_id
         LEFT JOIN candidate_knowledge_managed_write_recovery_claims AS claim
           ON claim.operation_id = operation.operation_id
         ORDER BY operation.operation_id`,
      )
      .all();
    const selectEvents = this.database.prepare(
      "SELECT sequence, state, target_version_id, created_at FROM candidate_knowledge_managed_write_events WHERE operation_id = ? ORDER BY sequence",
    );
    const selectSource = this.database.prepare(
      "SELECT candidate_knowledge_base_id, kind FROM candidate_knowledge_sources WHERE id = ?",
    );
    const selectTarget = this.database.prepare(
      `SELECT source.candidate_knowledge_base_id, version.source_id, managed.version_id
       FROM candidate_knowledge_source_versions AS version
       JOIN candidate_knowledge_sources AS source ON source.id = version.source_id
       LEFT JOIN candidate_knowledge_managed_source_versions AS managed
         ON managed.version_id = version.id
       WHERE version.id = ?`,
    );
    for (const row of operations) {
      const operation = managedCandidateKnowledgeWriteOperationFromRow(row);
      requireNonEmpty(operation.operationId, "managed candidate knowledge write operation id");
      requireNonEmpty(
        operation.knowledgeBaseId,
        "managed candidate knowledge write candidate knowledge base id",
      );
      requireNonEmpty(operation.sourceId, "managed candidate knowledge write source id");
      requireNonEmpty(
        operation.requestedVersionId,
        "managed candidate knowledge write requested version id",
      );
      if (operation.kind !== "create" && operation.kind !== "append") {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid managed write operation kind.",
        );
      }
      const ownershipValues = [
        operation.ownerKind,
        operation.ownerSchemaVersion,
        operation.ownerGeneration,
        operation.requestedMediaType,
        operation.requestedChecksum,
        operation.requestedSizeBytes,
      ];
      const hasOwnership = ownershipValues.some((value) => value !== null && value !== undefined);
      if (hasOwnership) {
        if (
          operation.ownerKind !== managedCandidateKnowledgeWriteOwnerKind ||
          operation.ownerSchemaVersion !== managedCandidateKnowledgeWriteOwnerSchemaVersion ||
          operation.ownerGeneration === undefined ||
          !Number.isInteger(operation.ownerGeneration) ||
          operation.ownerGeneration < 1 ||
          operation.requestedMediaType === undefined ||
          operation.requestedMediaType.trim() === "" ||
          operation.requestedChecksum === undefined ||
          !/^[0-9a-f]{64}$/.test(operation.requestedChecksum) ||
          operation.requestedSizeBytes === undefined ||
          !Number.isInteger(operation.requestedSizeBytes) ||
          operation.requestedSizeBytes < 0
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains invalid managed write ownership metadata.",
          );
        }
      } else if (
        operation.ownerKind !== null ||
        operation.ownerSchemaVersion !== null ||
        operation.ownerGeneration !== undefined ||
        operation.requestedMediaType !== undefined ||
        operation.requestedChecksum !== undefined ||
        operation.requestedSizeBytes !== undefined
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains invalid legacy managed write metadata.",
        );
      }
      const operationCreatedAt = requireTimestamp(
        operation.createdAt,
        `managed candidate knowledge write operation ${operation.operationId} createdAt`,
      );
      const stagingDevice = rowNullableNumber(row, "staging_device");
      const stagingInode = rowNullableNumber(row, "staging_inode");
      const stagingCreatedAt = rowNullableString(row, "staging_created_at");
      const recoveryClaimPhase = rowNullableString(row, "recovery_claim_phase");
      const recoveryClaimGeneration = rowNullableNumber(row, "recovery_claim_generation");
      const recoveryClaimedAt = rowNullableString(row, "recovery_claimed_at");
      const hasStagingIdentity =
        stagingDevice !== null || stagingInode !== null || stagingCreatedAt !== null;
      if (hasStagingIdentity) {
        if (
          stagingDevice === null ||
          !Number.isInteger(stagingDevice) ||
          stagingDevice < 0 ||
          stagingInode === null ||
          !Number.isInteger(stagingInode) ||
          stagingInode < 0 ||
          stagingCreatedAt === null
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write staging identity.",
          );
        }
        if (!hasOwnership) {
          throw new StorageValidationError(
            "Candidate knowledge store contains staging identity for a legacy managed write.",
          );
        }
        const normalizedStagingCreatedAt = requireTimestamp(
          stagingCreatedAt,
          `managed candidate knowledge write operation ${operation.operationId} staging identity createdAt`,
        );
        if (Date.parse(normalizedStagingCreatedAt) < Date.parse(operationCreatedAt)) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a staging identity timestamp before its operation.",
          );
        }
      }
      const hasRecoveryClaim =
        recoveryClaimPhase !== null ||
        recoveryClaimGeneration !== null ||
        recoveryClaimedAt !== null;
      if (hasRecoveryClaim) {
        if (
          recoveryClaimPhase === null ||
          !["prepared", "targeted", "published", "committed"].includes(recoveryClaimPhase) ||
          recoveryClaimGeneration === null ||
          !Number.isInteger(recoveryClaimGeneration) ||
          recoveryClaimGeneration < 1 ||
          recoveryClaimedAt === null
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write recovery claim.",
          );
        }
        if (
          !hasOwnership ||
          operation.ownerGeneration === undefined ||
          recoveryClaimGeneration <= operation.ownerGeneration
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a stale managed write recovery claim.",
          );
        }
        requireTimestamp(
          recoveryClaimedAt,
          `managed candidate knowledge write operation ${operation.operationId} recovery claim claimedAt`,
        );
      }
      this.requireCandidateKnowledgeBase(operation.knowledgeBaseId);
      const source = selectSource.get<{
        readonly candidate_knowledge_base_id: string;
        readonly kind: string;
      }>(operation.sourceId);
      if (
        operation.kind === "append" &&
        (source === undefined ||
          source.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
          (source.kind !== "file" && source.kind !== "url"))
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid managed append operation source.",
        );
      }
      if (
        source !== undefined &&
        (source.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
          (source.kind !== "file" && source.kind !== "url"))
      ) {
        throw new StorageValidationError(
          "Candidate knowledge store contains an invalid managed write operation source.",
        );
      }

      const events = selectEvents.all<{
        readonly sequence: number;
        readonly state: string;
        readonly target_version_id: string;
        readonly created_at: string;
      }>(operation.operationId);
      if (hasRecoveryClaim) {
        const claimPhase = recoveryClaimPhase as ManagedCandidateKnowledgeWriteRecoveryClaimPhase;
        const claimMatchesJournal =
          claimPhase === "prepared"
            ? events.length === 0 || (events.length === 1 && events[0]?.state === "aborted")
            : events.some((event) => event.state === claimPhase);
        if (!claimMatchesJournal) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a recovery claim for an absent journal phase.",
          );
        }
        const latestState = events.at(-1)?.state;
        if (
          latestState !== undefined &&
          latestState !== "completed" &&
          latestState !== "aborted" &&
          latestState !== "noop" &&
          latestState !== claimPhase
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a recovery claim for a stale journal phase.",
          );
        }
      }
      let previousState: ManagedCandidateKnowledgeWriteEventState | undefined;
      let previousCreatedAt = operationCreatedAt;
      let targetVersionId: string | undefined;
      for (const [index, event] of events.entries()) {
        if (event.sequence !== index + 1) {
          throw new StorageValidationError(
            "Candidate knowledge store contains a non-contiguous managed write journal.",
          );
        }
        if (
          event.state !== "targeted" &&
          event.state !== "published" &&
          event.state !== "committed" &&
          event.state !== "completed" &&
          event.state !== "aborted" &&
          event.state !== "noop"
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write event state.",
          );
        }
        const transitionAllowed =
          (previousState === undefined &&
            (event.state === "targeted" || event.state === "noop" || event.state === "aborted")) ||
          (previousState === "targeted" &&
            (event.state === "published" || event.state === "aborted")) ||
          (previousState === "published" &&
            (event.state === "committed" || event.state === "aborted")) ||
          (previousState === "committed" && event.state === "completed");
        if (!transitionAllowed) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write event transition.",
          );
        }
        const createdAt = requireTimestamp(
          event.created_at,
          `managed candidate knowledge write event ${operation.operationId}:${event.sequence} createdAt`,
        );
        if (Date.parse(createdAt) < Date.parse(previousCreatedAt)) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write timestamp order.",
          );
        }
        if (targetVersionId === undefined) targetVersionId = event.target_version_id;
        if (event.target_version_id !== targetVersionId) {
          throw new StorageValidationError(
            "Candidate knowledge store contains inconsistent managed write targets.",
          );
        }
        const target = selectTarget.get<{
          readonly candidate_knowledge_base_id: string;
          readonly source_id: string;
          readonly version_id: string | null;
        }>(event.target_version_id);
        const targetAllowed =
          event.target_version_id === operation.requestedVersionId ||
          (operation.kind === "append" && target?.source_id === operation.sourceId);
        if (!targetAllowed) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an invalid managed write target.",
          );
        }
        if (
          (event.state === "committed" || event.state === "completed") &&
          (target?.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
            target.source_id !== operation.sourceId ||
            target.version_id !== event.target_version_id)
        ) {
          throw new StorageValidationError(
            "Candidate knowledge store contains an unresolved managed write commit.",
          );
        }
        if (event.state === "noop") {
          if (
            operation.kind !== "append" ||
            target?.candidate_knowledge_base_id !== operation.knowledgeBaseId ||
            target.source_id !== operation.sourceId ||
            target.version_id !== event.target_version_id
          ) {
            throw new StorageValidationError(
              "Candidate knowledge store contains an invalid managed write noop.",
            );
          }
        }
        previousState = event.state;
        previousCreatedAt = createdAt;
      }
    }
  }

  public async saveWorkspace(record: WorkspaceRecord): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(record.id, "workspace id");
    requireNonEmpty(record.createdAt, "workspace createdAt");
    requireNonEmpty(record.updatedAt, "workspace updatedAt");
    if (!workflowStates.includes(record.state)) {
      throw new StorageValidationError(`Unsupported workspace state: ${record.state}`);
    }
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT state, created_at, updated_at FROM workspaces WHERE id = ?")
        .get<{ readonly state: string; readonly created_at: string; readonly updated_at: string }>(
          record.id,
        );
      if (existing === undefined) {
        this.database
          .prepare("INSERT INTO workspaces (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)")
          .run(record.id, record.state, record.createdAt, record.updatedAt);
      } else if (
        existing.state !== record.state ||
        existing.created_at !== record.createdAt ||
        existing.updated_at !== record.updatedAt
      ) {
        this.database
          .prepare("UPDATE workspaces SET state = ?, created_at = ?, updated_at = ? WHERE id = ?")
          .run(record.state, record.createdAt, record.updatedAt, record.id);
      }
      this.insertAuditEvent({
        id: `workspace:${record.id}:${record.updatedAt}`,
        workspaceId: record.id,
        eventType: "workspace.saved",
        entityType: "workspace",
        entityId: record.id,
        payload: recordToJson(record),
        createdAt: record.updatedAt,
      });
    })();
  }

  public async getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT id, state, created_at, updated_at FROM workspaces WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : workspaceFromRow(row);
  }

  public async saveContextSnapshot(input: ContextSnapshotInput): Promise<ContextSnapshotRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "context snapshot id");
    requireNonEmpty(input.workspaceId, "context snapshot workspaceId");
    requirePositiveInteger(input.schemaVersion, "context snapshot schemaVersion");
    requireNonEmpty(input.createdAt, "context snapshot createdAt");
    const checksumValue = payloadChecksum(input.payload);
    const record: ContextSnapshotRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, schema_version, created_at, payload_checksum FROM context_snapshots WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly schema_version: number;
          readonly created_at: string;
          readonly payload_checksum: string;
        }>(input.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== input.workspaceId ||
          existing.schema_version !== input.schemaVersion ||
          existing.created_at !== input.createdAt ||
          existing.payload_checksum !== checksumValue
        ) {
          throw new StorageConflictError(`context snapshot ${input.id} is immutable`);
        }
      } else {
        this.database
          .prepare(
            "INSERT INTO context_snapshots (id, workspace_id, schema_version, created_at, payload_json, payload_checksum) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            input.id,
            input.workspaceId,
            input.schemaVersion,
            input.createdAt,
            serialize(input.payload),
            checksumValue,
          );
        this.insertAuditEvent({
          id: `context-snapshot:${input.id}:${checksumValue}`,
          workspaceId: input.workspaceId,
          eventType: "context-snapshot.appended",
          entityType: "context-snapshot",
          entityId: input.id,
          payload: recordToJson(record),
          createdAt: input.createdAt,
        });
      }
    })();
    return record;
  }

  public async getContextSnapshot(id: string): Promise<ContextSnapshotRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, schema_version, created_at, payload_json, payload_checksum FROM context_snapshots WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : contextFromRow(row);
  }

  public async saveOpportunityBrief(
    workspaceId: string,
    brief: OpportunityBrief,
  ): Promise<OpportunityBriefVersionRecord> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
    const normalizedBrief = validatedOpportunityBrief(brief);
    const payload = recordToJson(normalizedBrief);
    const checksumValue = payloadChecksum(payload);
    let result: OpportunityBriefVersionRecord | undefined;
    this.database.transaction(() => {
      const workspace = this.database
        .prepare("SELECT id FROM workspaces WHERE id = ?")
        .get(normalizedWorkspaceId);
      if (workspace === undefined) {
        throw new StorageValidationError("The opportunity workspace was not found.");
      }

      const existing = this.database
        .prepare(
          "SELECT workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum FROM opportunity_brief_versions WHERE workspace_id = ? AND brief_id = ? AND version = ?",
        )
        .get(normalizedWorkspaceId, normalizedBrief.id, normalizedBrief.version);
      if (existing !== undefined) {
        const existingRecord = opportunityBriefFromRow(existing);
        if (existingRecord.checksum !== checksumValue) {
          throw new StorageConflictError("The opportunity brief version is immutable.");
        }
        result = existingRecord;
        return;
      }

      if (normalizedBrief.version > 1) {
        const parentRow = this.database
          .prepare(
            "SELECT workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum FROM opportunity_brief_versions WHERE workspace_id = ? AND brief_id = ? AND version = ?",
          )
          .get(normalizedWorkspaceId, normalizedBrief.id, normalizedBrief.version - 1);
        if (parentRow === undefined) {
          throw new StorageConflictError("The opportunity brief parent version is missing.");
        }
        const parent = opportunityBriefFromRow(parentRow).brief;
        if (Date.parse(normalizedBrief.createdAt) < Date.parse(parent.createdAt)) {
          throw new StorageConflictError(
            "The opportunity brief timestamp precedes its parent version.",
          );
        }
        if (parent.status === "reviewed" && normalizedBrief.status === "reviewed") {
          throw new StorageConflictError(
            "A reviewed opportunity brief cannot transition directly to reviewed.",
          );
        }
      }

      this.database
        .prepare(
          "INSERT INTO opportunity_brief_versions (workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          normalizedWorkspaceId,
          normalizedBrief.id,
          normalizedBrief.version,
          normalizedBrief.schemaVersion,
          normalizedBrief.priorVersion,
          normalizedBrief.status,
          normalizedBrief.createdAt,
          normalizedBrief.reviewedAt,
          serialize(payload),
          checksumValue,
        );
      const opaqueEntityId = checksum(`${normalizedWorkspaceId}\u0000${normalizedBrief.id}`).slice(
        0,
        32,
      );
      this.insertAuditEvent({
        id: `opportunity-brief-version:${opaqueEntityId}:${normalizedBrief.version}:${checksumValue}`,
        workspaceId: normalizedWorkspaceId,
        eventType: "opportunity-brief-version.appended",
        entityType: "opportunity-brief",
        entityId: opaqueEntityId,
        payload: {
          checksum: checksumValue,
          schemaVersion: normalizedBrief.schemaVersion,
          status: normalizedBrief.status,
          version: normalizedBrief.version,
        },
        createdAt: normalizedBrief.createdAt,
      });
      result = {
        workspaceId: normalizedWorkspaceId,
        brief: normalizedBrief,
        checksum: checksumValue,
      };
    })();
    return result as OpportunityBriefVersionRecord;
  }

  public async getOpportunityBrief(
    workspaceId: string,
    briefId: string,
    version: number,
  ): Promise<OpportunityBriefVersionRecord | undefined> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
    const normalizedBriefId = requireNonEmpty(briefId, "opportunity briefId").trim();
    requirePositive(version, "opportunity brief version");
    const row = this.database
      .prepare(
        "SELECT workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum FROM opportunity_brief_versions WHERE workspace_id = ? AND brief_id = ? AND version = ?",
      )
      .get(normalizedWorkspaceId, normalizedBriefId, version);
    return row === undefined ? undefined : opportunityBriefFromRow(row);
  }

  public async getLatestOpportunityBrief(
    workspaceId: string,
    briefId: string,
  ): Promise<OpportunityBriefVersionRecord | undefined> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
    const normalizedBriefId = requireNonEmpty(briefId, "opportunity briefId").trim();
    const row = this.database
      .prepare(
        "SELECT workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum FROM opportunity_brief_versions WHERE workspace_id = ? AND brief_id = ? ORDER BY version DESC LIMIT 1",
      )
      .get(normalizedWorkspaceId, normalizedBriefId);
    return row === undefined ? undefined : opportunityBriefFromRow(row);
  }

  public async listOpportunityBriefVersions(
    workspaceId: string,
    briefId: string,
  ): Promise<readonly OpportunityBriefVersionRecord[]> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(workspaceId, "opportunity workspaceId").trim();
    const normalizedBriefId = requireNonEmpty(briefId, "opportunity briefId").trim();
    return this.database
      .prepare(
        "SELECT workspace_id, brief_id, version, schema_version, prior_version, status, created_at, reviewed_at, payload_json, payload_checksum FROM opportunity_brief_versions WHERE workspace_id = ? AND brief_id = ? ORDER BY version",
      )
      .all(normalizedWorkspaceId, normalizedBriefId)
      .map((row) => opportunityBriefFromRow(row));
  }

  public async saveCanonicalCandidateProfile(
    workspaceId: string,
    profile: CanonicalCandidateProfile,
  ): Promise<CanonicalCandidateProfileVersionRecord> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(
      workspaceId,
      "canonical candidate profile workspaceId",
    ).trim();
    const normalizedProfile = validatedCanonicalCandidateProfile(profile);
    const payload = recordToJson(normalizedProfile);
    const payloadJson = serialize(payload);
    const checksumValue = payloadChecksum(payload);
    let result: CanonicalCandidateProfileVersionRecord | undefined;

    this.database.transaction(() => {
      const workspace = this.database
        .prepare("SELECT id FROM workspaces WHERE id = ?")
        .get(normalizedWorkspaceId);
      if (workspace === undefined) {
        throw new StorageValidationError(
          "The canonical candidate profile workspace was not found.",
        );
      }

      const existing = this.database
        .prepare(
          `${canonicalCandidateProfileVersionSelect()} WHERE workspace_id = ? AND profile_id = ? AND version = ?`,
        )
        .get(normalizedWorkspaceId, normalizedProfile.id, normalizedProfile.version);
      if (existing !== undefined) {
        const existingRecord = canonicalCandidateProfileVersionFromRow(existing);
        if (existingRecord.checksum !== checksumValue) {
          throw new StorageConflictError("The canonical candidate profile version is immutable.");
        }
        const history = canonicalCandidateProfileHistory(
          this.database,
          normalizedWorkspaceId,
          normalizedProfile.id,
        );
        const historyRecord = history.find(
          (record) => record.profile.version === normalizedProfile.version,
        );
        if (historyRecord === undefined || historyRecord.checksum !== existingRecord.checksum) {
          throw new StorageValidationError(
            "The stored canonical candidate profile history is inconsistent.",
          );
        }
        result = historyRecord;
        return;
      }

      const history = canonicalCandidateProfileHistory(
        this.database,
        normalizedWorkspaceId,
        normalizedProfile.id,
      );
      const latest = canonicalCandidateProfileLeaf(history);
      if (normalizedProfile.version === 1) {
        if (latest !== undefined) {
          throw new StorageConflictError(
            "The canonical candidate profile version must append after the current leaf.",
          );
        }
        if (normalizedProfile.parentVersion !== null) {
          throw new StorageValidationError(
            "The canonical candidate profile root version cannot have a parent.",
          );
        }
      } else {
        if (latest === undefined) {
          throw new StorageConflictError(
            "The canonical candidate profile parent version is missing.",
          );
        }
        if (
          normalizedProfile.version !== latest.profile.version + 1 ||
          normalizedProfile.parentVersion !== latest.profile.version
        ) {
          throw new StorageConflictError(
            "The canonical candidate profile version must append after the current leaf.",
          );
        }
        if (
          Date.parse(normalizedProfile.createdAt) < Date.parse(latest.profile.createdAt) ||
          Date.parse(normalizedProfile.updatedAt) < Date.parse(latest.profile.updatedAt)
        ) {
          throw new StorageConflictError(
            "The canonical candidate profile timestamp precedes its parent version.",
          );
        }
      }

      this.database
        .prepare(
          "INSERT INTO canonical_candidate_profile_versions (workspace_id, profile_id, version, schema_version, parent_version, status, created_at, updated_at, reviewed_at, payload_json, payload_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          normalizedWorkspaceId,
          normalizedProfile.id,
          normalizedProfile.version,
          normalizedProfile.schemaVersion,
          normalizedProfile.parentVersion,
          normalizedProfile.status,
          normalizedProfile.createdAt,
          normalizedProfile.updatedAt,
          normalizedProfile.reviewedAt ?? null,
          payloadJson,
          checksumValue,
        );

      const opaqueEntityId = checksum(
        `${normalizedWorkspaceId}\u0000${normalizedProfile.id}`,
      ).slice(0, 32);
      this.insertAuditEvent({
        id: `canonical-candidate-profile-version:${opaqueEntityId}:${normalizedProfile.version}:${checksumValue}`,
        workspaceId: normalizedWorkspaceId,
        eventType: "canonical-candidate-profile-version.appended",
        entityType: "canonical-candidate-profile",
        entityId: opaqueEntityId,
        payload: {
          checksum: checksumValue,
          schemaVersion: normalizedProfile.schemaVersion,
          status: normalizedProfile.status,
          version: normalizedProfile.version,
          parentVersion: normalizedProfile.parentVersion,
        },
        createdAt: normalizedProfile.createdAt,
      });
      result = {
        workspaceId: normalizedWorkspaceId,
        profile: normalizedProfile,
        checksum: checksumValue,
      };
    })();
    return result as CanonicalCandidateProfileVersionRecord;
  }

  public async getCanonicalCandidateProfile(
    workspaceId: string,
    profileId: string,
    version: number,
  ): Promise<CanonicalCandidateProfileVersionRecord | undefined> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(
      workspaceId,
      "canonical candidate profile workspaceId",
    ).trim();
    const normalizedProfileId = requireNonEmpty(profileId, "canonical candidate profileId").trim();
    requirePositive(version, "canonical candidate profile version");
    const history = canonicalCandidateProfileHistory(
      this.database,
      normalizedWorkspaceId,
      normalizedProfileId,
    );
    return history.find((record) => record.profile.version === version);
  }

  public async getLatestCanonicalCandidateProfile(
    workspaceId: string,
    profileId: string,
  ): Promise<CanonicalCandidateProfileVersionRecord | undefined> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(
      workspaceId,
      "canonical candidate profile workspaceId",
    ).trim();
    const normalizedProfileId = requireNonEmpty(profileId, "canonical candidate profileId").trim();
    return canonicalCandidateProfileLeaf(
      canonicalCandidateProfileHistory(this.database, normalizedWorkspaceId, normalizedProfileId),
    );
  }

  public async listCanonicalCandidateProfileVersions(
    workspaceId: string,
    profileId: string,
  ): Promise<readonly CanonicalCandidateProfileVersionRecord[]> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(
      workspaceId,
      "canonical candidate profile workspaceId",
    ).trim();
    const normalizedProfileId = requireNonEmpty(profileId, "canonical candidate profileId").trim();
    return canonicalCandidateProfileHistory(
      this.database,
      normalizedWorkspaceId,
      normalizedProfileId,
    );
  }

  public async saveWritingPolicyVersion(
    workspaceId: string,
    policy: WritingPolicyInput,
    options?: WritingPolicyVersionSaveOptions,
  ): Promise<WritingPolicyVersionRecord>;
  public async saveWritingPolicyVersion(
    input: WritingPolicyVersionInput,
  ): Promise<WritingPolicyVersionRecord>;
  public async saveWritingPolicyVersion(
    workspaceOrInput: string | WritingPolicyVersionInput,
    policyInput?: WritingPolicyInput,
    options: WritingPolicyVersionSaveOptions = {},
  ): Promise<WritingPolicyVersionRecord> {
    this.ensureOpen();
    const inputOptions =
      typeof workspaceOrInput === "string"
        ? options
        : {
            createdAt: workspaceOrInput.createdAt,
            priorChecksum: workspaceOrInput.priorChecksum,
          };
    const workspaceId = requireNonEmpty(
      typeof workspaceOrInput === "string" ? workspaceOrInput : workspaceOrInput.workspaceId,
      "writing policy workspaceId",
    ).trim();
    const policy = typeof workspaceOrInput === "string" ? policyInput : workspaceOrInput.policy;
    if (policy === undefined) {
      throw new StorageValidationError("A writing policy is required.");
    }
    const normalizedPolicy = validatedWritingPolicy(policy);
    const createdAt = requireTimestamp(inputOptions.createdAt ?? now(), "writing policy createdAt");
    const requestedPrior =
      inputOptions.priorChecksum === undefined
        ? undefined
        : inputOptions.priorChecksum === null
          ? null
          : requireSha256(inputOptions.priorChecksum, "writing policy priorChecksum");
    const payload = recordToJson(normalizedPolicy);
    const payloadJson = serialize(payload);
    const payloadChecksumValue = payloadChecksum(payload);
    const policyChecksum = normalizedPolicy.checksum;
    let result: WritingPolicyVersionRecord | undefined;

    this.database.transaction(() => {
      const workspace = this.database
        .prepare("SELECT id FROM workspaces WHERE id = ?")
        .get(workspaceId);
      if (workspace === undefined) {
        throw new StorageValidationError("The writing policy workspace was not found.");
      }

      const latest = currentWritingPolicyLeaf(this.database, workspaceId);

      const existing = this.database
        .prepare(`${writingPolicyVersionSelect()} WHERE workspace_id = ? AND policy_checksum = ?`)
        .get(workspaceId, policyChecksum);
      if (existing !== undefined) {
        const existingRecord = writingPolicyVersionFromRow(existing);
        const priorMatches =
          requestedPrior === undefined || existingRecord.priorChecksum === requestedPrior;
        const timestampMatches =
          inputOptions.createdAt === undefined || existingRecord.createdAt === createdAt;
        if (
          existingRecord.policy.version !== normalizedPolicy.version ||
          existingRecord.policy.schemaVersion !== normalizedPolicy.schemaVersion ||
          existingRecord.payloadChecksum !== payloadChecksumValue ||
          !priorMatches ||
          !timestampMatches
        ) {
          throw new StorageConflictError("The writing policy version is immutable.");
        }
        result = existingRecord;
        return;
      }

      const versionConflict = this.database
        .prepare(`${writingPolicyVersionSelect()} WHERE workspace_id = ? AND version = ? LIMIT 1`)
        .get(workspaceId, normalizedPolicy.version);
      if (versionConflict !== undefined) {
        throw new StorageConflictError("The writing policy display version is already bound.");
      }

      const inferredPrior = latest === undefined ? null : rowString(latest, "policy_checksum");
      const priorChecksum = requestedPrior === undefined ? inferredPrior : requestedPrior;
      if (latest !== undefined && priorChecksum === null) {
        throw new StorageConflictError("The writing policy parent version is required.");
      }
      if (latest !== undefined && priorChecksum !== inferredPrior) {
        throw new StorageConflictError(
          "The writing policy parent version must be the current leaf.",
        );
      }
      if (priorChecksum === policyChecksum) {
        throw new StorageConflictError("A writing policy version cannot link to itself.");
      }

      let parentCreatedAt: string | undefined;
      if (priorChecksum !== null) {
        const parent = this.database
          .prepare(`${writingPolicyVersionSelect()} WHERE workspace_id = ? AND policy_checksum = ?`)
          .get(workspaceId, priorChecksum);
        if (parent === undefined) {
          throw new StorageConflictError("The writing policy parent version is missing.");
        }
        parentCreatedAt = requireTimestamp(
          rowString(parent, "created_at"),
          "writing policy parent createdAt",
        );
        if (Date.parse(createdAt) <= Date.parse(parentCreatedAt)) {
          throw new StorageConflictError(
            "The writing policy timestamp must be later than its parent version.",
          );
        }
      }

      this.database
        .prepare(
          "INSERT INTO writing_policy_versions (workspace_id, policy_checksum, version, schema_version, created_at, prior_checksum, payload_json, payload_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          workspaceId,
          policyChecksum,
          normalizedPolicy.version,
          normalizedPolicy.schemaVersion,
          createdAt,
          priorChecksum,
          payloadJson,
          payloadChecksumValue,
        );

      const opaqueEntityId = checksum(`${workspaceId}\u0000${policyChecksum}`).slice(0, 32);
      this.insertAuditEvent({
        id: `writing-policy-version:${opaqueEntityId}:${policyChecksum}`,
        workspaceId,
        eventType: "writing-policy-version.appended",
        entityType: "writing-policy",
        entityId: opaqueEntityId,
        payload: {
          checksum: policyChecksum,
          version: normalizedPolicy.version,
          schemaVersion: normalizedPolicy.schemaVersion ?? 1,
          priorChecksum,
          payloadChecksum: payloadChecksumValue,
        },
        createdAt,
      });
      result = {
        workspaceId,
        policy: normalizedPolicy,
        checksum: policyChecksum,
        version: normalizedPolicy.version,
        schemaVersion: normalizedPolicy.schemaVersion ?? 1,
        createdAt,
        priorChecksum,
        payloadChecksum: payloadChecksumValue,
      };
    })();
    return result as WritingPolicyVersionRecord;
  }

  public async getWritingPolicyVersion(
    workspaceId: string,
    policyChecksum: string,
  ): Promise<WritingPolicyVersionRecord | undefined> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(workspaceId, "writing policy workspaceId").trim();
    const normalizedChecksum = requireSha256(policyChecksum, "writing policy checksum");
    const row = this.database
      .prepare(`${writingPolicyVersionSelect()} WHERE workspace_id = ? AND policy_checksum = ?`)
      .get(normalizedWorkspaceId, normalizedChecksum);
    return row === undefined ? undefined : writingPolicyVersionFromRow(row);
  }

  public async getLatestWritingPolicyVersion(
    workspaceId: string,
  ): Promise<WritingPolicyVersionRecord | undefined> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(workspaceId, "writing policy workspaceId").trim();
    const row = currentWritingPolicyLeaf(this.database, normalizedWorkspaceId);
    return row === undefined ? undefined : writingPolicyVersionFromRow(row);
  }

  public async listWritingPolicyVersions(
    workspaceId: string,
  ): Promise<readonly WritingPolicyVersionRecord[]> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireNonEmpty(workspaceId, "writing policy workspaceId").trim();
    currentWritingPolicyLeaf(this.database, normalizedWorkspaceId);
    return this.database
      .prepare(
        `${writingPolicyVersionSelect()} WHERE workspace_id = ? ORDER BY julianday(created_at), created_at, policy_checksum`,
      )
      .all(normalizedWorkspaceId)
      .map((row) => writingPolicyVersionFromRow(row));
  }

  public async saveEvidenceSource(record: EvidenceSourceRecord): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(record.id, "evidence source id");
    requireNonEmpty(record.workspaceId, "evidence source workspaceId");
    requireNonEmpty(record.path, "evidence source path");
    requireNonEmpty(record.mediaType, "evidence source mediaType");
    requireNonEmpty(record.checksum, "evidence source checksum");
    requireNonEmpty(record.createdAt, "evidence source createdAt");
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, path, media_type, checksum, created_at FROM evidence_sources WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly path: string;
          readonly media_type: string;
          readonly checksum: string;
          readonly created_at: string;
        }>(record.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== record.workspaceId ||
          existing.path !== record.path ||
          existing.media_type !== record.mediaType ||
          existing.checksum !== record.checksum ||
          existing.created_at !== record.createdAt
        ) {
          throw new StorageConflictError(`evidence source ${record.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO evidence_sources (id, workspace_id, path, media_type, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          record.workspaceId,
          record.path,
          record.mediaType,
          record.checksum,
          record.createdAt,
        );
      this.insertAuditEvent({
        id: `evidence-source:${record.id}:${record.checksum}`,
        workspaceId: record.workspaceId,
        eventType: "evidence-source.appended",
        entityType: "evidence-source",
        entityId: record.id,
        payload: recordToJson(record),
        createdAt: record.createdAt,
      });
    })();
  }

  public async getEvidenceSource(id: string): Promise<EvidenceSourceRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, path, media_type, checksum, created_at FROM evidence_sources WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : evidenceSourceFromRow(row);
  }

  public async saveEvidenceChunk(record: EvidenceChunkRecord): Promise<void> {
    this.ensureOpen();
    requireNonEmpty(record.id, "evidence chunk id");
    requireNonEmpty(record.workspaceId, "evidence chunk workspaceId");
    requireNonEmpty(record.sourceId, "evidence chunk sourceId");
    requirePositiveInteger(record.ordinal, "evidence chunk ordinal");
    requirePositiveInteger(record.lineStart, "evidence chunk lineStart");
    requirePositiveInteger(record.lineEnd, "evidence chunk lineEnd");
    if (record.lineEnd < record.lineStart) {
      throw new StorageValidationError("evidence chunk lineEnd must not precede lineStart");
    }
    requireNonEmpty(record.checksum, "evidence chunk checksum");
    requireNonEmpty(record.text, "evidence chunk text");
    requireNonEmpty(record.createdAt, "evidence chunk createdAt");
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, source_id, ordinal, line_start, line_end, checksum, text, created_at FROM evidence_chunks WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly source_id: string;
          readonly ordinal: number;
          readonly line_start: number;
          readonly line_end: number;
          readonly checksum: string;
          readonly text: string;
          readonly created_at: string;
        }>(record.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== record.workspaceId ||
          existing.source_id !== record.sourceId ||
          existing.ordinal !== record.ordinal ||
          existing.line_start !== record.lineStart ||
          existing.line_end !== record.lineEnd ||
          existing.checksum !== record.checksum ||
          existing.text !== record.text ||
          existing.created_at !== record.createdAt
        ) {
          throw new StorageConflictError(`evidence chunk ${record.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO evidence_chunks (id, workspace_id, source_id, ordinal, line_start, line_end, checksum, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          record.workspaceId,
          record.sourceId,
          record.ordinal,
          record.lineStart,
          record.lineEnd,
          record.checksum,
          record.text,
          record.createdAt,
        );
      this.database
        .prepare(
          "INSERT INTO evidence_chunks_fts (chunk_id, workspace_id, source_id, text) VALUES (?, ?, ?, ?)",
        )
        .run(record.id, record.workspaceId, record.sourceId, record.text);
      this.insertAuditEvent({
        id: `evidence-chunk:${record.id}:${record.checksum}`,
        workspaceId: record.workspaceId,
        eventType: "evidence-chunk.appended",
        entityType: "evidence-chunk",
        entityId: record.id,
        payload: recordToJson(record),
        createdAt: record.createdAt,
      });
    })();
  }

  public async saveArtifactVersion(input: ArtifactVersionInput): Promise<ArtifactVersionRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "artifact version id");
    requireNonEmpty(input.workspaceId, "artifact version workspaceId");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new StorageValidationError("artifact version must be a positive integer");
    }
    requireNonEmpty(input.createdAt, "artifact version createdAt");
    const checksumValue = payloadChecksum(input.payload);
    const record: ArtifactVersionRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, version, parent_version_id, created_at, payload_checksum FROM artifact_versions WHERE id = ?",
        )
        .get<{
          readonly workspace_id: string;
          readonly version: number;
          readonly parent_version_id: string | null;
          readonly created_at: string;
          readonly payload_checksum: string;
        }>(input.id);
      if (existing !== undefined) {
        if (
          existing.workspace_id !== input.workspaceId ||
          existing.version !== input.version ||
          existing.parent_version_id !== input.parentVersionId ||
          existing.created_at !== input.createdAt ||
          existing.payload_checksum !== checksumValue
        ) {
          throw new StorageConflictError(`artifact version ${input.id} is immutable`);
        }
      } else {
        this.database
          .prepare(
            "INSERT INTO artifact_versions (id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            input.id,
            input.workspaceId,
            input.version,
            input.parentVersionId,
            input.createdAt,
            serialize(input.payload),
            checksumValue,
          );
        this.insertAuditEvent({
          id: `artifact-version:${input.id}:${checksumValue}`,
          workspaceId: input.workspaceId,
          eventType: "artifact-version.appended",
          entityType: "artifact-version",
          entityId: input.id,
          payload: recordToJson(record),
          createdAt: input.createdAt,
        });
      }
    })();
    return record;
  }

  public async getArtifactVersion(id: string): Promise<ArtifactVersionRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum FROM artifact_versions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : artifactVersionFromRow(row);
  }

  public async saveRun(input: RunRecordInput): Promise<RunRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "run id");
    requireNonEmpty(input.workspaceId, "run workspaceId");
    requireNonEmpty(input.contextSnapshotId, "run contextSnapshotId");
    requireStoredRunState(input.state, "run state");
    requirePositive(input.round, "run round");
    requireStoredStep(input.currentStep, "run currentStep");
    requireNonEmpty(input.startedAt, "run startedAt");
    requireNonEmpty(input.updatedAt, "run updatedAt");
    requireNonNegativeNumber(input.totalCostUsd, "run totalCostUsd");
    assertSafeRecordFields(input, ["budget", "lastError", "payload"]);
    const checksumValue = recordChecksum(input);
    const record: RunRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM runs WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`run ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO runs (id, workspace_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.contextSnapshotId,
          input.state,
          input.round,
          input.currentStep,
          serialize(input.budget),
          input.artifactId,
          input.approval,
          input.totalCostUsd,
          input.startedAt,
          input.updatedAt,
          input.lastError === null ? null : serialize(input.lastError),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `run:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "run.appended",
        entityType: "run",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.updatedAt,
      });
    })();
    return record;
  }

  public async getRun(id: string): Promise<RunRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM runs WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : runFromRow(row);
  }

  public async listRuns(workspaceId: string): Promise<readonly RunRecord[]> {
    this.ensureOpen();
    requireNonEmpty(workspaceId, "run workspaceId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM runs WHERE workspace_id = ? ORDER BY updated_at, id",
      )
      .all(workspaceId)
      .map((row) => runFromRow(row));
  }

  public async saveRunSnapshot(input: RunSnapshotRecordInput): Promise<RunSnapshotRecord> {
    this.ensureOpen();
    requireNonEmpty(input.workspaceId, "run snapshot workspaceId");
    requireNonEmpty(input.runId, "run snapshot runId");
    requireNonEmpty(input.contextSnapshotId, "run snapshot contextSnapshotId");
    requireStoredRunState(input.state, "run snapshot state");
    requirePositive(input.round, "run snapshot round");
    requireStoredStep(input.currentStep, "run snapshot currentStep");
    requireNonEmpty(input.startedAt, "run snapshot startedAt");
    requireNonEmpty(input.updatedAt, "run snapshot updatedAt");
    requireNonNegativeNumber(input.totalCostUsd, "run snapshot totalCostUsd");
    assertSafeRecordFields(input, ["budget", "lastError", "payload"]);
    const checksumValue = recordChecksum(input);
    const id = `run-snapshot:${input.runId}:${checksumValue}`;
    const recordWithoutSequence = { ...input, id, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT sequence, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE id = ?",
        )
        .get(id);
      if (existing !== undefined) {
        const existingRecord = runSnapshotFromRow(existing);
        if (existingRecord.checksum !== checksumValue) {
          throw new StorageConflictError(`run snapshot ${id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO run_snapshots (id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.workspaceId,
          input.runId,
          input.contextSnapshotId,
          input.state,
          input.round,
          input.currentStep,
          serialize(input.budget),
          input.artifactId,
          input.approval,
          input.totalCostUsd,
          input.startedAt,
          input.updatedAt,
          input.lastError === null ? null : serialize(input.lastError),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `${id}:audit`,
        workspaceId: input.workspaceId,
        eventType: "run-snapshot.appended",
        entityType: "run-snapshot",
        entityId: input.runId,
        payload: recordToJson(recordWithoutSequence),
        createdAt: input.updatedAt,
      });
    })();
    const saved = await this.getRunSnapshotById(id);
    if (saved === undefined) {
      throw new StorageConflictError(`run snapshot ${id} could not be read after insert`);
    }
    return saved;
  }

  public async getLatestRunSnapshot(runId: string): Promise<RunSnapshotRecord | undefined> {
    this.ensureOpen();
    requireNonEmpty(runId, "run snapshot runId");
    const row = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE run_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(runId);
    return row === undefined ? undefined : runSnapshotFromRow(row);
  }

  public async listRunSnapshots(runId: string): Promise<readonly RunSnapshotRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "run snapshot runId");
    return this.database
      .prepare(
        "SELECT sequence, id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE run_id = ? ORDER BY sequence, id",
      )
      .all(runId)
      .map((row) => runSnapshotFromRow(row));
  }

  private async getRunSnapshotById(id: string): Promise<RunSnapshotRecord | undefined> {
    const row = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : runSnapshotFromRow(row);
  }

  public async saveRound(input: RoundRecordInput): Promise<RoundRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "round id");
    requireNonEmpty(input.workspaceId, "round workspaceId");
    requireNonEmpty(input.runId, "round runId");
    requirePositive(input.number, "round number");
    requireStoredRunState(input.state, "round state");
    requireNonEmpty(input.startedAt, "round startedAt");
    if (input.completedAt !== null) requireNonEmpty(input.completedAt, "round completedAt");
    assertSafeRecordFields(input, ["evaluation", "payload"]);
    const checksumValue = recordChecksum(input);
    const record: RoundRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM rounds WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`round ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO rounds (id, workspace_id, run_id, number, state, started_at, completed_at, evaluation_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.number,
          input.state,
          input.startedAt,
          input.completedAt,
          input.evaluation === null ? null : serialize(input.evaluation),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `round:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "round.appended",
        entityType: "round",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.startedAt,
      });
    })();
    return record;
  }

  public async getRound(id: string): Promise<RoundRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, number, state, started_at, completed_at, evaluation_json, payload_json, record_checksum FROM rounds WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : roundFromRow(row);
  }

  public async listRounds(runId: string): Promise<readonly RoundRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "round runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, number, state, started_at, completed_at, evaluation_json, payload_json, record_checksum FROM rounds WHERE run_id = ? ORDER BY number, id",
      )
      .all(runId)
      .map((row) => roundFromRow(row));
  }

  public async saveExecution(input: ExecutionRecordInput): Promise<ExecutionRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "execution id");
    requireNonEmpty(input.workspaceId, "execution workspaceId");
    requireNonEmpty(input.runId, "execution runId");
    requireNonEmpty(input.roundId, "execution roundId");
    requireNonEmpty(input.contextSnapshotId, "execution contextSnapshotId");
    requirePositive(input.attempt, "execution attempt");
    requireNonEmpty(input.provider, "execution provider");
    requireNonEmpty(input.modelId, "execution modelId");
    requireNonNegativeInteger(input.inputTokens, "execution inputTokens");
    requireNonNegativeInteger(input.outputTokens, "execution outputTokens");
    requireNonNegativeInteger(input.totalTokens, "execution totalTokens");
    if (input.estimatedUsd !== null)
      requireNonNegativeNumber(input.estimatedUsd, "execution estimatedUsd");
    requireNonEmpty(input.startedAt, "execution startedAt");
    if (input.completedAt !== null) requireNonEmpty(input.completedAt, "execution completedAt");
    assertSafeRecordFields(input, ["output", "payload"]);
    const checksumValue = recordChecksum(input);
    const record: ExecutionRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM executions WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`execution ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO executions (id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, provider_request_id, output_checksum, input_tokens, output_tokens, total_tokens, estimated_usd, started_at, completed_at, error_code, output_json, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.roundId,
          input.contextSnapshotId,
          input.artifactId,
          input.attempt,
          input.step,
          input.status,
          input.provider,
          input.modelId,
          input.providerRequestId,
          input.outputChecksum,
          input.inputTokens,
          input.outputTokens,
          input.totalTokens,
          input.estimatedUsd,
          input.startedAt,
          input.completedAt,
          input.errorCode,
          input.output === null ? null : serialize(input.output),
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `execution:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "execution.appended",
        entityType: "execution",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.completedAt ?? input.startedAt,
      });
    })();
    return record;
  }

  public async getExecution(id: string): Promise<ExecutionRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, provider_request_id, output_checksum, input_tokens, output_tokens, total_tokens, estimated_usd, started_at, completed_at, error_code, output_json, payload_json, record_checksum FROM executions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : executionFromRow(row);
  }

  public async listExecutions(runId: string): Promise<readonly ExecutionRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "execution runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, provider_request_id, output_checksum, input_tokens, output_tokens, total_tokens, estimated_usd, started_at, completed_at, error_code, output_json, payload_json, record_checksum FROM executions WHERE run_id = ? ORDER BY started_at, id",
      )
      .all(runId)
      .map((row) => executionFromRow(row));
  }

  public async saveFinding(input: FindingRecordInput): Promise<FindingRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "finding id");
    requireNonEmpty(input.workspaceId, "finding workspaceId");
    requireNonEmpty(input.runId, "finding runId");
    requireNonEmpty(input.roundId, "finding roundId");
    requireNonEmpty(input.code, "finding code");
    requireNonEmpty(input.category, "finding category");
    requireNonEmpty(input.message, "finding message");
    requireNonEmpty(input.createdAt, "finding createdAt");
    assertSafeRecordFields(input, ["payload"]);
    const checksumValue = recordChecksum(input);
    const record: FindingRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM findings WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`finding ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO findings (id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, claim_id, section_id, requirement_id, created_at, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.roundId,
          input.executionId,
          input.artifactId,
          input.code,
          input.category,
          input.severity,
          input.message,
          input.claimId,
          input.sectionId,
          input.requirementId,
          input.createdAt,
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `finding:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "finding.appended",
        entityType: "finding",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.createdAt,
      });
    })();
    return record;
  }

  public async getFinding(id: string): Promise<FindingRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, claim_id, section_id, requirement_id, created_at, payload_json, record_checksum FROM findings WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : findingFromRow(row);
  }

  public async listFindings(runId: string): Promise<readonly FindingRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "finding runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, claim_id, section_id, requirement_id, created_at, payload_json, record_checksum FROM findings WHERE run_id = ? ORDER BY created_at, id",
      )
      .all(runId)
      .map((row) => findingFromRow(row));
  }

  public async saveDecision(input: DecisionRecordInput): Promise<DecisionRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "decision id");
    requireNonEmpty(input.workspaceId, "decision workspaceId");
    requireNonEmpty(input.runId, "decision runId");
    requireNonEmpty(input.rationale, "decision rationale");
    requireNonEmpty(input.actor, "decision actor");
    requireNonEmpty(input.createdAt, "decision createdAt");
    assertSafeRecordFields(input, ["payload"]);
    const checksumValue = recordChecksum(input);
    const record: DecisionRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM decisions WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`decision ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO decisions (id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.roundId,
          input.artifactId,
          input.type,
          input.rationale,
          input.actor,
          input.createdAt,
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `decision:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "decision.appended",
        entityType: "decision",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.createdAt,
      });
    })();
    return record;
  }

  public async getDecision(id: string): Promise<DecisionRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum FROM decisions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : decisionFromRow(row);
  }

  public async listDecisions(runId: string): Promise<readonly DecisionRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "decision runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum FROM decisions WHERE run_id = ? ORDER BY created_at, id",
      )
      .all(runId)
      .map((row) => decisionFromRow(row));
  }

  public async saveExport(input: ExportRecordInput): Promise<ExportRecord> {
    this.ensureOpen();
    requireNonEmpty(input.id, "export id");
    requireNonEmpty(input.workspaceId, "export workspaceId");
    requireNonEmpty(input.runId, "export runId");
    requireNonEmpty(input.artifactId, "export artifactId");
    requireNonEmpty(input.format, "export format");
    requireNonEmpty(input.createdAt, "export createdAt");
    assertSafeRecordFields(input, ["payload"]);
    const checksumValue = recordChecksum(input);
    const record: ExportRecord = { ...input, checksum: checksumValue };
    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT record_checksum FROM exports WHERE id = ?")
        .get<{ readonly record_checksum: string }>(input.id);
      if (existing !== undefined) {
        if (existing.record_checksum !== checksumValue) {
          throw new StorageConflictError(`export ${input.id} is immutable`);
        }
        return;
      }
      this.database
        .prepare(
          "INSERT INTO exports (id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.workspaceId,
          input.runId,
          input.artifactId,
          input.format,
          input.status,
          input.outputPath,
          input.outputChecksum,
          input.createdAt,
          serialize(input.payload),
          checksumValue,
        );
      this.insertAuditEvent({
        id: `export:${input.id}:${checksumValue}`,
        workspaceId: input.workspaceId,
        eventType: "export.appended",
        entityType: "export",
        entityId: input.id,
        payload: recordToJson(record),
        createdAt: input.createdAt,
      });
    })();
    return record;
  }

  public async getExport(id: string): Promise<ExportRecord | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum FROM exports WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : exportFromRow(row);
  }

  public async listExports(runId: string): Promise<readonly ExportRecord[]> {
    this.ensureOpen();
    requireNonEmpty(runId, "export runId");
    return this.database
      .prepare(
        "SELECT id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum FROM exports WHERE run_id = ? ORDER BY created_at, id",
      )
      .all(runId)
      .map((row) => exportFromRow(row));
  }

  public async appendAuditEvent(input: AuditEventInput): Promise<AuditEvent> {
    this.ensureOpen();
    requireNonEmpty(input.id, "audit event id");
    requireNonEmpty(input.workspaceId, "audit event workspaceId");
    requireNonEmpty(input.eventType, "audit event type");
    requireNonEmpty(input.entityType, "audit event entityType");
    requireNonEmpty(input.entityId, "audit event entityId");
    requireNonEmpty(input.createdAt, "audit event createdAt");
    let result: AuditEvent | undefined;
    this.database.transaction(() => {
      result = this.insertAuditEvent(input);
    })();
    return result as AuditEvent;
  }

  public async listAuditEvents(workspaceId: string): Promise<readonly AuditEvent[]> {
    this.ensureOpen();
    return this.database
      .prepare(
        "SELECT sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE workspace_id = ? ORDER BY sequence",
      )
      .all(workspaceId)
      .map((row) => auditFromRow(row));
  }

  public async searchEvidence(
    query: string,
    optionsOrLimit: EvidenceSearchOptions | number = {},
  ): Promise<readonly EvidenceSearchHit[]> {
    return (await this.inspectEvidenceRetrieval(query, optionsOrLimit)).hits;
  }

  public async inspectEvidenceRetrieval(
    query: string,
    optionsOrLimit: EvidenceSearchOptions | number = {},
  ): Promise<EvidenceRetrievalInspection> {
    this.ensureOpen();
    const options = typeof optionsOrLimit === "number" ? { limit: optionsOrLimit } : optionsOrLimit;
    const limit = options.limit ?? 20;
    if (options.workspaceId !== undefined) {
      requireNonEmpty(options.workspaceId, "evidence search workspaceId");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new StorageValidationError("evidence search limit must be an integer from 1 to 100");
    }
    const workspaceId = options.workspaceId ?? null;
    const indexedChunkCount = Number(
      this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM evidence_chunks WHERE (? IS NULL OR workspace_id = ?)",
        )
        .get<{ readonly count: number }>(workspaceId, workspaceId)?.count ?? 0,
    );
    if (indexedChunkCount === 0) {
      return {
        status: "not-indexed",
        indexedChunkCount,
        selectedChunkCount: 0,
        selectedSourceCount: 0,
        hits: [],
      };
    }

    const queryTerms = evidenceQueryTerms(query);
    if (queryTerms.length === 0) {
      return {
        status: "no-query",
        indexedChunkCount,
        selectedChunkCount: 0,
        selectedSourceCount: 0,
        hits: [],
      };
    }
    const ftsQuery = queryTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    let hits = this.database
      .prepare(
        "SELECT c.id, c.workspace_id, c.source_id, c.ordinal, c.line_start, c.line_end, c.checksum, c.text, c.created_at, bm25(evidence_chunks_fts) AS rank FROM evidence_chunks_fts JOIN evidence_chunks AS c ON c.id = evidence_chunks_fts.chunk_id WHERE evidence_chunks_fts MATCH ? AND (? IS NULL OR c.workspace_id = ?) ORDER BY rank, c.id LIMIT ?",
      )
      .all(ftsQuery, workspaceId, workspaceId, limit)
      .map((row) => ({ ...evidenceChunkFromRow(row), rank: Number(row.rank) }));
    const status = hits.length > 0 ? "matched" : "fallback";
    if (hits.length === 0) {
      hits = this.database
        .prepare(
          "SELECT id, workspace_id, source_id, ordinal, line_start, line_end, checksum, text, created_at, 0 AS rank FROM evidence_chunks WHERE (? IS NULL OR workspace_id = ?) ORDER BY source_id, ordinal, id LIMIT ?",
        )
        .all(workspaceId, workspaceId, limit)
        .map((row) => ({ ...evidenceChunkFromRow(row), rank: Number(row.rank) }));
    }
    return {
      status,
      indexedChunkCount,
      selectedChunkCount: hits.length,
      selectedSourceCount: new Set(hits.map((hit) => hit.sourceId)).size,
      hits,
    };
  }

  public async queryEvidence(
    query: string,
    options?: RetrievalOptions,
  ): Promise<readonly ScoredEvidenceChunk[]> {
    return this.searchEvidence(query, options);
  }

  public async rebuildCandidateKnowledgeLexicalIndex(
    input: CandidateKnowledgeLexicalIndexRebuildInput,
  ): Promise<CandidateKnowledgeLexicalIndexRecord> {
    this.ensureOpen();
    const record = requireStrictStorageObject(
      input,
      candidateKnowledgeLexicalIndexRebuildKeys,
      "candidate knowledge lexical index rebuild",
    );
    const scope = validatedCandidateKnowledgeRetrievalScope(record.scope);
    const identity = validatedCandidateKnowledgeLexicalIndexIdentity(record.index);
    const { storeId, knowledgeBaseId } = requireSingleCandidateKnowledgeLexicalScope(scope);
    requireCandidateKnowledgeLexicalManifestBinding(scope, identity);
    const createdAt = requireTimestamp(
      String(record.createdAt),
      "candidate knowledge lexical index createdAt",
    );
    const chunks = validatedCandidateKnowledgeLexicalChunks(record.chunks, scope);
    if (chunks.length === 0) {
      throw new StorageValidationError(
        "Candidate knowledge lexical index must contain at least one chunk",
      );
    }
    let result: CandidateKnowledgeLexicalIndexRecord | undefined;
    this.database.transaction(() => {
      this.database
        .prepare(
          "DELETE FROM candidate_knowledge_lexical_chunks_fts WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(storeId, knowledgeBaseId);
      this.database
        .prepare(
          "DELETE FROM candidate_knowledge_lexical_chunks WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(storeId, knowledgeBaseId);
      this.database
        .prepare(
          "DELETE FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(storeId, knowledgeBaseId);
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_lexical_indexes (store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at, stale) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
        )
        .run(
          storeId,
          knowledgeBaseId,
          identity.schemaVersion,
          identity.indexerId,
          identity.manifestChecksum,
          candidateKnowledgeLexicalScopeJson(scope),
          createdAt,
        );
      this.insertCandidateKnowledgeLexicalChunks(storeId, knowledgeBaseId, chunks);
      const indexRow = this.database
        .prepare(
          "SELECT store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .get(storeId, knowledgeBaseId);
      if (indexRow === undefined) {
        throw new StorageValidationError("Candidate knowledge lexical index was not stored");
      }
      result = candidateKnowledgeLexicalIndexRecordFromRow(this.database, indexRow);
    })();
    return result as CandidateKnowledgeLexicalIndexRecord;
  }

  public async upsertCandidateKnowledgeLexicalChunks(
    input: CandidateKnowledgeLexicalIndexUpsertInput,
  ): Promise<CandidateKnowledgeLexicalIndexRecord> {
    this.ensureOpen();
    const record = requireStrictStorageObject(
      input,
      candidateKnowledgeLexicalIndexUpsertKeys,
      "candidate knowledge lexical index upsert",
    );
    const scope = validatedCandidateKnowledgeRetrievalScope(record.scope);
    const identity = validatedCandidateKnowledgeLexicalIndexIdentity(record.index);
    const { storeId, knowledgeBaseId } = requireSingleCandidateKnowledgeLexicalScope(scope);
    requireCandidateKnowledgeLexicalManifestBinding(scope, identity);
    const chunks = validatedCandidateKnowledgeLexicalChunks(record.chunks, scope);
    let result: CandidateKnowledgeLexicalIndexRecord | undefined;
    this.database.transaction(() => {
      const existingRow = this.database
        .prepare(
          "SELECT store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .get(storeId, knowledgeBaseId);
      if (existingRow === undefined) {
        throw new StorageConflictError("Candidate knowledge lexical index must be rebuilt first");
      }
      const existing = candidateKnowledgeLexicalIndexRecordFromRow(this.database, existingRow);
      if (!lexicalScopeEquals(existing.scope, scope)) {
        throw new StorageConflictError("Candidate knowledge lexical index scope has changed");
      }
      for (const chunk of chunks) {
        const conflictingRows = this.database
          .prepare(
            "SELECT chunk_id FROM candidate_knowledge_lexical_chunks WHERE store_id = ? AND knowledge_base_id = ? AND ((chunk_id = ?) OR (source_id = ? AND version_id = ? AND ordinal = ?))",
          )
          .all(
            storeId,
            knowledgeBaseId,
            chunk.chunkId,
            chunk.metadata.provenance.sourceId,
            chunk.metadata.provenance.versionId,
            chunk.ordinal,
          );
        for (const conflictingRow of conflictingRows) {
          const oldChunkId = rowString(conflictingRow, "chunk_id");
          this.database
            .prepare(
              "DELETE FROM candidate_knowledge_lexical_chunks_fts WHERE store_id = ? AND knowledge_base_id = ? AND chunk_key = ?",
            )
            .run(storeId, knowledgeBaseId, oldChunkId);
        }
        this.database
          .prepare(
            "DELETE FROM candidate_knowledge_lexical_chunks WHERE store_id = ? AND knowledge_base_id = ? AND ((chunk_id = ?) OR (source_id = ? AND version_id = ? AND ordinal = ?))",
          )
          .run(
            storeId,
            knowledgeBaseId,
            chunk.chunkId,
            chunk.metadata.provenance.sourceId,
            chunk.metadata.provenance.versionId,
            chunk.ordinal,
          );
        this.insertCandidateKnowledgeLexicalChunks(storeId, knowledgeBaseId, [chunk]);
      }
      this.database
        .prepare(
          "UPDATE candidate_knowledge_lexical_indexes SET schema_version = ?, indexer_id = ?, manifest_checksum = ?, scope_json = ?, created_at = ?, stale = 0 WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(
          identity.schemaVersion,
          identity.indexerId,
          identity.manifestChecksum,
          candidateKnowledgeLexicalScopeJson(scope),
          now(),
          storeId,
          knowledgeBaseId,
        );
      const indexRow = this.database
        .prepare(
          "SELECT store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .get(storeId, knowledgeBaseId);
      if (indexRow === undefined) {
        throw new StorageValidationError("Candidate knowledge lexical index was not stored");
      }
      result = candidateKnowledgeLexicalIndexRecordFromRow(this.database, indexRow);
    })();
    return result as CandidateKnowledgeLexicalIndexRecord;
  }

  public async deleteCandidateKnowledgeLexicalSourceVersion(
    input: CandidateKnowledgeLexicalSourceVersionDeletionInput,
  ): Promise<void> {
    this.ensureOpen();
    const record = requireStrictStorageObject(
      input,
      candidateKnowledgeLexicalSourceVersionDeletionKeys,
      "candidate knowledge lexical source-version deletion",
    );
    const parsed = candidateKnowledgeRetrievalSourceVersionReferenceSchema.safeParse(record);
    if (!parsed.success) {
      throw new StorageValidationError("Candidate knowledge lexical source-version is invalid");
    }
    const reference = parsed.data as CandidateKnowledgeRetrievalSourceVersionReference;
    this.database.transaction(() => {
      // A source-version deletion invalidates the complete manifest. Clear
      // the whole replaceable projection atomically so no chunks survive
      // without the manifest that scoped them.
      this.database
        .prepare(
          "DELETE FROM candidate_knowledge_lexical_chunks_fts WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(reference.storeId, reference.knowledgeBaseId);
      this.database
        .prepare(
          "DELETE FROM candidate_knowledge_lexical_chunks WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(reference.storeId, reference.knowledgeBaseId);
      // A manifest without the deleted source-version set is not a current
      // index. Force an explicit whole-scope rebuild before any new query.
      this.database
        .prepare(
          "DELETE FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?",
        )
        .run(reference.storeId, reference.knowledgeBaseId);
    })();
  }

  public async inspectCandidateKnowledgeLexicalIndex(
    scopeInput: CandidateKnowledgeRetrievalScopeInput,
    indexInput?: CandidateKnowledgeLexicalIndexIdentityInput,
  ): Promise<CandidateKnowledgeLexicalIndexInspection> {
    this.ensureOpen();
    const requestedScope = validatedCandidateKnowledgeRetrievalScope(scopeInput);
    const { storeId, knowledgeBaseId } =
      requireSingleCandidateKnowledgeLexicalScope(requestedScope);
    const expectedIndex =
      indexInput === undefined
        ? undefined
        : validatedCandidateKnowledgeLexicalIndexIdentity(indexInput);
    const row = this.database
      .prepare(
        "SELECT store_id, knowledge_base_id, schema_version, indexer_id, manifest_checksum, scope_json, created_at, stale FROM candidate_knowledge_lexical_indexes WHERE store_id = ? AND knowledge_base_id = ?",
      )
      .get(storeId, knowledgeBaseId);
    if (row === undefined) {
      return {
        status: "not-indexed",
        requestedScope,
        index: null,
        indexedScope: null,
        indexedChunkCount: 0,
      };
    }
    const record = candidateKnowledgeLexicalIndexRecordFromRow(this.database, row);
    const stale =
      record.stale ||
      !lexicalScopeEquals(record.scope, requestedScope) ||
      (expectedIndex !== undefined && !lexicalIndexEquals(record.index, expectedIndex));
    if (record.indexedChunkCount === 0) {
      return {
        status: "not-indexed",
        requestedScope,
        index: null,
        indexedScope: null,
        indexedChunkCount: 0,
      };
    }
    return {
      status: stale ? "stale" : "matched",
      requestedScope,
      index: record.index,
      indexedScope: record.scope,
      indexedChunkCount: record.indexedChunkCount,
    };
  }

  public async queryCandidateKnowledge(
    requestInput: CandidateKnowledgeLexicalRetrievalRequestInput,
  ): Promise<CandidateKnowledgeLexicalRetrievalResult> {
    this.ensureOpen();
    const request = validatedCandidateKnowledgeRetrievalRequest(requestInput);
    const inspection = await this.inspectCandidateKnowledgeLexicalIndex(request.scope);
    const base = {
      purpose: request.purpose,
      scope: request.scope,
      index: inspection.index,
      indexedChunkCount: inspection.indexedChunkCount,
    };
    if (inspection.status !== "matched") {
      return validatedCandidateKnowledgeRetrievalResult({
        ...base,
        status: inspection.status,
        selectedChunkCount: 0,
        selectedSourceCount: 0,
        hits: [],
      });
    }
    const queryTerms = evidenceQueryTerms(request.query);
    if (queryTerms.length === 0) {
      return validatedCandidateKnowledgeRetrievalResult({
        ...base,
        status: "no-query",
        selectedChunkCount: 0,
        selectedSourceCount: 0,
        hits: [],
      });
    }
    const { storeId, knowledgeBaseId } = requireSingleCandidateKnowledgeLexicalScope(request.scope);
    const ftsQuery = queryTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    let rows = this.database
      .prepare(
        "SELECT c.store_id, c.knowledge_base_id, c.source_id, c.version_id, c.chunk_id, c.ordinal, c.line_start, c.line_end, c.text, c.metadata_json, bm25(candidate_knowledge_lexical_chunks_fts) AS bm25_rank FROM candidate_knowledge_lexical_chunks_fts JOIN candidate_knowledge_lexical_chunks AS c ON c.chunk_id = candidate_knowledge_lexical_chunks_fts.chunk_key AND c.store_id = candidate_knowledge_lexical_chunks_fts.store_id AND c.knowledge_base_id = candidate_knowledge_lexical_chunks_fts.knowledge_base_id WHERE candidate_knowledge_lexical_chunks_fts MATCH ? AND candidate_knowledge_lexical_chunks_fts.store_id = ? AND candidate_knowledge_lexical_chunks_fts.knowledge_base_id = ? ORDER BY bm25_rank, c.chunk_id LIMIT ?",
      )
      .all(ftsQuery, storeId, knowledgeBaseId, request.limit);
    let status: CandidateKnowledgeRetrievalStatus = "matched";
    if (rows.length === 0) {
      status = "bounded-fallback";
      rows = this.database
        .prepare(
          "SELECT store_id, knowledge_base_id, source_id, version_id, chunk_id, ordinal, line_start, line_end, text, metadata_json, 0 AS bm25_rank FROM candidate_knowledge_lexical_chunks WHERE store_id = ? AND knowledge_base_id = ? ORDER BY chunk_id LIMIT ?",
        )
        .all(storeId, knowledgeBaseId, request.limit);
    }
    const hits = rows.map((row) => ({
      chunkId: rowString(row, "chunk_id"),
      ordinal: rowNumber(row, "ordinal"),
      lineStart: rowNumber(row, "line_start"),
      lineEnd: rowNumber(row, "line_end"),
      text: rowString(row, "text"),
      metadata: parse(rowString(row, "metadata_json")),
      bm25Rank: Number(row.bm25_rank),
    }));
    const selectedSourceCount = new Set(
      hits.map((hit) => {
        const metadata = hit.metadata as { readonly provenance?: unknown };
        return JSON.stringify(metadata.provenance);
      }),
    ).size;
    return validatedCandidateKnowledgeRetrievalResult({
      ...base,
      status,
      selectedChunkCount: hits.length,
      selectedSourceCount,
      hits,
    });
  }

  public async appendCandidateKnowledgeRetrievalTrace(
    input: CandidateKnowledgeRetrievalTraceInput,
  ): Promise<CandidateKnowledgeRetrievalTrace> {
    this.ensureOpen();
    const trace = validatedCandidateKnowledgeRetrievalTrace(input);
    if (trace.index !== null) {
      requireCandidateKnowledgeLexicalManifestBinding(trace.scope, trace.index);
    }
    const payload = recordToJson(trace);
    const payloadJson = serialize(payload);
    const payloadChecksum = checksum(payloadJson);
    let result: CandidateKnowledgeRetrievalTrace | undefined;
    this.database.transaction(() => {
      const existing = this.database
        .prepare(
          "SELECT workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at FROM candidate_knowledge_retrieval_traces WHERE workspace_id = ? AND trace_id = ?",
        )
        .get(trace.workspaceId, trace.id);
      if (existing !== undefined) {
        if (rowString(existing, "payload_checksum") !== payloadChecksum) {
          throw new StorageConflictError("Candidate knowledge retrieval trace is immutable");
        }
        result = candidateKnowledgeRetrievalTraceFromRow(existing);
        return;
      }
      this.database
        .prepare(
          "INSERT INTO candidate_knowledge_retrieval_traces (workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          trace.workspaceId,
          trace.id,
          trace.schemaVersion,
          trace.operationId,
          trace.purpose,
          trace.queryChecksum,
          payloadJson,
          payloadChecksum,
          trace.createdAt,
        );
      result = trace;
    })();
    return result as CandidateKnowledgeRetrievalTrace;
  }

  public async getCandidateKnowledgeRetrievalTrace(
    workspaceId: string,
    traceId: string,
  ): Promise<CandidateKnowledgeRetrievalTrace | undefined> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireSafeLexicalIdentifier(
      workspaceId,
      "retrieval trace workspaceId",
    );
    const normalizedTraceId = requireSafeLexicalIdentifier(traceId, "retrieval trace id");
    const row = this.database
      .prepare(
        "SELECT workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at FROM candidate_knowledge_retrieval_traces WHERE workspace_id = ? AND trace_id = ?",
      )
      .get(normalizedWorkspaceId, normalizedTraceId);
    return row === undefined ? undefined : candidateKnowledgeRetrievalTraceFromRow(row);
  }

  public async listCandidateKnowledgeRetrievalTraces(
    workspaceId: string,
    options: CandidateKnowledgeRetrievalTraceListOptions = {},
  ): Promise<readonly CandidateKnowledgeRetrievalTrace[]> {
    this.ensureOpen();
    const normalizedWorkspaceId = requireSafeLexicalIdentifier(
      workspaceId,
      "retrieval trace workspaceId",
    );
    const record = requireStrictStorageObject(
      options,
      new Set(["operationId", "limit"]),
      "retrieval trace list options",
    );
    const operationId =
      record.operationId === undefined
        ? undefined
        : requireSafeLexicalIdentifier(String(record.operationId), "retrieval trace operationId");
    const limit = record.limit === undefined ? 100 : Number(record.limit);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > maximumCandidateKnowledgeRetrievalTraceListCount
    ) {
      throw new StorageValidationError("retrieval trace limit is invalid");
    }
    const rows =
      operationId === undefined
        ? this.database
            .prepare(
              "SELECT workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at FROM candidate_knowledge_retrieval_traces WHERE workspace_id = ? ORDER BY created_at, trace_id LIMIT ?",
            )
            .all(normalizedWorkspaceId, limit)
        : this.database
            .prepare(
              "SELECT workspace_id, trace_id, schema_version, operation_id, purpose, query_checksum, payload_json, payload_checksum, created_at FROM candidate_knowledge_retrieval_traces WHERE workspace_id = ? AND operation_id = ? ORDER BY created_at, trace_id LIMIT ?",
            )
            .all(normalizedWorkspaceId, operationId, limit);
    return rows.map((row) => candidateKnowledgeRetrievalTraceFromRow(row));
  }

  private insertCandidateKnowledgeLexicalChunks(
    storeId: string,
    knowledgeBaseId: string,
    chunks: readonly CandidateKnowledgeLexicalChunk[],
  ): void {
    const insertChunk = this.database.prepare(
      "INSERT INTO candidate_knowledge_lexical_chunks (store_id, knowledge_base_id, source_id, version_id, chunk_id, ordinal, line_start, line_end, text, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertFts = this.database.prepare(
      "INSERT INTO candidate_knowledge_lexical_chunks_fts (chunk_key, store_id, knowledge_base_id, source_id, version_id, text) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const chunk of chunks) {
      const provenance = chunk.metadata.provenance;
      insertChunk.run(
        storeId,
        knowledgeBaseId,
        provenance.sourceId,
        provenance.versionId,
        chunk.chunkId,
        chunk.ordinal,
        chunk.lineStart,
        chunk.lineEnd,
        chunk.text,
        serialize(recordToJson(chunk.metadata)),
      );
      insertFts.run(
        chunk.chunkId,
        storeId,
        knowledgeBaseId,
        provenance.sourceId,
        provenance.versionId,
        chunk.text,
      );
    }
  }

  public async backup(destination: string): Promise<void> {
    await this.createBackup(destination);
  }

  public async createBackup(destinationPath: string): Promise<WorkspaceBackupResult> {
    this.ensureOpen();
    requireNonEmpty(destinationPath, "backup destination");
    const parentDir = dirname(destinationPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    await this.database.backup(destinationPath);
    const content = readFileSync(destinationPath);
    const stat = statSync(destinationPath);
    const hash = createHash("sha256").update(content).digest("hex");
    return {
      backupPath: destinationPath,
      checksum: hash,
      sizeBytes: stat.size,
      createdAt: now(),
    };
  }

  public static verifyDatabaseIntegrity(databasePath: string): boolean {
    requireNonEmpty(databasePath, "database path");
    if (!existsSync(databasePath)) {
      return false;
    }
    try {
      const db = loadSqlite(databasePath);
      try {
        const quickCheck = db.pragma("quick_check") as
          | readonly { readonly quick_check?: string }[]
          | { readonly quick_check?: string };
        const integrityCheck = db.pragma("integrity_check") as
          | readonly { readonly integrity_check?: string }[]
          | { readonly integrity_check?: string };
        const isOk = (res: unknown): boolean => {
          if (Array.isArray(res)) {
            return (
              res.length === 1 && (res[0]?.quick_check === "ok" || res[0]?.integrity_check === "ok")
            );
          }
          if (typeof res === "object" && res !== null) {
            const r = res as Record<string, unknown>;
            return r.quick_check === "ok" || r.integrity_check === "ok";
          }
          return res === "ok";
        };
        return isOk(quickCheck) && isOk(integrityCheck);
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  public static async restore(
    backupPath: string,
    destinationPath: string,
    options: WorkspaceRestoreOptions = {},
  ): Promise<SqliteStorage> {
    requireNonEmpty(backupPath, "backup path");
    requireNonEmpty(destinationPath, "destination path");
    if (!existsSync(backupPath)) {
      throw new StorageValidationError(`Backup file not found at: ${backupPath}`);
    }
    if (options.verifyIntegrity !== false) {
      const valid = SqliteStorage.verifyDatabaseIntegrity(backupPath);
      if (!valid) {
        throw new StorageValidationError(
          `Backup file at ${backupPath} failed SQLite integrity check.`,
        );
      }
    }
    const destDir = dirname(destinationPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(backupPath, destinationPath);
    return new SqliteStorage(destinationPath);
  }

  /**
   * Returns an external-archive plan without deleting local immutable history.
   * Retention deletion is intentionally outside this v1 storage boundary.
   */
  public async planRetention(before: string): Promise<RetentionPlan> {
    this.ensureOpen();
    requireNonEmpty(before, "retention before");
    if (Number.isNaN(Date.parse(before))) {
      throw new StorageValidationError("retention before must be a valid timestamp");
    }
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE created_at < ?")
      .get<{ readonly count: number }>(before);
    return {
      before,
      auditEventsEligible: Number(row?.count ?? 0),
      immutableBusinessRecords: true,
    };
  }

  public async purgeRetention(
    before: string,
    options: RetentionPurgeOptions,
  ): Promise<RetentionPurgeResult> {
    this.ensureOpen();
    requireNonEmpty(before, "retention before");
    if (Number.isNaN(Date.parse(before))) {
      throw new StorageValidationError("retention before must be a valid timestamp");
    }
    if (options?.confirmed !== true) {
      throw new StorageValidationError(
        "Explicit user confirmation (options.confirmed = true) is required to purge retention records.",
      );
    }
    const executedAt = now();
    const countRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE created_at < ?")
      .get<{ readonly count: number }>(before);
    const eligibleCount = Number(countRow?.count ?? 0);

    const purgeTx = this.database.transaction(() => {
      this.database.prepare("DROP TRIGGER IF EXISTS audit_events_immutable_delete").run();
      this.database.prepare("DELETE FROM audit_events WHERE created_at < ?").run(before);
      this.database
        .prepare(
          "CREATE TRIGGER IF NOT EXISTS audit_events_immutable_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;",
        )
        .run();
    });
    purgeTx();

    return {
      before,
      deletedAuditEventsCount: eligibleCount,
      executedAt,
    };
  }

  public async exportDiagnosticTelemetry(): Promise<DiagnosticTelemetryReport> {
    this.ensureOpen();
    const workspacesCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM workspaces")
        .get<{ readonly count: number }>()?.count ?? 0,
    );
    const totalRunsCount = Number(
      this.database.prepare("SELECT COUNT(*) AS count FROM runs").get<{ readonly count: number }>()
        ?.count ?? 0,
    );
    const totalRoundsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM rounds")
        .get<{ readonly count: number }>()?.count ?? 0,
    );
    const totalExecutionsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM executions")
        .get<{ readonly count: number }>()?.count ?? 0,
    );

    const execStatusRows = this.database
      .prepare("SELECT status, COUNT(*) AS count FROM executions GROUP BY status")
      .all<{ readonly status: string; readonly count: number }>();
    const executionsByStatus: Record<string, number> = {};
    for (const row of execStatusRows) {
      executionsByStatus[row.status] = Number(row.count);
    }

    const execStepRows = this.database
      .prepare("SELECT step, COUNT(*) AS count FROM executions GROUP BY step")
      .all<{ readonly step: string; readonly count: number }>();
    const executionsByStep: Record<string, number> = {};
    for (const row of execStepRows) {
      executionsByStep[row.step] = Number(row.count);
    }

    const findingsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM findings")
        .get<{ readonly count: number }>()?.count ?? 0,
    );
    const findingSeverityRows = this.database
      .prepare("SELECT severity, COUNT(*) AS count FROM findings GROUP BY severity")
      .all<{ readonly severity: string; readonly count: number }>();
    const findingsBySeverity: Record<string, number> = {};
    for (const row of findingSeverityRows) {
      findingsBySeverity[row.severity] = Number(row.count);
    }

    const decisionsCount = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM decisions")
        .get<{ readonly count: number }>()?.count ?? 0,
    );

    const tokenRow = this.database
      .prepare(
        "SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens, SUM(estimated_usd) AS total_cost_usd FROM executions",
      )
      .get<{
        readonly input_tokens?: number | null;
        readonly output_tokens?: number | null;
        readonly total_tokens?: number | null;
        readonly total_cost_usd?: number | null;
      }>();

    const providerRows = this.database
      .prepare("SELECT provider, COUNT(*) AS count FROM executions GROUP BY provider")
      .all<{ readonly provider: string; readonly count: number }>();
    const providersDistribution: Record<string, number> = {};
    for (const row of providerRows) {
      providersDistribution[row.provider] = Number(row.count);
    }

    const aggregates = {
      workspacesCount,
      totalRunsCount,
      totalRoundsCount,
      totalExecutionsCount,
      executionsByStatus: Object.freeze(executionsByStatus),
      executionsByStep: Object.freeze(executionsByStep),
      findingsCount,
      findingsBySeverity: Object.freeze(findingsBySeverity),
      decisionsCount,
      totalCostUsd: Number(tokenRow?.total_cost_usd ?? 0),
      totalTokens: Object.freeze({
        inputTokens: Number(tokenRow?.input_tokens ?? 0),
        outputTokens: Number(tokenRow?.output_tokens ?? 0),
        totalTokens: Number(tokenRow?.total_tokens ?? 0),
      }),
      providersDistribution: Object.freeze(providersDistribution),
    };

    const generatedAt = now();
    const payloadStr = JSON.stringify({ aggregates, generatedAt, schemaVersion: 1 });
    const checksum = createHash("sha256").update(payloadStr).digest("hex");

    return Object.freeze({
      generatedAt,
      schemaVersion: 1,
      aggregates: Object.freeze(aggregates),
      checksum,
    });
  }

  public async close(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  private insertAuditEvent(input: AuditEventInput): AuditEvent {
    requireNonEmpty(input.id, "audit event id");
    const payloadChecksumValue = payloadChecksum(input.payload);
    const existing = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE id = ?",
      )
      .get(input.id);
    if (existing !== undefined) {
      const existingEvent = auditFromRow(existing);
      if (
        existingEvent.workspaceId !== input.workspaceId ||
        existingEvent.eventType !== input.eventType ||
        existingEvent.entityType !== input.entityType ||
        existingEvent.entityId !== input.entityId ||
        existingEvent.payloadChecksum !== payloadChecksumValue ||
        existingEvent.createdAt !== input.createdAt
      ) {
        throw new StorageConflictError(`audit event ${input.id} is immutable`);
      }
      return existingEvent;
    }
    const previousEventChecksum =
      this.database
        .prepare(
          "SELECT event_checksum FROM audit_events WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get<{ readonly event_checksum: string }>(input.workspaceId)?.event_checksum ?? null;
    const eventChecksum = checksum(
      serialize({
        createdAt: input.createdAt,
        entityId: input.entityId,
        entityType: input.entityType,
        eventType: input.eventType,
        id: input.id,
        payloadChecksum: payloadChecksumValue,
        previousEventChecksum,
        workspaceId: input.workspaceId,
      }),
    );
    this.database
      .prepare(
        "INSERT INTO audit_events (id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id,
        input.workspaceId,
        input.eventType,
        input.entityType,
        input.entityId,
        serialize(input.payload),
        payloadChecksumValue,
        previousEventChecksum,
        eventChecksum,
        input.createdAt,
      );
    const row = this.database
      .prepare(
        "SELECT sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE id = ?",
      )
      .get(input.id);
    if (row === undefined) {
      throw new StorageConflictError(`audit event ${input.id} could not be read after insert`);
    }
    return auditFromRow(row);
  }

  private requireManagedCandidateKnowledgeWriteOperation(
    operationId: string,
  ): ManagedCandidateKnowledgeWriteOperationRecord {
    const row = this.database
      .prepare(
        "SELECT operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at, owner_kind, owner_schema_version, owner_generation, requested_media_type, requested_checksum, requested_size_bytes FROM candidate_knowledge_managed_write_operations WHERE operation_id = ?",
      )
      .get(operationId);
    if (row === undefined) {
      throw new StorageValidationError(
        `managed candidate knowledge write operation ${operationId} was not found`,
      );
    }
    return managedCandidateKnowledgeWriteOperationFromRow(row);
  }

  private requireCandidateKnowledgeDeletionOperation(
    operationId: string,
  ): CandidateKnowledgeDeletionOperationRecord {
    const row = this.database
      .prepare(
        `SELECT operation_id, knowledge_base_id, confirmation_token, graph_digest, phase,
                created_at, committed_at, completed_at, staging_device, staging_inode,
                managed_artifact_count, managed_artifact_bytes, preserved_unknown_count,
                preserved_unmanaged_count, count_capped
         FROM candidate_knowledge_deletion_operations
         WHERE operation_id = ?`,
      )
      .get(operationId);
    if (row === undefined) {
      throw new StorageValidationError(
        `candidate knowledge deletion operation ${operationId} was not found`,
      );
    }
    const artifacts = this.database
      .prepare(
        `SELECT operation_id, source_id, version_id, checksum, size_bytes, device, inode
         FROM candidate_knowledge_deletion_artifacts
         WHERE operation_id = ?
         ORDER BY source_id, version_id`,
      )
      .all(operationId);
    return candidateKnowledgeDeletionOperationFromRow(row, artifacts);
  }

  private requireManagedCandidateKnowledgeWriteMutationOwner(
    operation: ManagedCandidateKnowledgeWriteOperationRecord,
    expectedOwnerGeneration: number | undefined,
  ): void {
    const ownershipValues = [
      operation.ownerKind,
      operation.ownerSchemaVersion,
      operation.ownerGeneration,
      operation.requestedMediaType,
      operation.requestedChecksum,
      operation.requestedSizeBytes,
    ];
    const hasOwnership = ownershipValues.some((value) => value !== null && value !== undefined);
    if (!hasOwnership) {
      if (expectedOwnerGeneration !== undefined) {
        throw new StorageConflictError(
          "managed candidate knowledge write does not have owned mutation metadata",
        );
      }
      return;
    }
    if (
      operation.ownerKind !== managedCandidateKnowledgeWriteOwnerKind ||
      operation.ownerSchemaVersion !== managedCandidateKnowledgeWriteOwnerSchemaVersion ||
      operation.ownerGeneration === undefined ||
      expectedOwnerGeneration === undefined ||
      operation.ownerGeneration !== expectedOwnerGeneration ||
      operation.requestedMediaType === undefined ||
      operation.requestedMediaType.trim() === "" ||
      operation.requestedChecksum === undefined ||
      !/^[0-9a-f]{64}$/.test(operation.requestedChecksum) ||
      operation.requestedSizeBytes === undefined ||
      !Number.isInteger(operation.requestedSizeBytes) ||
      operation.requestedSizeBytes < 0
    ) {
      throw new StorageConflictError(
        "managed candidate knowledge write ownership generation changed",
      );
    }
    const recoveryClaim = this.database
      .prepare(
        "SELECT operation_id FROM candidate_knowledge_managed_write_recovery_claims WHERE operation_id = ?",
      )
      .get(operation.operationId);
    if (recoveryClaim !== undefined) {
      throw new StorageConflictError("managed candidate knowledge write is claimed for recovery");
    }
  }

  private requireManagedCandidateKnowledgeWriteRecoveryClaim(
    operationId: string,
    phase: ManagedCandidateKnowledgeWriteRecoveryClaimPhase,
    expectedGeneration: number,
  ): void {
    const claim = this.database
      .prepare(
        "SELECT phase, claim_generation FROM candidate_knowledge_managed_write_recovery_claims WHERE operation_id = ?",
      )
      .get<{
        readonly phase: ManagedCandidateKnowledgeWriteRecoveryClaimPhase;
        readonly claim_generation: number;
      }>(operationId);
    if (
      claim === undefined ||
      claim.phase !== phase ||
      claim.claim_generation !== expectedGeneration
    ) {
      throw new StorageConflictError(
        "managed candidate knowledge write recovery claim is no longer current",
      );
    }
  }

  private requireManagedCandidateKnowledgeWriteState(
    operationId: string,
    expectedState: ManagedCandidateKnowledgeWriteEventState | undefined,
    expectedTargetVersionId: string | undefined,
  ): void {
    const row = this.database
      .prepare(
        "SELECT state, target_version_id FROM candidate_knowledge_managed_write_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get<{ readonly state: string; readonly target_version_id: string }>(operationId);
    if (expectedState === undefined) {
      if (row !== undefined) {
        throw new StorageConflictError(
          "managed candidate knowledge write operation is not in its prepared state",
        );
      }
      return;
    }
    if (
      row?.state !== expectedState ||
      (expectedTargetVersionId !== undefined && row.target_version_id !== expectedTargetVersionId)
    ) {
      throw new StorageConflictError(
        `managed candidate knowledge write operation is not ${expectedState}`,
      );
    }
  }

  private insertManagedCandidateKnowledgeWriteEvent(
    operationId: string,
    state: ManagedCandidateKnowledgeWriteEventState,
    targetVersionId: string,
    createdAt: string,
  ): void {
    this.requireManagedCandidateKnowledgeWriteOperation(operationId);
    const sequence =
      (this.database
        .prepare(
          "SELECT MAX(sequence) AS sequence FROM candidate_knowledge_managed_write_events WHERE operation_id = ?",
        )
        .get<{ readonly sequence: number | null }>(operationId)?.sequence ?? 0) + 1;
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_managed_write_events (operation_id, sequence, state, target_version_id, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(operationId, sequence, state, targetVersionId, createdAt);
  }

  private insertCandidateKnowledgeBase(record: CandidateKnowledgeBaseRecord): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_bases (id, display_name, description, state, is_default, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.displayName,
        record.description,
        record.state,
        record.isDefault ? 1 : 0,
        record.createdAt,
        record.updatedAt,
        record.archivedAt,
      );
  }

  private insertCandidateKnowledgeSource(record: CandidateKnowledgeSourceRecord): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_sources (id, candidate_knowledge_base_id, kind, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(record.id, record.knowledgeBaseId, record.kind, record.displayName, record.createdAt);
  }

  private validateManagedCandidateKnowledgeDirectoryMemberCreate(
    source: CandidateKnowledgeSourceRecord,
    version: CandidateKnowledgeSourceVersionInput,
    directoryId: string,
    originPath: string | undefined,
  ): CandidateKnowledgeDirectoryMemberRecord {
    if (source.kind !== "file") {
      throw new StorageValidationError(
        "Managed candidate knowledge directory membership requires a file source",
      );
    }
    const binding = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_current_roots
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(source.knowledgeBaseId, directoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    if (rowString(binding, "id") !== directoryId) {
      throw new StorageValidationError("candidate knowledge directory binding is malformed");
    }
    const rootPath = requireCanonicalAbsolutePath(
      rowString(binding, "root_path"),
      "candidate knowledge directory root path",
    );
    const boundAt = requireTimestamp(
      rowString(binding, "bound_at"),
      `candidate knowledge directory ${directoryId} boundAt`,
    );
    if (
      Date.parse(source.createdAt) < Date.parse(boundAt) ||
      Date.parse(version.createdAt) < Date.parse(boundAt)
    ) {
      throw new StorageValidationError(
        "candidate knowledge directory member state must not precede its binding",
      );
    }
    const canonicalOriginPath = requireCanonicalAbsolutePath(
      originPath ?? "",
      `candidate knowledge source ${source.id} origin path`,
    );
    const relativePathHash = directoryMemberRelativePathHash(rootPath, canonicalOriginPath);
    const existingPath = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
        FROM candidate_knowledge_directory_current_members
         WHERE directory_id = ? AND candidate_knowledge_base_id = ? AND relative_path_hash = ?`,
      )
      .get(directoryId, source.knowledgeBaseId, relativePathHash);
    if (existingPath !== undefined) {
      throw new StorageConflictError(
        "candidate knowledge directory member relative path is already bound",
      );
    }
    const existingHistoricalPath = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, revision
         FROM candidate_knowledge_directory_member_revisions
         WHERE directory_id = ?
           AND candidate_knowledge_base_id = ?
           AND relative_path_hash = ?
         LIMIT 1`,
      )
      .get(directoryId, source.knowledgeBaseId, relativePathHash);
    if (existingHistoricalPath !== undefined) {
      throw new StorageConflictError(
        "candidate knowledge directory member relative path is already historically bound",
      );
    }
    const existingSource = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_current_members
         WHERE source_id = ?`,
      )
      .get(source.id);
    if (existingSource !== undefined) {
      throw new StorageConflictError("candidate knowledge source is already a directory member");
    }
    return {
      directoryId,
      knowledgeBaseId: source.knowledgeBaseId,
      sourceId: source.id,
      relativePathHash,
    };
  }

  private insertCandidateKnowledgeDirectoryMember(
    record: CandidateKnowledgeDirectoryMemberRecord,
  ): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_directory_members (directory_id, candidate_knowledge_base_id, source_id, relative_path_hash) VALUES (?, ?, ?, ?)",
      )
      .run(record.directoryId, record.knowledgeBaseId, record.sourceId, record.relativePathHash);
  }

  private insertCandidateKnowledgeSourceVersion(
    record: CandidateKnowledgeSourceVersionRecord,
  ): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_source_versions (id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.sourceId,
        record.version,
        record.parentVersionId,
        record.mediaType,
        record.checksum,
        record.sizeBytes,
        record.createdAt,
      );
  }

  private hasManagedCandidateKnowledgeSourceVersion(versionId: string): boolean {
    return (
      this.database
        .prepare(
          "SELECT version_id FROM candidate_knowledge_managed_source_versions WHERE version_id = ?",
        )
        .get(versionId) !== undefined
    );
  }

  private requireCandidateKnowledgeSourceActive(sourceId: string): void {
    const retired = this.database
      .prepare("SELECT source_id FROM candidate_knowledge_source_retirements WHERE source_id = ?")
      .get(sourceId);
    if (retired !== undefined) {
      throw new StorageConflictError("candidate knowledge source is retired");
    }
  }

  private insertManagedCandidateKnowledgeSourceVersion(versionId: string): void {
    this.database
      .prepare("INSERT INTO candidate_knowledge_managed_source_versions (version_id) VALUES (?)")
      .run(versionId);
  }

  private insertCandidateKnowledgeSourceUrlProvenance(
    record: CandidateKnowledgeSourceUrlProvenanceRecord,
  ): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_source_url_provenance (version_id, source_id, original_url, final_url, fetched_at, kind) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.versionId,
        record.sourceId,
        record.originalUrl,
        record.finalUrl,
        record.fetchedAt,
        record.kind,
      );
  }

  private insertCandidateKnowledgeSourceOriginBinding(
    record: CandidateKnowledgeSourceOriginBindingRecord,
  ): void {
    this.database
      .prepare(
        "INSERT INTO candidate_knowledge_source_origin_bindings (source_id, origin_path, bound_at) VALUES (?, ?, ?)",
      )
      .run(record.sourceId, record.originPath, record.boundAt);
  }

  private readCandidateKnowledgeDirectoryMemberOriginRelation(
    knowledgeBaseId: string,
    directoryId: string,
    sourceId: string,
  ): CandidateKnowledgeDirectoryMemberOriginRelationRecord {
    const binding = this.database
      .prepare(
        `SELECT id, candidate_knowledge_base_id, root_path, bound_at
         FROM candidate_knowledge_directory_current_roots
         WHERE candidate_knowledge_base_id = ? AND id = ?`,
      )
      .get(knowledgeBaseId, directoryId);
    if (binding === undefined) {
      throw new StorageValidationError("candidate knowledge directory binding was not found");
    }
    const rootPath = requireCanonicalAbsolutePath(
      rowString(binding, "root_path"),
      "candidate knowledge directory root path",
    );
    requireTimestamp(
      rowString(binding, "bound_at"),
      `candidate knowledge directory ${directoryId} boundAt`,
    );
    const member = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_current_members
         WHERE candidate_knowledge_base_id = ? AND directory_id = ? AND source_id = ?`,
      )
      .get(knowledgeBaseId, directoryId, sourceId);
    if (member === undefined) {
      throw new StorageValidationError("candidate knowledge directory member was not found");
    }
    const memberRecord = candidateKnowledgeDirectoryMemberFromRow(member);
    if (
      memberRecord.directoryId !== directoryId ||
      memberRecord.knowledgeBaseId !== knowledgeBaseId ||
      memberRecord.sourceId !== sourceId ||
      !/^[0-9a-f]{64}$/.test(memberRecord.relativePathHash)
    ) {
      throw new StorageValidationError("candidate knowledge directory member is malformed");
    }
    const source = this.requireCandidateKnowledgeSource(knowledgeBaseId, sourceId);
    if (source.kind !== "file") {
      throw new StorageValidationError("candidate knowledge directory member is not a file source");
    }
    const managed = this.database
      .prepare(
        `SELECT version.id
         FROM candidate_knowledge_source_versions AS version
         JOIN candidate_knowledge_managed_source_versions AS managed
           ON managed.version_id = version.id
         WHERE version.source_id = ?
         LIMIT 1`,
      )
      .get(sourceId);
    if (managed === undefined) {
      throw new StorageValidationError("candidate knowledge directory member is not managed");
    }
    const originRow = this.database
      .prepare(
        `SELECT source_id, origin_path, bound_at
         FROM candidate_knowledge_source_origin_bindings
         WHERE source_id = ?`,
      )
      .get(sourceId);
    if (originRow === undefined) {
      return {
        directoryId,
        knowledgeBaseId,
        sourceId,
        relation: "unbound",
      };
    }
    const origin = candidateKnowledgeSourceOriginBindingFromRow(originRow);
    if (origin.sourceId !== sourceId) {
      throw new StorageValidationError("candidate knowledge source origin binding is malformed");
    }
    const originBoundAt = requireTimestamp(
      origin.boundAt,
      `candidate knowledge source ${sourceId} origin boundAt`,
    );
    const originPath = requireCanonicalAbsolutePath(
      origin.originPath,
      `candidate knowledge source ${sourceId} origin path`,
    );
    const memberHashes = new Set<string>();
    const members = this.database
      .prepare(
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_current_members
         WHERE candidate_knowledge_base_id = ? AND directory_id = ?`,
      )
      .all(knowledgeBaseId, directoryId);
    for (const row of members) {
      const current = candidateKnowledgeDirectoryMemberFromRow(row);
      if (
        current.directoryId !== directoryId ||
        current.knowledgeBaseId !== knowledgeBaseId ||
        !/^[0-9a-f]{64}$/.test(current.relativePathHash) ||
        memberHashes.has(current.relativePathHash)
      ) {
        throw new StorageValidationError("candidate knowledge directory membership is malformed");
      }
      memberHashes.add(current.relativePathHash);
    }
    return {
      directoryId,
      knowledgeBaseId,
      sourceId,
      relation: directoryMemberOriginRelation(
        rootPath,
        originPath,
        memberRecord.relativePathHash,
        memberHashes,
      ),
      originBoundAt,
    };
  }

  private requireManagedCandidateKnowledgeWriteGuards(
    operation: ManagedCandidateKnowledgeWriteOperationRecord,
    source: CandidateKnowledgeSourceRecord,
    current: CandidateKnowledgeSourceVersionRecord,
    expectedCurrentVersionId: string | undefined,
    expectedOriginBoundAt: string | undefined,
    expectedOriginPath: string | undefined,
  ): void {
    if (
      expectedCurrentVersionId !== undefined &&
      current.id !==
        requireNonEmpty(
          expectedCurrentVersionId,
          "managed candidate knowledge expected current version id",
        ).trim()
    ) {
      throw new StorageConflictError(
        "managed candidate knowledge write current version changed during publication",
      );
    }
    if (expectedOriginBoundAt === undefined) {
      if (expectedOriginPath !== undefined) {
        throw new StorageValidationError(
          "managed candidate knowledge expected origin path requires an origin revision",
        );
      }
      return;
    }
    if (source.kind !== "file") {
      throw new StorageValidationError(
        "managed candidate knowledge origin revision guards require a file source",
      );
    }
    const normalizedExpectedBoundAt = requireTimestamp(
      expectedOriginBoundAt,
      `managed candidate knowledge source ${operation.sourceId} expected origin boundAt`,
    );
    const normalizedExpectedOriginPath = requireCanonicalAbsolutePath(
      expectedOriginPath ?? "",
      `managed candidate knowledge source ${operation.sourceId} expected origin path`,
    );
    const originRow = this.database
      .prepare(
        "SELECT source_id, origin_path, bound_at FROM candidate_knowledge_source_origin_bindings WHERE source_id = ?",
      )
      .get(operation.sourceId);
    if (originRow === undefined) {
      throw new StorageConflictError(
        "managed candidate knowledge write origin binding changed during publication",
      );
    }
    const origin = candidateKnowledgeSourceOriginBindingFromRow(originRow);
    if (origin.sourceId !== operation.sourceId) {
      throw new StorageValidationError("managed candidate knowledge source origin is malformed");
    }
    const currentBoundAt = requireTimestamp(
      origin.boundAt,
      `managed candidate knowledge source ${operation.sourceId} origin boundAt`,
    );
    if (currentBoundAt !== normalizedExpectedBoundAt) {
      throw new StorageConflictError(
        "managed candidate knowledge write origin binding changed during publication",
      );
    }
    const currentOriginPath = requireCanonicalAbsolutePath(
      origin.originPath,
      `managed candidate knowledge source ${operation.sourceId} origin path`,
    );
    if (currentOriginPath !== normalizedExpectedOriginPath) {
      throw new StorageConflictError(
        "managed candidate knowledge write origin binding changed during publication",
      );
    }
  }

  private readCandidateKnowledgeRetentionPolicy(
    knowledgeBaseId: string,
  ): CandidateKnowledgeRetentionPolicyRecord {
    const knowledgeBase = this.requireCandidateKnowledgeBase(knowledgeBaseId);
    const latest = this.database
      .prepare(
        "SELECT MAX(revision) AS revision FROM candidate_knowledge_retention_policy_events WHERE knowledge_base_id = ?",
      )
      .get(knowledgeBaseId);
    const revision =
      latest === undefined || latest.revision === null ? 0 : rowNumber(latest, "revision");
    const policy = this.readCandidateKnowledgeRetentionPolicyAtRevision(
      knowledgeBaseId,
      revision,
      knowledgeBase,
    );
    return freezeCandidateKnowledgeRetentionPolicy({
      ...policy,
      overrideRevision: this.readCandidateKnowledgeRetentionOverrideRevision(knowledgeBaseId),
      activeOverrides: this.readCandidateKnowledgeRetentionOverrides(knowledgeBaseId),
    });
  }

  private readCandidateKnowledgeRetentionPolicyAtAsOf(
    knowledgeBaseId: string,
    asOf: string,
  ): CandidateKnowledgeRetentionPolicyRecord {
    const normalizedAsOf = requireRetentionTimestampNotFuture(
      asOf,
      "candidate knowledge retention asOf",
    );
    const knowledgeBase = this.requireCandidateKnowledgeBase(knowledgeBaseId);
    if (Date.parse(normalizedAsOf) < Date.parse(knowledgeBase.createdAt)) {
      throw new StorageValidationError(
        "candidate knowledge retention asOf must not precede the candidate knowledge base",
      );
    }
    const latest = this.database
      .prepare(
        `SELECT MAX(revision) AS revision
         FROM candidate_knowledge_retention_policy_events
         WHERE knowledge_base_id = ? AND julianday(updated_at) <= julianday(?)`,
      )
      .get(knowledgeBaseId, normalizedAsOf);
    const revision =
      latest === undefined || latest.revision === null ? 0 : rowNumber(latest, "revision");
    const policy = this.readCandidateKnowledgeRetentionPolicyAtRevision(
      knowledgeBaseId,
      revision,
      knowledgeBase,
    );
    return freezeCandidateKnowledgeRetentionPolicy({
      ...policy,
      overrideRevision: this.readCandidateKnowledgeRetentionOverrideRevision(
        knowledgeBaseId,
        normalizedAsOf,
      ),
      activeOverrides: this.readCandidateKnowledgeRetentionOverrides(
        knowledgeBaseId,
        normalizedAsOf,
      ).filter((override) => override.policyRevision <= revision),
    });
  }

  private readCandidateKnowledgeRetentionPolicyAtRevision(
    knowledgeBaseId: string,
    revision: number,
    knowledgeBaseInput?: CandidateKnowledgeBaseRecord,
  ): CandidateKnowledgeRetentionPolicyRecord {
    const knowledgeBase = knowledgeBaseInput ?? this.requireCandidateKnowledgeBase(knowledgeBaseId);
    const normalizedRevision = requireNonNegativeInteger(
      revision,
      "candidate knowledge retention policy revision",
    );
    if (normalizedRevision === 0) {
      return {
        knowledgeBaseId,
        revision: 0,
        overrideRevision: 0,
        updatedAt: knowledgeBase.createdAt,
        classes: defaultCandidateKnowledgeRetentionClasses(),
        activeOverrides: [],
      };
    }
    const rows = this.database
      .prepare(
        `SELECT revision, retention_class, rule, expire_after_days, updated_at
         FROM candidate_knowledge_retention_policy_events
         WHERE knowledge_base_id = ? AND revision = ?
         ORDER BY retention_class`,
      )
      .all(knowledgeBaseId, normalizedRevision);
    if (rows.length !== candidateKnowledgeRetentionClasses.length) {
      throw new StorageValidationError(
        "candidate knowledge retention policy contains an incomplete revision",
      );
    }
    const updatedAt = requireRetentionTimestampNotFuture(
      rowString(rows[0] as Record<string, unknown>, "updated_at"),
      "candidate knowledge retention policy updatedAt",
    );
    for (const row of rows) {
      if (rowNumber(row, "revision") !== normalizedRevision) {
        throw new StorageValidationError(
          "candidate knowledge retention policy revision is malformed",
        );
      }
      const rowUpdatedAt = requireRetentionTimestampNotFuture(
        rowString(row, "updated_at"),
        "candidate knowledge retention policy updatedAt",
      );
      if (rowUpdatedAt !== updatedAt) {
        throw new StorageValidationError(
          "candidate knowledge retention policy revision timestamps must match",
        );
      }
    }
    return {
      knowledgeBaseId,
      revision: normalizedRevision,
      overrideRevision: 0,
      updatedAt,
      classes: normalizeCandidateKnowledgeRetentionClassPolicies(
        rows.map((row) => ({
          class: rowString(row, "retention_class"),
          rule: rowString(row, "rule"),
          expireAfterDays: rowNullableNumber(row, "expire_after_days"),
        })),
      ),
      activeOverrides: [],
    };
  }

  private readCandidateKnowledgeRetentionOverrides(
    knowledgeBaseId: string,
    asOf?: string,
  ): readonly CandidateKnowledgeRetentionOverrideRecord[] {
    const where = asOf === undefined ? "" : " AND julianday(changed_at) <= julianday(?)";
    const rows = this.database
      .prepare(
        `SELECT retention_class, override_kind, sequence, state, override_revision,
                policy_revision, changed_at
         FROM candidate_knowledge_retention_override_events
         WHERE knowledge_base_id = ?${where}
         ORDER BY retention_class, override_kind, sequence`,
      )
      .all(...(asOf === undefined ? [knowledgeBaseId] : [knowledgeBaseId, asOf]));
    const latest = new Map<string, CandidateKnowledgeRetentionOverrideRecord>();
    for (const row of rows) {
      const record = candidateKnowledgeRetentionOverrideFromRow(row);
      latest.set(`${record.class}\u0000${record.kind}`, record);
    }
    return [...latest.values()]
      .filter((record) => record.state === "applied")
      .sort(
        (left, right) =>
          retentionClassIndex(left.class) - retentionClassIndex(right.class) ||
          candidateKnowledgeRetentionOverrideKinds.indexOf(left.kind) -
            candidateKnowledgeRetentionOverrideKinds.indexOf(right.kind),
      );
  }

  private readCandidateKnowledgeRetentionOverrideRevision(
    knowledgeBaseId: string,
    asOf?: string,
  ): number {
    const where = asOf === undefined ? "" : " AND julianday(changed_at) <= julianday(?)";
    const row = this.database
      .prepare(
        `SELECT MAX(override_revision) AS override_revision
         FROM candidate_knowledge_retention_override_events
         WHERE knowledge_base_id = ?${where}`,
      )
      .get(...(asOf === undefined ? [knowledgeBaseId] : [knowledgeBaseId, asOf]));
    const eventRevision =
      row === undefined || row.override_revision === null
        ? 0
        : requireNonNegativeInteger(
            rowNumber(row, "override_revision"),
            "candidate knowledge retention override revision",
          );
    if (asOf !== undefined) return eventRevision;
    const snapshot = this.database
      .prepare(
        `SELECT override_revision
         FROM candidate_knowledge_retention_override_revision_snapshots
         WHERE knowledge_base_id = ?`,
      )
      .get(knowledgeBaseId);
    if (snapshot === undefined) return eventRevision;
    return Math.max(
      eventRevision,
      requireNonNegativeInteger(
        rowNumber(snapshot, "override_revision"),
        "candidate knowledge retention override revision",
      ),
    );
  }

  private readCandidateKnowledgeRetentionOverrideState(
    knowledgeBaseId: string,
    retentionClass: CandidateKnowledgeRetentionClass,
    kind: CandidateKnowledgeRetentionOverrideKind,
  ): CandidateKnowledgeRetentionOverrideRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT retention_class, override_kind, sequence, state, override_revision,
                policy_revision, changed_at
         FROM candidate_knowledge_retention_override_events
         WHERE knowledge_base_id = ? AND retention_class = ? AND override_kind = ?
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(knowledgeBaseId, retentionClass, kind);
    return row === undefined ? undefined : candidateKnowledgeRetentionOverrideFromRow(row);
  }

  private async writeCandidateKnowledgeRetentionOverride(
    knowledgeBaseIdInput: string,
    input: CandidateKnowledgeRetentionOverrideInput,
    state: "applied" | "released",
  ): Promise<CandidateKnowledgeRetentionPolicyRecord> {
    this.ensureOpen();
    const knowledgeBaseId = requireNonEmpty(
      knowledgeBaseIdInput,
      "candidate knowledge base id",
    ).trim();
    this.database.transaction(() => {
      const current = this.readCandidateKnowledgeRetentionPolicy(knowledgeBaseId);
      if (current.revision !== input.expectedPolicyRevision) {
        throw new StorageConflictError(
          "candidate knowledge retention override policy revision changed",
        );
      }
      const existing = this.readCandidateKnowledgeRetentionOverrideState(
        knowledgeBaseId,
        input.class,
        input.kind,
      );
      const actualState = existing?.state ?? "none";
      if (actualState !== input.expectedState) {
        throw new StorageConflictError("candidate knowledge retention override state changed");
      }
      if (state === "applied" && actualState === "applied") {
        throw new StorageConflictError("candidate knowledge retention override is already applied");
      }
      if (state === "released" && actualState !== "applied") {
        throw new StorageConflictError("candidate knowledge retention override is not applied");
      }
      if (Date.parse(input.changedAt) < Date.parse(current.updatedAt)) {
        throw new StorageValidationError(
          "candidate knowledge retention override changedAt must not precede the policy",
        );
      }
      if (existing !== undefined && Date.parse(input.changedAt) < Date.parse(existing.changedAt)) {
        throw new StorageValidationError(
          "candidate knowledge retention override changedAt must not move backwards",
        );
      }
      const sequence = (existing?.sequence ?? 0) + 1;
      const overrideRevision = current.overrideRevision + 1;
      this.database
        .prepare(
          `INSERT INTO candidate_knowledge_retention_override_events
           (knowledge_base_id, retention_class, override_kind, sequence, state,
            override_revision, policy_revision, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          knowledgeBaseId,
          input.class,
          input.kind,
          sequence,
          state,
          overrideRevision,
          current.revision,
          input.changedAt,
        );
    })();
    return this.readCandidateKnowledgeRetentionPolicy(knowledgeBaseId);
  }

  private requireCandidateKnowledgeBase(id: string): CandidateKnowledgeBaseRecord {
    const row = this.database
      .prepare(
        "SELECT id, display_name, description, state, is_default, created_at, updated_at, archived_at FROM candidate_knowledge_bases WHERE id = ?",
      )
      .get(id);
    if (row === undefined) {
      throw new StorageValidationError(`candidate knowledge base ${id} was not found`);
    }
    return candidateKnowledgeBaseFromRow(row);
  }

  private requireActiveCandidateKnowledgeBase(id: string): CandidateKnowledgeBaseRecord {
    const knowledgeBase = this.requireCandidateKnowledgeBase(id);
    if (knowledgeBase.state !== "active") {
      throw new StorageConflictError(`candidate knowledge base ${id} is archived`);
    }
    return knowledgeBase;
  }

  private requireCandidateKnowledgeSource(
    knowledgeBaseId: string,
    sourceId: string,
  ): CandidateKnowledgeSourceRecord {
    const row = this.database
      .prepare(
        "SELECT id, candidate_knowledge_base_id, kind, display_name, created_at FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = ? AND id = ?",
      )
      .get(knowledgeBaseId, sourceId);
    if (row === undefined) {
      throw new StorageValidationError(
        `candidate knowledge source ${sourceId} was not found in candidate knowledge base ${knowledgeBaseId}`,
      );
    }
    return candidateKnowledgeSourceFromRow(row);
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new StorageValidationError("SQLite storage is closed");
    }
  }
}

function recordToJson(record: unknown): JsonValue {
  return JSON.parse(JSON.stringify(record)) as JsonValue;
}

function normalizeCandidateKnowledgeBaseInput(
  input: CandidateKnowledgeBaseInput,
): CandidateKnowledgeBaseRecord {
  const id = requireNonEmpty(input.id, "candidate knowledge base id").trim();
  const displayName = requireNonEmpty(
    input.displayName,
    "candidate knowledge base displayName",
  ).trim();
  const createdAt = requireTimestamp(input.createdAt, "candidate knowledge base createdAt");
  if (input.description !== undefined && typeof input.description !== "string") {
    throw new StorageValidationError("candidate knowledge base description must be a string");
  }
  if (typeof input.isDefault !== "boolean") {
    throw new StorageValidationError("candidate knowledge base isDefault must be a boolean");
  }
  return {
    id,
    displayName,
    description: (input.description ?? "").trim(),
    state: "active",
    isDefault: input.isDefault,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

function normalizeCandidateKnowledgeSourceInput(
  input: CandidateKnowledgeSourceInput,
): CandidateKnowledgeSourceRecord {
  const id = requireNonEmpty(input.id, "candidate knowledge source id").trim();
  const knowledgeBaseId = requireNonEmpty(
    input.knowledgeBaseId,
    "candidate knowledge source knowledgeBaseId",
  ).trim();
  if (input.kind !== "file" && input.kind !== "url") {
    throw new StorageValidationError(`Unsupported candidate knowledge source kind: ${input.kind}`);
  }
  const displayName = requireNonEmpty(
    input.displayName,
    "candidate knowledge source displayName",
  ).trim();
  const createdAt = requireTimestamp(input.createdAt, "candidate knowledge source createdAt");
  return { id, knowledgeBaseId, kind: input.kind, displayName, createdAt };
}

function normalizeCandidateKnowledgeDirectoryBindingInput(
  input: CandidateKnowledgeDirectoryBindingInput,
): CandidateKnowledgeDirectoryBindingInput {
  const id = requireNonEmpty(input.id, "candidate knowledge directory id").trim();
  const knowledgeBaseId = requireNonEmpty(
    input.knowledgeBaseId,
    "candidate knowledge directory knowledgeBaseId",
  ).trim();
  const rootPath = requireCanonicalAbsolutePath(
    input.rootPath,
    "candidate knowledge directory root path",
  );
  const boundAt = requireTimestamp(input.boundAt, "candidate knowledge directory boundAt");
  if (!Array.isArray(input.sourceIds)) {
    throw new StorageValidationError("candidate knowledge directory source IDs must be an array");
  }
  const sourceIds = input.sourceIds.map((sourceId) =>
    requireNonEmpty(sourceId, "candidate knowledge directory source id").trim(),
  );
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new StorageConflictError("candidate knowledge directory source IDs must be unique");
  }
  return { id, knowledgeBaseId, rootPath, boundAt, sourceIds };
}

function normalizeCandidateKnowledgeDirectoryRootRebindInput(
  input: CandidateKnowledgeDirectoryRootRebindInput,
): CandidateKnowledgeDirectoryRootRebindInput {
  if (typeof input !== "object" || input === null || !Array.isArray(input.members)) {
    throw new StorageValidationError(
      "Candidate knowledge directory root rebind members are required",
    );
  }
  const knowledgeBaseId = requireNonEmpty(
    input.knowledgeBaseId,
    "candidate knowledge directory root rebind knowledgeBaseId",
  ).trim();
  const directoryId = requireNonEmpty(
    input.directoryId,
    "candidate knowledge directory root rebind directoryId",
  ).trim();
  const candidateRootPath = requireCanonicalAbsolutePath(
    input.candidateRootPath,
    "candidate knowledge directory candidate root path",
  );
  const expectedRootPath = requireCanonicalAbsolutePath(
    input.expectedRootPath,
    "candidate knowledge directory expected root path",
  );
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new StorageValidationError(
      "candidate knowledge directory expected revision must be a positive safe integer",
    );
  }
  const reboundAt = requireTimestamp(
    input.reboundAt,
    "candidate knowledge directory root reboundAt",
  );
  const sourceIds = new Set<string>();
  const members = input.members
    .map((member) => {
      if (typeof member !== "object" || member === null) {
        throw new StorageValidationError(
          "candidate knowledge directory root rebind member is invalid",
        );
      }
      const sourceId = requireNonEmpty(
        member.sourceId,
        "candidate knowledge directory root rebind source id",
      ).trim();
      if (sourceIds.has(sourceId)) {
        throw new StorageConflictError(
          "candidate knowledge directory root rebind sources must be unique",
        );
      }
      sourceIds.add(sourceId);
      const originPath = requireCanonicalAbsolutePath(
        member.originPath,
        `candidate knowledge directory root rebind source ${sourceId} origin path`,
      );
      const mediaType = requireNonEmpty(
        member.mediaType,
        `candidate knowledge directory root rebind source ${sourceId} media type`,
      ).trim();
      if (!/^[0-9a-f]{64}$/.test(member.checksum)) {
        throw new StorageValidationError(
          `candidate knowledge directory root rebind source ${sourceId} checksum is invalid`,
        );
      }
      const sizeBytes = requireNonNegativeInteger(
        member.sizeBytes,
        `candidate knowledge directory root rebind source ${sourceId} sizeBytes`,
      );
      const expectedVersionId = requireNonEmpty(
        member.expectedVersionId,
        `candidate knowledge directory root rebind source ${sourceId} expected version id`,
      ).trim();
      const expectedOriginBoundAt = requireTimestamp(
        member.expectedOriginBoundAt,
        `candidate knowledge directory root rebind source ${sourceId} expected origin boundAt`,
      );
      return {
        sourceId,
        originPath,
        mediaType,
        checksum: member.checksum,
        sizeBytes,
        expectedVersionId,
        expectedOriginBoundAt,
      } satisfies CandidateKnowledgeDirectoryRootRebindMemberInput;
    })
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {
    knowledgeBaseId,
    directoryId,
    candidateRootPath,
    expectedRootPath,
    expectedRevision: input.expectedRevision,
    reboundAt,
    members,
  };
}

function normalizeCandidateKnowledgeDirectoryMemberMoveInput(
  input: CandidateKnowledgeDirectoryMemberMoveInput,
): CandidateKnowledgeDirectoryMemberMoveInput {
  if (typeof input !== "object" || input === null) {
    throw new StorageValidationError("Candidate knowledge directory member move input is invalid");
  }
  const knowledgeBaseId = requireNonEmpty(
    input.knowledgeBaseId,
    "candidate knowledge directory member move knowledgeBaseId",
  ).trim();
  const directoryId = requireNonEmpty(
    input.directoryId,
    "candidate knowledge directory member move directoryId",
  ).trim();
  const sourceId = requireNonEmpty(
    input.sourceId,
    "candidate knowledge directory member move sourceId",
  ).trim();
  const targetOriginPath = requireCanonicalAbsolutePath(
    input.targetOriginPath,
    "candidate knowledge directory member move target origin path",
  );
  const mediaType = requireNonEmpty(
    input.mediaType,
    "candidate knowledge directory member move mediaType",
  ).trim();
  if (!/^[0-9a-f]{64}$/.test(input.checksum)) {
    throw new StorageValidationError(
      "candidate knowledge directory member move checksum must be a lowercase SHA-256 checksum",
    );
  }
  const sizeBytes = requireNonNegativeInteger(
    input.sizeBytes,
    "candidate knowledge directory member move sizeBytes",
  );
  const expectedRootPath = requireCanonicalAbsolutePath(
    input.expectedRootPath,
    "candidate knowledge directory member move expected root path",
  );
  if (!Number.isSafeInteger(input.expectedRootRevision) || input.expectedRootRevision < 1) {
    throw new StorageValidationError(
      "candidate knowledge directory member move expected root revision must be a positive safe integer",
    );
  }
  if (!Number.isSafeInteger(input.expectedMemberRevision) || input.expectedMemberRevision < 1) {
    throw new StorageValidationError(
      "candidate knowledge directory member move expected member revision must be a positive safe integer",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(input.expectedRelativePathHash)) {
    throw new StorageValidationError(
      "candidate knowledge directory member move expected relative path hash is invalid",
    );
  }
  const expectedVersionId = requireNonEmpty(
    input.expectedVersionId,
    "candidate knowledge directory member move expected version id",
  ).trim();
  const expectedOriginBoundAt = requireTimestamp(
    input.expectedOriginBoundAt,
    "candidate knowledge directory member move expected origin boundAt",
  );
  const movedAt = requireTimestamp(
    input.movedAt,
    "candidate knowledge directory member move movedAt",
  );
  return {
    knowledgeBaseId,
    directoryId,
    sourceId,
    targetOriginPath,
    mediaType,
    checksum: input.checksum,
    sizeBytes,
    expectedRootPath,
    expectedRootRevision: input.expectedRootRevision,
    expectedMemberRevision: input.expectedMemberRevision,
    expectedRelativePathHash: input.expectedRelativePathHash,
    expectedVersionId,
    expectedOriginBoundAt,
    movedAt,
  };
}

function normalizeCandidateKnowledgeSourceVersionInput(
  input: CandidateKnowledgeSourceVersionInput,
): CandidateKnowledgeSourceVersionInput {
  const id = requireNonEmpty(input.id, "candidate knowledge source version id").trim();
  const mediaType = requireNonEmpty(
    input.mediaType,
    "candidate knowledge source version mediaType",
  ).trim();
  if (!/^[0-9a-f]{64}$/.test(input.checksum)) {
    throw new StorageValidationError(
      "candidate knowledge source version checksum must be a lowercase SHA-256 checksum",
    );
  }
  const sizeBytes = requireNonNegativeInteger(
    input.sizeBytes,
    "candidate knowledge source version sizeBytes",
  );
  const createdAt = requireTimestamp(
    input.createdAt,
    "candidate knowledge source version createdAt",
  );
  return { id, mediaType, checksum: input.checksum, sizeBytes, createdAt };
}

function requireCandidateKnowledgeSourceRefreshObservationStatus(
  value: CandidateKnowledgeSourceRefreshObservationStatus,
): CandidateKnowledgeSourceRefreshObservationStatus {
  if (
    value !== "current" &&
    value !== "changed" &&
    value !== "missing" &&
    value !== "inaccessible" &&
    value !== "unbound"
  ) {
    throw new StorageValidationError(
      `Unsupported candidate knowledge source refresh observation status: ${value}`,
    );
  }
  return value;
}

function normalizeCandidateKnowledgeDirectoryRefreshObservationBatchInput(
  input: CandidateKnowledgeDirectoryRefreshObservationBatchInput,
): CandidateKnowledgeDirectoryRefreshObservationBatchInput {
  if (typeof input !== "object" || input === null || !Array.isArray(input.entries)) {
    throw new StorageValidationError(
      "Candidate knowledge directory refresh observation entries are required",
    );
  }
  const checkedAt = requireTimestamp(
    input.checkedAt,
    "candidate knowledge directory refresh checkedAt",
  );
  const sourceIds = new Set<string>();
  const entries = input.entries.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new StorageValidationError(
        "Candidate knowledge directory refresh observation entry is invalid",
      );
    }
    const sourceId = requireNonEmpty(
      entry.sourceId,
      "candidate knowledge directory refresh observation source id",
    ).trim();
    if (sourceIds.has(sourceId)) {
      throw new StorageValidationError(
        "Candidate knowledge directory refresh observation sources must be unique",
      );
    }
    sourceIds.add(sourceId);
    const observedVersionId = requireNonEmpty(
      entry.observedVersionId,
      "candidate knowledge directory refresh observation version id",
    ).trim();
    const status = entry.status;
    if (status !== "current" && status !== "changed" && status !== "missing") {
      throw new StorageValidationError(
        "Candidate knowledge directory refresh observation status is invalid",
      );
    }
    const expectedOriginBoundAt = requireTimestamp(
      entry.expectedOriginBoundAt,
      "candidate knowledge directory refresh expected origin boundAt",
    );
    return { sourceId, observedVersionId, status, expectedOriginBoundAt };
  });
  return { checkedAt, entries };
}

function requireCandidateKnowledgeSourceRetirementReason(
  value: CandidateKnowledgeSourceRetirementReason,
): CandidateKnowledgeSourceRetirementReason {
  if (value !== "user-requested") {
    throw new StorageValidationError(
      "Candidate knowledge source retirement reason must be user-requested",
    );
  }
  return value;
}

function requireCandidateKnowledgeRetentionClass(value: unknown): CandidateKnowledgeRetentionClass {
  if (
    typeof value !== "string" ||
    !candidateKnowledgeRetentionClasses.includes(value as CandidateKnowledgeRetentionClass)
  ) {
    throw new StorageValidationError("candidate knowledge retention class is invalid");
  }
  return value as CandidateKnowledgeRetentionClass;
}

function requireCandidateKnowledgeRetentionRule(value: unknown): CandidateKnowledgeRetentionRule {
  if (value !== "retain-until-deletion" && value !== "expire-after-days") {
    throw new StorageValidationError("candidate knowledge retention rule is invalid");
  }
  return value;
}

function requireCandidateKnowledgeRetentionOverrideKind(
  value: unknown,
): CandidateKnowledgeRetentionOverrideKind {
  if (
    typeof value !== "string" ||
    !candidateKnowledgeRetentionOverrideKinds.includes(
      value as CandidateKnowledgeRetentionOverrideKind,
    )
  ) {
    throw new StorageValidationError("candidate knowledge retention override kind is invalid");
  }
  return value as CandidateKnowledgeRetentionOverrideKind;
}

function retentionClassIndex(value: CandidateKnowledgeRetentionClass): number {
  return candidateKnowledgeRetentionClasses.indexOf(value);
}

function defaultCandidateKnowledgeRetentionClasses(): readonly CandidateKnowledgeRetentionClassPolicy[] {
  return candidateKnowledgeRetentionClasses.map((retentionClass) => ({
    class: retentionClass,
    rule: "retain-until-deletion",
    expireAfterDays: null,
  }));
}

function normalizeCandidateKnowledgeRetentionClassPolicy(
  value: unknown,
): CandidateKnowledgeRetentionClassPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorageValidationError("candidate knowledge retention class policy is invalid");
  }
  const input = value as CandidateKnowledgeRetentionClassPolicyInput;
  const retentionClass = requireCandidateKnowledgeRetentionClass(input.class);
  const rule = requireCandidateKnowledgeRetentionRule(input.rule);
  if (rule === "retain-until-deletion") {
    if (input.expireAfterDays !== undefined && input.expireAfterDays !== null) {
      throw new StorageValidationError("retain-until-deletion cannot include expireAfterDays");
    }
    return { class: retentionClass, rule, expireAfterDays: null };
  }
  if (input.expireAfterDays === undefined || input.expireAfterDays === null) {
    throw new StorageValidationError("expire-after-days requires a positive expireAfterDays value");
  }
  const expireAfterDays = requirePositive(
    input.expireAfterDays,
    "candidate knowledge retention expireAfterDays",
  );
  if (expireAfterDays > maximumCandidateKnowledgeRetentionExpireAfterDays) {
    throw new StorageValidationError(
      `candidate knowledge retention expireAfterDays must be at most ${maximumCandidateKnowledgeRetentionExpireAfterDays}`,
    );
  }
  return { class: retentionClass, rule, expireAfterDays };
}

function normalizeCandidateKnowledgeRetentionClassPolicies(
  value: unknown,
): readonly CandidateKnowledgeRetentionClassPolicy[] {
  if (!Array.isArray(value) || value.length !== candidateKnowledgeRetentionClasses.length) {
    throw new StorageValidationError(
      "candidate knowledge retention policy must enumerate each retention class exactly once",
    );
  }
  const seen = new Set<CandidateKnowledgeRetentionClass>();
  const normalized = value.map((entry) => {
    const policy = normalizeCandidateKnowledgeRetentionClassPolicy(entry);
    const retentionClass = policy.class;
    if (seen.has(retentionClass)) {
      throw new StorageValidationError(
        "candidate knowledge retention policy contains a duplicate class",
      );
    }
    seen.add(retentionClass);
    return policy;
  });
  if (seen.size !== candidateKnowledgeRetentionClasses.length) {
    throw new StorageValidationError(
      "candidate knowledge retention policy must enumerate each retention class exactly once",
    );
  }
  return normalized.sort(
    (left, right) => retentionClassIndex(left.class) - retentionClassIndex(right.class),
  );
}

function normalizeCandidateKnowledgeRetentionPolicyUpdateInput(
  input: CandidateKnowledgeRetentionPolicyUpdateInput,
): CandidateKnowledgeRetentionPolicyUpdateInput {
  const parsed = candidateKnowledgeRetentionPolicyUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new StorageValidationError("candidate knowledge retention policy update is invalid");
  }
  const expectedRevision = requireNonNegativeInteger(
    parsed.data.expectedRevision,
    "candidate knowledge retention expected revision",
  );
  const updatedAt = requireRetentionTimestampNotFuture(
    parsed.data.updatedAt,
    "candidate knowledge retention policy updatedAt",
  );
  return {
    expectedRevision,
    updatedAt,
    classes: normalizeCandidateKnowledgeRetentionClassPolicies(parsed.data.classes),
  };
}

function normalizeCandidateKnowledgeRetentionOverrideInput(
  input: CandidateKnowledgeRetentionOverrideInput,
): CandidateKnowledgeRetentionOverrideInput {
  const parsed = candidateKnowledgeRetentionOverrideInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new StorageValidationError("candidate knowledge retention override is invalid");
  }
  const retentionClass = requireCandidateKnowledgeRetentionClass(parsed.data.class);
  const kind = requireCandidateKnowledgeRetentionOverrideKind(parsed.data.kind);
  const expectedPolicyRevision = requireNonNegativeInteger(
    parsed.data.expectedPolicyRevision,
    "candidate knowledge retention override expected policy revision",
  );
  if (
    parsed.data.expectedState !== "none" &&
    parsed.data.expectedState !== "applied" &&
    parsed.data.expectedState !== "released"
  ) {
    throw new StorageValidationError(
      "candidate knowledge retention override expected state is invalid",
    );
  }
  const changedAt = requireRetentionTimestampNotFuture(
    parsed.data.changedAt,
    "candidate knowledge retention override changedAt",
  );
  return {
    class: retentionClass,
    kind,
    expectedPolicyRevision,
    expectedState: parsed.data.expectedState,
    changedAt,
  };
}

function freezeCandidateKnowledgeRetentionPolicy(
  policy: CandidateKnowledgeRetentionPolicyRecord,
): CandidateKnowledgeRetentionPolicyRecord {
  return Object.freeze({
    ...policy,
    classes: Object.freeze(policy.classes.map((entry) => Object.freeze({ ...entry }))),
    activeOverrides: Object.freeze(
      policy.activeOverrides.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

function normalizeCandidateKnowledgeSourceUrlProvenance(
  input: CandidateKnowledgeSourceUrlProvenanceInput | undefined,
): CandidateKnowledgeSourceUrlProvenanceInput {
  if (input === undefined) {
    throw new StorageValidationError("Candidate knowledge source URL provenance is required");
  }
  const originalUrl = requireNonEmpty(
    input.originalUrl,
    "candidate knowledge source original URL",
  ).trim();
  const finalUrl = requireNonEmpty(input.finalUrl, "candidate knowledge source final URL").trim();
  const validateUrl = (value: string, label: string): string => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new StorageValidationError(`Candidate knowledge source ${label} is invalid`);
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== "" ||
      parsed.hostname === ""
    ) {
      throw new StorageValidationError(`Candidate knowledge source ${label} is invalid`);
    }
    return parsed.href;
  };
  const kind = input.kind;
  if (!candidateKnowledgeSourceUrlKinds.includes(kind)) {
    throw new StorageValidationError("Candidate knowledge source URL kind is invalid");
  }
  return {
    originalUrl: validateUrl(originalUrl, "original URL"),
    finalUrl: validateUrl(finalUrl, "final URL"),
    fetchedAt: requireTimestamp(input.fetchedAt, "candidate knowledge source URL fetchedAt"),
    kind,
  };
}

function workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: rowString(row, "id"),
    state: rowString(row, "state") as WorkflowState,
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
  };
}

function candidateKnowledgeBaseFromRow(row: Record<string, unknown>): CandidateKnowledgeBaseRecord {
  return {
    id: rowString(row, "id"),
    displayName: rowString(row, "display_name"),
    description: rowString(row, "description"),
    state: rowString(row, "state") as CandidateKnowledgeBaseState,
    isDefault: rowNumber(row, "is_default") === 1,
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
    archivedAt: rowNullableString(row, "archived_at"),
  };
}

function candidateKnowledgeSourceFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceRecord {
  return {
    id: rowString(row, "id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    kind: rowString(row, "kind") as CandidateKnowledgeSourceKind,
    displayName: rowString(row, "display_name"),
    createdAt: rowString(row, "created_at"),
  };
}

function candidateKnowledgeSourceOriginBindingFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceOriginBindingRecord {
  return {
    sourceId: rowString(row, "source_id"),
    originPath: rowString(row, "origin_path"),
    boundAt: rowString(row, "bound_at"),
  };
}

function candidateKnowledgeDirectoryBindingFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeDirectoryBindingRecord {
  return {
    id: rowString(row, "id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    rootPath: rowString(row, "root_path"),
    boundAt: rowString(row, "bound_at"),
  };
}

function candidateKnowledgeDirectoryRootRevisionFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeDirectoryRootRevisionRecord {
  return {
    directoryId: rowString(row, "directory_id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    revision: rowNumber(row, "revision"),
    rootPath: rowString(row, "root_path"),
    boundAt: rowString(row, "bound_at"),
  };
}

function candidateKnowledgeDirectoryMemberFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeDirectoryMemberRecord {
  return {
    directoryId: rowString(row, "directory_id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    sourceId: rowString(row, "source_id"),
    relativePathHash: rowString(row, "relative_path_hash"),
  };
}

function candidateKnowledgeDirectoryMemberRevisionFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeDirectoryMemberRevisionRecord {
  return {
    directoryId: rowString(row, "directory_id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    sourceId: rowString(row, "source_id"),
    revision: rowNumber(row, "revision"),
    relativePathHash: rowString(row, "relative_path_hash"),
    boundAt: rowString(row, "bound_at"),
  };
}

function candidateKnowledgeSourceUrlProvenanceFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceUrlProvenanceRecord {
  return {
    sourceId: rowString(row, "source_id"),
    versionId: rowString(row, "version_id"),
    originalUrl: rowString(row, "original_url"),
    finalUrl: rowString(row, "final_url"),
    fetchedAt: rowString(row, "fetched_at"),
    kind: rowString(row, "kind") as CandidateKnowledgeSourceUrlKind,
  };
}

function candidateKnowledgeSourceRetirementFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceRetirementRecord {
  return {
    sourceId: rowString(row, "source_id"),
    retiredAt: rowString(row, "retired_at"),
    reason: rowString(row, "reason") as CandidateKnowledgeSourceRetirementReason,
  };
}

function candidateKnowledgeRetentionOverrideFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeRetentionOverrideRecord {
  const retentionClass = requireCandidateKnowledgeRetentionClass(rowString(row, "retention_class"));
  const kind = requireCandidateKnowledgeRetentionOverrideKind(rowString(row, "override_kind"));
  const sequence = requirePositive(
    rowNumber(row, "sequence"),
    "candidate knowledge retention override sequence",
  );
  const overrideRevision = requirePositive(
    rowNumber(row, "override_revision"),
    "candidate knowledge retention override revision",
  );
  const state = rowString(row, "state");
  if (state !== "applied" && state !== "released") {
    throw new StorageValidationError("candidate knowledge retention override state is invalid");
  }
  const policyRevision = requireNonNegativeInteger(
    rowNumber(row, "policy_revision"),
    "candidate knowledge retention override policy revision",
  );
  const changedAt = requireRetentionTimestampNotFuture(
    rowString(row, "changed_at"),
    "candidate knowledge retention override changedAt",
  );
  return {
    class: retentionClass,
    kind,
    state,
    sequence,
    overrideRevision,
    policyRevision,
    changedAt,
  };
}

function candidateKnowledgeSourceRefreshObservationFromRow(
  row: Record<string, unknown>,
  latestVersionId: string,
): CandidateKnowledgeSourceRefreshObservationRecord {
  const observedVersionId = rowString(row, "observed_version_id");
  return {
    sourceId: rowString(row, "source_id"),
    observedVersionId,
    status: rowString(row, "status") as CandidateKnowledgeSourceRefreshObservationStatus,
    checkedAt: rowString(row, "checked_at"),
    lastRefreshedVersionId: rowNullableString(row, "last_refreshed_version_id"),
    lastRefreshedAt: rowNullableString(row, "last_refreshed_at"),
    stale: observedVersionId !== latestVersionId,
  };
}

function managedCandidateKnowledgeWriteOperationFromRow(
  row: Record<string, unknown>,
): ManagedCandidateKnowledgeWriteOperationRecord {
  const ownerGeneration = rowNullableNumber(row, "owner_generation");
  const requestedSizeBytes = rowNullableNumber(row, "requested_size_bytes");
  const latestPhase = rowNullableString(row, "latest_phase");
  const latestEventCreatedAt = rowNullableString(row, "latest_event_created_at");
  const stagingDevice = rowNullableNumber(row, "staging_device");
  const stagingInode = rowNullableNumber(row, "staging_inode");
  const stagingCreatedAt = rowNullableString(row, "staging_created_at");
  const recoveryClaimPhase = rowNullableString(row, "recovery_claim_phase");
  const recoveryClaimGeneration = rowNullableNumber(row, "recovery_claim_generation");
  const recoveryClaimedAt = rowNullableString(row, "recovery_claimed_at");
  return {
    operationId: rowString(row, "operation_id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    sourceId: rowString(row, "source_id"),
    requestedVersionId: rowString(row, "requested_version_id"),
    kind: rowString(row, "kind") as ManagedCandidateKnowledgeWriteKind,
    createdAt: rowString(row, "created_at"),
    ...(ownerGeneration === null ? {} : { ownerGeneration }),
    ...(rowNullableString(row, "requested_media_type") === null
      ? {}
      : { requestedMediaType: rowNullableString(row, "requested_media_type") as string }),
    ...(rowNullableString(row, "requested_checksum") === null
      ? {}
      : { requestedChecksum: rowNullableString(row, "requested_checksum") as string }),
    ...(requestedSizeBytes === null ? {} : { requestedSizeBytes }),
    ownerKind: rowNullableString(row, "owner_kind"),
    ownerSchemaVersion: rowNullableNumber(row, "owner_schema_version"),
    latestPhase:
      latestPhase === null
        ? "prepared"
        : (latestPhase as ManagedCandidateKnowledgeWriteJournalPhase),
    latestEventCreatedAt,
    targetVersionId: rowNullableString(row, "target_version_id"),
    stagingIdentity:
      stagingDevice === null || stagingInode === null || stagingCreatedAt === null
        ? null
        : { device: stagingDevice, inode: stagingInode, createdAt: stagingCreatedAt },
    recoveryClaim:
      recoveryClaimPhase === null || recoveryClaimGeneration === null || recoveryClaimedAt === null
        ? null
        : {
            phase: recoveryClaimPhase as ManagedCandidateKnowledgeWriteRecoveryClaimPhase,
            generation: recoveryClaimGeneration,
            claimedAt: recoveryClaimedAt,
          },
  };
}

function candidateKnowledgeSourceVersionFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceVersionRecord {
  return {
    id: rowString(row, "id"),
    sourceId: rowString(row, "source_id"),
    version: rowNumber(row, "version"),
    parentVersionId: rowNullableString(row, "parent_version_id"),
    mediaType: rowString(row, "media_type"),
    checksum: rowString(row, "checksum"),
    sizeBytes: rowNumber(row, "size_bytes"),
    createdAt: rowString(row, "created_at"),
  };
}

function candidateKnowledgeDeletionOperationFromRow(
  row: Record<string, unknown>,
  artifactRows: readonly Record<string, unknown>[],
): CandidateKnowledgeDeletionOperationRecord {
  const phase = rowString(row, "phase");
  if (
    phase !== "prepared" &&
    phase !== "staging" &&
    phase !== "committed" &&
    phase !== "completed" &&
    phase !== "aborted"
  ) {
    throw new StorageValidationError("candidate knowledge deletion operation phase is invalid");
  }
  const artifacts = artifactRows.map((artifact) => ({
    operationId: rowString(artifact, "operation_id"),
    sourceId: rowString(artifact, "source_id"),
    versionId: rowString(artifact, "version_id"),
    checksum: rowString(artifact, "checksum"),
    sizeBytes: rowNumber(artifact, "size_bytes"),
    device: rowNumber(artifact, "device"),
    inode: rowNumber(artifact, "inode"),
  }));
  return Object.freeze({
    operationId: rowString(row, "operation_id"),
    knowledgeBaseId: rowString(row, "knowledge_base_id"),
    confirmationToken: rowString(row, "confirmation_token"),
    graphDigest: rowString(row, "graph_digest"),
    phase,
    createdAt: rowString(row, "created_at"),
    committedAt: rowNullableString(row, "committed_at"),
    completedAt: rowNullableString(row, "completed_at"),
    stagingDevice: rowNullableNumber(row, "staging_device"),
    stagingInode: rowNullableNumber(row, "staging_inode"),
    managedArtifactCount: rowNumber(row, "managed_artifact_count"),
    managedArtifactBytes: rowNumber(row, "managed_artifact_bytes"),
    preservedUnknownCount: rowNumber(row, "preserved_unknown_count"),
    preservedUnmanagedCount: rowNumber(row, "preserved_unmanaged_count"),
    countCapped: rowNumber(row, "count_capped") === 1,
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze(artifact))),
  });
}

function candidateKnowledgeDeletionAuditFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeDeletionAuditRecord {
  if (rowString(row, "status") !== "completed") {
    throw new StorageValidationError("candidate knowledge deletion audit status is invalid");
  }
  return Object.freeze({
    auditId: rowString(row, "audit_id"),
    operationId: rowString(row, "operation_id"),
    knowledgeBaseId: rowString(row, "knowledge_base_id"),
    confirmationToken: rowString(row, "confirmation_token"),
    status: "completed",
    createdAt: rowString(row, "created_at"),
    completedAt: rowString(row, "completed_at"),
    counts: Object.freeze({
      managedArtifactCount: rowNumber(row, "managed_artifact_count"),
      managedArtifactBytes: rowNumber(row, "managed_artifact_bytes"),
      preservedUnknownCount: rowNumber(row, "preserved_unknown_count"),
      preservedUnmanagedCount: rowNumber(row, "preserved_unmanaged_count"),
      countCapped: rowNumber(row, "count_capped") === 1,
    }),
  });
}

function isValidCandidateKnowledgeBaseLifecycleState(
  knowledgeBase: CandidateKnowledgeBaseRecord,
): boolean {
  if (
    !isValidCandidateKnowledgeBaseState(knowledgeBase.state) ||
    !isValidTimestampValue(knowledgeBase.createdAt) ||
    !isValidTimestampValue(knowledgeBase.updatedAt) ||
    Date.parse(knowledgeBase.updatedAt) < Date.parse(knowledgeBase.createdAt)
  ) {
    return false;
  }
  if (knowledgeBase.state === "active") {
    return knowledgeBase.archivedAt === null;
  }
  return (
    knowledgeBase.archivedAt !== null &&
    isValidTimestampValue(knowledgeBase.archivedAt) &&
    Date.parse(knowledgeBase.archivedAt) >= Date.parse(knowledgeBase.createdAt) &&
    Date.parse(knowledgeBase.archivedAt) <= Date.parse(knowledgeBase.updatedAt)
  );
}

function isValidCandidateKnowledgeBaseState(value: unknown): value is CandidateKnowledgeBaseState {
  return value === "active" || value === "archived";
}

function isValidTimestampValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function freezeCandidateKnowledgeBaseLifecycleReadiness(
  result: CandidateKnowledgeBaseLifecycleReadinessRecord,
): CandidateKnowledgeBaseLifecycleReadinessRecord {
  const sources = result.sources.map((source) => {
    const observation =
      source.lifecycleRevision.observation === null
        ? null
        : Object.freeze({ ...source.lifecycleRevision.observation });
    const retirement =
      source.lifecycleRevision.retirement === null
        ? null
        : Object.freeze({ ...source.lifecycleRevision.retirement });
    const directory =
      source.lifecycleRevision.directory === null
        ? null
        : Object.freeze({ ...source.lifecycleRevision.directory });
    const lifecycleRevision = Object.freeze({
      ...source.lifecycleRevision,
      observation,
      retirement,
      directory,
    });
    return Object.freeze({
      ...source,
      reasons: Object.freeze([...source.reasons]),
      lifecycleRevision,
    });
  });
  return Object.freeze({
    ...result,
    sources: Object.freeze(sources),
  });
}

function contextFromRow(row: Record<string, unknown>): ContextSnapshotRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    schemaVersion: rowNumber(row, "schema_version"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "payload_checksum"),
  };
}

function opportunityBriefFromRow(row: Record<string, unknown>): OpportunityBriefVersionRecord {
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

function canonicalCandidateProfileVersionFromRow(
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

function writingPolicyVersionFromRow(row: Record<string, unknown>): WritingPolicyVersionRecord {
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

function evidenceSourceFromRow(row: Record<string, unknown>): EvidenceSourceRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    path: rowString(row, "path"),
    mediaType: rowString(row, "media_type"),
    checksum: rowString(row, "checksum"),
    createdAt: rowString(row, "created_at"),
  };
}

function evidenceChunkFromRow(row: Record<string, unknown>): EvidenceChunkRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    sourceId: rowString(row, "source_id"),
    ordinal: rowNumber(row, "ordinal"),
    lineStart: rowNumber(row, "line_start"),
    lineEnd: rowNumber(row, "line_end"),
    checksum: rowString(row, "checksum"),
    text: rowString(row, "text"),
    createdAt: rowString(row, "created_at"),
  };
}

function runFromRow(row: Record<string, unknown>): RunRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    state: rowString(row, "state") as StoredRunState,
    round: rowNumber(row, "round"),
    currentStep: rowNullableString(row, "current_step") as StoredRunStep,
    budget: parse(rowString(row, "budget_json")),
    artifactId: rowNullableString(row, "artifact_id"),
    approval: rowString(row, "approval") as StoredApprovalStatus,
    totalCostUsd: rowNumber(row, "total_cost_usd"),
    startedAt: rowString(row, "started_at"),
    updatedAt: rowString(row, "updated_at"),
    lastError: rowNullableJson(row, "last_error_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function runSnapshotFromRow(row: Record<string, unknown>): RunSnapshotRecord {
  return {
    sequence: rowNumber(row, "sequence"),
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    state: rowString(row, "state") as StoredRunState,
    round: rowNumber(row, "round"),
    currentStep: rowNullableString(row, "current_step") as StoredRunStep,
    budget: parse(rowString(row, "budget_json")),
    artifactId: rowNullableString(row, "artifact_id"),
    approval: rowString(row, "approval") as StoredApprovalStatus,
    totalCostUsd: rowNumber(row, "total_cost_usd"),
    startedAt: rowString(row, "started_at"),
    updatedAt: rowString(row, "updated_at"),
    lastError: rowNullableJson(row, "last_error_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function roundFromRow(row: Record<string, unknown>): RoundRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    number: rowNumber(row, "number"),
    state: rowString(row, "state") as StoredRoundState,
    startedAt: rowString(row, "started_at"),
    completedAt: rowNullableString(row, "completed_at"),
    evaluation: rowNullableJson(row, "evaluation_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function executionFromRow(row: Record<string, unknown>): ExecutionRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowString(row, "round_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    attempt: rowNumber(row, "attempt"),
    step: rowString(row, "step") as StoredExecutionStep,
    status: rowString(row, "status") as StoredExecutionStatus,
    provider: rowString(row, "provider"),
    modelId: rowString(row, "model_id"),
    providerRequestId: rowNullableString(row, "provider_request_id"),
    outputChecksum: rowNullableString(row, "output_checksum"),
    inputTokens: rowNumber(row, "input_tokens"),
    outputTokens: rowNumber(row, "output_tokens"),
    totalTokens: rowNumber(row, "total_tokens"),
    estimatedUsd: rowNullableNumber(row, "estimated_usd"),
    startedAt: rowString(row, "started_at"),
    completedAt: rowNullableString(row, "completed_at"),
    errorCode: rowNullableString(row, "error_code"),
    output: rowNullableJson(row, "output_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function findingFromRow(row: Record<string, unknown>): FindingRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowString(row, "round_id"),
    executionId: rowNullableString(row, "execution_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    code: rowString(row, "code"),
    category: rowString(row, "category"),
    severity: rowString(row, "severity") as StoredFindingSeverity,
    message: rowString(row, "message"),
    claimId: rowNullableString(row, "claim_id"),
    sectionId: rowNullableString(row, "section_id"),
    requirementId: rowNullableString(row, "requirement_id"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function decisionFromRow(row: Record<string, unknown>): DecisionRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowNullableString(row, "round_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    type: rowString(row, "type") as StoredDecisionType,
    rationale: rowString(row, "rationale"),
    actor: rowString(row, "actor"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function exportFromRow(row: Record<string, unknown>): ExportRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    artifactId: rowString(row, "artifact_id"),
    format: rowString(row, "format"),
    status: rowString(row, "status") as StoredExportStatus,
    outputPath: rowNullableString(row, "output_path"),
    outputChecksum: rowNullableString(row, "output_checksum"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

function auditFromRow(row: Record<string, unknown>): AuditEvent {
  return {
    sequence: rowNumber(row, "sequence"),
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    eventType: rowString(row, "event_type"),
    entityType: rowString(row, "entity_type"),
    entityId: rowString(row, "entity_id"),
    payload: parse(rowString(row, "payload_json")),
    payloadChecksum: rowString(row, "payload_checksum"),
    previousEventChecksum: rowNullableString(row, "previous_event_checksum"),
    eventChecksum: rowString(row, "event_checksum"),
    createdAt: rowString(row, "created_at"),
  };
}

export function openSqliteStorage(filename: string): SqliteStorage {
  return new SqliteStorage(filename);
}

export function openSqliteStorageReadOnly(filename: string): SqliteStorage {
  return new SqliteStorage(filename, { readOnly: true, fileMustExist: true });
}
