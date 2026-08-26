import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import {
  chmod,
  copyFile,
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  type CandidateKnowledgePortableBackupInspection,
  type CandidateKnowledgePortableBackupManifest,
  type CandidateKnowledgePortableBackupRestoreResult,
  candidateKnowledgePortableBackupFormat,
  candidateKnowledgePortableBackupInspectionSchema,
  candidateKnowledgePortableBackupIntegrityIndicator,
  candidateKnowledgePortableBackupManifestChecksumFilename,
  candidateKnowledgePortableBackupManifestFilename,
  candidateKnowledgePortableBackupManifestSchema,
  candidateKnowledgePortableBackupMaximumEntries,
  candidateKnowledgePortableBackupObjectsDirectory,
  candidateKnowledgePortableBackupRestoreOptionsSchema,
  candidateKnowledgePortableBackupRestoreResultSchema,
  candidateKnowledgePortableBackupSchemaVersion,
  candidateKnowledgeStoreSchema,
} from "@draft-loop/schemas";

import {
  type CandidateKnowledgeBaseInput,
  type CandidateKnowledgeBaseRecord,
  type CandidateKnowledgeBaseStoragePort,
  type CandidateKnowledgeDeletionArtifactRecord,
  type CandidateKnowledgeDeletionAuditRecord,
  type CandidateKnowledgeDeletionCommitInput,
  type CandidateKnowledgeDeletionDatabaseSnapshot,
  type CandidateKnowledgeDeletionOperationInput,
  type CandidateKnowledgeDeletionOperationRecord,
  type CandidateKnowledgeDirectoryBindingInput,
  type CandidateKnowledgeDirectoryBindingRecord,
  type CandidateKnowledgeDirectoryMemberMoveInput,
  type CandidateKnowledgeDirectoryMemberOriginRelationRecord,
  type CandidateKnowledgeDirectoryMemberRecord,
  type CandidateKnowledgeDirectoryMemberRetirementInput,
  type CandidateKnowledgeDirectoryMemberRevisionRecord,
  type CandidateKnowledgeDirectoryRefreshObservationBatchInput,
  type CandidateKnowledgeDirectoryRootRebindInput,
  type CandidateKnowledgeDirectoryRootRebindResult,
  type CandidateKnowledgeDirectoryRootRevisionRecord,
  type CandidateKnowledgeRetentionClass,
  type CandidateKnowledgeRetentionOwnershipStatus,
  type CandidateKnowledgeRetentionPlan,
  type CandidateKnowledgeRetentionPlanClass,
  type CandidateKnowledgeRetentionRule,
  type CandidateKnowledgeSourceInput,
  type CandidateKnowledgeSourceOriginBindingRecord,
  type CandidateKnowledgeSourceRefreshObservationInput,
  type CandidateKnowledgeSourceRefreshObservationRecord,
  type CandidateKnowledgeSourceRetirementInput,
  type CandidateKnowledgeSourceRetirementRecord,
  type CandidateKnowledgeSourceUrlProvenanceInput,
  type CandidateKnowledgeSourceUrlProvenanceRecord,
  type CandidateKnowledgeSourceVersionInput,
  type CandidateKnowledgeSourceVersionRecord,
  type CandidateKnowledgeSourceVersionWriteResult,
  candidateKnowledgeRetentionClasses,
  type ManagedCandidateKnowledgeWriteJournalPhase,
  type ManagedCandidateKnowledgeWriteOperationRecord,
  type ManagedCandidateKnowledgeWriteRecoveryReport,
  managedCandidateKnowledgeWriteOwnerKind,
  managedCandidateKnowledgeWriteOwnerSchemaVersion,
  openSqliteStorage,
  openSqliteStorageReadOnly,
  type SqliteStorage,
  StorageConflictError,
  StorageValidationError,
  storageSchemaVersion,
} from "./index.js";
import {
  type StorageWriterLease,
  StorageWriterLeaseError,
  type StorageWriterLeaseOptions,
  withStorageWriterLease,
} from "./writer-lease.js";

const manifestFilename = "draft-loop-knowledge.json";
const privateDirectory = ".draft-loop";
const databaseFilename = "knowledge.sqlite";
const writerCoordinatorFilename = "writer-coordination.sqlite";
const sourcesDirectory = "sources";
const maximumManifestBytes = 64 * 1024;
const maximumPortableBackupManifestBytes = 16 * 1024 * 1024;
const maximumDatabaseBytes = 16 * 1024 * 1024 * 1024;
const descriptorKeyPrefix = "candidateKnowledgeStore";

export const maximumManagedCandidateKnowledgeFileBytes = 20 * 1024 * 1024;
export const maximumManagedCandidateKnowledgeUrlResponseBytes = 4 * 1024 * 1024;
export const maximumManagedCandidateKnowledgeInventoryEntries = 1024;

function currentKnowledgeStoreTimestamp(): string {
  return new Date().toISOString();
}

export type CandidateKnowledgeDeletionBlockerCode =
  | "legal-hold"
  | "manual-preservation"
  | "unmanaged-database-records"
  | "pending-managed-write"
  | "managed-artifact-missing"
  | "managed-artifact-integrity"
  | "unknown-deletion-state";

export interface CandidateKnowledgeDeletionBlocker {
  readonly code: CandidateKnowledgeDeletionBlockerCode;
  readonly count: number;
}

export type CandidateKnowledgeDeletionPlanClassStatus = "delete" | "blocked" | "not-materialized";

export interface CandidateKnowledgeDeletionPlanClass {
  readonly class: CandidateKnowledgeRetentionClass;
  readonly rule: CandidateKnowledgeRetentionRule;
  readonly expireAfterDays: number | null;
  readonly status: CandidateKnowledgeDeletionPlanClassStatus;
  readonly ownershipStatus: CandidateKnowledgeRetentionOwnershipStatus;
  readonly managedCount: number;
  readonly eligibleCount: number;
  readonly preservedCount: number;
  readonly unmanagedCount: number;
  readonly unknownCount: number;
  readonly countCapped: boolean;
  readonly preservationReasons: readonly (
    | "override"
    | "unmanaged"
    | "unknown"
    | "not-materialized"
    | "blocked"
  )[];
}

/** Path-free, bounded preview of one archived non-default CKB deletion. */
export interface CandidateKnowledgeDeletionPlan {
  readonly schemaVersion: 1;
  readonly knowledgeBaseId: string;
  readonly archivedAt: string;
  readonly status: "ready" | "blocked";
  readonly policyRevision: number;
  readonly overrideRevision: number;
  readonly sourceCount: number;
  readonly versionCount: number;
  readonly managedArtifactCount: number;
  readonly managedArtifactBytes: number;
  readonly preservedUnknownCount: number;
  readonly preservedUnmanagedCount: number;
  readonly countCapped: boolean;
  readonly blockers: readonly CandidateKnowledgeDeletionBlocker[];
  readonly classes: readonly CandidateKnowledgeDeletionPlanClass[];
  /** Opaque digest bound to the complete store, graph, policy, and inventory. */
  readonly confirmationToken: string;
}

export type CandidateKnowledgeDeletionInterruptionBoundary =
  | "intent"
  | "staging"
  | "before-commit"
  | "commit"
  | "after-commit"
  | "staging-cleanup"
  | "after-staging-cleanup";

export interface CandidateKnowledgeDeletionOptions {
  /** @internal Simulates a restart-worthy failure at a deletion boundary. */
  readonly interruptAt?: CandidateKnowledgeDeletionInterruptionBoundary;
  /** @internal Failure seam before the operation journal is created. */
  readonly beforeIntent?: () => Promise<void>;
  /** @internal Failure seam before filesystem staging starts. */
  readonly beforeStaging?: () => Promise<void>;
  /** @internal Failure seam before the logical SQLite commit. */
  readonly beforeCommit?: () => Promise<void>;
  /** @internal Failure seam after the logical SQLite commit. */
  readonly afterCommit?: () => Promise<void>;
  /** @internal Failure seam before staging cleanup. */
  readonly beforeStagingCleanup?: () => Promise<void>;
  /** @internal Failure seam after staging cleanup, before audit completion. */
  readonly afterStagingCleanup?: () => Promise<void>;
}

export type CandidateKnowledgeDeletionAudit = CandidateKnowledgeDeletionAuditRecord;

/** Content-free result and audit projection for a completed CKB deletion. */
export interface CandidateKnowledgeDeletionResult {
  readonly schemaVersion: 1;
  readonly status: "deleted";
  readonly knowledgeBaseId: string;
  readonly operationId: string;
  readonly auditId: string;
  readonly confirmationToken: string;
  readonly completedAt: string;
  readonly managedArtifactCount: number;
  readonly managedArtifactBytes: number;
  readonly preservedUnknownCount: number;
  readonly preservedUnmanagedCount: number;
  readonly countCapped: boolean;
  readonly audit: CandidateKnowledgeDeletionAudit;
}

export type ManagedCandidateKnowledgeWriteInterruptionBoundary =
  | "intent"
  | "staging"
  | "target-intent"
  | "target-publication"
  | "published-event"
  | "commit"
  | "staging-cleanup"
  | "after-staging-cleanup";

export interface ManagedCandidateKnowledgeFileInventory {
  readonly schemaVersion: 1;
  readonly verifiedManagedFileCount: number;
  readonly scannedEntryCount: number;
  readonly unknownEntries: {
    readonly intakeShapedFilesAtSourcesRoot: number;
    readonly opaqueEntriesAtSourcesRoot: number;
    readonly entriesInsideManagedSourceDirectories: number;
    readonly symbolicLinks: number;
    readonly otherEntries: number;
  };
  readonly complete: boolean;
  readonly scanLimitReached: boolean;
}

export interface CandidateKnowledgePortableBackupExportOptions {
  /** @internal Deterministic timestamp seam for application/tests. */
  readonly createdAt?: string;
  /** @internal Simulates a failure after the no-replace destination claim. */
  readonly beforePublication?: () => Promise<void>;
}

export type CandidateKnowledgePortableBackupRestoreInterruptionBoundary =
  | "staging"
  | "import"
  | "commit"
  | "target-publication"
  | "destination-claim"
  | "manifest-publication"
  | "after-manifest-publication";

export interface CandidateKnowledgePortableBackupRestoreOptions {
  readonly collision?: "fail-if-destination-exists";
  /** @internal Deterministic restoredAt seam for tests. */
  readonly restoredAt?: string;
  /** @internal Simulates an interruption and preserves owned staging state. */
  readonly interruptAt?: CandidateKnowledgePortableBackupRestoreInterruptionBoundary;
  /** @internal Failure seam before the trusted metadata import. */
  readonly beforeImport?: () => Promise<void>;
  /** @internal Failure seam before no-replace target publication. */
  readonly beforePublication?: () => Promise<void>;
}

export interface CandidateKnowledgePortableBackupExportResult
  extends CandidateKnowledgePortableBackupInspection {
  readonly status: "exported";
}

export interface CandidateKnowledgeStoreDescriptor {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
}

export interface InitializeCandidateKnowledgeStoreInput {
  /** A new, user-selected directory. It must not already exist. */
  readonly root: string;
  readonly descriptor: CandidateKnowledgeStoreDescriptor;
  readonly defaultKnowledgeBase: Omit<CandidateKnowledgeBaseInput, "isDefault">;
  /** @internal Test seam for exercising a target-creation race before publication. */
  readonly beforePublish?: (target: string) => Promise<void>;
}

export interface ManagedCandidateKnowledgeFileVersionInput
  extends CandidateKnowledgeSourceVersionInput {
  /**
   * Runtime selection. Managed creates retain its verified canonical path only in the
   * sensitive local origin binding; appends do not persist or replace it.
   */
  readonly sourcePath: string;
  /** Runtime-only directory membership context for a new managed file source. */
  readonly directoryId?: string;
  /** @internal Expected latest version for an explicitly guarded refresh append. */
  readonly expectedCurrentVersionId?: string;
  /** @internal Expected current origin revision for an explicitly guarded refresh append. */
  readonly expectedOriginBoundAt?: string;
  /** @internal Test seam for mutating the opened source before its final stability check. */
  readonly beforeSourceRecheck?: () => Promise<void>;
  /** @internal Test seam for simulating a failure after file publication but before SQLite. */
  readonly beforeDatabaseWrite?: () => Promise<void>;
  /** @internal Test seam after lease renewal and before an owned SQLite transition. */
  readonly afterLeaseRenewBeforeDatabaseWrite?: () => Promise<void>;
  /** @internal Test seam after the no-replace link and before its published event. */
  readonly afterTargetPublication?: () => Promise<void>;
  /** @internal Test seam for simulating a failure after the atomic SQLite commit. */
  readonly beforeCommittedFileRecheck?: () => Promise<void>;
  /** @internal Test seam for simulating a staging cleanup failure after commit. */
  readonly beforeStagingCleanup?: () => Promise<void>;
  /** @internal Restart-recovery seam; bypasses in-process rollback at this boundary. */
  readonly interruptAt?: ManagedCandidateKnowledgeWriteInterruptionBoundary;
}

export interface ManagedCandidateKnowledgeUrlVersionInput
  extends CandidateKnowledgeSourceVersionInput {
  /** Exact response bytes returned by the approved URL ingestion boundary. */
  readonly responseBytes: Uint8Array;
  readonly provenance: CandidateKnowledgeSourceUrlProvenanceInput;
  /** @internal Expected latest version for a refresh preflight lineage guard. */
  readonly expectedCurrentVersionId?: string;
  /** @internal Test seam for simulating a failure after file publication but before SQLite. */
  readonly beforeDatabaseWrite?: () => Promise<void>;
  /** @internal Test seam after lease renewal and before an owned SQLite transition. */
  readonly afterLeaseRenewBeforeDatabaseWrite?: () => Promise<void>;
  /** @internal Test seam after the no-replace link and before its published event. */
  readonly afterTargetPublication?: () => Promise<void>;
  /** @internal Test seam for simulating an integrity recheck failure after SQLite. */
  readonly beforeCommittedFileRecheck?: () => Promise<void>;
  /** @internal Test seam for simulating a staging cleanup failure after commit. */
  readonly beforeStagingCleanup?: () => Promise<void>;
  /** @internal Restart-recovery seam; bypasses in-process rollback at this boundary. */
  readonly interruptAt?: ManagedCandidateKnowledgeWriteInterruptionBoundary;
}

export interface RebindManagedCandidateKnowledgeFileInput {
  /** Explicit runtime selection; it is never persisted in a product projection. */
  readonly sourcePath: string;
  /** Expected media type obtained by the caller's bounded file ingestion. */
  readonly mediaType: string;
  /** Expected SHA-256 obtained by the caller's bounded file ingestion. */
  readonly checksum: string;
  /** Expected byte size obtained by the caller's bounded file ingestion. */
  readonly sizeBytes: number;
  /** Timestamp for the new origin binding. */
  readonly boundAt: string;
  /** @internal Test seam for mutating the opened source before its final stability check. */
  readonly beforeSourceRecheck?: () => Promise<void>;
}

export interface RebindManagedCandidateKnowledgeFileResult {
  readonly binding: CandidateKnowledgeSourceOriginBindingRecord;
  readonly rebound: boolean;
}

export interface RebindManagedCandidateKnowledgeDirectoryRootMemberInput {
  readonly sourceId: string;
  /** Explicit runtime source selection; it is never persisted in a product projection. */
  readonly sourcePath: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly expectedVersionId: string;
  readonly expectedOriginBoundAt: string;
  /** @internal Test seam for mutating the selected source before its final stability check. */
  readonly beforeSourceRecheck?: () => Promise<void>;
}

export interface RebindManagedCandidateKnowledgeDirectoryRootInput {
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly candidateRootPath: string;
  readonly expectedRootPath: string;
  readonly expectedRevision: number;
  readonly reboundAt: string;
  readonly members: readonly RebindManagedCandidateKnowledgeDirectoryRootMemberInput[];
}

export type RebindManagedCandidateKnowledgeDirectoryRootResult =
  CandidateKnowledgeDirectoryRootRebindResult;

export interface MoveManagedCandidateKnowledgeDirectoryMemberInput {
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly sourceId: string;
  /** Explicit runtime source selection; it is never persisted in a product projection. */
  readonly sourcePath: string;
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
  /** @internal Test seam for mutating the selected source before its final stability check. */
  readonly beforeSourceRecheck?: () => Promise<void>;
}

export interface MoveManagedCandidateKnowledgeDirectoryMemberResult {
  readonly member: CandidateKnowledgeDirectoryMemberRecord;
  readonly revision: CandidateKnowledgeDirectoryMemberRevisionRecord;
  readonly binding: CandidateKnowledgeSourceOriginBindingRecord;
  readonly moved: boolean;
}

export interface CandidateKnowledgeStoreHandle extends CandidateKnowledgeBaseStoragePort {
  readonly descriptor: CandidateKnowledgeStoreDescriptor;
  /** Canonical physical root. It is runtime state and is never persisted in the manifest. */
  readonly root: string;
  /** Safe summary of any managed writes reconciled while opening the store. */
  readonly recoveryReport: ManagedCandidateKnowledgeWriteRecoveryReport;
  /** Hold one store-wide writer lease across a complete multi-step operation. */
  readonly withWriterLease: <T>(
    operation: string,
    callback: () => Promise<T>,
    options?: CandidateKnowledgeWriterLeaseOptions,
  ) => Promise<T>;
  readonly createManagedCandidateKnowledgeFileSource: (
    source: CandidateKnowledgeSourceInput,
    initialVersion: ManagedCandidateKnowledgeFileVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly createManagedCandidateKnowledgeUrlSource: (
    source: CandidateKnowledgeSourceInput,
    initialVersion: ManagedCandidateKnowledgeUrlVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly appendManagedCandidateKnowledgeUrlVersion: (
    knowledgeBaseId: string,
    sourceId: string,
    version: ManagedCandidateKnowledgeUrlVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly appendManagedCandidateKnowledgeFileVersion: (
    knowledgeBaseId: string,
    sourceId: string,
    version: ManagedCandidateKnowledgeFileVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly rebindManagedCandidateKnowledgeFileOrigin: (
    knowledgeBaseId: string,
    sourceId: string,
    input: RebindManagedCandidateKnowledgeFileInput,
  ) => Promise<RebindManagedCandidateKnowledgeFileResult>;
  /** Sensitive local-only state; never included in application projections. */
  readonly getCandidateKnowledgeSourceOriginBinding: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceOriginBindingRecord | undefined>;
  /** Sensitive local-only directory root and membership state. */
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
  readonly rebindManagedCandidateKnowledgeDirectoryRoot: (
    input: RebindManagedCandidateKnowledgeDirectoryRootInput,
  ) => Promise<RebindManagedCandidateKnowledgeDirectoryRootResult>;
  readonly moveManagedCandidateKnowledgeDirectoryMember: (
    input: MoveManagedCandidateKnowledgeDirectoryMemberInput,
  ) => Promise<MoveManagedCandidateKnowledgeDirectoryMemberResult>;
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
  readonly getCandidateKnowledgeSourceRefreshObservation: (
    knowledgeBaseId: string,
    sourceId: string,
  ) => Promise<CandidateKnowledgeSourceRefreshObservationRecord | undefined>;
  readonly getCandidateKnowledgeSourceUrlProvenance: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<CandidateKnowledgeSourceUrlProvenanceRecord | undefined>;
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
  readonly planCandidateKnowledgeRetention: (
    knowledgeBaseId: string,
    asOf: string,
  ) => Promise<CandidateKnowledgeRetentionPlan>;
  readonly planCandidateKnowledgeBaseDeletion: (
    knowledgeBaseId: string,
  ) => Promise<CandidateKnowledgeDeletionPlan>;
  readonly deleteCandidateKnowledgeBase: (
    knowledgeBaseId: string,
    confirmationToken: string,
    options?: CandidateKnowledgeDeletionOptions,
  ) => Promise<CandidateKnowledgeDeletionResult>;
  readonly getManagedCandidateKnowledgeFilePath: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<string | undefined>;
  readonly inspectManagedCandidateKnowledgeFiles: () => Promise<ManagedCandidateKnowledgeFileInventory>;
  readonly exportPortableBackup: (
    destination: string,
    options?: CandidateKnowledgePortableBackupExportOptions,
  ) => Promise<CandidateKnowledgePortableBackupExportResult>;
  readonly close: () => Promise<void>;
}

export type CandidateKnowledgeWriterLeaseOptions = Omit<
  StorageWriterLeaseOptions,
  "coordinatorPath" | "scope" | "operation"
>;

interface CandidateKnowledgeWriterContext {
  readonly root: string;
  readonly lease: StorageWriterLease;
}

const candidateKnowledgeWriterContext = new AsyncLocalStorage<CandidateKnowledgeWriterContext>();

class SimulatedManagedWriteInterruption extends Error {
  public constructor(boundary: ManagedCandidateKnowledgeWriteInterruptionBoundary) {
    super(`Simulated managed candidate knowledge write interruption at ${boundary}.`);
    this.name = "SimulatedManagedWriteInterruption";
  }
}

async function interruptManagedWriteAt(
  input: {
    readonly interruptAt?: ManagedCandidateKnowledgeWriteInterruptionBoundary;
  },
  boundary: ManagedCandidateKnowledgeWriteInterruptionBoundary,
): Promise<void> {
  if (input.interruptAt === boundary) {
    throw new SimulatedManagedWriteInterruption(boundary);
  }
}

function currentCandidateKnowledgeWriterLease(root: string): StorageWriterLease {
  const context = candidateKnowledgeWriterContext.getStore();
  if (context === undefined || context.root !== root) {
    throw new StorageConflictError("Candidate knowledge store writer lease is not held.");
  }
  context.lease.assertCurrent();
  return context.lease;
}

export async function withCandidateKnowledgeStoreWriterLease<T>(
  rootInput: string,
  operation: string,
  callback: () => Promise<T>,
  options: CandidateKnowledgeWriterLeaseOptions = {},
): Promise<T> {
  const requestedRoot = requiredPath(rootInput);
  await requireDirectory(requestedRoot, "Candidate knowledge store root");
  const root = await realpath(requestedRoot);
  const existing = candidateKnowledgeWriterContext.getStore();
  if (existing?.root === root) {
    existing.lease.assertCurrent();
    const result = await callback();
    existing.lease.assertCurrent();
    return result;
  }
  const internalRoot = join(root, privateDirectory);
  await requireDirectory(internalRoot, "Candidate knowledge store private directory");
  return withStorageWriterLease(
    {
      ...options,
      coordinatorPath: join(internalRoot, writerCoordinatorFilename),
      scope: "candidate-knowledge-store",
      operation,
    },
    async (lease) =>
      candidateKnowledgeWriterContext.run({ root, lease }, async () => {
        lease.assertCurrent();
        const result = await callback();
        lease.assertCurrent();
        return result;
      }),
  );
}

function requiredPath(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new StorageValidationError("Candidate knowledge store root is required.");
  }
  return resolve(value);
}

function requiredManagedText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new StorageValidationError(`${label} is required.`);
  }
  return value.trim();
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function managedPathSegment(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex");
}

function managedVersionPath(root: string, sourceId: string, versionId: string): string {
  return join(root, sourcesDirectory, managedPathSegment(sourceId), managedPathSegment(versionId));
}

function sourceOpenFlags(): number {
  return process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    // Preserve the failure that caused cleanup.
  }
}

function sameFileState(
  first: Awaited<ReturnType<FileHandle["stat"]>>,
  second: Awaited<ReturnType<FileHandle["stat"]>>,
): boolean {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs &&
    first.ctimeMs === second.ctimeMs
  );
}

async function writeComplete(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, null);
    if (result.bytesWritten <= 0) {
      throw new StorageValidationError("Managed candidate knowledge source could not be copied.");
    }
    offset += result.bytesWritten;
  }
}

interface CapturedManagedFile {
  readonly checksum: string;
  readonly sizeBytes: number;
  /** Canonical physical path verified during capture; never part of product projections. */
  readonly originPath: string;
  readonly temporaryPath: string;
  readonly temporaryIdentity: FileIdentity;
}

interface CapturedManagedBytes {
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly temporaryPath: string;
  readonly temporaryIdentity: FileIdentity;
}

