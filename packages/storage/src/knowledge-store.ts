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
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  type CandidateKnowledgePortableBackupInspection,
  type CandidateKnowledgePortableBackupManifest,
  candidateKnowledgePortableBackupFormat,
  candidateKnowledgePortableBackupInspectionSchema,
  candidateKnowledgePortableBackupIntegrityIndicator,
  candidateKnowledgePortableBackupManifestChecksumFilename,
  candidateKnowledgePortableBackupManifestFilename,
  candidateKnowledgePortableBackupManifestSchema,
  candidateKnowledgePortableBackupMaximumEntries,
  candidateKnowledgePortableBackupObjectsDirectory,
  candidateKnowledgePortableBackupSchemaVersion,
  candidateKnowledgeStoreSchema,
} from "@draft-loop/schemas";

import {
  type CandidateKnowledgeBaseInput,
  type CandidateKnowledgeBaseRecord,
  type CandidateKnowledgeBaseStoragePort,
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
  type CandidateKnowledgeRetentionPlan,
  type CandidateKnowledgeRetentionPlanClass,
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

async function scanManagedCandidateKnowledgeDirectory(
  path: string,
  inventory: MutableManagedCandidateKnowledgeFileInventory,
  inspect: (entry: Dirent) => void,
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
      inspect(entry);
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

function portableBackupFailure(): StorageValidationError {
  return new StorageValidationError(
    "Portable candidate knowledge backup is invalid or incomplete.",
  );
}

function portableBackupExportFailure(): StorageValidationError {
  return new StorageValidationError("Portable candidate knowledge backup export failed.");
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
        const provenance = await storage.getCandidateKnowledgeSourceUrlProvenance(
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
