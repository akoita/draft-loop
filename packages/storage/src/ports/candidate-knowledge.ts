import type { CandidateKnowledgeBaseState } from "@draft-loop/domain";
import type { CandidateKnowledgePortableBackupManifest } from "@draft-loop/schemas";
import type {
  CandidateKnowledgeRetentionOverrideInput,
  CandidateKnowledgeRetentionPolicyRecord,
  CandidateKnowledgeRetentionPolicyUpdateInput,
} from "../candidate-knowledge-retention-types.js";
import type { SourceEvidenceKindStoragePort } from "../source-evidence-kinds.js";
import type { SourceSensitivityRuleStoragePort } from "../source-sensitivity-rules.js";

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

export interface CandidateKnowledgeBaseStoragePort
  extends SourceSensitivityRuleStoragePort,
    SourceEvidenceKindStoragePort {
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