interface VerifiedManagedFile {
  readonly checksum: string;
  readonly sizeBytes: number;
  /** Canonical physical path verified during read-only validation. */
  readonly originPath: string;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

async function removeRegularFileIfIdentityMatches(
  path: string,
  identity: FileIdentity,
): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (
      details.isSymbolicLink() ||
      !details.isFile() ||
      details.dev !== identity.dev ||
      details.ino !== identity.ino
    ) {
      return false;
    }
    await rm(path);
    return true;
  } catch (error) {
    return isMissing(error);
  }
}

async function requireDirectoryIdentity(path: string, identity: FileIdentity): Promise<void> {
  const details = await lstat(path);
  if (
    details.isSymbolicLink() ||
    !details.isDirectory() ||
    details.dev !== identity.dev ||
    details.ino !== identity.ino
  ) {
    throw new StorageConflictError("Portable candidate knowledge restore state changed.");
  }
}

async function removeEmptyDirectoryIfIdentityMatches(
  path: string,
  identity: FileIdentity,
): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (
      details.isSymbolicLink() ||
      !details.isDirectory() ||
      details.dev !== identity.dev ||
      details.ino !== identity.ino
    ) {
      return false;
    }
    await rmdir(path);
    return true;
  } catch (error) {
    return isMissing(error);
  }
}

async function captureManagedFile(
  root: string,
  input: ManagedCandidateKnowledgeFileVersionInput,
  operationId: string,
): Promise<CapturedManagedFile> {
  const expectedChecksum = requiredManagedText(
    input.checksum,
    "Managed candidate knowledge source expected checksum",
  );
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected checksum must be a lowercase SHA-256 checksum.",
    );
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected size must be a non-negative integer.",
    );
  }
  if (input.sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
    throw new StorageValidationError("Managed candidate knowledge source exceeds the size limit.");
  }
  const selectedPath = resolve(requiredManagedText(input.sourcePath, "Managed source path"));
  if (isWithin(root, selectedPath)) {
    throw new StorageValidationError(
      "A managed candidate knowledge source must be selected outside its store.",
    );
  }

  let sourceHandle: FileHandle | undefined;
  let temporaryHandle: FileHandle | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  const temporaryPath = join(root, sourcesDirectory, `.intake-${managedPathSegment(operationId)}`);
  try {
    const selectedDetails = await lstat(selectedPath);
    if (selectedDetails.isSymbolicLink() || !selectedDetails.isFile()) {
      throw new StorageValidationError(
        "Managed candidate knowledge source must be a regular file, not a symbolic link.",
      );
    }
    if (selectedDetails.size > maximumManagedCandidateKnowledgeFileBytes) {
      throw new StorageValidationError(
        "Managed candidate knowledge source exceeds the size limit.",
      );
    }
    const physicalPath = await realpath(selectedPath);
    if (isWithin(root, physicalPath)) {
      throw new StorageValidationError(
        "A managed candidate knowledge source must be selected outside its store.",
      );
    }
    sourceHandle = await open(selectedPath, sourceOpenFlags());
    const before = await sourceHandle.stat();
    if (
      !before.isFile() ||
      before.dev !== selectedDetails.dev ||
      before.ino !== selectedDetails.ino
    ) {
      throw new StorageValidationError(
        "Managed candidate knowledge source changed while it was being opened.",
      );
    }
    if (before.size > maximumManagedCandidateKnowledgeFileBytes) {
      throw new StorageValidationError(
        "Managed candidate knowledge source exceeds the size limit.",
      );
    }

    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    const temporaryDetails = await temporaryHandle.stat();
    temporaryIdentity = { dev: temporaryDetails.dev, ino: temporaryDetails.ino };
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      const result = await sourceHandle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      sizeBytes += result.bytesRead;
      if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
        throw new StorageValidationError(
          "Managed candidate knowledge source exceeds the size limit.",
        );
      }
      const chunk = buffer.subarray(0, result.bytesRead);
      digest.update(chunk);
      await writeComplete(temporaryHandle, chunk);
    }
    await input.beforeSourceRecheck?.();
    const after = await sourceHandle.stat();
    if (!sameFileState(before, after) || sizeBytes !== before.size) {
      throw new StorageValidationError(
        "Managed candidate knowledge source changed while it was being copied.",
      );
    }
    const checksum = digest.digest("hex");
    if (sizeBytes !== input.sizeBytes || checksum !== expectedChecksum) {
      throw new StorageValidationError(
        "Managed candidate knowledge source does not match its expected integrity metadata.",
      );
    }
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await chmodWhereSupported(temporaryPath, 0o600);
    await sourceHandle.close();
    sourceHandle = undefined;
    return {
      checksum,
      sizeBytes,
      originPath: physicalPath,
      temporaryPath,
      temporaryIdentity,
    };
  } catch (error) {
    await closeQuietly(temporaryHandle);
    await closeQuietly(sourceHandle);
    if (temporaryIdentity !== undefined) {
      await removeRegularFileIfIdentityMatches(temporaryPath, temporaryIdentity);
    }
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError(
      "Managed candidate knowledge source could not be read safely.",
    );
  }
}

async function captureManagedBytes(
  root: string,
  input: ManagedCandidateKnowledgeUrlVersionInput,
  operationId: string,
): Promise<CapturedManagedBytes> {
  const bytes = validateManagedUrlResponseBytes(input);
  const temporaryPath = join(root, sourcesDirectory, `.intake-${managedPathSegment(operationId)}`);
  let temporaryHandle: FileHandle | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  try {
    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    const temporaryDetails = await temporaryHandle.stat();
    temporaryIdentity = { dev: temporaryDetails.dev, ino: temporaryDetails.ino };
    await writeComplete(temporaryHandle, Buffer.from(bytes));
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await chmodWhereSupported(temporaryPath, 0o600);
    return {
      checksum: input.checksum,
      sizeBytes: bytes.byteLength,
      temporaryPath,
      temporaryIdentity,
    };
  } catch (error) {
    await closeQuietly(temporaryHandle);
    if (temporaryIdentity !== undefined) {
      await removeRegularFileIfIdentityMatches(temporaryPath, temporaryIdentity);
    }
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError(
      "Managed candidate knowledge source URL response could not be staged safely.",
    );
  }
}

function validateManagedUrlResponseBytes(
  input: ManagedCandidateKnowledgeUrlVersionInput,
): Uint8Array {
  if (!(input.responseBytes instanceof Uint8Array)) {
    throw new StorageValidationError("Managed candidate knowledge URL response bytes are invalid.");
  }
  if (input.responseBytes.byteLength > maximumManagedCandidateKnowledgeUrlResponseBytes) {
    throw new StorageValidationError("Managed candidate knowledge source exceeds the size limit.");
  }
  const expectedChecksum = requiredManagedText(
    input.checksum,
    "Managed candidate knowledge source expected checksum",
  );
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected checksum must be a lowercase SHA-256 checksum.",
    );
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected size must be a non-negative integer.",
    );
  }
  const bytes = new Uint8Array(input.responseBytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== input.sizeBytes || checksum !== expectedChecksum) {
    throw new StorageValidationError(
      "Managed candidate knowledge source does not match its expected integrity metadata.",
    );
  }
  return bytes;
}

async function verifyManagedFileOrigin(
  root: string,
  input: RebindManagedCandidateKnowledgeFileInput,
): Promise<VerifiedManagedFile> {
  const expectedChecksum = requiredManagedText(
    input.checksum,
    "Managed candidate knowledge source expected checksum",
  );
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected checksum must be a lowercase SHA-256 checksum.",
    );
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected size must be a non-negative integer.",
    );
  }
  if (input.sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
    throw new StorageValidationError("Managed candidate knowledge source exceeds the size limit.");
  }
  const selectedPath = resolve(requiredManagedText(input.sourcePath, "Managed source path"));
  if (isWithin(root, selectedPath)) {
    throw new StorageValidationError(
      "A managed candidate knowledge source must be selected outside its store.",
    );
  }

  let sourceHandle: FileHandle | undefined;
  try {
    const selectedDetails = await lstat(selectedPath);
    if (selectedDetails.isSymbolicLink() || !selectedDetails.isFile()) {
      throw new StorageValidationError(
        "Managed candidate knowledge source must be a regular file, not a symbolic link.",
      );
    }
    if (selectedDetails.size > maximumManagedCandidateKnowledgeFileBytes) {
      throw new StorageValidationError(
        "Managed candidate knowledge source exceeds the size limit.",
      );
    }
    const physicalPath = await realpath(selectedPath);
    if (isWithin(root, physicalPath)) {
      throw new StorageValidationError(
        "A managed candidate knowledge source must be selected outside its store.",
      );
    }
    sourceHandle = await open(selectedPath, sourceOpenFlags());
    const before = await sourceHandle.stat();
    if (
      !before.isFile() ||
      before.dev !== selectedDetails.dev ||
      before.ino !== selectedDetails.ino
    ) {
      throw new StorageValidationError(
        "Managed candidate knowledge source changed while it was being opened.",
      );
    }
    if (before.size > maximumManagedCandidateKnowledgeFileBytes) {
      throw new StorageValidationError(
        "Managed candidate knowledge source exceeds the size limit.",
      );
    }

    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      const result = await sourceHandle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      sizeBytes += result.bytesRead;
      if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
        throw new StorageValidationError(
          "Managed candidate knowledge source exceeds the size limit.",
        );
      }
      digest.update(buffer.subarray(0, result.bytesRead));
    }
    await input.beforeSourceRecheck?.();
    const after = await sourceHandle.stat();
    if (!sameFileState(before, after) || sizeBytes !== before.size) {
      throw new StorageValidationError(
        "Managed candidate knowledge source changed while it was being verified.",
      );
    }
    const checksum = digest.digest("hex");
    if (sizeBytes !== input.sizeBytes || checksum !== expectedChecksum) {
      throw new StorageValidationError(
        "Managed candidate knowledge source does not match its expected integrity metadata.",
      );
    }
    return { checksum, sizeBytes, originPath: physicalPath };
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError(
      "Managed candidate knowledge source could not be read safely.",
    );
  } finally {
    await closeQuietly(sourceHandle);
  }
}

async function verifyCandidateDirectoryRoot(
  root: string,
  candidateRootPath: string,
): Promise<string> {
  const selectedPath = resolve(requiredManagedText(candidateRootPath, "Candidate directory root"));
  try {
    const details = await lstat(selectedPath);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new StorageValidationError(
        "Candidate knowledge directory root must be a real directory, not a symbolic link.",
      );
    }
    const canonicalPath = await realpath(selectedPath);
    if (isWithin(root, canonicalPath) || isWithin(canonicalPath, root)) {
      throw new StorageValidationError(
        "Candidate knowledge directory root must be outside its store.",
      );
    }
    return canonicalPath;
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError("Candidate knowledge directory root could not be verified.");
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

async function chmodWhereSupported(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch (error) {
    const code = errorCode(error);
    if (
      code === "ENOSYS" ||
      code === "ENOTSUP" ||
      code === "EOPNOTSUPP" ||
      (process.platform === "win32" && code === "EPERM")
    ) {
      return;
    }
    throw error;
  }
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new StorageConflictError("Candidate knowledge store target already exists.");
}

async function requireDirectory(path: string, label: string): Promise<void> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      throw new StorageValidationError(`${label} is missing.`);
    }
    throw error;
  }
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new StorageValidationError(`${label} must be a real directory, not a symbolic link.`);
  }
}

async function requireRegularFile(
  path: string,
  label: string,
  maximumBytes: number,
): Promise<void> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      throw new StorageValidationError(`${label} is missing.`);
    }
    throw error;
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new StorageValidationError(`${label} must be a regular file, not a symbolic link.`);
  }
  if (details.size > maximumBytes) {
    throw new StorageValidationError(`${label} exceeds the supported size limit.`);
  }
}

async function ensureManagedSourceDirectory(
  root: string,
  sourceId: string,
): Promise<{ readonly path: string; readonly created: boolean }> {
  const path = join(root, sourcesDirectory, managedPathSegment(sourceId));
  try {
    await mkdir(path, { mode: 0o700 });
    await chmodWhereSupported(path, 0o700);
    return { path, created: true };
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    await requireDirectory(path, "Managed candidate knowledge source directory");
    return { path, created: false };
  }
}

async function hashManagedFile(path: string, expectedSize: number): Promise<string> {
  await requireRegularFile(
    path,
    "Managed candidate knowledge source version",
    maximumManagedCandidateKnowledgeFileBytes,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, sourceOpenFlags());
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedSize) {
      throw new StorageValidationError(
        "Managed candidate knowledge source version size does not match its record.",
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      sizeBytes += result.bytesRead;
      if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
        throw new StorageValidationError(
          "Managed candidate knowledge source version exceeds the size limit.",
        );
      }
      digest.update(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat();
    if (!sameFileState(before, after) || sizeBytes !== expectedSize) {
      throw new StorageValidationError(
        "Managed candidate knowledge source version changed while it was being verified.",
      );
    }
    return digest.digest("hex");
  } finally {
    await closeQuietly(handle);
  }
}

async function verifyManagedFile(
  path: string,
  version: Pick<CandidateKnowledgeSourceVersionRecord, "checksum" | "sizeBytes">,
): Promise<void> {
  const checksum = await hashManagedFile(path, version.sizeBytes);
  if (checksum !== version.checksum) {
    throw new StorageValidationError(
      "Managed candidate knowledge source version checksum does not match its record.",
    );
  }
}

async function publishManagedFile(
  temporaryPath: string,
  temporaryIdentity: FileIdentity,
  finalPath: string,
  version: Pick<CandidateKnowledgeSourceVersionRecord, "checksum" | "sizeBytes">,
): Promise<void> {
  let created = false;
  try {
    await link(temporaryPath, finalPath);
    created = true;
    await chmodWhereSupported(finalPath, 0o600);
    await verifyManagedFile(finalPath, version);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new StorageConflictError(
        "Managed candidate knowledge source version target already exists and is not owned by this operation.",
      );
    }
    if (created) await removeRegularFileIfIdentityMatches(finalPath, temporaryIdentity);
    throw error;
  }
}

async function validateManagedCandidateKnowledgeFiles(
  storage: SqliteStorage,
  root: string,
): Promise<void> {
  await verifyManagedCandidateKnowledgeFileVersions(
    storage.listManagedCandidateKnowledgeSourceVersions(),
    root,
  );
}

type ManagedWriteRecoveryArtifact =
  | { readonly status: "missing" }
  | { readonly status: "preserved" }
  | { readonly status: "verified"; readonly identity: FileIdentity };

function isManagedWriteJournalPhase(
  value: string,
): value is ManagedCandidateKnowledgeWriteJournalPhase {
  return (
    value === "prepared" ||
    value === "targeted" ||
    value === "published" ||
    value === "committed" ||
    value === "completed" ||
    value === "aborted" ||
    value === "noop"
  );
}

async function inspectManagedWriteRecoveryArtifact(
  path: string,
  integrity: Pick<CandidateKnowledgeSourceVersionRecord, "checksum" | "sizeBytes">,
): Promise<ManagedWriteRecoveryArtifact> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    return isMissing(error) ? { status: "missing" } : { status: "preserved" };
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    return { status: "preserved" };
  }
  try {
    await verifyManagedFile(path, integrity);
    const after = await lstat(path);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.dev !== details.dev ||
      after.ino !== details.ino
    ) {
      return { status: "preserved" };
    }
    return { status: "verified", identity: { dev: after.dev, ino: after.ino } };
  } catch {
    return { status: "preserved" };
  }
}

function requireManagedWriteRecoveryIdentity(
  artifact: ManagedWriteRecoveryArtifact,
  expected: ManagedCandidateKnowledgeWriteOperationRecord["stagingIdentity"],
): ManagedWriteRecoveryArtifact {
  if (
    expected !== null &&
    artifact.status === "verified" &&
    (artifact.identity.dev !== expected.device || artifact.identity.ino !== expected.inode)
  ) {
    return { status: "preserved" };
  }
  return artifact;
}

async function removeManagedWriteRecoveryArtifact(
  lease: StorageWriterLease,
  path: string,
  artifact: ManagedWriteRecoveryArtifact,
): Promise<boolean> {
  if (artifact.status === "missing") return true;
  if (artifact.status !== "verified") return false;
  lease.renew();
  const removed = await removeRegularFileIfIdentityMatches(path, artifact.identity);
  lease.assertCurrent();
  return removed;
}

async function removeEmptyManagedWriteSourceDirectory(
  root: string,
  lease: StorageWriterLease,
  operation: ManagedCandidateKnowledgeWriteOperationRecord,
): Promise<boolean> {
  if (operation.kind !== "create") return true;
  const path = join(root, sourcesDirectory, managedPathSegment(operation.sourceId));
  lease.renew();
  try {
    await rmdir(path);
    lease.assertCurrent();
    return true;
  } catch (error) {
    lease.assertCurrent();
    if (isMissing(error)) return true;
    if (errorCode(error) === "ENOTEMPTY") return false;
    return false;
  }
}

function recoveryReport(
  entries: readonly {
    readonly kind: ManagedCandidateKnowledgeWriteOperationRecord["kind"];
    readonly phase: ManagedCandidateKnowledgeWriteJournalPhase;
    readonly outcome: "aborted" | "completed" | "preserved";
  }[],
): ManagedCandidateKnowledgeWriteRecoveryReport {
  return Object.freeze({
    schemaVersion: 1,
    entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
  });
}

function managedWriteRecoveryTimestamp(
  operationCreatedAt: string,
  latestEventCreatedAt: string | null,
): string {
  return new Date(
    Math.max(
      Date.now(),
      Date.parse(operationCreatedAt),
      latestEventCreatedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(latestEventCreatedAt),
    ),
  ).toISOString();
}

async function recoverIncompleteManagedCandidateKnowledgeWrites(
  storage: SqliteStorage,
  root: string,
): Promise<ManagedCandidateKnowledgeWriteRecoveryReport> {
  const lease = currentCandidateKnowledgeWriterLease(root);
  const generation = lease.generation;
  const operations = await storage.listManagedCandidateKnowledgeWriteOperations();
  const entries: {
    readonly kind: ManagedCandidateKnowledgeWriteOperationRecord["kind"];
    readonly phase: ManagedCandidateKnowledgeWriteJournalPhase;
    readonly outcome: "aborted" | "completed" | "preserved";
  }[] = [];

  for (const operation of operations) {
    lease.assertCurrent();
    if (
      operation.latestPhase === "completed" ||
      operation.latestPhase === "aborted" ||
      operation.latestPhase === "noop"
    ) {
      continue;
    }
    const phase = operation.recoveryClaim?.phase ?? operation.latestPhase;
    if (!isManagedWriteJournalPhase(phase)) {
      entries.push({ kind: operation.kind, phase: "prepared", outcome: "preserved" });
      continue;
    }
    const owned =
      operation.ownerKind === managedCandidateKnowledgeWriteOwnerKind &&
      operation.ownerSchemaVersion === managedCandidateKnowledgeWriteOwnerSchemaVersion &&
      operation.ownerGeneration !== null &&
      operation.ownerGeneration !== undefined &&
      operation.requestedMediaType !== undefined &&
      operation.requestedChecksum !== undefined &&
      operation.requestedSizeBytes !== undefined;
    if (!owned || operation.ownerGeneration >= generation) {
      entries.push({ kind: operation.kind, phase, outcome: "preserved" });
      continue;
    }

    const targetVersionId = operation.targetVersionId ?? operation.requestedVersionId;
    const stagingPath = join(
      root,
      sourcesDirectory,
      `.intake-${managedPathSegment(operation.operationId)}`,
    );
    const targetPath = managedVersionPath(root, operation.sourceId, targetVersionId);
    const claimRecovery = async (): Promise<void> => {
      if (
        phase !== "prepared" &&
        phase !== "targeted" &&
        phase !== "published" &&
        phase !== "committed"
      ) {
        throw new StorageConflictError("Managed candidate knowledge recovery phase is invalid.");
      }
      lease.renew();
      await storage.claimManagedCandidateKnowledgeWriteRecovery(
        operation.operationId,
        phase,
        generation,
        managedWriteRecoveryTimestamp(operation.createdAt, operation.latestEventCreatedAt),
      );
      lease.assertCurrent();
    };
    await claimRecovery();
    const integrity = {
      checksum: operation.requestedChecksum,
      sizeBytes: operation.requestedSizeBytes,
    };
    const stagingObserved = await inspectManagedWriteRecoveryArtifact(stagingPath, integrity);
    const targetObserved = await inspectManagedWriteRecoveryArtifact(targetPath, integrity);
    if (operation.stagingIdentity === null) {
      if (
        phase !== "prepared" ||
        stagingObserved.status !== "missing" ||
        targetObserved.status !== "missing"
      ) {
        entries.push({ kind: operation.kind, phase, outcome: "preserved" });
        continue;
      }
      lease.renew();
      await storage.terminalizePreparedManagedCandidateKnowledgeWrite(
        operation.operationId,
        "aborted",
        targetVersionId,
        managedWriteRecoveryTimestamp(operation.createdAt, operation.latestEventCreatedAt),
        operation.ownerGeneration,
        generation,
      );
      lease.assertCurrent();
      entries.push({ kind: operation.kind, phase, outcome: "aborted" });
      continue;
    }
    const staging = requireManagedWriteRecoveryIdentity(stagingObserved, operation.stagingIdentity);
    const target = requireManagedWriteRecoveryIdentity(targetObserved, operation.stagingIdentity);

    if (phase === "committed") {
      if (staging.status === "preserved") {
        entries.push({ kind: operation.kind, phase, outcome: "preserved" });
        continue;
      }
      if (target.status !== "verified") {
        entries.push({ kind: operation.kind, phase, outcome: "preserved" });
        continue;
      }
      if (staging.status === "verified") {
        const removed = await removeManagedWriteRecoveryArtifact(lease, stagingPath, staging);
        if (!removed) {
          entries.push({ kind: operation.kind, phase, outcome: "preserved" });
          continue;
        }
      }
      lease.renew();
      await storage.terminalizePreparedManagedCandidateKnowledgeWrite(
        operation.operationId,
        "completed",
        targetVersionId,
        managedWriteRecoveryTimestamp(operation.createdAt, operation.latestEventCreatedAt),
        operation.ownerGeneration,
        generation,
      );
      lease.assertCurrent();
      entries.push({ kind: operation.kind, phase, outcome: "completed" });
      continue;
    }

    if (staging.status === "preserved" || target.status === "preserved") {
      entries.push({ kind: operation.kind, phase, outcome: "preserved" });
      continue;
    }
    if (
      target.status === "verified" &&
      !(await removeManagedWriteRecoveryArtifact(lease, targetPath, target))
    ) {
      entries.push({ kind: operation.kind, phase, outcome: "preserved" });
      continue;
    }
    if (!(await removeManagedWriteRecoveryArtifact(lease, stagingPath, staging))) {
      entries.push({ kind: operation.kind, phase, outcome: "preserved" });
      continue;
    }
    if (!(await removeEmptyManagedWriteSourceDirectory(root, lease, operation))) {
      entries.push({ kind: operation.kind, phase, outcome: "preserved" });
      continue;
    }
    lease.renew();
    await storage.terminalizePreparedManagedCandidateKnowledgeWrite(
      operation.operationId,
      "aborted",
      targetVersionId,
      managedWriteRecoveryTimestamp(operation.createdAt, operation.latestEventCreatedAt),
      operation.ownerGeneration,
      generation,
    );
    lease.assertCurrent();
    entries.push({ kind: operation.kind, phase, outcome: "aborted" });
  }
  return recoveryReport(entries);
}

type ManagedCandidateKnowledgeSourceVersion = ReturnType<
  SqliteStorage["listManagedCandidateKnowledgeSourceVersions"]
>[number];

async function verifyManagedCandidateKnowledgeFileVersions(
  versions: readonly ManagedCandidateKnowledgeSourceVersion[],
  root: string,
): Promise<void> {
  for (const version of versions) {
    if (version.kind !== "file" && version.kind !== "url") {
      throw new StorageValidationError(
        "Candidate knowledge store contains a managed version for an unsupported source.",
      );
    }
    const sourceDirectory = join(root, sourcesDirectory, managedPathSegment(version.sourceId));
    await requireDirectory(sourceDirectory, "Managed candidate knowledge source directory");
    await verifyManagedFile(managedVersionPath(root, version.sourceId, version.id), version);
  }
}

