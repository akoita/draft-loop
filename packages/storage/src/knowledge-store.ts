import { createHash, randomUUID } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import {
  chmod,
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

import { candidateKnowledgeStoreSchema } from "@draft-loop/schemas";

import {
  type CandidateKnowledgeBaseInput,
  type CandidateKnowledgeBaseRecord,
  type CandidateKnowledgeBaseStoragePort,
  type CandidateKnowledgeDirectoryBindingInput,
  type CandidateKnowledgeDirectoryBindingRecord,
  type CandidateKnowledgeDirectoryMemberOriginRelationRecord,
  type CandidateKnowledgeDirectoryMemberRecord,
  type CandidateKnowledgeDirectoryMemberRetirementInput,
  type CandidateKnowledgeDirectoryRefreshObservationBatchInput,
  type CandidateKnowledgeDirectoryRootRebindInput,
  type CandidateKnowledgeDirectoryRootRebindResult,
  type CandidateKnowledgeDirectoryRootRevisionRecord,
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
  openSqliteStorage,
  type SqliteStorage,
  StorageConflictError,
  StorageValidationError,
  storageSchemaVersion,
} from "./index.js";

const manifestFilename = "draft-loop-knowledge.json";
const privateDirectory = ".draft-loop";
const databaseFilename = "knowledge.sqlite";
const sourcesDirectory = "sources";
const maximumManifestBytes = 64 * 1024;
const maximumDatabaseBytes = 16 * 1024 * 1024 * 1024;
const descriptorKeyPrefix = "candidateKnowledgeStore";

export const maximumManagedCandidateKnowledgeFileBytes = 20 * 1024 * 1024;
export const maximumManagedCandidateKnowledgeUrlResponseBytes = 4 * 1024 * 1024;
export const maximumManagedCandidateKnowledgeInventoryEntries = 1024;

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
  /** @internal Test seam after the no-replace link and before its published event. */
  readonly afterTargetPublication?: () => Promise<void>;
  /** @internal Test seam for simulating a failure after the atomic SQLite commit. */
  readonly beforeCommittedFileRecheck?: () => Promise<void>;
  /** @internal Test seam for simulating a staging cleanup failure after commit. */
  readonly beforeStagingCleanup?: () => Promise<void>;
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
  /** @internal Test seam after the no-replace link and before its published event. */
  readonly afterTargetPublication?: () => Promise<void>;
  /** @internal Test seam for simulating an integrity recheck failure after SQLite. */
  readonly beforeCommittedFileRecheck?: () => Promise<void>;
  /** @internal Test seam for simulating a staging cleanup failure after commit. */
  readonly beforeStagingCleanup?: () => Promise<void>;
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

export interface CandidateKnowledgeStoreHandle extends CandidateKnowledgeBaseStoragePort {
  readonly descriptor: CandidateKnowledgeStoreDescriptor;
  /** Canonical physical root. It is runtime state and is never persisted in the manifest. */
  readonly root: string;
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
  readonly rebindManagedCandidateKnowledgeDirectoryRoot: (
    input: RebindManagedCandidateKnowledgeDirectoryRootInput,
  ) => Promise<RebindManagedCandidateKnowledgeDirectoryRootResult>;
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
  readonly getManagedCandidateKnowledgeFilePath: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<string | undefined>;
  readonly inspectManagedCandidateKnowledgeFiles: () => Promise<ManagedCandidateKnowledgeFileInventory>;
  readonly close: () => Promise<void>;
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
  await storage.prepareManagedCandidateKnowledgeWrite({
    operationId,
    knowledgeBaseId,
    sourceId,
    requestedVersionId: requestedVersion.id,
    kind: operation.kind,
    createdAt: requestedVersion.createdAt,
  });
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
      await operation.version.beforeCommittedFileRecheck?.();
      await verifyManagedFile(targetPath as string, integrity);
      const expectedOriginPath =
        operation.version.expectedOriginBoundAt === undefined ? undefined : captured.originPath;
      return storage.recordManagedCandidateKnowledgeWriteNoop(
        operationId,
        requestedVersion,
        operation.version.expectedCurrentVersionId,
        operation.version.expectedOriginBoundAt,
        expectedOriginPath,
      );
    }

    if (publicationRequired) {
      targetPath = managedVersionPath(root, sourceId, targetVersionId);
      await storage.recordManagedCandidateKnowledgeWriteEvent(
        operationId,
        "targeted",
        targetVersionId,
        requestedVersion.createdAt,
      );
      targeted = true;
      const sourceDirectory = await ensureManagedSourceDirectory(root, sourceId);
      sourceDirectoryCreated = sourceDirectory.created;
      await publishManagedFile(
        captured.temporaryPath,
        captured.temporaryIdentity,
        targetPath,
        integrity,
      );
      published = true;
      await operation.version.afterTargetPublication?.();
      await storage.recordManagedCandidateKnowledgeWriteEvent(
        operationId,
        "published",
        targetVersionId,
        requestedVersion.createdAt,
      );
    }

    await operation.version.beforeDatabaseWrite?.();
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
          },
    );
    committed = true;
    const committedPath = managedVersionPath(root, sourceId, result.version.id);
    await operation.version.beforeCommittedFileRecheck?.();
    await verifyManagedFile(committedPath, result.version);
    await operation.version.beforeStagingCleanup?.();
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
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "completed",
      result.version.id,
      requestedVersion.createdAt,
    );
    return result;
  } catch (error) {
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
  await storage.prepareManagedCandidateKnowledgeWrite({
    operationId,
    knowledgeBaseId,
    sourceId,
    requestedVersionId: requestedVersion.id,
    kind: operation.kind,
    createdAt: requestedVersion.createdAt,
  });
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
      await operation.version.beforeCommittedFileRecheck?.();
      await verifyManagedFile(targetPath as string, {
        checksum: captured.checksum,
        sizeBytes: captured.sizeBytes,
      });
      return storage.recordManagedCandidateKnowledgeWriteNoop(
        operationId,
        requestedVersion,
        expectedCurrentVersionId,
      );
    }

    targetPath = managedVersionPath(root, sourceId, targetVersionId);
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "targeted",
      targetVersionId,
      requestedVersion.createdAt,
    );
    targeted = true;
    const sourceDirectory = await ensureManagedSourceDirectory(root, sourceId);
    sourceDirectoryCreated = sourceDirectory.created;
    await publishManagedFile(
      captured.temporaryPath,
      captured.temporaryIdentity,
      targetPath,
      captured,
    );
    published = true;
    await operation.version.afterTargetPublication?.();
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "published",
      targetVersionId,
      requestedVersion.createdAt,
    );
    await operation.version.beforeDatabaseWrite?.();
    const result = await storage.commitManagedCandidateKnowledgeWrite(
      operation.kind === "create"
        ? {
            kind: "create",
            operationId,
            source: { ...operation.source, id: sourceId, knowledgeBaseId },
            version: requestedVersion,
            urlProvenance: operation.version.provenance,
          }
        : {
            kind: "append",
            operationId,
            version: requestedVersion,
            urlProvenance: operation.version.provenance,
            ...(expectedCurrentVersionId === undefined ? {} : { expectedCurrentVersionId }),
          },
    );
    committed = true;
    const committedPath = managedVersionPath(root, sourceId, result.version.id);
    await operation.version.beforeCommittedFileRecheck?.();
    await verifyManagedFile(committedPath, result.version);
    await operation.version.beforeStagingCleanup?.();
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
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      operationId,
      "completed",
      result.version.id,
      requestedVersion.createdAt,
    );
    return result;
  } catch (error) {
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

function createHandle(
  descriptor: CandidateKnowledgeStoreDescriptor,
  root: string,
  storage: SqliteStorage,
): CandidateKnowledgeStoreHandle {
  const handle: CandidateKnowledgeStoreHandle = {
    descriptor: Object.freeze({ ...descriptor }),
    root,
    ensureDefaultCandidateKnowledgeBase: (input) =>
      storage.ensureDefaultCandidateKnowledgeBase(input),
    createCandidateKnowledgeBase: (input) => storage.createCandidateKnowledgeBase(input),
    getCandidateKnowledgeBase: (id) => storage.getCandidateKnowledgeBase(id),
    listCandidateKnowledgeBases: () => storage.listCandidateKnowledgeBases(),
    renameCandidateKnowledgeBase: (id, displayName, updatedAt) =>
      storage.renameCandidateKnowledgeBase(id, displayName, updatedAt),
    archiveCandidateKnowledgeBase: (id, archivedAt) =>
      storage.archiveCandidateKnowledgeBase(id, archivedAt),
    createCandidateKnowledgeSource: (source, initialVersion) =>
      storage.createCandidateKnowledgeSource(source, initialVersion),
    appendCandidateKnowledgeSourceVersion: (knowledgeBaseId, sourceId, version) =>
      storage.appendCandidateKnowledgeSourceVersion(knowledgeBaseId, sourceId, version),
    getCandidateKnowledgeSource: (knowledgeBaseId, sourceId) =>
      storage.getCandidateKnowledgeSource(knowledgeBaseId, sourceId),
    listCandidateKnowledgeSources: (knowledgeBaseId) =>
      storage.listCandidateKnowledgeSources(knowledgeBaseId),
    listCandidateKnowledgeSourceVersions: (knowledgeBaseId, sourceId) =>
      storage.listCandidateKnowledgeSourceVersions(knowledgeBaseId, sourceId),
    getCandidateKnowledgeSourceOriginBinding: async (knowledgeBaseId, sourceId) => {
      const binding = await storage.getCandidateKnowledgeSourceOriginBinding(
        knowledgeBaseId,
        sourceId,
      );
      return binding === undefined ? undefined : Object.freeze({ ...binding });
    },
    createCandidateKnowledgeDirectoryBinding: async (input) =>
      Object.freeze({ ...(await storage.createCandidateKnowledgeDirectoryBinding(input)) }),
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
    rebindManagedCandidateKnowledgeDirectoryRoot: async (input) => {
      const candidateRootPath = await verifyCandidateDirectoryRoot(root, input.candidateRootPath);
      if (!Array.isArray(input.members)) {
        throw new StorageValidationError(
          "Candidate knowledge directory root rebind members are required.",
        );
      }
      const sourceIds = new Set<string>();
      const verifiedMembers: Array<CandidateKnowledgeDirectoryRootRebindInput["members"][number]> =
        [];
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
    },
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
    upsertCandidateKnowledgeDirectoryRefreshObservations: async (
      knowledgeBaseId,
      directoryId,
      input,
    ) =>
      Object.freeze(
        (
          await storage.upsertCandidateKnowledgeDirectoryRefreshObservations(
            knowledgeBaseId,
            directoryId,
            input,
          )
        ).map((observation) => Object.freeze({ ...observation })),
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
    upsertCandidateKnowledgeSourceRefreshObservation: async (knowledgeBaseId, sourceId, input) =>
      Object.freeze({
        ...(await storage.upsertCandidateKnowledgeSourceRefreshObservation(
          knowledgeBaseId,
          sourceId,
          input,
        )),
      }),
    getCandidateKnowledgeSourceRetirement: async (knowledgeBaseId, sourceId) => {
      const retirement = await storage.getCandidateKnowledgeSourceRetirement(
        knowledgeBaseId,
        sourceId,
      );
      return retirement === undefined ? undefined : Object.freeze({ ...retirement });
    },
    retireCandidateKnowledgeSource: async (knowledgeBaseId, sourceId, input) =>
      Object.freeze({
        ...(await storage.retireCandidateKnowledgeSource(knowledgeBaseId, sourceId, input)),
      }),
    retireCandidateKnowledgeDirectoryMember: async (
      knowledgeBaseId,
      directoryId,
      sourceId,
      input,
    ) =>
      Object.freeze({
        ...(await storage.retireCandidateKnowledgeDirectoryMember(
          knowledgeBaseId,
          directoryId,
          sourceId,
          input,
        )),
      }),
    createManagedCandidateKnowledgeFileSource: (source, initialVersion) =>
      writeManagedCandidateKnowledgeFile(storage, root, {
        kind: "create",
        source,
        version: initialVersion,
      }),
    createManagedCandidateKnowledgeUrlSource: (source, initialVersion) =>
      writeManagedCandidateKnowledgeUrlVersion(storage, root, {
        kind: "create",
        source,
        version: initialVersion,
      }),
    appendManagedCandidateKnowledgeUrlVersion: (knowledgeBaseId, sourceId, version) =>
      writeManagedCandidateKnowledgeUrlVersion(storage, root, {
        kind: "append",
        knowledgeBaseId,
        sourceId,
        version,
      }),
    appendManagedCandidateKnowledgeFileVersion: (knowledgeBaseId, sourceId, version) =>
      writeManagedCandidateKnowledgeFile(storage, root, {
        kind: "append",
        knowledgeBaseId,
        sourceId,
        version,
      }),
    rebindManagedCandidateKnowledgeFileOrigin: (knowledgeBaseId, sourceId, input) =>
      rebindManagedCandidateKnowledgeFileOrigin(storage, root, knowledgeBaseId, sourceId, input),
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
  const storage = openSqliteStorage(databasePath);
  try {
    await validateOpenedStore(storage, descriptor);
    await validateManagedCandidateKnowledgeFiles(storage, root);
    return createHandle(descriptor, root, storage);
  } catch (error) {
    await closePreservingFailure(storage);
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