interface MutableManagedCandidateKnowledgeFileInventory {
  scannedEntryCount: number;
  scanLimitReached: boolean;
  readonly unknownEntries: {
    intakeShapedFilesAtSourcesRoot: number;
    opaqueEntriesAtSourcesRoot: number;
    entriesInsideManagedSourceDirectories: number;
    symbolicLinks: number;
    otherEntries: number;
  };
}

const intakeShapedFilename =
  /^\.intake-(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/;

function entryType(entry: Dirent): "directory" | "file" | "symbolic-link" | "other" {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (entry.isSymbolicLink()) return "symbolic-link";
  return "other";
}

async function scanManagedCandidateKnowledgeDirectory(
  path: string,
  inventory: MutableManagedCandidateKnowledgeFileInventory,
  inspect: (entry: Dirent, entryPath: string) => void,
): Promise<void> {
  if (inventory.scanLimitReached) return;
  const directory = await opendir(path);
  let closeError: unknown;
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      if (inventory.scannedEntryCount === maximumManagedCandidateKnowledgeInventoryEntries) {
        inventory.scanLimitReached = true;
        break;
      }
      inventory.scannedEntryCount += 1;
      inspect(entry, join(path, entry.name));
    }
  } finally {
    try {
      await directory.close();
    } catch (error) {
      if (errorCode(error) !== "ERR_DIR_CLOSED") closeError = error;
    }
  }
  if (closeError !== undefined) throw closeError;
}

async function inspectManagedCandidateKnowledgeFiles(
  storage: SqliteStorage,
  root: string,
): Promise<ManagedCandidateKnowledgeFileInventory> {
  const managedVersions = storage.listManagedCandidateKnowledgeSourceVersions();
  await verifyManagedCandidateKnowledgeFileVersions(managedVersions, root);

  const expectedFilesBySourceDirectory = new Map<string, Set<string>>();
  for (const version of managedVersions) {
    const sourceDirectory = managedPathSegment(version.sourceId);
    const expectedFiles = expectedFilesBySourceDirectory.get(sourceDirectory) ?? new Set<string>();
    expectedFiles.add(managedPathSegment(version.id));
    expectedFilesBySourceDirectory.set(sourceDirectory, expectedFiles);
  }

  const inventory: MutableManagedCandidateKnowledgeFileInventory = {
    scannedEntryCount: 0,
    scanLimitReached: false,
    unknownEntries: {
      intakeShapedFilesAtSourcesRoot: 0,
      opaqueEntriesAtSourcesRoot: 0,
      entriesInsideManagedSourceDirectories: 0,
      symbolicLinks: 0,
      otherEntries: 0,
    },
  };
  const observedManagedSourceDirectories: string[] = [];
  const sourcesRoot = join(root, sourcesDirectory);
  await scanManagedCandidateKnowledgeDirectory(sourcesRoot, inventory, (entry) => {
    if (entry.isSymbolicLink()) {
      inventory.unknownEntries.symbolicLinks += 1;
    } else if (entry.isFile()) {
      if (intakeShapedFilename.test(entry.name)) {
        inventory.unknownEntries.intakeShapedFilesAtSourcesRoot += 1;
      } else {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      }
    } else if (entry.isDirectory()) {
      if (expectedFilesBySourceDirectory.has(entry.name)) {
        observedManagedSourceDirectories.push(entry.name);
      } else {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      }
    } else {
      inventory.unknownEntries.otherEntries += 1;
    }
  });

  for (const sourceDirectory of observedManagedSourceDirectories) {
    if (inventory.scanLimitReached) break;
    const sourcePath = join(sourcesRoot, sourceDirectory);
    await requireDirectory(sourcePath, "Managed candidate knowledge source directory");
    const expectedFiles = expectedFilesBySourceDirectory.get(sourceDirectory) as Set<string>;
    await scanManagedCandidateKnowledgeDirectory(sourcePath, inventory, (entry) => {
      if (entry.isSymbolicLink()) {
        inventory.unknownEntries.symbolicLinks += 1;
      } else if (entry.isFile()) {
        if (!expectedFiles.has(entry.name)) {
          inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
        }
      } else if (entry.isDirectory()) {
        inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
      } else {
        inventory.unknownEntries.otherEntries += 1;
      }
    });
  }

  const unknownEntries = Object.freeze({ ...inventory.unknownEntries });
  return Object.freeze({
    schemaVersion: 1,
    verifiedManagedFileCount: managedVersions.length,
    scannedEntryCount: inventory.scannedEntryCount,
    unknownEntries,
    complete: !inventory.scanLimitReached,
    scanLimitReached: inventory.scanLimitReached,
  });
}

const portableBackupMaximumObjectCount = candidateKnowledgePortableBackupMaximumEntries;
const portableBackupMaximumKnowledgeBaseCount = candidateKnowledgePortableBackupMaximumEntries;
const portableBackupMaximumSourceCount = candidateKnowledgePortableBackupMaximumEntries;
const portableBackupMaximumVersionCount = candidateKnowledgePortableBackupMaximumEntries;
const portableBackupMaximumBytes = maximumDatabaseBytes;
const portableBackupRestoreMarkerFilename = ".draft-loop-restore.json";
const portableBackupRestoreReadyFilename = ".draft-loop-restore-ready.json";
const portableBackupRestoreMarkerSchemaVersion = 1 as const;

// A restore target and its deterministic staging directory are shared by
// callers that retry the same package. Keep same-process attempts serialized
// so one caller cannot publish or clean another caller's in-flight state.
const activePortableBackupRestoreOperations = new Set<string>();

function portableBackupFailure(): StorageValidationError {
  return new StorageValidationError(
    "Portable candidate knowledge backup is invalid or incomplete.",
  );
}

function portableBackupExportFailure(): StorageValidationError {
  return new StorageValidationError("Portable candidate knowledge backup export failed.");
}

function portableBackupRestoreFailure(): StorageValidationError {
  return new StorageValidationError("Portable candidate knowledge backup restore failed.");
}

interface PortableBackupRestoreMarker {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly manifestChecksum: string;
  readonly storeId: string;
  readonly destinationIdentity: string;
}

class SimulatedPortableBackupRestoreInterruption extends Error {
  public constructor(boundary: CandidateKnowledgePortableBackupRestoreInterruptionBoundary) {
    super(`Simulated portable candidate knowledge restore interruption at ${boundary}.`);
    this.name = "SimulatedPortableBackupRestoreInterruption";
  }
}

function restoreOperationIdentity(
  storeId: string,
  manifestChecksum: string,
  destination: string,
): {
  readonly operationId: string;
  readonly destinationIdentity: string;
} {
  const destinationIdentity = createHash("sha256").update(destination, "utf8").digest("hex");
  const operationId = createHash("sha256")
    .update(`${storeId}\u0000${manifestChecksum}\u0000${destinationIdentity}`, "utf8")
    .digest("hex");
  return { operationId, destinationIdentity };
}

function restoreMarker(
  storeId: string,
  manifestChecksum: string,
  destination: string,
): PortableBackupRestoreMarker {
  const identity = restoreOperationIdentity(storeId, manifestChecksum, destination);
  return {
    schemaVersion: portableBackupRestoreMarkerSchemaVersion,
    operationId: identity.operationId,
    manifestChecksum,
    storeId,
    destinationIdentity: identity.destinationIdentity,
  };
}

function parseRestoreMarker(value: unknown): PortableBackupRestoreMarker | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const marker = value as Record<string, unknown>;
  if (
    marker.schemaVersion !== portableBackupRestoreMarkerSchemaVersion ||
    typeof marker.operationId !== "string" ||
    !/^[0-9a-f]{64}$/.test(marker.operationId) ||
    typeof marker.manifestChecksum !== "string" ||
    !/^[0-9a-f]{64}$/.test(marker.manifestChecksum) ||
    typeof marker.storeId !== "string" ||
    marker.storeId.trim() === "" ||
    typeof marker.destinationIdentity !== "string" ||
    !/^[0-9a-f]{64}$/.test(marker.destinationIdentity)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    operationId: marker.operationId,
    manifestChecksum: marker.manifestChecksum,
    storeId: marker.storeId,
    destinationIdentity: marker.destinationIdentity,
  };
}

function sameRestoreMarker(
  first: PortableBackupRestoreMarker,
  second: PortableBackupRestoreMarker,
): boolean {
  return (
    first.schemaVersion === second.schemaVersion &&
    first.operationId === second.operationId &&
    first.manifestChecksum === second.manifestChecksum &&
    first.storeId === second.storeId &&
    first.destinationIdentity === second.destinationIdentity
  );
}

async function readRestoreMarker(path: string): Promise<PortableBackupRestoreMarker | undefined> {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isFile() || details.size > 4096) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch {
      return undefined;
    }
    return parseRestoreMarker(parsed);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function readPortableBackupRestoreReadiness(
  path: string,
  marker: PortableBackupRestoreMarker,
): Promise<boolean> {
  const readiness = await readRestoreMarker(path);
  return readiness !== undefined && sameRestoreMarker(readiness, marker);
}

async function readPortableRestoreDirectoryEntries(path: string): Promise<readonly Dirent[]> {
  const directory = await opendir(path);
  const entries: Dirent[] = [];
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      if (entries.length >= 16) {
        throw new StorageConflictError(
          "Portable candidate knowledge restore target already exists.",
        );
      }
      entries.push(entry);
    }
  } finally {
    await directory.close().catch((error: unknown) => {
      if (errorCode(error) !== "ERR_DIR_CLOSED") throw error;
    });
  }
  return entries;
}

async function interruptPortableBackupRestoreAt(
  options: CandidateKnowledgePortableBackupRestoreOptions,
  boundary: CandidateKnowledgePortableBackupRestoreInterruptionBoundary,
): Promise<void> {
  if (options.interruptAt === boundary) {
    throw new SimulatedPortableBackupRestoreInterruption(boundary);
  }
}

function portableBackupTimestamp(value: string | undefined): string {
  const candidate = value ?? new Date().toISOString();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) ||
    Number.isNaN(Date.parse(candidate)) ||
    Date.parse(candidate) > Date.now()
  ) {
    throw new StorageValidationError(
      "Portable candidate knowledge backup timestamp is invalid or in the future.",
    );
  }
  return candidate;
}

function validatePortableBackupManifestTimestamps(
  manifest: CandidateKnowledgePortableBackupManifest,
): void {
  const timestamps = [manifest.createdAt, manifest.descriptor.createdAt];
  for (const entry of manifest.knowledgeBases) {
    timestamps.push(
      entry.knowledgeBase.createdAt,
      entry.knowledgeBase.updatedAt,
      ...(entry.knowledgeBase.archivedAt === null ? [] : [entry.knowledgeBase.archivedAt]),
      entry.retentionPolicy.updatedAt,
    );
    for (const override of entry.retentionPolicy.activeOverrides) {
      timestamps.push(override.changedAt);
    }
    for (const source of entry.sources) {
      timestamps.push(source.createdAt);
      if (source.refreshObservation !== null) {
        timestamps.push(source.refreshObservation.checkedAt);
        if (source.refreshObservation.lastRefreshedAt !== null) {
          timestamps.push(source.refreshObservation.lastRefreshedAt);
        }
      }
      if (source.retirement !== null) timestamps.push(source.retirement.retiredAt);
      for (const version of source.versions) {
        timestamps.push(version.createdAt);
        if (version.urlProvenance !== undefined) {
          timestamps.push(version.urlProvenance.fetchedAt);
        }
      }
    }
  }
  if (timestamps.some((timestamp) => Date.parse(timestamp) > Date.now())) {
    throw portableBackupFailure();
  }
}

function portableBackupObjectName(checksum: string): string {
  return `${candidateKnowledgePortableBackupObjectsDirectory}/${checksum}.bin`;
}

function freezePortableBackupInspection(
  inspection: CandidateKnowledgePortableBackupInspection,
): CandidateKnowledgePortableBackupInspection {
  return Object.freeze({ ...inspection });
}

async function readPortableBackupDirectoryEntries(
  path: string,
  maximumEntries: number,
): Promise<readonly Dirent[]> {
  const directory = await opendir(path);
  const entries: Dirent[] = [];
  let closeError: unknown;
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      if (entries.length === maximumEntries) throw portableBackupFailure();
      entries.push(entry);
    }
  } finally {
    try {
      await directory.close();
    } catch (error) {
      if (errorCode(error) !== "ERR_DIR_CLOSED") closeError = error;
    }
  }
  if (closeError !== undefined) throw closeError;
  return entries;
}

function validatePortableBackupManifestBounds(
  manifest: CandidateKnowledgePortableBackupManifest,
): void {
  if (manifest.knowledgeBases.length > portableBackupMaximumKnowledgeBaseCount) {
    throw portableBackupFailure();
  }
  let sourceCount = 0;
  let versionCount = 0;
  for (const entry of manifest.knowledgeBases) {
    sourceCount += entry.sources.length;
    if (sourceCount > portableBackupMaximumSourceCount) throw portableBackupFailure();
    for (const source of entry.sources) {
      versionCount += source.versions.length;
      if (versionCount > portableBackupMaximumVersionCount) throw portableBackupFailure();
    }
  }
  if (manifest.contentObjects.length > portableBackupMaximumObjectCount) {
    throw portableBackupFailure();
  }
}

async function hashPortableBackupObject(path: string, expectedSize: number): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, sourceOpenFlags());
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedSize) throw portableBackupFailure();
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      sizeBytes += result.bytesRead;
      if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes) throw portableBackupFailure();
      digest.update(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat();
    if (!sameFileState(before, after) || sizeBytes !== expectedSize) throw portableBackupFailure();
    const checksum = digest.digest("hex");
    if (checksum.length !== 64) throw portableBackupFailure();
    return checksum;
  } catch (error) {
    if (error instanceof StorageValidationError) throw error;
    throw portableBackupFailure();
  } finally {
    await closeQuietly(handle);
  }
}

async function copyPortableBackupObject(
  sourcePath: string,
  targetPath: string,
  expectedChecksum: string,
  expectedSize: number,
): Promise<void> {
  let sourceHandle: FileHandle | undefined;
  let targetHandle: FileHandle | undefined;
  let targetIdentity: FileIdentity | undefined;
  let completed = false;
  try {
    sourceHandle = await open(sourcePath, sourceOpenFlags());
    const before = await sourceHandle.stat();
    if (!before.isFile() || before.size !== expectedSize) throw portableBackupRestoreFailure();
    targetHandle = await open(
      targetPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    const targetDetails = await targetHandle.stat();
    targetIdentity = { dev: targetDetails.dev, ino: targetDetails.ino };
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      const result = await sourceHandle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      sizeBytes += result.bytesRead;
      if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
        throw portableBackupRestoreFailure();
      }
      digest.update(buffer.subarray(0, result.bytesRead));
      let written = 0;
      while (written < result.bytesRead) {
        const writeResult = await targetHandle.write(buffer, written, result.bytesRead - written);
        if (writeResult.bytesWritten <= 0) throw portableBackupRestoreFailure();
        written += writeResult.bytesWritten;
      }
    }
    await targetHandle.sync();
    const after = await sourceHandle.stat();
    const checksum = digest.digest("hex");
    if (
      !sameFileState(before, after) ||
      sizeBytes !== expectedSize ||
      checksum !== expectedChecksum
    ) {
      throw portableBackupRestoreFailure();
    }
    completed = true;
  } catch (error) {
    if (error instanceof StorageValidationError) throw error;
    throw portableBackupRestoreFailure();
  } finally {
    await closeQuietly(targetHandle);
    await closeQuietly(sourceHandle);
    if (!completed && targetIdentity !== undefined) {
      await removeRegularFileIfIdentityMatches(targetPath, targetIdentity);
    }
  }
}

async function readPortableBackupManifest(packagePath: string): Promise<{
  readonly manifest: CandidateKnowledgePortableBackupManifest;
  readonly manifestChecksum: string;
}> {
  try {
    await requireDirectory(packagePath, "Portable candidate knowledge backup");
    const expectedTopLevel = new Set<string>([
      candidateKnowledgePortableBackupManifestFilename,
      candidateKnowledgePortableBackupManifestChecksumFilename,
      candidateKnowledgePortableBackupObjectsDirectory,
    ]);
    const entries = await readPortableBackupDirectoryEntries(packagePath, expectedTopLevel.size);
    if (
      entries.length !== expectedTopLevel.size ||
      entries.some((entry) => !expectedTopLevel.has(entry.name))
    ) {
      throw portableBackupFailure();
    }
    const manifestEntry = entries.find(
      (entry) => entry.name === candidateKnowledgePortableBackupManifestFilename,
    );
    const checksumEntry = entries.find(
      (entry) => entry.name === candidateKnowledgePortableBackupManifestChecksumFilename,
    );
    const objectsEntry = entries.find(
      (entry) => entry.name === candidateKnowledgePortableBackupObjectsDirectory,
    );
    if (
      manifestEntry === undefined ||
      checksumEntry === undefined ||
      objectsEntry === undefined ||
      manifestEntry.isSymbolicLink() ||
      checksumEntry.isSymbolicLink() ||
      objectsEntry.isSymbolicLink() ||
      !manifestEntry.isFile() ||
      !checksumEntry.isFile() ||
      !objectsEntry.isDirectory()
    ) {
      throw portableBackupFailure();
    }
    await requireRegularFile(
      join(packagePath, manifestEntry.name),
      "Portable candidate knowledge backup manifest",
      maximumPortableBackupManifestBytes,
    );
    await requireRegularFile(
      join(packagePath, checksumEntry.name),
      "Portable candidate knowledge backup checksum",
      128,
    );
    const manifestBytes = await readFile(join(packagePath, manifestEntry.name));
    const checksumBytes = await readFile(join(packagePath, checksumEntry.name));
    const manifestChecksum = createHash("sha256").update(manifestBytes).digest("hex");
    if (checksumBytes.toString("utf8") !== `${manifestChecksum}\n`) throw portableBackupFailure();
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      throw portableBackupFailure();
    }
    const manifest = candidateKnowledgePortableBackupManifestSchema.parse(parsed);
    validatePortableBackupManifestTimestamps(manifest);
    validatePortableBackupManifestBounds(manifest);
    return { manifest, manifestChecksum };
  } catch (error) {
    if (error instanceof StorageValidationError) throw error;
    throw portableBackupFailure();
  }
}

async function inspectPortableBackupPackage(
  packagePath: string,
): Promise<CandidateKnowledgePortableBackupInspection> {
  const { manifest, manifestChecksum } = await readPortableBackupManifest(packagePath);
  try {
    const objectsPath = join(packagePath, candidateKnowledgePortableBackupObjectsDirectory);
    const entries = await readPortableBackupDirectoryEntries(
      objectsPath,
      portableBackupMaximumObjectCount,
    );
    const expected = new Map(
      manifest.contentObjects.map((object) => [object.name.slice("objects/".length), object]),
    );
    if (
      entries.length !== expected.size ||
      entries.some(
        (entry) => entry.isSymbolicLink() || !entry.isFile() || !expected.has(entry.name),
      )
    ) {
      throw portableBackupFailure();
    }
    let contentBytes = 0;
    for (const [name, object] of expected) {
      if (!Number.isSafeInteger(contentBytes + object.sizeBytes)) throw portableBackupFailure();
      contentBytes += object.sizeBytes;
      if (contentBytes > portableBackupMaximumBytes) throw portableBackupFailure();
      const checksum = await hashPortableBackupObject(join(objectsPath, name), object.sizeBytes);
      if (checksum !== object.checksum) throw portableBackupFailure();
    }
    const sourceCount = manifest.knowledgeBases.reduce(
      (total, entry) => total + entry.sources.length,
      0,
    );
    const versionCount = manifest.knowledgeBases.reduce(
      (total, entry) =>
        total +
        entry.sources.reduce((sourceTotal, source) => sourceTotal + source.versions.length, 0),
      0,
    );
    return freezePortableBackupInspection(
      candidateKnowledgePortableBackupInspectionSchema.parse({
        format: candidateKnowledgePortableBackupFormat,
        schemaVersion: candidateKnowledgePortableBackupSchemaVersion,
        status: "valid",
        descriptorSchemaVersion: manifest.descriptor.schemaVersion,
        storeId: manifest.descriptor.id,
        createdAt: manifest.createdAt,
        manifestChecksum,
        knowledgeBaseCount: manifest.knowledgeBases.length,
        sourceCount,
        versionCount,
        contentObjectCount: manifest.contentObjects.length,
        contentBytes,
        integrity: candidateKnowledgePortableBackupIntegrityIndicator,
      }),
    );
  } catch (error) {
    if (error instanceof StorageValidationError) throw error;
    throw portableBackupFailure();
  }
}

export async function inspectCandidateKnowledgePortableBackup(
  packagePathInput: string,
): Promise<CandidateKnowledgePortableBackupInspection> {
  const packagePath = requiredPath(packagePathInput);
  try {
    return await inspectPortableBackupPackage(packagePath);
  } catch (error) {
    if (error instanceof StorageValidationError) throw error;
    throw portableBackupFailure();
  }
}

async function buildPortableBackupManifest(
  storage: SqliteStorage,
  descriptor: CandidateKnowledgeStoreDescriptor,
  root: string,
  createdAt: string,
): Promise<{
  readonly manifest: CandidateKnowledgePortableBackupManifest;
  readonly sourceFiles: readonly { readonly objectName: string; readonly sourcePath: string }[];
}> {
  const inventory = await inspectManagedCandidateKnowledgeFiles(storage, root);
  const unknownCount = Object.values(inventory.unknownEntries).reduce(
    (total, count) => total + count,
    0,
  );
  if (!inventory.complete || unknownCount !== 0) throw portableBackupFailure();
  const operations = await storage.listManagedCandidateKnowledgeWriteOperations();
  if (
    operations.some(
      (operation) => !["completed", "aborted", "noop"].includes(operation.latestPhase),
    )
  ) {
    throw portableBackupFailure();
  }
  const contentObjects = new Map<
    string,
    { readonly checksum: string; readonly sizeBytes: number }
  >();
  const sourceFiles: { readonly objectName: string; readonly sourcePath: string }[] = [];
  const knowledgeBases = [] as CandidateKnowledgePortableBackupManifest["knowledgeBases"][number][];
  const knowledgeBaseRecords = await storage.listCandidateKnowledgeBases();
  for (const knowledgeBase of knowledgeBaseRecords) {
    const sources =
      [] as CandidateKnowledgePortableBackupManifest["knowledgeBases"][number]["sources"];
    const sourceRecords = [...(await storage.listCandidateKnowledgeSources(knowledgeBase.id))].sort(
      (left, right) => left.id.localeCompare(right.id),
    );
    for (const source of sourceRecords) {
      const versions = [
        ...(await storage.listCandidateKnowledgeSourceVersions(knowledgeBase.id, source.id)),
      ].sort((left, right) => left.version - right.version || left.id.localeCompare(right.id));
      const portableVersions =
        [] as CandidateKnowledgePortableBackupManifest["knowledgeBases"][number]["sources"][number]["versions"];
      for (const version of versions) {
        if (
          !(await storage.isCandidateKnowledgeSourceVersionManaged(
            knowledgeBase.id,
            source.id,
            version.id,
          ))
        ) {
          throw portableBackupFailure();
        }
        const sourcePath = managedVersionPath(root, source.id, version.id);
        await verifyManagedFile(sourcePath, version);
        const objectName = portableBackupObjectName(version.checksum);
        const previous = contentObjects.get(objectName);
        if (previous !== undefined && previous.sizeBytes !== version.sizeBytes)
          throw portableBackupFailure();
        contentObjects.set(objectName, {
          checksum: version.checksum,
          sizeBytes: version.sizeBytes,
        });
        sourceFiles.push({ objectName, sourcePath });
        const provenance = await storage.getCandidateKnowledgeSourcePortableUrlProvenance(
          knowledgeBase.id,
          source.id,
          version.id,
        );
        portableVersions.push({
          ...version,
          contentObject: objectName,
          ...(provenance === undefined
            ? {}
            : { urlProvenance: { fetchedAt: provenance.fetchedAt, kind: provenance.kind } }),
        });
      }
      const refreshObservation = await storage.getCandidateKnowledgeSourceRefreshObservation(
        knowledgeBase.id,
        source.id,
      );
      const retirement = await storage.getCandidateKnowledgeSourceRetirement(
        knowledgeBase.id,
        source.id,
      );
      sources.push({
        ...source,
        versions: portableVersions,
        refreshObservation:
          refreshObservation === undefined
            ? null
            : {
                observedVersionId: refreshObservation.observedVersionId,
                status: refreshObservation.status,
                checkedAt: refreshObservation.checkedAt,
                lastRefreshedVersionId: refreshObservation.lastRefreshedVersionId,
                lastRefreshedAt: refreshObservation.lastRefreshedAt,
              },
        retirement:
          retirement === undefined
            ? null
            : { retiredAt: retirement.retiredAt, reason: retirement.reason },
      });
    }
    const policy = await storage.getCandidateKnowledgeRetentionPolicy(knowledgeBase.id);
    knowledgeBases.push({
      knowledgeBase: { ...knowledgeBase },
      sources,
      retentionPolicy: {
        revision: policy.revision,
        overrideRevision: policy.overrideRevision,
        updatedAt: policy.updatedAt,
        classes: policy.classes.map((entry) =>
          entry.rule === "expire-after-days"
            ? {
                class: entry.class,
                rule: entry.rule,
                expireAfterDays: entry.expireAfterDays as number,
              }
            : { class: entry.class, rule: entry.rule, expireAfterDays: null },
        ),
        activeOverrides: policy.activeOverrides.map((entry) => ({
          class: entry.class,
          kind: entry.kind,
          state: "applied" as const,
          sequence: entry.sequence,
          overrideRevision: entry.overrideRevision,
          policyRevision: entry.policyRevision,
          changedAt: entry.changedAt,
        })),
      },
    });
  }
  const manifest = candidateKnowledgePortableBackupManifestSchema.parse({
    format: candidateKnowledgePortableBackupFormat,
    schemaVersion: candidateKnowledgePortableBackupSchemaVersion,
    createdAt,
    descriptor: { ...descriptor },
    knowledgeBases,
    contentObjects: [...contentObjects.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, object]) => ({ name, ...object })),
  });
  validatePortableBackupManifestTimestamps(manifest);
  return { manifest, sourceFiles };
}

interface PortableBackupPublishedFile {
  readonly path: string;
  readonly identity: FileIdentity;
}

async function publishPortableBackupFile(
  lease: StorageWriterLease,
  sourcePath: string,
  destinationPath: string,
  publishedFiles: PortableBackupPublishedFile[],
): Promise<void> {
  const sourceDetails = await lstat(sourcePath);
  if (sourceDetails.isSymbolicLink() || !sourceDetails.isFile()) {
    throw portableBackupFailure();
  }
  const identity = { dev: sourceDetails.dev, ino: sourceDetails.ino };
  lease.renew();
  lease.assertCurrent();
  try {
    await link(sourcePath, destinationPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new StorageConflictError("Portable backup destination entry already exists.");
    }
    throw error;
  }
  publishedFiles.push({ path: destinationPath, identity });
  lease.assertCurrent();
}

async function cleanupPortableBackupPublication(
  destination: string,
  objectsPath: string,
  publishedFiles: readonly PortableBackupPublishedFile[],
  createdObjectsDirectory: boolean,
  createdDestination: boolean,
): Promise<void> {
  for (const published of [...publishedFiles].reverse()) {
    await removeRegularFileIfIdentityMatches(published.path, published.identity);
  }
  if (createdObjectsDirectory) {
    try {
      await rmdir(objectsPath);
    } catch {
      // Preserve concurrent or unrelated entries in the destination.
    }
  }
  if (createdDestination) {
    try {
      await rmdir(destination);
    } catch {
      // Preserve concurrent or unrelated entries in the destination.
    }
  }
}

async function exportPortableBackupPackage(
  storage: SqliteStorage,
  descriptor: CandidateKnowledgeStoreDescriptor,
  root: string,
  destinationInput: string,
  options: CandidateKnowledgePortableBackupExportOptions | undefined,
): Promise<CandidateKnowledgePortableBackupExportResult> {
  const lease = currentCandidateKnowledgeWriterLease(root);
  const destination = requiredPath(destinationInput);
  if (isWithin(root, destination)) throw portableBackupExportFailure();
  const parent = dirname(destination);
  const staging = join(parent, `.${basename(destination)}.draft-loop-backup-${randomUUID()}`);
  const objectsPath = join(destination, candidateKnowledgePortableBackupObjectsDirectory);
  const publishedFiles: PortableBackupPublishedFile[] = [];
  let createdStaging = false;
  let createdDestination = false;
  let createdObjectsDirectory = false;
  try {
    lease.renew();
    lease.assertCurrent();
    await requireDirectory(parent, "Portable candidate knowledge backup destination parent");
    if (isWithin(root, await realpath(parent))) throw portableBackupExportFailure();
    await requireAbsent(destination);
    await requireAbsent(staging);
    const createdAt = portableBackupTimestamp(options?.createdAt);
    const { manifest, sourceFiles } = await buildPortableBackupManifest(
      storage,
      descriptor,
      root,
      createdAt,
    );
    lease.renew();
    lease.assertCurrent();
    await mkdir(staging, { mode: 0o700 });
    createdStaging = true;
    await mkdir(join(staging, candidateKnowledgePortableBackupObjectsDirectory), { mode: 0o700 });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const manifestChecksum = createHash("sha256").update(manifestBytes).digest("hex");
    lease.renew();
    lease.assertCurrent();
    await writeFile(
      join(staging, candidateKnowledgePortableBackupManifestFilename),
      manifestBytes,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    lease.renew();
    lease.assertCurrent();
    await writeFile(
      join(staging, candidateKnowledgePortableBackupManifestChecksumFilename),
      `${manifestChecksum}\n`,
      { flag: "wx", mode: 0o600 },
    );
    const copied = new Set<string>();
    for (const sourceFile of sourceFiles) {
      if (copied.has(sourceFile.objectName)) continue;
      copied.add(sourceFile.objectName);
      lease.renew();
      lease.assertCurrent();
      await copyFile(
        sourceFile.sourcePath,
        join(staging, sourceFile.objectName),
        constants.COPYFILE_EXCL,
      );
      await chmodWhereSupported(join(staging, sourceFile.objectName), 0o600);
      lease.assertCurrent();
    }
    lease.renew();
    lease.assertCurrent();
    await inspectPortableBackupPackage(staging);
    lease.renew();
    lease.assertCurrent();
    try {
      await mkdir(destination, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) === "EEXIST")
        throw new StorageConflictError("Portable backup destination already exists.");
      throw error;
    }
    createdDestination = true;
    lease.assertCurrent();
    await mkdir(objectsPath, { mode: 0o700 });
    createdObjectsDirectory = true;
    lease.assertCurrent();
    await options?.beforePublication?.();
    for (const object of manifest.contentObjects) {
      await publishPortableBackupFile(
        lease,
        join(staging, object.name),
        join(
          objectsPath,
          object.name.slice(`${candidateKnowledgePortableBackupObjectsDirectory}/`.length),
        ),
        publishedFiles,
      );
    }
    await publishPortableBackupFile(
      lease,
      join(staging, candidateKnowledgePortableBackupManifestChecksumFilename),
      join(destination, candidateKnowledgePortableBackupManifestChecksumFilename),
      publishedFiles,
    );
    lease.renew();
    lease.assertCurrent();
    await publishPortableBackupFile(
      lease,
      join(staging, candidateKnowledgePortableBackupManifestFilename),
      join(destination, candidateKnowledgePortableBackupManifestFilename),
      publishedFiles,
    );
    lease.assertCurrent();
    const publishedInspection = await inspectPortableBackupPackage(destination);
    lease.renew();
    lease.assertCurrent();
    try {
      await rm(staging, { recursive: true, force: true });
      createdStaging = false;
    } catch {
      // Preserve the primary export/publication failure.
    }
    lease.assertCurrent();
    return Object.freeze({ ...publishedInspection, status: "exported" });
  } catch (error) {
    await cleanupPortableBackupPublication(
      destination,
      objectsPath,
      publishedFiles,
      createdObjectsDirectory,
      createdDestination,
    );
    if (createdStaging) {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch {
        // Preserve the primary export/publication failure.
      }
    }
    if (error instanceof StorageConflictError) throw error;
    if (error instanceof StorageValidationError) throw error;
    if (error instanceof StorageWriterLeaseError) throw error;
    throw portableBackupExportFailure();
  }
}

export async function exportCandidateKnowledgePortableBackup(
  rootInput: string,
  destinationInput: string,
  options: CandidateKnowledgePortableBackupExportOptions = {},
  expectedStoreId?: string,
): Promise<CandidateKnowledgePortableBackupExportResult> {
  const requestedRoot = requiredPath(rootInput);
  await requireDirectory(requestedRoot, "Candidate knowledge store root");
  const root = await realpath(requestedRoot);
  const descriptor = await readDescriptor(root);
  if (
    expectedStoreId !== undefined &&
    descriptor.id !== requiredManagedText(expectedStoreId, "store id")
  ) {
    throw new StorageConflictError(
      "Candidate knowledge store identity does not match the request.",
    );
  }
  const internalRoot = join(root, privateDirectory);
  const managedSources = join(root, sourcesDirectory);
  await requireDirectory(internalRoot, "Candidate knowledge store private directory");
  await requireDirectory(managedSources, "Candidate knowledge store sources directory");
  const databasePath = join(internalRoot, databaseFilename);
  await requireRegularFile(
    databasePath,
    "Candidate knowledge store database",
    maximumDatabaseBytes,
  );
  let storage: SqliteStorage | undefined;
  try {
    return await withCandidateKnowledgeStoreWriterLease(
      root,
      "ckb-portable-backup-export",
      async () => {
        const readOnlyStorage = openSqliteStorageReadOnly(databasePath);
        storage = readOnlyStorage;
        try {
          await validateOpenedStore(readOnlyStorage, descriptor);
          await validateManagedCandidateKnowledgeFiles(readOnlyStorage, root);
          return await exportPortableBackupPackage(
            readOnlyStorage,
            descriptor,
            root,
            destinationInput,
            options,
          );
        } finally {
          await closePreservingFailure(storage);
          storage = undefined;
        }
      },
    );
  } catch (error) {
    if (storage !== undefined) {
      await closePreservingFailure(storage);
      storage = undefined;
    }
    throw error;
  }
}

interface PortableBackupRestorePublishedFile {
  readonly path: string;
  readonly identity: FileIdentity;
}

interface PortableBackupRestoreCreatedDirectory {
  readonly path: string;
  readonly identity: FileIdentity;
}

async function publishPortableBackupRestoreFile(
  sourcePath: string,
  destinationPath: string,
  publishedFiles: PortableBackupRestorePublishedFile[],
): Promise<void> {
  const sourceDetails = await lstat(sourcePath);
  if (sourceDetails.isSymbolicLink() || !sourceDetails.isFile()) {
    throw portableBackupRestoreFailure();
  }
  try {
    const destinationDetails = await lstat(destinationPath);
    if (destinationDetails.isSymbolicLink() || !destinationDetails.isFile()) {
      throw new StorageConflictError("Portable candidate knowledge restore target already exists.");
    }
    if (
      destinationDetails.dev !== sourceDetails.dev ||
      destinationDetails.ino !== sourceDetails.ino
    ) {
      throw new StorageConflictError("Portable candidate knowledge restore target already exists.");
    }
    return;
  } catch (error) {
    if (error instanceof StorageConflictError) throw error;
    if (!isMissing(error)) throw error;
  }
  try {
    await link(sourcePath, destinationPath);
    publishedFiles.push({
      path: destinationPath,
      identity: { dev: sourceDetails.dev, ino: sourceDetails.ino },
    });
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new StorageConflictError("Portable candidate knowledge restore target already exists.");
    }
    throw error;
  }
}

async function cleanupPortableBackupRestorePublication(
  publishedFiles: readonly PortableBackupRestorePublishedFile[],
  createdPrivateDirectory: PortableBackupRestoreCreatedDirectory | undefined,
  createdSourcesDirectory: PortableBackupRestoreCreatedDirectory | undefined,
  createdSourceDirectories: readonly PortableBackupRestoreCreatedDirectory[],
  createdDestination: PortableBackupRestoreCreatedDirectory | undefined,
): Promise<void> {
  for (const published of [...publishedFiles].reverse()) {
    await removeRegularFileIfIdentityMatches(published.path, published.identity);
  }
  for (const createdSourceDirectory of [...createdSourceDirectories].reverse()) {
    await removeEmptyDirectoryIfIdentityMatches(
      createdSourceDirectory.path,
      createdSourceDirectory.identity,
    );
  }
  if (createdSourcesDirectory !== undefined) {
    await removeEmptyDirectoryIfIdentityMatches(
      createdSourcesDirectory.path,
      createdSourcesDirectory.identity,
    );
  }
  if (createdPrivateDirectory !== undefined) {
    await removeEmptyDirectoryIfIdentityMatches(
      createdPrivateDirectory.path,
      createdPrivateDirectory.identity,
    );
  }
  if (createdDestination !== undefined) {
    await removeEmptyDirectoryIfIdentityMatches(
      createdDestination.path,
      createdDestination.identity,
    );
  }
}

async function cleanupPortableBackupRestoreStaging(
  staging: string,
  stagingIdentity: FileIdentity,
  manifest: CandidateKnowledgePortableBackupManifest,
): Promise<void> {
  const files = [
    join(staging, portableBackupRestoreMarkerFilename),
    join(staging, portableBackupRestoreReadyFilename),
    join(staging, manifestFilename),
    join(staging, privateDirectory, databaseFilename),
    join(staging, privateDirectory, `${databaseFilename}-wal`),
    join(staging, privateDirectory, `${databaseFilename}-shm`),
  ];
  const directories = [
    ...manifest.knowledgeBases.flatMap((entry) =>
      entry.sources.map((source) => join(staging, sourcesDirectory, managedPathSegment(source.id))),
    ),
    join(staging, sourcesDirectory),
    join(staging, privateDirectory),
    staging,
  ];
  for (const entry of manifest.knowledgeBases) {
    for (const source of entry.sources) {
      for (const version of source.versions) {
        files.push(
          join(
            staging,
            sourcesDirectory,
            managedPathSegment(source.id),
            managedPathSegment(version.id),
          ),
        );
      }
    }
  }
  for (const path of files) {
    try {
      const details = await lstat(path);
      if (details.isSymbolicLink() || !details.isFile()) continue;
      await removeRegularFileIfIdentityMatches(path, {
        dev: details.dev,
        ino: details.ino,
      });
    } catch {
      // Preserve unknown or concurrently replaced entries.
    }
  }
  for (const path of [...directories].reverse()) {
    try {
      const details = await lstat(path);
      if (details.isSymbolicLink() || !details.isDirectory()) continue;
      const identity = { dev: details.dev, ino: details.ino };
      if (path === staging) {
        if (identity.dev !== stagingIdentity.dev || identity.ino !== stagingIdentity.ino) {
          continue;
        }
      }
      await removeEmptyDirectoryIfIdentityMatches(path, identity);
    } catch {
      // Preserve unknown or concurrently replaced entries.
    }
  }
}

async function buildPortableBackupRestoreStaging(
  packagePath: string,
  staging: string,
  marker: PortableBackupRestoreMarker,
  manifest: CandidateKnowledgePortableBackupManifest,
  operationId: string,
  manifestChecksum: string,
  options: CandidateKnowledgePortableBackupRestoreOptions,
): Promise<FileIdentity> {
  let stagingIdentity: FileIdentity | undefined;
  try {
    await mkdir(staging, { mode: 0o700 });
    const stagingDetails = await lstat(staging);
    if (stagingDetails.isSymbolicLink() || !stagingDetails.isDirectory()) {
      throw portableBackupRestoreFailure();
    }
    stagingIdentity = { dev: stagingDetails.dev, ino: stagingDetails.ino };
    await writeFile(
      join(staging, portableBackupRestoreMarkerFilename),
      `${JSON.stringify(marker)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await mkdir(join(staging, privateDirectory), { mode: 0o700 });
    await mkdir(join(staging, sourcesDirectory), { mode: 0o700 });
    await writeFile(
      join(staging, manifestFilename),
      `${JSON.stringify(manifest.descriptor, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    const databasePath = join(staging, privateDirectory, databaseFilename);
    let storage: SqliteStorage | undefined;
    try {
      storage = openSqliteStorage(databasePath);
      await persistDescriptorBinding(storage, manifest.descriptor);
      await options.beforeImport?.();
      await interruptPortableBackupRestoreAt(options, "import");
      await storage.importCandidateKnowledgePortableBackup({
        manifest,
        operationId,
        manifestChecksum,
        restoredAt: options.restoredAt ?? new Date().toISOString(),
      });
      await interruptPortableBackupRestoreAt(options, "commit");
    } finally {
      if (storage !== undefined) await closePreservingFailure(storage);
    }

    for (const entry of manifest.knowledgeBases) {
      for (const source of entry.sources) {
        const sourceDirectory = join(staging, sourcesDirectory, managedPathSegment(source.id));
        await mkdir(sourceDirectory, { mode: 0o700 });
        for (const version of source.versions) {
          await interruptPortableBackupRestoreAt(options, "staging");
          const sourceObject = join(packagePath, version.contentObject);
          const targetVersion = join(sourceDirectory, managedPathSegment(version.id));
          await copyPortableBackupObject(
            sourceObject,
            targetVersion,
            version.checksum,
            version.sizeBytes,
          );
          await chmodWhereSupported(targetVersion, 0o600);
          await verifyManagedFile(targetVersion, version);
        }
      }
    }
    const readOnlyStorage = openSqliteStorageReadOnly(databasePath);
    try {
      await validateOpenedStore(readOnlyStorage, manifest.descriptor);
      await validateManagedCandidateKnowledgeFiles(readOnlyStorage, staging);
    } finally {
      await closePreservingFailure(readOnlyStorage);
    }
    await chmodWhereSupported(join(staging, privateDirectory), 0o700);
    await chmodWhereSupported(join(staging, sourcesDirectory), 0o700);
    await chmodWhereSupported(staging, 0o700);
    await writeFile(
      join(staging, portableBackupRestoreReadyFilename),
      `${JSON.stringify(marker)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return stagingIdentity;
  } catch (error) {
    if (stagingIdentity !== undefined) {
      await cleanupPortableBackupRestoreStaging(staging, stagingIdentity, manifest);
    }
    throw error;
  }
}

async function restorePortableBackupPackage(
  packagePath: string,
  destinationInput: string,
  options: CandidateKnowledgePortableBackupRestoreOptions,
): Promise<CandidateKnowledgePortableBackupRestoreResult> {
  const packageInspection = await inspectPortableBackupPackage(packagePath);
  const { manifest, manifestChecksum } = await readPortableBackupManifest(packagePath);
  if (packageInspection.manifestChecksum !== manifestChecksum) throw portableBackupFailure();
  const destination = requiredPath(destinationInput);
  if (isWithin(packagePath, destination)) throw portableBackupRestoreFailure();
  const parent = dirname(destination);
  await requireDirectory(parent, "Portable candidate knowledge restore destination parent");
  if (isWithin(packagePath, await realpath(parent))) throw portableBackupRestoreFailure();
  const marker = restoreMarker(manifest.descriptor.id, manifestChecksum, destination);
  const staging = join(
    parent,
    `.${basename(destination)}.draft-loop-restore-${marker.operationId}`,
  );
  const markerName = portableBackupRestoreMarkerFilename;
  const claimPath = join(
    parent,
    `.${basename(destination)}.draft-loop-restore-claim-${marker.operationId}`,
  );
  const destinationMarkerPath = join(destination, markerName);
  const stagingMarkerPath = join(staging, markerName);
  const targetPrivatePath = join(destination, privateDirectory);
  const targetSourcesPath = join(destination, sourcesDirectory);
  const publishedFiles: PortableBackupRestorePublishedFile[] = [];
  let createdDestination: PortableBackupRestoreCreatedDirectory | undefined;
  let createdPrivateDirectory: PortableBackupRestoreCreatedDirectory | undefined;
  let createdSourcesDirectory: PortableBackupRestoreCreatedDirectory | undefined;
  const createdSourceDirectories: PortableBackupRestoreCreatedDirectory[] = [];
  let stagingIdentity: FileIdentity | undefined;
  let createdStaging = false;
  let manifestPublished = false;
  let preserveOwnedState = false;
  if (activePortableBackupRestoreOperations.has(marker.operationId)) {
    throw new StorageConflictError("Portable candidate knowledge restore is already in progress.");
  }
  activePortableBackupRestoreOperations.add(marker.operationId);
  let destinationExists = false;
  let destinationIdentity: FileIdentity | undefined;
  let destinationMarkerIdentity: FileIdentity | undefined;
  let claimIdentity: FileIdentity | undefined;
  try {
    try {
      try {
        const destinationDetails = await lstat(destination);
        destinationExists = true;
        if (destinationDetails.isSymbolicLink() || !destinationDetails.isDirectory()) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore target already exists.",
          );
        }
        let completeManifestPresent = false;
        try {
          await lstat(join(destination, manifestFilename));
          completeManifestPresent = true;
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        if (completeManifestPresent) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore target already exists.",
          );
        }
        const existingMarker = await readRestoreMarker(destinationMarkerPath);
        if (existingMarker !== undefined && sameRestoreMarker(existingMarker, marker)) {
          const markerDetails = await lstat(destinationMarkerPath);
          destinationMarkerIdentity = {
            dev: markerDetails.dev,
            ino: markerDetails.ino,
          };
          preserveOwnedState = true;
        } else if (existingMarker !== undefined || destinationExists) {
          // A pre-existing directory is adoptable only with the exact operation
          // marker and a later claim check. Unknown partial state is preserved.
          if (destinationExists) {
            const entries = await readPortableRestoreDirectoryEntries(destination);
            if (entries.length !== 0) {
              throw new StorageConflictError(
                "Portable candidate knowledge restore target already exists.",
              );
            }
          }
        }
        if (destinationExists) {
          const destinationDetails = await lstat(destination);
          destinationIdentity = {
            dev: destinationDetails.dev,
            ino: destinationDetails.ino,
          };
        }
      } catch (error) {
        if (error instanceof StorageConflictError) throw error;
        if (!isMissing(error)) throw error;
      }

      let stagingReady = false;
      try {
        const stagingDetails = await lstat(staging);
        if (stagingDetails.isSymbolicLink() || !stagingDetails.isDirectory()) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore staging is invalid.",
          );
        }
        stagingIdentity = { dev: stagingDetails.dev, ino: stagingDetails.ino };
        const existingMarker = await readRestoreMarker(stagingMarkerPath);
        if (existingMarker === undefined || !sameRestoreMarker(existingMarker, marker)) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore staging is not owned.",
          );
        }
        if (
          !(await readPortableBackupRestoreReadiness(
            join(staging, portableBackupRestoreReadyFilename),
            marker,
          ))
        ) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore staging is still in progress.",
          );
        }
        stagingReady = true;
      } catch (error) {
        if (error instanceof StorageConflictError) throw error;
        if (!isMissing(error)) throw error;
      }
      if (!stagingReady) {
        await requireAbsent(staging);
        stagingIdentity = await buildPortableBackupRestoreStaging(
          packagePath,
          staging,
          marker,
          manifest,
          marker.operationId,
          manifestChecksum,
          options,
        );
        createdStaging = true;
      } else {
        let stagingIsValid = true;
        try {
          const stagedStorage = openSqliteStorageReadOnly(
            join(staging, privateDirectory, databaseFilename),
          );
          try {
            await validateOpenedStore(stagedStorage, manifest.descriptor);
            await validateManagedCandidateKnowledgeFiles(stagedStorage, staging);
          } finally {
            await closePreservingFailure(stagedStorage);
          }
        } catch {
          stagingIsValid = false;
        }
        if (!stagingIsValid) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore staging is invalid.",
          );
        }
      }
      await options.beforePublication?.();
      await interruptPortableBackupRestoreAt(options, "target-publication");

      if (stagingIdentity === undefined) {
        throw new StorageConflictError(
          "Portable candidate knowledge restore staging is unavailable.",
        );
      }
      await requireDirectoryIdentity(staging, stagingIdentity);
      const stagingMarkerDetails = await lstat(stagingMarkerPath);
      if (stagingMarkerDetails.isSymbolicLink() || !stagingMarkerDetails.isFile()) {
        throw new StorageConflictError("Portable candidate knowledge restore staging is invalid.");
      }
      const stagingMarkerIdentity: FileIdentity = {
        dev: stagingMarkerDetails.dev,
        ino: stagingMarkerDetails.ino,
      };
      if (
        destinationMarkerIdentity !== undefined &&
        (destinationMarkerIdentity.dev !== stagingMarkerIdentity.dev ||
          destinationMarkerIdentity.ino !== stagingMarkerIdentity.ino)
      ) {
        throw new StorageConflictError(
          "Portable candidate knowledge restore target marker is not owned.",
        );
      }
      try {
        const claimDetails = await lstat(claimPath);
        if (claimDetails.isSymbolicLink() || !claimDetails.isFile()) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore publication claim already exists.",
          );
        }
        const claimMarker = await readRestoreMarker(claimPath);
        if (
          claimMarker === undefined ||
          !sameRestoreMarker(claimMarker, marker) ||
          claimDetails.dev !== stagingMarkerIdentity.dev ||
          claimDetails.ino !== stagingMarkerIdentity.ino
        ) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore publication claim is not owned.",
          );
        }
        claimIdentity = { dev: claimDetails.dev, ino: claimDetails.ino };
      } catch (error) {
        if (error instanceof StorageConflictError) throw error;
        if (!isMissing(error)) throw error;
        if (destinationExists) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore target already exists.",
          );
        }
        const publishedCount = publishedFiles.length;
        await publishPortableBackupRestoreFile(stagingMarkerPath, claimPath, publishedFiles);
        if (publishedFiles.length === publishedCount) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore publication claim is already in use.",
          );
        }
        claimIdentity = stagingMarkerIdentity;
      }
      if (!destinationExists) {
        try {
          await mkdir(destination, { mode: 0o700 });
          const destinationDetails = await lstat(destination);
          if (destinationDetails.isSymbolicLink() || !destinationDetails.isDirectory()) {
            throw new StorageConflictError(
              "Portable candidate knowledge restore target already exists.",
            );
          }
          destinationIdentity = {
            dev: destinationDetails.dev,
            ino: destinationDetails.ino,
          };
          createdDestination = { path: destination, identity: destinationIdentity };
        } catch (error) {
          if (errorCode(error) === "EEXIST") {
            throw new StorageConflictError(
              "Portable candidate knowledge restore target already exists.",
            );
          }
          throw error;
        }
      }
      await interruptPortableBackupRestoreAt(options, "destination-claim");
      if (destinationIdentity === undefined || claimIdentity === undefined) {
        throw new StorageConflictError(
          "Portable candidate knowledge restore target is unavailable.",
        );
      }
      await requireDirectoryIdentity(destination, destinationIdentity);
      if (!preserveOwnedState) {
        await publishPortableBackupRestoreFile(
          stagingMarkerPath,
          destinationMarkerPath,
          publishedFiles,
        );
        preserveOwnedState = true;
      }
      try {
        await mkdir(targetPrivatePath, { mode: 0o700 });
        const privateDetails = await lstat(targetPrivatePath);
        if (privateDetails.isSymbolicLink() || !privateDetails.isDirectory()) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore private directory is invalid.",
          );
        }
        createdPrivateDirectory = {
          path: targetPrivatePath,
          identity: { dev: privateDetails.dev, ino: privateDetails.ino },
        };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        await requireDirectory(
          targetPrivatePath,
          "Portable candidate knowledge restore private directory",
        );
      }
      try {
        await mkdir(targetSourcesPath, { mode: 0o700 });
        const sourcesDetails = await lstat(targetSourcesPath);
        if (sourcesDetails.isSymbolicLink() || !sourcesDetails.isDirectory()) {
          throw new StorageConflictError(
            "Portable candidate knowledge restore sources directory is invalid.",
          );
        }
        createdSourcesDirectory = {
          path: targetSourcesPath,
          identity: { dev: sourcesDetails.dev, ino: sourcesDetails.ino },
        };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        await requireDirectory(
          targetSourcesPath,
          "Portable candidate knowledge restore sources directory",
        );
      }
      await publishPortableBackupRestoreFile(
        join(staging, privateDirectory, databaseFilename),
        join(targetPrivatePath, databaseFilename),
        publishedFiles,
      );
      for (const entry of manifest.knowledgeBases) {
        for (const source of entry.sources) {
          const sourceDirectory = join(targetSourcesPath, managedPathSegment(source.id));
          try {
            await mkdir(sourceDirectory, { mode: 0o700 });
            const sourceDirectoryDetails = await lstat(sourceDirectory);
            if (sourceDirectoryDetails.isSymbolicLink() || !sourceDirectoryDetails.isDirectory()) {
              throw new StorageConflictError(
                "Portable candidate knowledge restore source directory is invalid.",
              );
            }
            createdSourceDirectories.push({
              path: sourceDirectory,
              identity: { dev: sourceDirectoryDetails.dev, ino: sourceDirectoryDetails.ino },
            });
          } catch (error) {
            if (errorCode(error) !== "EEXIST") throw error;
            await requireDirectory(
              sourceDirectory,
              "Portable candidate knowledge restore source directory",
            );
          }
          for (const version of source.versions) {
            await publishPortableBackupRestoreFile(
              join(
                staging,
                sourcesDirectory,
                managedPathSegment(source.id),
                managedPathSegment(version.id),
              ),
              join(sourceDirectory, managedPathSegment(version.id)),
              publishedFiles,
            );
          }
        }
      }
      const targetStorage = openSqliteStorageReadOnly(join(targetPrivatePath, databaseFilename));
      try {
        await validateOpenedStore(targetStorage, manifest.descriptor);
        await validateManagedCandidateKnowledgeFiles(targetStorage, destination);
      } finally {
        await closePreservingFailure(targetStorage);
      }
      await interruptPortableBackupRestoreAt(options, "manifest-publication");
      await publishPortableBackupRestoreFile(
        join(staging, manifestFilename),
        join(destination, manifestFilename),
        publishedFiles,
      );
      manifestPublished = true;
      await interruptPortableBackupRestoreAt(options, "after-manifest-publication");
      const markerPublication = publishedFiles.find(
        (published) => published.path === destinationMarkerPath,
      );
      if (markerPublication !== undefined) {
        await removeRegularFileIfIdentityMatches(
          markerPublication.path,
          markerPublication.identity,
        );
      }
      const claimPublication = publishedFiles.find((published) => published.path === claimPath);
      if (claimPublication !== undefined) {
        await removeRegularFileIfIdentityMatches(claimPublication.path, claimPublication.identity);
      }
      if (createdStaging && stagingIdentity !== undefined) {
        await cleanupPortableBackupRestoreStaging(staging, stagingIdentity, manifest);
        createdStaging = false;
      }
      return candidateKnowledgePortableBackupRestoreResultSchema.parse({
        status: "restored",
        format: packageInspection.format,
        schemaVersion: packageInspection.schemaVersion,
        storeId: packageInspection.storeId,
        manifestChecksum: packageInspection.manifestChecksum,
        knowledgeBaseCount: packageInspection.knowledgeBaseCount,
        sourceCount: packageInspection.sourceCount,
        versionCount: packageInspection.versionCount,
        contentObjectCount: packageInspection.contentObjectCount,
        contentBytes: packageInspection.contentBytes,
        integrity: packageInspection.integrity,
      });
    } catch (error) {
      if (error instanceof SimulatedPortableBackupRestoreInterruption) throw error;
      if (manifestPublished) {
        for (const published of publishedFiles.filter(
          (entry) => entry.path === destinationMarkerPath || entry.path === claimPath,
        )) {
          try {
            await removeRegularFileIfIdentityMatches(published.path, published.identity);
          } catch {
            // The manifest is the commit point; cleanup is best effort.
          }
        }
        if (createdStaging && stagingIdentity !== undefined) {
          try {
            await cleanupPortableBackupRestoreStaging(staging, stagingIdentity, manifest);
          } catch {
            // The manifest is the commit point; cleanup is best effort.
          }
        }
        return candidateKnowledgePortableBackupRestoreResultSchema.parse({
          status: "restored",
          format: packageInspection.format,
          schemaVersion: packageInspection.schemaVersion,
          storeId: packageInspection.storeId,
          manifestChecksum: packageInspection.manifestChecksum,
          knowledgeBaseCount: packageInspection.knowledgeBaseCount,
          sourceCount: packageInspection.sourceCount,
          versionCount: packageInspection.versionCount,
          contentObjectCount: packageInspection.contentObjectCount,
          contentBytes: packageInspection.contentBytes,
          integrity: packageInspection.integrity,
        });
      }
      await cleanupPortableBackupRestorePublication(
        publishedFiles,
        createdPrivateDirectory,
        createdSourcesDirectory,
        createdSourceDirectories,
        createdDestination,
      );
      if (createdStaging && stagingIdentity !== undefined) {
        await cleanupPortableBackupRestoreStaging(staging, stagingIdentity, manifest);
        createdStaging = false;
      }
      if (error instanceof StorageConflictError) throw error;
      if (error instanceof StorageValidationError) throw error;
      throw portableBackupRestoreFailure();
    }
  } finally {
    activePortableBackupRestoreOperations.delete(marker.operationId);
  }
}

export async function restoreCandidateKnowledgePortableBackup(
  packagePathInput: string,
  destinationInput: string,
  options: CandidateKnowledgePortableBackupRestoreOptions = {},
): Promise<CandidateKnowledgePortableBackupRestoreResult> {
  const parsed = candidateKnowledgePortableBackupRestoreOptionsSchema.safeParse({
    collision: options.collision,
  });
  if (!parsed.success)
    throw new StorageValidationError("Portable candidate knowledge restore options are invalid.");
  const packagePath = requiredPath(packagePathInput);
  await requireDirectory(packagePath, "Portable candidate knowledge backup");
  const canonicalPackagePath = await realpath(packagePath);
  return restorePortableBackupPackage(canonicalPackagePath, destinationInput, options);
}

function requiredRetentionPlanTimestamp(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new StorageValidationError(`${label} must be a valid ISO timestamp.`);
  }
  if (Date.parse(value) > Date.now()) {
    throw new StorageValidationError(`${label} must not be in the future.`);
  }
  return value;
}

function freezeCandidateKnowledgeRetentionPlan(
  plan: CandidateKnowledgeRetentionPlan,
): CandidateKnowledgeRetentionPlan {
  return Object.freeze({
    ...plan,
    classes: Object.freeze(
      plan.classes.map((entry) =>
        Object.freeze({
          ...entry,
          preservationReasons: Object.freeze([...entry.preservationReasons]),
        }),
      ),
    ),
  });
}

function boundedRetentionPlanCount(value: number): {
  readonly count: number;
  readonly capped: boolean;
} {
  if (value <= 1_024) return { count: value, capped: false };
  return { count: 1_024, capped: true };
}

async function planCandidateKnowledgeRetention(
  storage: SqliteStorage,
  root: string,
  knowledgeBaseIdInput: string,
  asOfInput: string,
): Promise<CandidateKnowledgeRetentionPlan> {
  const knowledgeBaseId = requiredManagedText(
    knowledgeBaseIdInput,
    "Candidate knowledge retention knowledge base id",
  );
  const asOf = requiredRetentionPlanTimestamp(asOfInput, "Candidate knowledge retention plan asOf");
  const policy = await storage.getCandidateKnowledgeRetentionPolicyAtAsOf(knowledgeBaseId, asOf);

  const managedVersions = storage
    .listManagedCandidateKnowledgeSourceVersions()
    .filter(
      (version) =>
        version.knowledgeBaseId === knowledgeBaseId &&
        Date.parse(version.createdAt) <= Date.parse(asOf),
    );
  const managedKeys = new Set(
    managedVersions.map((version) => `${version.sourceId}\u0000${version.id}`),
  );
  const sources = await storage.listCandidateKnowledgeSources(knowledgeBaseId);
  const unmanagedVersions: CandidateKnowledgeSourceVersionRecord[] = [];
  for (const source of sources) {
    const versions = await storage.listCandidateKnowledgeSourceVersions(knowledgeBaseId, source.id);
    for (const version of versions) {
      if (Date.parse(version.createdAt) > Date.parse(asOf)) continue;
      if (!managedKeys.has(`${version.sourceId}\u0000${version.id}`)) {
        unmanagedVersions.push(version);
      }
    }
  }
  const inventory = await inspectManagedCandidateKnowledgeFiles(storage, root);
  const unknownTotal = Object.values(inventory.unknownEntries).reduce(
    (total, count) => total + count,
    0,
  );
  const boundedUnmanaged = boundedRetentionPlanCount(unmanagedVersions.length);
  const boundedUnknown = boundedRetentionPlanCount(unknownTotal);
  const commonCapped =
    boundedUnmanaged.capped || boundedUnknown.capped || inventory.scanLimitReached;
  const activeOverrides = new Set(
    policy.activeOverrides
      .filter((override) => override.class === "raw-sources")
      .map((override) => override.kind),
  );
  const rawPolicy = policy.classes.find((entry) => entry.class === "raw-sources");
  if (rawPolicy === undefined) {
    throw new StorageValidationError("Candidate knowledge retention policy is incomplete.");
  }
  let eligible = 0;
  let preserved = 0;
  for (const version of managedVersions) {
    const expiresAt =
      rawPolicy.rule === "expire-after-days" && rawPolicy.expireAfterDays !== null
        ? Date.parse(version.createdAt) + rawPolicy.expireAfterDays * 24 * 60 * 60 * 1000
        : Number.POSITIVE_INFINITY;
    if (activeOverrides.size === 0 && expiresAt <= Date.parse(asOf)) eligible += 1;
    else preserved += 1;
  }
  const boundedEligible = boundedRetentionPlanCount(eligible);
  const boundedPreserved = boundedRetentionPlanCount(preserved);
  const reasons: CandidateKnowledgeRetentionPlanClass["preservationReasons"][number][] = [];
  if (boundedPreserved.count > 0 || rawPolicy.rule === "retain-until-deletion") {
    reasons.push("retention-rule");
  }
  if (activeOverrides.size > 0) reasons.push("override");
  if (boundedUnmanaged.count > 0) reasons.push("unmanaged");
  if (boundedUnknown.count > 0) reasons.push("unknown");
  const rawClass: CandidateKnowledgeRetentionPlanClass = {
    class: "raw-sources",
    rule: rawPolicy.rule,
    expireAfterDays: rawPolicy.expireAfterDays,
    ownershipStatus: managedVersions.length > 0 ? "owned" : "preserved",
    eligibleCount: boundedEligible.count,
    preservedCount: boundedPreserved.count,
    unmanagedCount: boundedUnmanaged.count,
    unknownCount: boundedUnknown.count,
    countCapped: commonCapped || boundedEligible.capped || boundedPreserved.capped,
    preservationReasons: reasons,
  };

  const classes: CandidateKnowledgeRetentionPlanClass[] = [rawClass];
  for (const retentionClass of candidateKnowledgeRetentionClasses) {
    if (retentionClass === "raw-sources") continue;
    const classPolicy = policy.classes.find((entry) => entry.class === retentionClass);
    if (classPolicy === undefined) {
      throw new StorageValidationError("Candidate knowledge retention policy is incomplete.");
    }
    const classOverrides = policy.activeOverrides.some(
      (override) => override.class === retentionClass,
    );
    classes.push({
      class: retentionClass,
      rule: classPolicy.rule,
      expireAfterDays: classPolicy.expireAfterDays,
      ownershipStatus: "not-materialized",
      eligibleCount: 0,
      preservedCount: 0,
      unmanagedCount: 0,
      unknownCount: 0,
      countCapped: false,
      preservationReasons: classOverrides ? ["override", "not-materialized"] : ["not-materialized"],
    });
  }
  return freezeCandidateKnowledgeRetentionPlan({
    schemaVersion: 1,
    knowledgeBaseId,
    asOf,
    policyRevision: policy.revision,
    overrideRevision: policy.overrideRevision,
    classes,
  });
}

const candidateKnowledgeDeletionStagingDirectory = ".deletion-staging";
const candidateKnowledgeDeletionPlanSchemaVersion = 1 as const;

type CandidateKnowledgeDeletionArtifactStatus = "verified" | "missing" | "integrity-mismatch";

interface CandidateKnowledgeDeletionArtifactObservation {
  readonly sourceId: string;
  readonly versionId: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly status: CandidateKnowledgeDeletionArtifactStatus;
  readonly identity: FileIdentity | null;
}

interface CandidateKnowledgeDeletionPhysicalInventory {
  readonly artifacts: readonly CandidateKnowledgeDeletionArtifactObservation[];
  readonly unknownEntries: ManagedCandidateKnowledgeFileInventory["unknownEntries"];
  readonly scanLimitReached: boolean;
  readonly inventoryDigest: string;
}

function deletionDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

async function observeCandidateKnowledgeDeletionArtifacts(
  root: string,
  snapshot: CandidateKnowledgeDeletionDatabaseSnapshot,
): Promise<readonly CandidateKnowledgeDeletionArtifactObservation[]> {
  const observations: CandidateKnowledgeDeletionArtifactObservation[] = [];
  for (const artifact of snapshot.managedArtifacts) {
    const path = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    try {
      const details = await lstat(path);
      if (details.isSymbolicLink() || !details.isFile()) {
        observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
        continue;
      }
      try {
        await verifyManagedFile(path, artifact);
        const after = await lstat(path);
        if (
          after.isSymbolicLink() ||
          !after.isFile() ||
          after.dev !== details.dev ||
          after.ino !== details.ino
        ) {
          observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
          continue;
        }
        observations.push({
          ...artifact,
          status: "verified",
          identity: { dev: after.dev, ino: after.ino },
        });
      } catch {
        observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
      }
    } catch (error) {
      if (isMissing(error)) {
        observations.push({ ...artifact, status: "missing", identity: null });
        continue;
      }
      observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
    }
  }
  return observations;
}

async function inspectCandidateKnowledgeDeletionInventory(
  storage: SqliteStorage,
  root: string,
  snapshot: CandidateKnowledgeDeletionDatabaseSnapshot,
): Promise<CandidateKnowledgeDeletionPhysicalInventory> {
  const allManaged = storage.listManagedCandidateKnowledgeSourceVersions();
  const targetSources = await storage.listCandidateKnowledgeSources(snapshot.knowledgeBaseId);
  const expectedSourceDirectories = new Set(
    allManaged.map((version) => managedPathSegment(version.sourceId)),
  );
  const targetSourceDirectories = new Map<string, Set<string>>();
  for (const source of targetSources) {
    targetSourceDirectories.set(managedPathSegment(source.id), new Set<string>());
  }
  for (const artifact of snapshot.managedArtifacts) {
    const sourceDirectory = managedPathSegment(artifact.sourceId);
    const expectedFiles = targetSourceDirectories.get(sourceDirectory) ?? new Set<string>();
    expectedFiles.add(managedPathSegment(artifact.versionId));
    targetSourceDirectories.set(sourceDirectory, expectedFiles);
  }
  const inventory: MutableManagedCandidateKnowledgeFileInventory = {
    scannedEntryCount: 0,
    scanLimitReached: false,
    unknownEntries: {
      intakeShapedFilesAtSourcesRoot: 0,
      opaqueEntriesAtSourcesRoot: 0,
      entriesInsideManagedSourceDirectories: 0,
      symbolicLinks: 0,
      otherEntries: 0,
    },
  };
  const inventoryFingerprints: string[] = [];
  const targetDirectories: string[] = [];
  const sourcesRoot = join(root, sourcesDirectory);
  await scanManagedCandidateKnowledgeDirectory(sourcesRoot, inventory, (entry, entryPath) => {
    inventoryFingerprints.push(`${relative(sourcesRoot, entryPath)}:${entryType(entry)}`);
    if (entry.isSymbolicLink()) {
      inventory.unknownEntries.symbolicLinks += 1;
    } else if (entry.isFile()) {
      if (intakeShapedFilename.test(entry.name)) {
        inventory.unknownEntries.intakeShapedFilesAtSourcesRoot += 1;
      } else {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      }
    } else if (entry.isDirectory()) {
      if (!expectedSourceDirectories.has(entry.name)) {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      } else if (targetSourceDirectories.has(entry.name)) {
        targetDirectories.push(entry.name);
      }
    } else {
      inventory.unknownEntries.otherEntries += 1;
    }
  });
  for (const sourceDirectory of targetDirectories) {
    if (inventory.scanLimitReached) break;
    const sourcePath = join(sourcesRoot, sourceDirectory);
    try {
      await scanManagedCandidateKnowledgeDirectory(sourcePath, inventory, (entry, entryPath) => {
        inventoryFingerprints.push(`${relative(sourcesRoot, entryPath)}:${entryType(entry)}`);
        if (entry.isSymbolicLink()) {
          inventory.unknownEntries.symbolicLinks += 1;
        } else if (entry.isFile()) {
          const expectedFiles = targetSourceDirectories.get(sourceDirectory);
          if (expectedFiles === undefined || !expectedFiles.has(entry.name)) {
            inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
          }
        } else if (entry.isDirectory()) {
          inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
        } else {
          inventory.unknownEntries.otherEntries += 1;
        }
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const unknownEntries = Object.freeze({ ...inventory.unknownEntries });
  return Object.freeze({
    artifacts: Object.freeze([
      ...(await observeCandidateKnowledgeDeletionArtifacts(root, snapshot)),
    ]),
    unknownEntries,
    scanLimitReached: inventory.scanLimitReached,
    inventoryDigest: deletionDigest(inventoryFingerprints.sort()),
  });
}

function freezeCandidateKnowledgeDeletionPlan(
  plan: CandidateKnowledgeDeletionPlan,
): CandidateKnowledgeDeletionPlan {
  return Object.freeze({
    ...plan,
    blockers: Object.freeze(plan.blockers.map((blocker) => Object.freeze({ ...blocker }))),
    classes: Object.freeze(
      plan.classes.map((entry) =>
        Object.freeze({
          ...entry,
          preservationReasons: Object.freeze([...entry.preservationReasons]),
        }),
      ),
    ),
  });
}

function boundedDeletionCount(value: number): { readonly count: number; readonly capped: boolean } {
  if (value <= maximumManagedCandidateKnowledgeInventoryEntries) {
    return { count: value, capped: false };
  }
  return { count: maximumManagedCandidateKnowledgeInventoryEntries, capped: true };
}

function deletionBlocker(
  code: CandidateKnowledgeDeletionBlockerCode,
  count = 1,
): CandidateKnowledgeDeletionBlocker {
  return { code, count: boundedDeletionCount(count).count };
}

async function planCandidateKnowledgeBaseDeletion(
  storage: SqliteStorage,
  descriptor: CandidateKnowledgeStoreDescriptor,
  root: string,
  knowledgeBaseIdInput: string,
): Promise<{
  readonly plan: CandidateKnowledgeDeletionPlan;
  readonly snapshot: CandidateKnowledgeDeletionDatabaseSnapshot;
  readonly inventory: CandidateKnowledgeDeletionPhysicalInventory;
}> {
  const knowledgeBaseId = requiredManagedText(
    knowledgeBaseIdInput,
    "Candidate knowledge deletion knowledge base id",
  );
  const snapshot = storage.getCandidateKnowledgeDeletionDatabaseSnapshot(knowledgeBaseId);
  if (snapshot.state !== "archived") {
    throw new StorageConflictError("candidate knowledge base deletion requires an archived target");
  }
  if (snapshot.isDefault) {
    throw new StorageConflictError("the default candidate knowledge base cannot be deleted");
  }
  const inventory = await inspectCandidateKnowledgeDeletionInventory(storage, root, snapshot);
  const boundedSourceCount = boundedDeletionCount(snapshot.sourceCount);
  const boundedVersionCount = boundedDeletionCount(snapshot.versionCount);
  const boundedManagedRecordCount = boundedDeletionCount(
    snapshot.versionCount - snapshot.unmanagedVersionCount,
  );
  const boundedManagedCount = boundedDeletionCount(snapshot.managedArtifacts.length);
  const managedArtifactBytes = snapshot.managedArtifacts.reduce(
    (total, artifact) => total + artifact.sizeBytes,
    0,
  );
  const unknownTotal = Object.values(inventory.unknownEntries).reduce(
    (total, count) => total + count,
    0,
  );
  const boundedUnknown = boundedDeletionCount(unknownTotal);
  const boundedUnmanaged = boundedDeletionCount(
    snapshot.unmanagedVersionCount + snapshot.unmanagedSourceCount,
  );
  const blockers: CandidateKnowledgeDeletionBlocker[] = [];
  const activeOverrides = snapshot.policy.activeOverrides;
  for (const kind of ["legal-hold", "manual-preservation"] as const) {
    const count = activeOverrides.filter((override) => override.kind === kind).length;
    if (count > 0) blockers.push(deletionBlocker(kind, count));
  }
  if (snapshot.unmanagedSourceCount > 0 || snapshot.unmanagedVersionCount > 0) {
    blockers.push(
      deletionBlocker(
        "unmanaged-database-records",
        snapshot.unmanagedVersionCount + snapshot.unmanagedSourceCount,
      ),
    );
  }
  if (snapshot.pendingOperationCount > 0) {
    blockers.push(deletionBlocker("pending-managed-write", snapshot.pendingOperationCount));
  }
  const missingArtifacts = inventory.artifacts.filter(
    (artifact) => artifact.status === "missing",
  ).length;
  const mismatchedArtifacts = inventory.artifacts.filter(
    (artifact) => artifact.status === "integrity-mismatch",
  ).length;
  if (missingArtifacts > 0)
    blockers.push(deletionBlocker("managed-artifact-missing", missingArtifacts));
  if (mismatchedArtifacts > 0) {
    blockers.push(deletionBlocker("managed-artifact-integrity", mismatchedArtifacts));
  }
  // The durable artifact journal intentionally has a bounded count. A plan
  // that exceeds it cannot describe an exact mutation set, so execution must
  // remain unavailable until the inventory is reduced.
  if (boundedManagedCount.capped) {
    blockers.push(deletionBlocker("unknown-deletion-state"));
  }
  if (inventory.scanLimitReached && !boundedManagedCount.capped) {
    blockers.push(deletionBlocker("unknown-deletion-state"));
  }
  const countCapped =
    boundedSourceCount.capped ||
    boundedVersionCount.capped ||
    boundedManagedRecordCount.capped ||
    boundedManagedCount.capped ||
    boundedUnknown.capped ||
    boundedUnmanaged.capped ||
    inventory.scanLimitReached;
  const blockersByClass = new Set<CandidateKnowledgeRetentionClass>();
  for (const override of activeOverrides) blockersByClass.add(override.class);
  const rawBlocked = blockers.length > 0;
  const rawReasons: CandidateKnowledgeDeletionPlanClass["preservationReasons"][number][] = [];
  if (activeOverrides.some((override) => override.class === "raw-sources")) {
    rawReasons.push("override");
  }
  if (boundedUnmanaged.count > 0) rawReasons.push("unmanaged");
  if (boundedUnknown.count > 0) rawReasons.push("unknown");
  if (rawBlocked) rawReasons.push("blocked");
  const rawPolicy = snapshot.policy.classes.find((entry) => entry.class === "raw-sources");
  if (rawPolicy === undefined) {
    throw new StorageValidationError("Candidate knowledge retention policy is incomplete.");
  }
  const classes: CandidateKnowledgeDeletionPlanClass[] = [
    {
      class: "raw-sources",
      rule: rawPolicy.rule,
      expireAfterDays: rawPolicy.expireAfterDays,
      status: rawBlocked ? "blocked" : "delete",
      ownershipStatus: boundedManagedRecordCount.count > 0 ? "owned" : "preserved",
      managedCount: boundedManagedRecordCount.count,
      eligibleCount: boundedManagedRecordCount.count,
      preservedCount: boundedDeletionCount(boundedUnknown.count + boundedUnmanaged.count).count,
      unmanagedCount: boundedUnmanaged.count,
      unknownCount: boundedUnknown.count,
      countCapped,
      preservationReasons: rawReasons,
    },
  ];
  for (const retentionClass of candidateKnowledgeRetentionClasses) {
    if (retentionClass === "raw-sources") continue;
    const classPolicy = snapshot.policy.classes.find((entry) => entry.class === retentionClass);
    if (classPolicy === undefined) {
      throw new StorageValidationError("Candidate knowledge retention policy is incomplete.");
    }
    const overridden = blockersByClass.has(retentionClass);
    classes.push({
      class: retentionClass,
      rule: classPolicy.rule,
      expireAfterDays: classPolicy.expireAfterDays,
      status: overridden ? "blocked" : "not-materialized",
      ownershipStatus: "not-materialized",
      managedCount: 0,
      eligibleCount: 0,
      preservedCount: 0,
      unmanagedCount: 0,
      unknownCount: 0,
      countCapped: false,
      preservationReasons: overridden ? ["override", "not-materialized"] : ["not-materialized"],
    });
  }
  const planWithoutToken = {
    schemaVersion: candidateKnowledgeDeletionPlanSchemaVersion,
    knowledgeBaseId,
    archivedAt: snapshot.archivedAt as string,
    status: rawBlocked ? ("blocked" as const) : ("ready" as const),
    policyRevision: snapshot.policy.revision,
    overrideRevision: snapshot.policy.overrideRevision,
    sourceCount: boundedSourceCount.count,
    versionCount: boundedVersionCount.count,
    managedArtifactCount: boundedManagedCount.count,
    managedArtifactBytes,
    preservedUnknownCount: boundedUnknown.count,
    preservedUnmanagedCount: boundedUnmanaged.count,
    countCapped,
    blockers,
    classes,
  };
  const token = deletionDigest({
    schemaVersion: candidateKnowledgeDeletionPlanSchemaVersion,
    storeId: descriptor.id,
    knowledgeBaseId,
    state: snapshot.state,
    isDefault: snapshot.isDefault,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    archivedAt: snapshot.archivedAt,
    policyRevision: snapshot.policy.revision,
    overrideRevision: snapshot.policy.overrideRevision,
    graphDigest: snapshot.graphDigest,
    plan: planWithoutToken,
    managedArtifacts: inventory.artifacts.map((artifact) => ({
      sourceId: artifact.sourceId,
      versionId: artifact.versionId,
      checksum: artifact.checksum,
      sizeBytes: artifact.sizeBytes,
      status: artifact.status,
      identity: artifact.identity,
    })),
    unknownEntries: inventory.unknownEntries,
    scanLimitReached: inventory.scanLimitReached,
    inventoryDigest: inventory.inventoryDigest,
  });
  return {
    plan: freezeCandidateKnowledgeDeletionPlan({ ...planWithoutToken, confirmationToken: token }),
    snapshot,
    inventory,
  };
}

class SimulatedCandidateKnowledgeDeletionInterruption extends Error {
  public constructor(boundary: CandidateKnowledgeDeletionInterruptionBoundary) {
    super(`Simulated candidate knowledge deletion interruption at ${boundary}.`);
    this.name = "SimulatedCandidateKnowledgeDeletionInterruption";
  }
}

async function interruptCandidateKnowledgeDeletionAt(
  options: CandidateKnowledgeDeletionOptions,
  boundary: CandidateKnowledgeDeletionInterruptionBoundary,
): Promise<void> {
  if (options.interruptAt === boundary) {
    throw new SimulatedCandidateKnowledgeDeletionInterruption(boundary);
  }
}

function deletionOperationId(confirmationToken: string): string {
  return deletionDigest(`${confirmationToken}\u0000${randomUUID()}`);
}

function deletionStagingPath(root: string, operationId: string): string {
  return join(root, privateDirectory, candidateKnowledgeDeletionStagingDirectory, operationId);
}

function deletionArtifactStagingPath(
  stagingPath: string,
  sourceId: string,
  versionId: string,
): string {
  return join(stagingPath, `${managedPathSegment(sourceId)}-${managedPathSegment(versionId)}`);
}

function sameFileIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

async function createCandidateKnowledgeDeletionStaging(
  root: string,
  operationId: string,
): Promise<{ readonly path: string; readonly identity: FileIdentity }> {
  const parent = join(root, privateDirectory, candidateKnowledgeDeletionStagingDirectory);
  await mkdir(parent, { mode: 0o700, recursive: true });
  await requireDirectory(parent, "Candidate knowledge deletion staging parent");
  await chmodWhereSupported(parent, 0o700);
  const path = deletionStagingPath(root, operationId);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new StorageConflictError("Candidate knowledge deletion staging is already owned.");
    }
    throw error;
  }
  await chmodWhereSupported(path, 0o700);
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new StorageConflictError("Candidate knowledge deletion staging is not a real directory.");
  }
  return { path, identity: { dev: details.dev, ino: details.ino } };
}

async function verifyDeletionStagingDirectory(
  path: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<FileIdentity | null> {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new StorageConflictError(
        "Candidate knowledge deletion staging is not a real directory.",
      );
    }
    if (
      operation.stagingDevice !== null &&
      operation.stagingInode !== null &&
      (details.dev !== operation.stagingDevice || details.ino !== operation.stagingInode)
    ) {
      throw new StorageConflictError("Candidate knowledge deletion staging ownership changed.");
    }
    return { dev: details.dev, ino: details.ino };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function verifyDeletionArtifactAt(
  path: string,
  artifact: CandidateKnowledgeDeletionArtifactRecord,
): Promise<{
  readonly status: "missing" | "verified" | "preserved";
  readonly identity?: FileIdentity;
}> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return { status: "missing" };
    return { status: "preserved" };
  }
  if (details.isSymbolicLink() || !details.isFile()) return { status: "preserved" };
  const identity = { dev: details.dev, ino: details.ino };
  if (!sameFileIdentity(identity, { dev: artifact.device, ino: artifact.inode })) {
    return { status: "preserved" };
  }
  try {
    await verifyManagedFile(path, artifact);
  } catch {
    return { status: "preserved" };
  }
  return { status: "verified", identity };
}

async function moveCandidateKnowledgeDeletionArtifactsToStaging(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
  stagingPath: string,
): Promise<void> {
  for (const artifact of operation.artifacts) {
    const originalPath = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    const stagedPath = deletionArtifactStagingPath(
      stagingPath,
      artifact.sourceId,
      artifact.versionId,
    );
    const staged = await verifyDeletionArtifactAt(stagedPath, artifact);
    const original = await verifyDeletionArtifactAt(originalPath, artifact);
    if (staged.status === "verified") {
      if (original.status !== "missing") {
        throw new StorageConflictError(
          "Candidate knowledge deletion artifact exists in two locations.",
        );
      }
      continue;
    }
    if (staged.status === "preserved") {
      throw new StorageConflictError(
        "Candidate knowledge deletion staging contains an unowned entry.",
      );
    }
    if (original.status !== "verified") {
      throw new StorageConflictError(
        "Candidate knowledge deletion managed artifact changed before staging.",
      );
    }
    try {
      await rename(originalPath, stagedPath);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new StorageConflictError(
          "Candidate knowledge deletion artifact target already exists.",
        );
      }
      throw error;
    }
    const moved = await verifyDeletionArtifactAt(stagedPath, artifact);
    if (moved.status !== "verified") {
      throw new StorageConflictError(
        "Candidate knowledge deletion artifact changed while staging.",
      );
    }
  }
}

async function verifyCandidateKnowledgeDeletionStagingArtifacts(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
  stagingPath: string,
): Promise<void> {
  const stagingIdentity = await verifyDeletionStagingDirectory(stagingPath, operation);
  if (stagingIdentity === null) {
    throw new StorageConflictError("Candidate knowledge deletion staging disappeared.");
  }
  for (const artifact of operation.artifacts) {
    const stagedPath = deletionArtifactStagingPath(
      stagingPath,
      artifact.sourceId,
      artifact.versionId,
    );
    const originalPath = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    const staged = await verifyDeletionArtifactAt(stagedPath, artifact);
    const original = await verifyDeletionArtifactAt(originalPath, artifact);
    if (staged.status !== "verified" || original.status !== "missing") {
      throw new StorageConflictError("Candidate knowledge deletion staging inventory changed.");
    }
  }
}

async function cleanupCandidateKnowledgeDeletionStaging(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<void> {
  const stagingPath = deletionStagingPath(root, operation.operationId);
  const identity = await verifyDeletionStagingDirectory(stagingPath, operation);
  if (identity !== null) {
    const entries = await readDirectoryEntriesSafely(stagingPath);
    const expected = new Map(
      operation.artifacts.map((artifact) => [
        `${managedPathSegment(artifact.sourceId)}-${managedPathSegment(artifact.versionId)}`,
        artifact,
      ]),
    );
    for (const entry of entries) {
      const artifact = expected.get(entry.name);
      if (artifact === undefined || !entry.isFile()) {
        throw new StorageConflictError(
          "Candidate knowledge deletion staging contains an unowned entry.",
        );
      }
      const path = join(stagingPath, entry.name);
      const observed = await verifyDeletionArtifactAt(path, artifact);
      if (observed.status !== "verified" || observed.identity === undefined) {
        throw new StorageConflictError(
          "Candidate knowledge deletion staging artifact is not owned.",
        );
      }
      await removeRegularFileIfIdentityMatches(path, observed.identity);
    }
    await removeEmptyDirectoryIfIdentityMatches(stagingPath, identity);
  }
  await removeCandidateKnowledgeDeletionSourceDirectories(root, operation);
}

async function removeCandidateKnowledgeDeletionSourceDirectories(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<void> {
  const sourceIds = [...new Set(operation.artifacts.map((artifact) => artifact.sourceId))];
  for (const sourceId of sourceIds) {
    const path = join(root, sourcesDirectory, managedPathSegment(sourceId));
    let details: Awaited<ReturnType<typeof lstat>>;
    try {
      details = await lstat(path);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (details.isSymbolicLink() || !details.isDirectory()) continue;
    const entries = await readDirectoryEntriesSafely(path);
    if (entries.length > 0) continue;
    // The helper re-checks lstat identity immediately before rmdir. A race
    // that adds an unknown entry therefore leaves the directory untouched.
    await removeEmptyDirectoryIfIdentityMatches(path, { dev: details.dev, ino: details.ino });
  }
}

async function restoreCandidateKnowledgeDeletionArtifacts(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<boolean> {
  const stagingPath = deletionStagingPath(root, operation.operationId);
  const identity = await verifyDeletionStagingDirectory(stagingPath, operation);
  if (identity === null) return true;
  let restored = true;
  for (const artifact of operation.artifacts) {
    const originalPath = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    const stagedPath = deletionArtifactStagingPath(
      stagingPath,
      artifact.sourceId,
      artifact.versionId,
    );
    const staged = await verifyDeletionArtifactAt(stagedPath, artifact);
    const original = await verifyDeletionArtifactAt(originalPath, artifact);
    if (staged.status === "missing") {
      if (original.status === "verified") continue;
      restored = false;
      continue;
    }
    if (staged.status !== "verified" || original.status !== "missing") {
      restored = false;
      continue;
    }
    try {
      await rename(stagedPath, originalPath);
    } catch {
      restored = false;
    }
  }
  if (!restored) return false;
  await removeEmptyDirectoryIfIdentityMatches(stagingPath, identity);
  return true;
}

async function readDirectoryEntriesSafely(path: string): Promise<readonly Dirent[]> {
  const directory = await opendir(path);
  const entries: Dirent[] = [];
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      entries.push(entry);
    }
  } finally {
    await directory.close().catch((error: unknown) => {
      if (errorCode(error) !== "ERR_DIR_CLOSED") throw error;
    });
  }
  return entries;
}

async function recoverIncompleteCandidateKnowledgeDeletions(
  storage: SqliteStorage,
  root: string,
): Promise<void> {
  const lease = currentCandidateKnowledgeWriterLease(root);
  const operations = await storage.listCandidateKnowledgeDeletionOperations();
  for (const operation of operations) {
    lease.assertCurrent();
    lease.renew();
    if (operation.phase === "completed") continue;
    if (operation.phase === "committed") {
      await cleanupCandidateKnowledgeDeletionStaging(root, operation);
      lease.assertCurrent();
      await storage.completeCandidateKnowledgeDeletion(
        operation.operationId,
        new Date(
          Math.max(Date.now(), Date.parse(operation.committedAt ?? operation.createdAt)),
        ).toISOString(),
      );
      continue;
    }
    if (operation.phase === "aborted") {
      const restored = await restoreCandidateKnowledgeDeletionArtifacts(root, operation);
      if (!restored) {
        throw new StorageConflictError(
          "Candidate knowledge deletion recovery could not restore its original graph.",
        );
      }
      continue;
    }
    const restored = await restoreCandidateKnowledgeDeletionArtifacts(root, operation);
    if (!restored) {
      throw new StorageConflictError(
        "Candidate knowledge deletion recovery could not restore its original graph.",
      );
    }
    lease.assertCurrent();
    await storage.abortCandidateKnowledgeDeletion(operation.operationId);
  }
}

function parseDescriptor(value: unknown): CandidateKnowledgeStoreDescriptor {
  try {
    return candidateKnowledgeStoreSchema.parse(value) as CandidateKnowledgeStoreDescriptor;
  } catch {
    throw new StorageValidationError(
      "Candidate knowledge store manifest is invalid or unsupported.",
    );
  }
}

async function persistDescriptorBinding(
  storage: SqliteStorage,
  descriptor: CandidateKnowledgeStoreDescriptor,
): Promise<void> {
  await storage.set(`${descriptorKeyPrefix}.schemaVersion`, String(descriptor.schemaVersion));
  await storage.set(`${descriptorKeyPrefix}.id`, descriptor.id);
  await storage.set(`${descriptorKeyPrefix}.createdAt`, descriptor.createdAt);
}

async function validateOpenedStore(
  storage: SqliteStorage,
  descriptor: CandidateKnowledgeStoreDescriptor,
): Promise<void> {
  const migrationVersions = storage.appliedMigrationVersions();
  if (
    migrationVersions.some(
      (version) => !Number.isInteger(version) || version < 1 || version > storageSchemaVersion,
    )
  ) {
    throw new StorageValidationError(
      "Candidate knowledge store uses an unsupported future storage schema.",
    );
  }
  if (
    migrationVersions.length !== storageSchemaVersion ||
    migrationVersions.some((version, index) => version !== index + 1)
  ) {
    throw new StorageValidationError(
      "Candidate knowledge store uses an incomplete or unsupported storage schema.",
    );
  }
  const [boundSchemaVersion, boundId, boundCreatedAt] = await Promise.all([
    storage.get(`${descriptorKeyPrefix}.schemaVersion`),
    storage.get(`${descriptorKeyPrefix}.id`),
    storage.get(`${descriptorKeyPrefix}.createdAt`),
  ]);
  if (
    boundSchemaVersion !== String(descriptor.schemaVersion) ||
    boundId !== descriptor.id ||
    boundCreatedAt !== descriptor.createdAt
  ) {
    throw new StorageValidationError(
      "Candidate knowledge store manifest does not match its database.",
    );
  }
  const knowledgeBases = await storage.listCandidateKnowledgeBases();
  const activeDefaults = knowledgeBases.filter(
    (knowledgeBase) => knowledgeBase.isDefault && knowledgeBase.state === "active",
  );
  if (activeDefaults.length !== 1) {
    throw new StorageValidationError(
      "Candidate knowledge store must contain exactly one active default knowledge base.",
    );
  }
  storage.validateCandidateKnowledgeSourceGraph();
}

async function closePreservingFailure(storage: SqliteStorage): Promise<void> {
  try {
    await storage.close();
  } catch {
    // Preserve the validation error that made opening unsafe.
  }
}

async function readDescriptor(root: string): Promise<CandidateKnowledgeStoreDescriptor> {
  const path = join(root, manifestFilename);
  await requireRegularFile(path, "Candidate knowledge store manifest", maximumManifestBytes);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new StorageValidationError("Candidate knowledge store manifest is not valid JSON.");
  }
  return parseDescriptor(value);
}

function managedVersionMetadata(
  input: CandidateKnowledgeSourceVersionInput,
): CandidateKnowledgeSourceVersionInput {
  return {
    id: requiredManagedText(input.id, "Managed candidate knowledge source version id"),
    mediaType: requiredManagedText(
      input.mediaType,
      "Managed candidate knowledge source version media type",
    ),
    checksum: input.checksum,
    sizeBytes: input.sizeBytes,
    createdAt: input.createdAt,
  };
}

async function cleanUncommittedManagedWrite(
  captured: Pick<CapturedManagedFile | CapturedManagedBytes, "temporaryPath" | "temporaryIdentity">,
  finalPath: string | undefined,
  published: boolean,
  createdDirectory: boolean,
): Promise<boolean> {
  let complete = true;
  if (
    published &&
    finalPath !== undefined &&
    !(await removeRegularFileIfIdentityMatches(finalPath, captured.temporaryIdentity))
  ) {
    complete = false;
  }
  if (
    !(await removeRegularFileIfIdentityMatches(captured.temporaryPath, captured.temporaryIdentity))
  ) {
    complete = false;
  }
  if (createdDirectory && finalPath !== undefined) {
    try {
      await rmdir(dirname(finalPath));
    } catch (error) {
      if (errorCode(error) !== "ENOTEMPTY" && !isMissing(error)) complete = false;
    }
  }
  return complete;
}

async function writeManagedCandidateKnowledgeFile(
  storage: SqliteStorage,
  root: string,
  operation:
    | {
        readonly kind: "create";
        readonly source: CandidateKnowledgeSourceInput;
        readonly version: ManagedCandidateKnowledgeFileVersionInput;
      }
    | {
        readonly kind: "append";
        readonly knowledgeBaseId: string;
        readonly sourceId: string;
        readonly version: ManagedCandidateKnowledgeFileVersionInput;
      },
): Promise<CandidateKnowledgeSourceVersionWriteResult> {
  const sourceId = requiredManagedText(
    operation.kind === "create" ? operation.source.id : operation.sourceId,
    "Managed candidate knowledge source id",
  );
  const knowledgeBaseId = requiredManagedText(
    operation.kind === "create" ? operation.source.knowledgeBaseId : operation.knowledgeBaseId,
    "Managed candidate knowledge base id",
  );
  if (operation.kind === "create" && operation.source.kind !== "file") {
    throw new StorageValidationError(
      "Managed candidate knowledge source versions require a file source.",
    );
  }
  if (operation.kind === "append") {
    if (operation.version.directoryId !== undefined) {
      throw new StorageValidationError(
        "Managed candidate knowledge directory membership is create-only.",
      );
    }
    const existingSource = await storage.getCandidateKnowledgeSource(knowledgeBaseId, sourceId);
    if (existingSource !== undefined && existingSource.kind !== "file") {
      throw new StorageValidationError(
        "Managed candidate knowledge source versions require a file source.",
      );
    }
  }
  const requestedVersion = managedVersionMetadata(operation.version);
  const operationId = randomUUID();
  const writerLease = currentCandidateKnowledgeWriterLease(root);
  const ownerGeneration = writerLease.generation;
  writerLease.renew();
  await storage.prepareManagedCandidateKnowledgeWrite({
    operationId,
    knowledgeBaseId,
    sourceId,
    requestedVersionId: requestedVersion.id,
    kind: operation.kind,
    createdAt: requestedVersion.createdAt,
    ownerGeneration,
    requestedMediaType: requestedVersion.mediaType,
    requestedChecksum: requestedVersion.checksum,
    requestedSizeBytes: requestedVersion.sizeBytes,
  });
  writerLease.assertCurrent();
  await interruptManagedWriteAt(operation.version, "intent");
  let captured: CapturedManagedFile | undefined;
  let sourceDirectoryCreated = false;
  let targetPath: string | undefined;
  let targetVersionId = requestedVersion.id;
  let targeted = false;
  let published = false;
  let committed = false;
  let noopCandidate = false;
  try {
    captured = await captureManagedFile(root, operation.version, operationId);
    writerLease.renew();
    await storage.recordManagedCandidateKnowledgeWriteStagingIdentity(
      operationId,
      {
        device: captured.temporaryIdentity.dev,
        inode: captured.temporaryIdentity.ino,
        createdAt: new Date(
          Math.max(Date.now(), Date.parse(requestedVersion.createdAt)),
        ).toISOString(),
      },
      ownerGeneration,
    );
    writerLease.assertCurrent();
    await interruptManagedWriteAt(operation.version, "staging");
    const integrity = {
      checksum: captured.checksum,
      sizeBytes: captured.sizeBytes,
    };
    let publicationRequired = true;
    if (operation.kind === "append") {
      const versions = await storage.listCandidateKnowledgeSourceVersions(
        knowledgeBaseId,
        sourceId,
      );
      const current = versions.at(-1);
      if (current?.checksum === captured.checksum) {
        targetVersionId = current.id;
        if (
          current.mediaType !== requestedVersion.mediaType ||
          current.sizeBytes !== captured.sizeBytes
        ) {
          throw new StorageConflictError(
            "Candidate knowledge source version checksum conflicts with its integrity metadata.",
          );
        }
        if (
          await storage.isCandidateKnowledgeSourceVersionManaged(
            knowledgeBaseId,
            sourceId,
            current.id,
          )
        ) {
          targetPath = managedVersionPath(root, sourceId, current.id);
          await verifyManagedFile(targetPath, current);
          publicationRequired = false;
          noopCandidate = true;
        }
      }
    }

    if (noopCandidate) {
      await operation.version.beforeDatabaseWrite?.();
      await operation.version.beforeStagingCleanup?.();
      await interruptManagedWriteAt(operation.version, "staging-cleanup");
      writerLease.renew();
      if (
        !(await removeRegularFileIfIdentityMatches(
          captured.temporaryPath,
          captured.temporaryIdentity,
        ))
      ) {
        throw new StorageValidationError(
          "Managed candidate knowledge source staging cleanup could not be verified.",
        );
      }
      writerLease.assertCurrent();
      await interruptManagedWriteAt(operation.version, "after-staging-cleanup");
      await operation.version.beforeCommittedFileRecheck?.();
      await verifyManagedFile(targetPath as string, integrity);
      const expectedOriginPath =
        operation.version.expectedOriginBoundAt === undefined ? undefined : captured.originPath;
      writerLease.renew();
      return storage.recordManagedCandidateKnowledgeWriteNoop(
        operationId,
        requestedVersion,
        operation.version.expectedCurrentVersionId,
        operation.version.expectedOriginBoundAt,
        expectedOriginPath,
        ownerGeneration,
      );
    }

    if (publicationRequired) {
      targetPath = managedVersionPath(root, sourceId, targetVersionId);
      writerLease.renew();
      await operation.version.afterLeaseRenewBeforeDatabaseWrite?.();
      await storage.recordManagedCandidateKnowledgeWriteEvent(
        operationId,
        "targeted",
        targetVersionId,
        requestedVersion.createdAt,
        ownerGeneration,
      );
      targeted = true;
      await interruptManagedWriteAt(operation.version, "target-intent");
      writerLease.renew();
      const sourceDirectory = await ensureManagedSourceDirectory(root, sourceId);
      sourceDirectoryCreated = sourceDirectory.created;
      await publishManagedFile(
        captured.temporaryPath,
        captured.temporaryIdentity,
        targetPath,
        integrity,
      );
      published = true;
      writerLease.assertCurrent();
      await interruptManagedWriteAt(operation.version, "target-publication");
      await operation.version.afterTargetPublication?.();
      writerLease.renew();
      await storage.recordManagedCandidateKnowledgeWriteEvent(
        operationId,
        "published",
        targetVersionId,
        requestedVersion.createdAt,
        ownerGeneration,
      );
      await interruptManagedWriteAt(operation.version, "published-event");
    }

    await operation.version.beforeDatabaseWrite?.();
    writerLease.renew();
    const result = await storage.commitManagedCandidateKnowledgeWrite(
      operation.kind === "create"
        ? {
            kind: "create",
            operationId,
            source: { ...operation.source, id: sourceId, knowledgeBaseId },
            version: requestedVersion,
            originPath: captured.originPath,
            ...(operation.version.directoryId === undefined
              ? {}
              : { directoryId: operation.version.directoryId }),
            expectedOwnerGeneration: ownerGeneration,
          }
        : {
            kind: "append",
            operationId,
            version: requestedVersion,
            ...(operation.version.expectedCurrentVersionId === undefined
              ? {}
              : { expectedCurrentVersionId: operation.version.expectedCurrentVersionId }),
            ...(operation.version.expectedOriginBoundAt === undefined
              ? {}
              : { expectedOriginBoundAt: operation.version.expectedOriginBoundAt }),
            ...(operation.version.expectedOriginBoundAt === undefined
              ? {}
              : { expectedOriginPath: captured.originPath }),
            expectedOwnerGeneration: ownerGeneration,
          },
    );
    await interruptManagedWriteAt(operation.version, "commit");
    committed = true;
    const committedPath = managedVersionPath(root, sourceId, result.version.id);
    await operation.version.beforeCommittedFileRecheck?.();
    await verifyManagedFile(committedPath, result.version);
    await operation.version.beforeStagingCleanup?.();
    await interruptManagedWriteAt(operation.version, "staging-cleanup");
    writerLease.renew();
    if (
      !(await removeRegularFileIfIdentityMatches(
        captured.temporaryPath,
        captured.temporaryIdentity,
      ))
    ) {
      throw new StorageValidationError(
        "Managed candidate knowledge source staging cleanup could not be verified.",
      );
    }
    writerLease.assertCurrent();
    await interruptManagedWriteAt(operation.version, "after-staging-cleanup");
    writerLease.renew();
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "completed",
      result.version.id,
      requestedVersion.createdAt,
      ownerGeneration,
    );
    return result;
  } catch (error) {
    if (
      error instanceof SimulatedManagedWriteInterruption ||
      error instanceof StorageWriterLeaseError
    ) {
      throw error;
    }
    writerLease.renew();
    if (!committed && captured !== undefined) {
      const cleaned = await cleanUncommittedManagedWrite(
        captured,
        targetPath,
        published,
        sourceDirectoryCreated,
      );
      if (cleaned && targeted && !noopCandidate) {
        try {
          await storage.recordManagedCandidateKnowledgeWriteEvent(
            operationId,
            "aborted",
            targetVersionId,
            requestedVersion.createdAt,
            ownerGeneration,
          );
        } catch {
          // The durable prepared/published journal remains safely inspectable.
        }
      }
    }
    throw error;
  }
}

async function writeManagedCandidateKnowledgeUrlVersion(
  storage: SqliteStorage,
  root: string,
  operation:
    | {
        readonly kind: "create";
        readonly source: CandidateKnowledgeSourceInput;
        readonly version: ManagedCandidateKnowledgeUrlVersionInput;
      }
    | {
        readonly kind: "append";
        readonly knowledgeBaseId: string;
        readonly sourceId: string;
        readonly version: ManagedCandidateKnowledgeUrlVersionInput;
      },
): Promise<CandidateKnowledgeSourceVersionWriteResult> {
  const sourceId = requiredManagedText(
    operation.kind === "create" ? operation.source.id : operation.sourceId,
    "Managed candidate knowledge source id",
  );
  const knowledgeBaseId = requiredManagedText(
    operation.kind === "create" ? operation.source.knowledgeBaseId : operation.knowledgeBaseId,
    "Managed candidate knowledge base id",
  );
  if (operation.kind === "create" && operation.source.kind !== "url") {
    throw new StorageValidationError(
      "Managed candidate knowledge URL sources require a URL source.",
    );
  }
  if (operation.kind === "append") {
    const existingSource = await storage.getCandidateKnowledgeSource(knowledgeBaseId, sourceId);
    if (existingSource !== undefined && existingSource.kind !== "url") {
      throw new StorageValidationError(
        "Managed candidate knowledge URL versions require a URL source.",
      );
    }
    if (
      existingSource !== undefined &&
      (await storage.getCandidateKnowledgeSourceRetirement(knowledgeBaseId, sourceId)) !== undefined
    ) {
      throw new StorageConflictError("candidate knowledge source is retired");
    }
  }
  const requestedVersion = managedVersionMetadata(operation.version);
  validateManagedUrlResponseBytes(operation.version);
  const operationId = randomUUID();
  const writerLease = currentCandidateKnowledgeWriterLease(root);
  const ownerGeneration = writerLease.generation;
  writerLease.renew();
  await storage.prepareManagedCandidateKnowledgeWrite({
    operationId,
    knowledgeBaseId,
    sourceId,
    requestedVersionId: requestedVersion.id,
    kind: operation.kind,
    createdAt: requestedVersion.createdAt,
    ownerGeneration,
    requestedMediaType: requestedVersion.mediaType,
    requestedChecksum: requestedVersion.checksum,
    requestedSizeBytes: requestedVersion.sizeBytes,
  });
  writerLease.assertCurrent();
  await interruptManagedWriteAt(operation.version, "intent");
  let captured: CapturedManagedBytes | undefined;
  let sourceDirectoryCreated = false;
  let targetPath: string | undefined;
  let targetVersionId = requestedVersion.id;
  let targeted = false;
  let published = false;
  let committed = false;
  let noopCandidate = false;
  let expectedCurrentVersionId: string | undefined;
  try {
    captured = await captureManagedBytes(root, operation.version, operationId);
    writerLease.renew();
    await storage.recordManagedCandidateKnowledgeWriteStagingIdentity(
      operationId,
      {
        device: captured.temporaryIdentity.dev,
        inode: captured.temporaryIdentity.ino,
        createdAt: new Date(
          Math.max(Date.now(), Date.parse(requestedVersion.createdAt)),
        ).toISOString(),
      },
      ownerGeneration,
    );
    writerLease.assertCurrent();
    await interruptManagedWriteAt(operation.version, "staging");
    if (operation.kind === "append") {
      const versions = await storage.listCandidateKnowledgeSourceVersions(
        knowledgeBaseId,
        sourceId,
      );
      const current = versions.at(-1);
      if (current?.checksum === captured.checksum) {
        targetVersionId = current.id;
        expectedCurrentVersionId = operation.version.expectedCurrentVersionId ?? current.id;
        if (
          current.mediaType !== requestedVersion.mediaType ||
          current.sizeBytes !== captured.sizeBytes
        ) {
          throw new StorageConflictError(
            "Candidate knowledge source version checksum conflicts with its integrity metadata.",
          );
        }
        if (
          !(await storage.isCandidateKnowledgeSourceVersionManaged(
            knowledgeBaseId,
            sourceId,
            current.id,
          ))
        ) {
          throw new StorageConflictError(
            "Managed candidate knowledge write noop requires a managed current URL version.",
          );
        }
        targetPath = managedVersionPath(root, sourceId, current.id);
        await verifyManagedFile(targetPath, current);
        noopCandidate = true;
      } else if (current !== undefined) {
        expectedCurrentVersionId = operation.version.expectedCurrentVersionId ?? current.id;
      }
    }

    if (noopCandidate) {
      await operation.version.beforeDatabaseWrite?.();
      await operation.version.beforeStagingCleanup?.();
      await interruptManagedWriteAt(operation.version, "staging-cleanup");
      writerLease.renew();
      if (
        !(await removeRegularFileIfIdentityMatches(
          captured.temporaryPath,
          captured.temporaryIdentity,
        ))
      ) {
        throw new StorageValidationError(
          "Managed candidate knowledge source staging cleanup could not be verified.",
        );
      }
      writerLease.assertCurrent();
      await interruptManagedWriteAt(operation.version, "after-staging-cleanup");
      await operation.version.beforeCommittedFileRecheck?.();
      await verifyManagedFile(targetPath as string, {
        checksum: captured.checksum,
        sizeBytes: captured.sizeBytes,
      });
      writerLease.renew();
      return storage.recordManagedCandidateKnowledgeWriteNoop(
        operationId,
        requestedVersion,
        expectedCurrentVersionId,
        undefined,
        undefined,
        ownerGeneration,
      );
    }

    targetPath = managedVersionPath(root, sourceId, targetVersionId);
    writerLease.renew();
    await operation.version.afterLeaseRenewBeforeDatabaseWrite?.();
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "targeted",
      targetVersionId,
      requestedVersion.createdAt,
      ownerGeneration,
    );
    targeted = true;
    await interruptManagedWriteAt(operation.version, "target-intent");
    writerLease.renew();
    const sourceDirectory = await ensureManagedSourceDirectory(root, sourceId);
    sourceDirectoryCreated = sourceDirectory.created;
    await publishManagedFile(
      captured.temporaryPath,
      captured.temporaryIdentity,
      targetPath,
      captured,
    );
    published = true;
    writerLease.assertCurrent();
    await interruptManagedWriteAt(operation.version, "target-publication");
    await operation.version.afterTargetPublication?.();
    writerLease.renew();
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "published",
      targetVersionId,
      requestedVersion.createdAt,
      ownerGeneration,
    );
    await interruptManagedWriteAt(operation.version, "published-event");
    await operation.version.beforeDatabaseWrite?.();
    writerLease.renew();
    const result = await storage.commitManagedCandidateKnowledgeWrite(
      operation.kind === "create"
        ? {
            kind: "create",
            operationId,
            source: { ...operation.source, id: sourceId, knowledgeBaseId },
            version: requestedVersion,
            urlProvenance: operation.version.provenance,
            expectedOwnerGeneration: ownerGeneration,
          }
        : {
            kind: "append",
            operationId,
            version: requestedVersion,
            urlProvenance: operation.version.provenance,
            ...(expectedCurrentVersionId === undefined ? {} : { expectedCurrentVersionId }),
            expectedOwnerGeneration: ownerGeneration,
          },
    );
    await interruptManagedWriteAt(operation.version, "commit");
    committed = true;
    const committedPath = managedVersionPath(root, sourceId, result.version.id);
    await operation.version.beforeCommittedFileRecheck?.();
    await verifyManagedFile(committedPath, result.version);
    await operation.version.beforeStagingCleanup?.();
    await interruptManagedWriteAt(operation.version, "staging-cleanup");
    writerLease.renew();
    if (
      !(await removeRegularFileIfIdentityMatches(
        captured.temporaryPath,
        captured.temporaryIdentity,
      ))
    ) {
      throw new StorageValidationError(
        "Managed candidate knowledge source staging cleanup could not be verified.",
      );
    }
    writerLease.assertCurrent();
    await interruptManagedWriteAt(operation.version, "after-staging-cleanup");
    writerLease.renew();
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "completed",
      result.version.id,
      requestedVersion.createdAt,
      ownerGeneration,
    );
    return result;
  } catch (error) {
    if (
      error instanceof SimulatedManagedWriteInterruption ||
      error instanceof StorageWriterLeaseError
    ) {
      throw error;
    }
    writerLease.renew();
    if (!committed && captured !== undefined) {
      const cleaned = await cleanUncommittedManagedWrite(
        captured,
        targetPath,
        published,
        sourceDirectoryCreated,
      );
      if (cleaned && targeted && !noopCandidate) {
        try {
          await storage.recordManagedCandidateKnowledgeWriteEvent(
            operationId,
            "aborted",
            targetVersionId,
            requestedVersion.createdAt,
            ownerGeneration,
          );
        } catch {
          // The durable prepared/published journal remains safely inspectable.
        }
      }
    }
    throw error;
  }
}

function latestCandidateKnowledgeSourceVersion(
  versions: readonly CandidateKnowledgeSourceVersionRecord[],
  sourceId: string,
): CandidateKnowledgeSourceVersionRecord {
  if (versions.length === 0 || versions.some((version) => version.sourceId !== sourceId)) {
    throw new StorageValidationError("Candidate knowledge source version graph is inconsistent.");
  }
  return versions.reduce((latest, version) => {
    if (
      version.version > latest.version ||
      (version.version === latest.version && version.id.localeCompare(latest.id) > 0)
    ) {
      return version;
    }
    return latest;
  });
}

async function rebindManagedCandidateKnowledgeFileOrigin(
  storage: SqliteStorage,
  root: string,
  knowledgeBaseId: string,
  sourceId: string,
  input: RebindManagedCandidateKnowledgeFileInput,
): Promise<RebindManagedCandidateKnowledgeFileResult> {
  const normalizedKnowledgeBaseId = requiredManagedText(
    knowledgeBaseId,
    "Managed candidate knowledge base id",
  );
  const normalizedSourceId = requiredManagedText(sourceId, "Managed candidate knowledge source id");
  const source = await storage.getCandidateKnowledgeSource(
    normalizedKnowledgeBaseId,
    normalizedSourceId,
  );
  if (source === undefined) {
    throw new StorageValidationError("Managed candidate knowledge source was not found.");
  }
  if (source.kind !== "file") {
    throw new StorageValidationError(
      "Managed candidate knowledge source origin bindings require a file source.",
    );
  }
  const currentBinding = await storage.getCandidateKnowledgeSourceOriginBinding(
    normalizedKnowledgeBaseId,
    normalizedSourceId,
  );
  if (currentBinding === undefined) {
    throw new StorageValidationError(
      "Managed candidate knowledge source origin binding is missing.",
    );
  }
  const versions = await storage.listCandidateKnowledgeSourceVersions(
    normalizedKnowledgeBaseId,
    normalizedSourceId,
  );
  const latestVersion = latestCandidateKnowledgeSourceVersion(versions, normalizedSourceId);
  if (
    !(await storage.isCandidateKnowledgeSourceVersionManaged(
      normalizedKnowledgeBaseId,
      normalizedSourceId,
      latestVersion.id,
    ))
  ) {
    throw new StorageValidationError(
      "Managed candidate knowledge source origin rebinding requires the latest version to be managed.",
    );
  }

  const verified = await verifyManagedFileOrigin(root, input);
  const expectedMediaType = requiredManagedText(
    input.mediaType,
    "Managed candidate knowledge source expected media type",
  );
  if (
    expectedMediaType !== latestVersion.mediaType ||
    verified.checksum !== latestVersion.checksum ||
    verified.sizeBytes !== latestVersion.sizeBytes
  ) {
    throw new StorageValidationError(
      "Managed candidate knowledge source does not match the latest managed version.",
    );
  }
  const binding = await storage.rebindCandidateKnowledgeSourceOrigin(
    normalizedKnowledgeBaseId,
    normalizedSourceId,
    verified.originPath,
    input.boundAt,
  );
  return Object.freeze({
    binding: Object.freeze({ ...binding }),
    rebound: currentBinding.originPath !== verified.originPath,
  });
}

async function moveManagedCandidateKnowledgeDirectoryMember(
  storage: SqliteStorage,
  root: string,
  input: MoveManagedCandidateKnowledgeDirectoryMemberInput,
): Promise<MoveManagedCandidateKnowledgeDirectoryMemberResult> {
  const knowledgeBaseId = requiredManagedText(
    input.knowledgeBaseId,
    "Managed candidate knowledge base id",
  );
  const directoryId = requiredManagedText(
    input.directoryId,
    "Managed candidate knowledge directory id",
  );
  const sourceId = requiredManagedText(input.sourceId, "Managed candidate knowledge source id");
  const candidateRootPath = await verifyCandidateDirectoryRoot(root, input.expectedRootPath);
  const verified = await verifyManagedFileOrigin(root, {
    sourcePath: input.sourcePath,
    mediaType: input.mediaType,
    checksum: input.checksum,
    sizeBytes: input.sizeBytes,
    boundAt: input.movedAt,
    ...(input.beforeSourceRecheck === undefined
      ? {}
      : { beforeSourceRecheck: input.beforeSourceRecheck }),
  });
  if (
    verified.originPath === candidateRootPath ||
    !isWithin(candidateRootPath, verified.originPath)
  ) {
    throw new StorageValidationError(
      "Managed candidate knowledge directory member must be strictly inside its current root.",
    );
  }
  const moved = await storage.moveCandidateKnowledgeDirectoryMember({
    knowledgeBaseId,
    directoryId,
    sourceId,
    targetOriginPath: verified.originPath,
    mediaType: input.mediaType,
    checksum: verified.checksum,
    sizeBytes: verified.sizeBytes,
    expectedRootPath: candidateRootPath,
    expectedRootRevision: input.expectedRootRevision,
    expectedMemberRevision: input.expectedMemberRevision,
    expectedRelativePathHash: input.expectedRelativePathHash,
    expectedVersionId: input.expectedVersionId,
    expectedOriginBoundAt: input.expectedOriginBoundAt,
    movedAt: input.movedAt,
  } satisfies CandidateKnowledgeDirectoryMemberMoveInput);
  return Object.freeze({
    member: Object.freeze({ ...moved.member }),
    revision: Object.freeze({ ...moved.revision }),
    binding: Object.freeze({ ...moved.binding }),
    moved: moved.moved,
  });
}

function deletionResultFromAudit(
  audit: CandidateKnowledgeDeletionAuditRecord,
): CandidateKnowledgeDeletionResult {
  return Object.freeze({
    schemaVersion: candidateKnowledgeDeletionPlanSchemaVersion,
    status: "deleted",
    knowledgeBaseId: audit.knowledgeBaseId,
    operationId: audit.operationId,
    auditId: audit.auditId,
    confirmationToken: audit.confirmationToken,
    completedAt: audit.completedAt,
    managedArtifactCount: audit.counts.managedArtifactCount,
    managedArtifactBytes: audit.counts.managedArtifactBytes,
    preservedUnknownCount: audit.counts.preservedUnknownCount,
    preservedUnmanagedCount: audit.counts.preservedUnmanagedCount,
    countCapped: audit.counts.countCapped,
    audit,
  });
}

function requiredDeletionConfirmationToken(value: string): string {
  const token = requiredManagedText(value, "Candidate knowledge deletion confirmation token");
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new StorageValidationError("Candidate knowledge deletion confirmation token is invalid.");
  }
  return token;
}

async function deleteCandidateKnowledgeBase(
  storage: SqliteStorage,
  descriptor: CandidateKnowledgeStoreDescriptor,
  root: string,
  knowledgeBaseIdInput: string,
  confirmationTokenInput: string,
  options: CandidateKnowledgeDeletionOptions = {},
): Promise<CandidateKnowledgeDeletionResult> {
  const knowledgeBaseId = requiredManagedText(
    knowledgeBaseIdInput,
    "Candidate knowledge deletion knowledge base id",
  );
  const confirmationToken = requiredDeletionConfirmationToken(confirmationTokenInput);
  // A retry may run in the same process after an injected interruption. Run
  // the same journal recovery used during store-open so the retry observes a
  // stable graph and can safely reuse an aborted operation.
  await recoverIncompleteCandidateKnowledgeDeletions(storage, root);
  const existingAudit = await storage.getCandidateKnowledgeDeletionAuditByToken(confirmationToken);
  if (existingAudit !== undefined) {
    if (existingAudit.knowledgeBaseId !== knowledgeBaseId) {
      throw new StorageConflictError("Candidate knowledge deletion confirmation is mismatched.");
    }
    return deletionResultFromAudit(existingAudit);
  }

  const planned = await planCandidateKnowledgeBaseDeletion(
    storage,
    descriptor,
    root,
    knowledgeBaseId,
  );
  if (planned.plan.confirmationToken !== confirmationToken) {
    throw new StorageConflictError("Candidate knowledge deletion confirmation is stale.");
  }
  if (planned.plan.status !== "ready") {
    throw new StorageConflictError("Candidate knowledge deletion is blocked by its current state.");
  }
  await options.beforeIntent?.();
  await interruptCandidateKnowledgeDeletionAt(options, "intent");

  const verifiedArtifacts = planned.inventory.artifacts.filter(
    (
      artifact,
    ): artifact is CandidateKnowledgeDeletionArtifactObservation & {
      readonly identity: FileIdentity;
    } => artifact.status === "verified" && artifact.identity !== null,
  );
  if (verifiedArtifacts.length !== planned.snapshot.managedArtifacts.length) {
    throw new StorageConflictError("Candidate knowledge deletion artifact inventory changed.");
  }
  const existingOperation = (await storage.listCandidateKnowledgeDeletionOperations()).find(
    (candidate) => candidate.confirmationToken === confirmationToken,
  );
  if (existingOperation !== undefined && existingOperation.knowledgeBaseId !== knowledgeBaseId) {
    throw new StorageConflictError("Candidate knowledge deletion confirmation is mismatched.");
  }
  const operationId = existingOperation?.operationId ?? deletionOperationId(confirmationToken);
  const createdAt = currentKnowledgeStoreTimestamp();
  const operationInput: CandidateKnowledgeDeletionOperationInput = {
    operationId,
    knowledgeBaseId,
    confirmationToken,
    graphDigest: planned.snapshot.graphDigest,
    createdAt,
    managedArtifactCount: planned.plan.managedArtifactCount,
    managedArtifactBytes: planned.plan.managedArtifactBytes,
    preservedUnknownCount: planned.plan.preservedUnknownCount,
    preservedUnmanagedCount: planned.plan.preservedUnmanagedCount,
    countCapped: planned.plan.countCapped,
    artifacts: verifiedArtifacts.map((artifact) => ({
      sourceId: artifact.sourceId,
      versionId: artifact.versionId,
      checksum: artifact.checksum,
      sizeBytes: artifact.sizeBytes,
      device: artifact.identity.dev,
      inode: artifact.identity.ino,
    })),
  };
  await storage.beginCandidateKnowledgeDeletion(operationInput);
  let logicallyCommitted = false;
  let stagingCreated = false;
  try {
    await options.beforeStaging?.();
    const staging = await createCandidateKnowledgeDeletionStaging(root, operationId);
    stagingCreated = true;
    await storage.stageCandidateKnowledgeDeletion(
      operationId,
      staging.identity.dev,
      staging.identity.ino,
    );
    const stagedOperation = (await storage.listCandidateKnowledgeDeletionOperations()).find(
      (candidate) => candidate.operationId === operationId,
    );
    if (stagedOperation === undefined) {
      throw new StorageConflictError("Candidate knowledge deletion operation disappeared.");
    }
    await moveCandidateKnowledgeDeletionArtifactsToStaging(root, stagedOperation, staging.path);
    await interruptCandidateKnowledgeDeletionAt(options, "staging");
    await options.beforeCommit?.();
    await verifyCandidateKnowledgeDeletionStagingArtifacts(root, stagedOperation, staging.path);
    await interruptCandidateKnowledgeDeletionAt(options, "before-commit");
    const commitInput: CandidateKnowledgeDeletionCommitInput = {
      operationId,
      knowledgeBaseId,
      confirmationToken,
      graphDigest: planned.snapshot.graphDigest,
      committedAt: currentKnowledgeStoreTimestamp(),
    };
    await storage.commitCandidateKnowledgeDeletion(commitInput);
    logicallyCommitted = true;
    await options.afterCommit?.();
    await interruptCandidateKnowledgeDeletionAt(options, "commit");
    await interruptCandidateKnowledgeDeletionAt(options, "after-commit");
    await options.beforeStagingCleanup?.();
    await interruptCandidateKnowledgeDeletionAt(options, "staging-cleanup");
    const committedOperation = (await storage.listCandidateKnowledgeDeletionOperations()).find(
      (candidate) => candidate.operationId === operationId,
    );
    if (committedOperation === undefined) {
      throw new StorageConflictError("Candidate knowledge deletion operation disappeared.");
    }
    await cleanupCandidateKnowledgeDeletionStaging(root, committedOperation);
    await options.afterStagingCleanup?.();
    await interruptCandidateKnowledgeDeletionAt(options, "after-staging-cleanup");
    const audit = await storage.completeCandidateKnowledgeDeletion(
      operationId,
      currentKnowledgeStoreTimestamp(),
    );
    return deletionResultFromAudit(audit);
  } catch (error) {
    if (logicallyCommitted || error instanceof SimulatedCandidateKnowledgeDeletionInterruption) {
      throw error;
    }
    const operation = (await storage.listCandidateKnowledgeDeletionOperations()).find(
      (candidate) => candidate.operationId === operationId,
    );
    if (
      operation !== undefined &&
      operation.phase !== "committed" &&
      operation.phase !== "completed"
    ) {
      const restored = await restoreCandidateKnowledgeDeletionArtifacts(root, operation);
      if (restored) {
        await storage.abortCandidateKnowledgeDeletion(operationId);
      } else {
        throw new StorageConflictError(
          "Candidate knowledge deletion failed and its original graph could not be restored.",
        );
      }
    }
    if (stagingCreated) {
      // The operation owns this namespace. Cleanup is best effort after a
      // successful restore; an inaccessible remainder is recovered on open.
      try {
        const afterAbort = (await storage.listCandidateKnowledgeDeletionOperations()).find(
          (candidate) => candidate.operationId === operationId,
        );
        if (afterAbort !== undefined && afterAbort.phase === "aborted") {
          await restoreCandidateKnowledgeDeletionArtifacts(root, afterAbort);
        }
      } catch {
        // Preserve the original failure and let deterministic open recovery retry.
      }
    }
    throw error;
  }
}

function createHandle(
  descriptor: CandidateKnowledgeStoreDescriptor,
  root: string,
  storage: SqliteStorage,
  recovery: ManagedCandidateKnowledgeWriteRecoveryReport,
): CandidateKnowledgeStoreHandle {
  const coordinateWrite = <T>(operation: string, callback: () => Promise<T>): Promise<T> =>
    withCandidateKnowledgeStoreWriterLease(root, operation, callback);
  const handle: CandidateKnowledgeStoreHandle = {
    descriptor: Object.freeze({ ...descriptor }),
    root,
    recoveryReport: recovery,
    withWriterLease: (operation, callback, options) =>
      withCandidateKnowledgeStoreWriterLease(root, operation, callback, options),
    ensureDefaultCandidateKnowledgeBase: (input) =>
      coordinateWrite("ckb-ensure-default", () =>
        storage.ensureDefaultCandidateKnowledgeBase(input),
      ),
    createCandidateKnowledgeBase: (input) =>
      coordinateWrite("ckb-create", () => storage.createCandidateKnowledgeBase(input)),
    getCandidateKnowledgeBase: (id) => storage.getCandidateKnowledgeBase(id),
    listCandidateKnowledgeBases: () => storage.listCandidateKnowledgeBases(),
    renameCandidateKnowledgeBase: (id, displayName, updatedAt) =>
      coordinateWrite("ckb-rename", () =>
        storage.renameCandidateKnowledgeBase(id, displayName, updatedAt),
      ),
    archiveCandidateKnowledgeBase: (id, archivedAt) =>
      coordinateWrite("ckb-archive", () => storage.archiveCandidateKnowledgeBase(id, archivedAt)),
    createCandidateKnowledgeSource: (source, initialVersion) =>
      coordinateWrite("ckb-source-create", () =>
        storage.createCandidateKnowledgeSource(source, initialVersion),
      ),
    appendCandidateKnowledgeSourceVersion: (knowledgeBaseId, sourceId, version) =>
      coordinateWrite("ckb-source-append", () =>
        storage.appendCandidateKnowledgeSourceVersion(knowledgeBaseId, sourceId, version),
      ),
    getCandidateKnowledgeSource: (knowledgeBaseId, sourceId) =>
      storage.getCandidateKnowledgeSource(knowledgeBaseId, sourceId),
    listCandidateKnowledgeSources: (knowledgeBaseId) =>
      storage.listCandidateKnowledgeSources(knowledgeBaseId),
    listCandidateKnowledgeSourceVersions: (knowledgeBaseId, sourceId) =>
      storage.listCandidateKnowledgeSourceVersions(knowledgeBaseId, sourceId),
    getCandidateKnowledgeBaseLifecycleReadiness: async (knowledgeBaseId) => {
      const readiness = await storage.getCandidateKnowledgeBaseLifecycleReadiness(knowledgeBaseId);
      return readiness === undefined ? undefined : readiness;
    },
    getCandidateKnowledgeSourceOriginBinding: async (knowledgeBaseId, sourceId) => {
      const binding = await storage.getCandidateKnowledgeSourceOriginBinding(
        knowledgeBaseId,
        sourceId,
      );
      return binding === undefined ? undefined : Object.freeze({ ...binding });
    },
    createCandidateKnowledgeDirectoryBinding: (input) =>
      coordinateWrite("ckb-directory-bind", async () =>
        Object.freeze({ ...(await storage.createCandidateKnowledgeDirectoryBinding(input)) }),
      ),
    getCandidateKnowledgeDirectoryBinding: async (knowledgeBaseId, directoryId) => {
      const binding = await storage.getCandidateKnowledgeDirectoryBinding(
        knowledgeBaseId,
        directoryId,
      );
      return binding === undefined ? undefined : Object.freeze({ ...binding });
    },
    getCandidateKnowledgeDirectoryCurrentRootRevision: async (knowledgeBaseId, directoryId) => {
      const revision = await storage.getCandidateKnowledgeDirectoryCurrentRootRevision(
        knowledgeBaseId,
        directoryId,
      );
      return revision === undefined ? undefined : Object.freeze({ ...revision });
    },
    getCandidateKnowledgeDirectoryMemberCurrentRevision: async (
      knowledgeBaseId,
      directoryId,
      sourceId,
    ) => {
      const revision = await storage.getCandidateKnowledgeDirectoryMemberCurrentRevision(
        knowledgeBaseId,
        directoryId,
        sourceId,
      );
      return revision === undefined ? undefined : Object.freeze({ ...revision });
    },
    rebindManagedCandidateKnowledgeDirectoryRoot: (input) =>
      coordinateWrite("ckb-directory-root-rebind", async () => {
        const candidateRootPath = await verifyCandidateDirectoryRoot(root, input.candidateRootPath);
        if (!Array.isArray(input.members)) {
          throw new StorageValidationError(
            "Candidate knowledge directory root rebind members are required.",
          );
        }
        const sourceIds = new Set<string>();
        const verifiedMembers: Array<
          CandidateKnowledgeDirectoryRootRebindInput["members"][number]
        > = [];
        const members = [...input.members].sort((left, right) =>
          left.sourceId.localeCompare(right.sourceId),
        );
        for (const member of members) {
          const sourceId = requiredManagedText(
            member.sourceId,
            "Candidate knowledge directory root rebind source id",
          );
          if (sourceIds.has(sourceId)) {
            throw new StorageConflictError(
              "Candidate knowledge directory root rebind sources must be unique.",
            );
          }
          sourceIds.add(sourceId);
          const verified = await verifyManagedFileOrigin(root, {
            sourcePath: member.sourcePath,
            mediaType: member.mediaType,
            checksum: member.checksum,
            sizeBytes: member.sizeBytes,
            boundAt: input.reboundAt,
            beforeSourceRecheck: member.beforeSourceRecheck,
          });
          if (
            verified.originPath === candidateRootPath ||
            !isWithin(candidateRootPath, verified.originPath)
          ) {
            throw new StorageValidationError(
              "Candidate knowledge directory root rebind source must be strictly inside its root.",
            );
          }
          verifiedMembers.push({
            sourceId,
            originPath: verified.originPath,
            mediaType: member.mediaType,
            checksum: verified.checksum,
            sizeBytes: verified.sizeBytes,
            expectedVersionId: member.expectedVersionId,
            expectedOriginBoundAt: member.expectedOriginBoundAt,
          });
        }
        const rebound = await storage.rebindCandidateKnowledgeDirectoryRoot({
          knowledgeBaseId: input.knowledgeBaseId,
          directoryId: input.directoryId,
          candidateRootPath,
          expectedRootPath: input.expectedRootPath,
          expectedRevision: input.expectedRevision,
          reboundAt: input.reboundAt,
          members: verifiedMembers,
        });
        return Object.freeze({
          binding: Object.freeze({ ...rebound.binding }),
          revision: Object.freeze({ ...rebound.revision }),
          rebound: rebound.rebound,
        });
      }),
    moveManagedCandidateKnowledgeDirectoryMember: (input) =>
      coordinateWrite("ckb-directory-member-move", () =>
        moveManagedCandidateKnowledgeDirectoryMember(storage, root, input),
      ),
    findCandidateKnowledgeDirectoryBinding: async (knowledgeBaseId, rootPath) => {
      const binding = await storage.findCandidateKnowledgeDirectoryBinding(
        knowledgeBaseId,
        rootPath,
      );
      return binding === undefined ? undefined : Object.freeze({ ...binding });
    },
    listCandidateKnowledgeDirectoryMembers: async (knowledgeBaseId, directoryId) =>
      Object.freeze(
        (await storage.listCandidateKnowledgeDirectoryMembers(knowledgeBaseId, directoryId)).map(
          (member) => Object.freeze({ ...member }),
        ),
      ),
    findCandidateKnowledgeDirectoryMemberByPath: async (
      knowledgeBaseId,
      directoryId,
      sourcePath,
    ) => {
      const member = await storage.findCandidateKnowledgeDirectoryMemberByPath(
        knowledgeBaseId,
        directoryId,
        sourcePath,
      );
      return member === undefined ? undefined : Object.freeze({ ...member });
    },
    findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath: async (
      knowledgeBaseId,
      directoryId,
      candidateRootPath,
      sourcePath,
    ) => {
      const member = await storage.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        knowledgeBaseId,
        directoryId,
        candidateRootPath,
        sourcePath,
      );
      return member === undefined ? undefined : Object.freeze({ ...member });
    },
    getCandidateKnowledgeDirectoryMemberOriginRelation: async (
      knowledgeBaseId,
      directoryId,
      sourceId,
    ) =>
      Object.freeze({
        ...(await storage.getCandidateKnowledgeDirectoryMemberOriginRelation(
          knowledgeBaseId,
          directoryId,
          sourceId,
        )),
      }),
    upsertCandidateKnowledgeDirectoryRefreshObservations: (knowledgeBaseId, directoryId, input) =>
      coordinateWrite("ckb-directory-observe", async () =>
        Object.freeze(
          (
            await storage.upsertCandidateKnowledgeDirectoryRefreshObservations(
              knowledgeBaseId,
              directoryId,
              input,
            )
          ).map((observation) => Object.freeze({ ...observation })),
        ),
      ),
    getCandidateKnowledgeSourceRefreshObservation: async (knowledgeBaseId, sourceId) => {
      const observation = await storage.getCandidateKnowledgeSourceRefreshObservation(
        knowledgeBaseId,
        sourceId,
      );
      return observation === undefined ? undefined : Object.freeze({ ...observation });
    },
    getCandidateKnowledgeSourceUrlProvenance: async (knowledgeBaseId, sourceId, versionId) => {
      const provenance = await storage.getCandidateKnowledgeSourceUrlProvenance(
        knowledgeBaseId,
        sourceId,
        versionId,
      );
      return provenance === undefined ? undefined : Object.freeze({ ...provenance });
    },
    getCandidateKnowledgeSourcePortableUrlProvenance: async (
      knowledgeBaseId,
      sourceId,
      versionId,
    ) => {
      const provenance = await storage.getCandidateKnowledgeSourcePortableUrlProvenance(
        knowledgeBaseId,
        sourceId,
        versionId,
      );
      return provenance === undefined ? undefined : Object.freeze({ ...provenance });
    },
    upsertCandidateKnowledgeSourceRefreshObservation: (knowledgeBaseId, sourceId, input) =>
      coordinateWrite("ckb-source-observe", async () =>
        Object.freeze({
          ...(await storage.upsertCandidateKnowledgeSourceRefreshObservation(
            knowledgeBaseId,
            sourceId,
            input,
          )),
        }),
      ),
    getCandidateKnowledgeSourceRetirement: async (knowledgeBaseId, sourceId) => {
      const retirement = await storage.getCandidateKnowledgeSourceRetirement(
        knowledgeBaseId,
        sourceId,
      );
      return retirement === undefined ? undefined : Object.freeze({ ...retirement });
    },
    retireCandidateKnowledgeSource: (knowledgeBaseId, sourceId, input) =>
      coordinateWrite("ckb-source-retire", async () =>
        Object.freeze({
          ...(await storage.retireCandidateKnowledgeSource(knowledgeBaseId, sourceId, input)),
        }),
      ),
    retireCandidateKnowledgeDirectoryMember: async (
      knowledgeBaseId,
      directoryId,
      sourceId,
      input,
    ) =>
      coordinateWrite("ckb-directory-member-retire", async () =>
        Object.freeze({
          ...(await storage.retireCandidateKnowledgeDirectoryMember(
            knowledgeBaseId,
            directoryId,
            sourceId,
            input,
          )),
        }),
      ),
    getCandidateKnowledgeRetentionPolicy: async (knowledgeBaseId) =>
      storage.getCandidateKnowledgeRetentionPolicy(knowledgeBaseId),
    setCandidateKnowledgeRetentionPolicy: (knowledgeBaseId, input) =>
      coordinateWrite("ckb-retention-policy", () =>
        storage.setCandidateKnowledgeRetentionPolicy(knowledgeBaseId, input),
      ),
    applyCandidateKnowledgeRetentionOverride: (knowledgeBaseId, input) =>
      coordinateWrite("ckb-retention-override-apply", () =>
        storage.applyCandidateKnowledgeRetentionOverride(knowledgeBaseId, input),
      ),
    releaseCandidateKnowledgeRetentionOverride: (knowledgeBaseId, input) =>
      coordinateWrite("ckb-retention-override-release", () =>
        storage.releaseCandidateKnowledgeRetentionOverride(knowledgeBaseId, input),
      ),
    planCandidateKnowledgeRetention: (knowledgeBaseId, asOf) =>
      coordinateWrite("ckb-retention-plan", () =>
        planCandidateKnowledgeRetention(storage, root, knowledgeBaseId, asOf),
      ),
    planCandidateKnowledgeBaseDeletion: (knowledgeBaseId) =>
      coordinateWrite(
        "ckb-deletion-plan",
        async () =>
          (await planCandidateKnowledgeBaseDeletion(storage, descriptor, root, knowledgeBaseId))
            .plan,
      ),
    deleteCandidateKnowledgeBase: (knowledgeBaseId, confirmationToken, options) =>
      coordinateWrite("ckb-deletion", () =>
        deleteCandidateKnowledgeBase(
          storage,
          descriptor,
          root,
          knowledgeBaseId,
          confirmationToken,
          options,
        ),
      ),
    createManagedCandidateKnowledgeFileSource: (source, initialVersion) =>
      coordinateWrite("ckb-managed-file-create", () =>
        writeManagedCandidateKnowledgeFile(storage, root, {
          kind: "create",
          source,
          version: initialVersion,
        }),
      ),
    createManagedCandidateKnowledgeUrlSource: (source, initialVersion) =>
      coordinateWrite("ckb-managed-url-create", () =>
        writeManagedCandidateKnowledgeUrlVersion(storage, root, {
          kind: "create",
          source,
          version: initialVersion,
        }),
      ),
    appendManagedCandidateKnowledgeUrlVersion: (knowledgeBaseId, sourceId, version) =>
      coordinateWrite("ckb-managed-url-append", () =>
        writeManagedCandidateKnowledgeUrlVersion(storage, root, {
          kind: "append",
          knowledgeBaseId,
          sourceId,
          version,
        }),
      ),
    appendManagedCandidateKnowledgeFileVersion: (knowledgeBaseId, sourceId, version) =>
      coordinateWrite("ckb-managed-file-append", () =>
        writeManagedCandidateKnowledgeFile(storage, root, {
          kind: "append",
          knowledgeBaseId,
          sourceId,
          version,
        }),
      ),
    rebindManagedCandidateKnowledgeFileOrigin: (knowledgeBaseId, sourceId, input) =>
      coordinateWrite("ckb-managed-file-rebind", () =>
        rebindManagedCandidateKnowledgeFileOrigin(storage, root, knowledgeBaseId, sourceId, input),
      ),
    getManagedCandidateKnowledgeFilePath: async (knowledgeBaseId, sourceId, versionId) => {
      const managed = await storage.isCandidateKnowledgeSourceVersionManaged(
        knowledgeBaseId,
        sourceId,
        versionId,
      );
      if (!managed) return undefined;
      const versions = await storage.listCandidateKnowledgeSourceVersions(
        knowledgeBaseId,
        sourceId,
      );
      const version = versions.find((candidate) => candidate.id === versionId.trim());
      if (version === undefined) return undefined;
      const path = managedVersionPath(root, sourceId.trim(), version.id);
      await verifyManagedFile(path, version);
      return path;
    },
    inspectManagedCandidateKnowledgeFiles: () =>
      inspectManagedCandidateKnowledgeFiles(storage, root),
    exportPortableBackup: (destination, options) =>
      coordinateWrite("ckb-portable-backup-export", () =>
        exportPortableBackupPackage(storage, descriptor, root, destination, options),
      ),
    close: () => storage.close(),
  };
  return Object.freeze(handle);
}

export async function openCandidateKnowledgeStore(
  rootInput: string,
): Promise<CandidateKnowledgeStoreHandle> {
  const requestedRoot = requiredPath(rootInput);
  await requireDirectory(requestedRoot, "Candidate knowledge store root");
  const root = await realpath(requestedRoot);
  const descriptor = await readDescriptor(root);
  const internalRoot = join(root, privateDirectory);
  const managedSources = join(root, sourcesDirectory);
  await requireDirectory(internalRoot, "Candidate knowledge store private directory");
  await requireDirectory(managedSources, "Candidate knowledge store sources directory");
  const databasePath = join(internalRoot, databaseFilename);
  await requireRegularFile(
    databasePath,
    "Candidate knowledge store database",
    maximumDatabaseBytes,
  );
  let storage: SqliteStorage | undefined;
  try {
    const recovery = await withCandidateKnowledgeStoreWriterLease(
      root,
      "ckb-recovery",
      async () => {
        storage = openSqliteStorage(databasePath);
        await validateOpenedStore(storage, descriptor);
        const report = await recoverIncompleteManagedCandidateKnowledgeWrites(storage, root);
        await recoverIncompleteCandidateKnowledgeDeletions(storage, root);
        await validateOpenedStore(storage, descriptor);
        await validateManagedCandidateKnowledgeFiles(storage, root);
        return report;
      },
    );
    if (storage === undefined) {
      throw new StorageValidationError("Candidate knowledge store database could not be opened.");
    }
    return createHandle(descriptor, root, storage, recovery);
  } catch (error) {
    if (storage !== undefined) await closePreservingFailure(storage);
    throw error;
  }
}

export async function initializeCandidateKnowledgeStore(
  input: InitializeCandidateKnowledgeStoreInput,
): Promise<CandidateKnowledgeStoreHandle> {
  const target = requiredPath(input.root);
  await requireAbsent(target);
  const parent = dirname(target);
  await requireDirectory(parent, "Candidate knowledge store parent directory");
  const descriptor = parseDescriptor(input.descriptor);
  const staging = join(parent, `.${basename(target)}.draft-loop-staging-${randomUUID()}`);
  await requireAbsent(staging);

  let storage: SqliteStorage | undefined;
  try {
    await mkdir(staging, { mode: 0o700 });
    await mkdir(join(staging, privateDirectory), { mode: 0o700 });
    await mkdir(join(staging, sourcesDirectory), { mode: 0o700 });
    await writeFile(join(staging, manifestFilename), `${JSON.stringify(descriptor, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });

    const databasePath = join(staging, privateDirectory, databaseFilename);
    storage = openSqliteStorage(databasePath);
    await storage.ensureDefaultCandidateKnowledgeBase(input.defaultKnowledgeBase);
    await persistDescriptorBinding(storage, descriptor);
    await storage.close();
    storage = undefined;

    // SQLite creates the database using the process umask. Tighten it explicitly.
    await chmodWhereSupported(databasePath, 0o600);
    await chmodWhereSupported(join(staging, manifestFilename), 0o600);
    await chmodWhereSupported(join(staging, privateDirectory), 0o700);
    await chmodWhereSupported(join(staging, sourcesDirectory), 0o700);
    await chmodWhereSupported(staging, 0o700);

    await input.beforePublish?.(target);

    // mkdir is the no-replace publication claim. Once it succeeds, this process
    // owns the new empty root; an existing path always fails without replacement.
    try {
      await mkdir(target, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new StorageConflictError("Candidate knowledge store target already exists.");
      }
      throw error;
    }

    // Publish only into exclusively created names. The staged files and target
    // are siblings on one filesystem, so hard links provide atomic no-replace
    // publication without copying a possibly large database. The manifest is
    // deliberately last: its presence is the readiness marker accepted by open.
    await mkdir(join(target, privateDirectory), { mode: 0o700 });
    await mkdir(join(target, sourcesDirectory), { mode: 0o700 });
    await link(
      join(staging, privateDirectory, databaseFilename),
      join(target, privateDirectory, databaseFilename),
    );
    await link(join(staging, manifestFilename), join(target, manifestFilename));
    try {
      await rm(staging, { recursive: true, force: true });
    } catch {
      // Publication is complete once the manifest exists. A stale, uniquely
      // named sibling staging directory is safer than reporting a false failure.
    }
  } catch (error) {
    if (storage !== undefined) {
      try {
        await storage.close();
      } catch {
        // Preserve the original initialization failure.
      }
    }
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return openCandidateKnowledgeStore(target);
}

export type { CandidateKnowledgeBaseRecord };
