import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
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
  type CandidateKnowledgeSourceInput,
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
  /** Runtime-only import location. It is never persisted or returned in product records. */
  readonly sourcePath: string;
  /** @internal Test seam for mutating the opened source before its final stability check. */
  readonly beforeSourceRecheck?: () => Promise<void>;
  /** @internal Test seam for simulating a failure after file publication but before SQLite. */
  readonly beforeDatabaseWrite?: () => Promise<void>;
}

export interface CandidateKnowledgeStoreHandle extends CandidateKnowledgeBaseStoragePort {
  readonly descriptor: CandidateKnowledgeStoreDescriptor;
  /** Canonical physical root. It is runtime state and is never persisted in the manifest. */
  readonly root: string;
  readonly createManagedCandidateKnowledgeFileSource: (
    source: CandidateKnowledgeSourceInput,
    initialVersion: ManagedCandidateKnowledgeFileVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly appendManagedCandidateKnowledgeFileVersion: (
    knowledgeBaseId: string,
    sourceId: string,
    version: ManagedCandidateKnowledgeFileVersionInput,
  ) => Promise<CandidateKnowledgeSourceVersionWriteResult>;
  readonly getManagedCandidateKnowledgeFilePath: (
    knowledgeBaseId: string,
    sourceId: string,
    versionId: string,
  ) => Promise<string | undefined>;
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
  readonly temporaryPath: string;
}

async function captureManagedFile(
  root: string,
  input: ManagedCandidateKnowledgeFileVersionInput,
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
  const temporaryPath = join(root, sourcesDirectory, `.intake-${randomUUID()}`);
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
    return { checksum, sizeBytes, temporaryPath };
  } catch (error) {
    await closeQuietly(temporaryHandle);
    await closeQuietly(sourceHandle);
    await rm(temporaryPath, { force: true });
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError(
      "Managed candidate knowledge source could not be read safely.",
    );
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
  finalPath: string,
  version: Pick<CandidateKnowledgeSourceVersionRecord, "checksum" | "sizeBytes">,
): Promise<boolean> {
  let created = false;
  try {
    await link(temporaryPath, finalPath);
    created = true;
    await chmodWhereSupported(finalPath, 0o600);
    await verifyManagedFile(finalPath, version);
    return true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      if (created) {
        try {
          const [published, staged] = await Promise.all([lstat(finalPath), lstat(temporaryPath)]);
          if (
            !published.isSymbolicLink() &&
            published.isFile() &&
            published.dev === staged.dev &&
            published.ino === staged.ino
          ) {
            await rm(finalPath);
          }
        } catch {
          // Preserve a path that disappeared or changed concurrently.
        }
      }
      throw error;
    }
    try {
      await verifyManagedFile(finalPath, version);
    } catch {
      throw new StorageConflictError(
        "Managed candidate knowledge source version target already contains different content.",
      );
    }
    return false;
  }
}

async function validateManagedCandidateKnowledgeFiles(
  storage: SqliteStorage,
  root: string,
): Promise<void> {
  for (const version of storage.listManagedCandidateKnowledgeSourceVersions()) {
    if (version.kind !== "file") {
      throw new StorageValidationError(
        "Candidate knowledge store contains a managed version for a non-file source.",
      );
    }
    const sourceDirectory = join(root, sourcesDirectory, managedPathSegment(version.sourceId));
    await requireDirectory(sourceDirectory, "Managed candidate knowledge source directory");
    await verifyManagedFile(managedVersionPath(root, version.sourceId, version.id), version);
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
  input: ManagedCandidateKnowledgeFileVersionInput,
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

async function removeUncommittedManagedFile(
  storage: SqliteStorage,
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
  path: string,
  temporaryPath: string,
  createdFile: boolean,
  createdDirectory: boolean,
): Promise<void> {
  if (!createdFile) {
    if (createdDirectory) {
      try {
        await rmdir(dirname(path));
      } catch {
        // Preserve a directory that is no longer empty or was changed concurrently.
      }
    }
    return;
  }
  let managed: boolean;
  try {
    managed = await storage.isCandidateKnowledgeSourceVersionManaged(
      knowledgeBaseId,
      sourceId,
      versionId,
    );
  } catch {
    return;
  }
  if (managed) return;
  try {
    const [published, staged] = await Promise.all([lstat(path), lstat(temporaryPath)]);
    if (
      published.isSymbolicLink() ||
      !published.isFile() ||
      published.dev !== staged.dev ||
      published.ino !== staged.ino
    ) {
      return;
    }
    await rm(path);
  } catch {
    return;
  }
  if (createdDirectory) {
    try {
      await rmdir(dirname(path));
    } catch {
      // Preserve a directory that is no longer empty or was changed concurrently.
    }
  }
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
  const requestedVersion = managedVersionMetadata(operation.version);
  const captured = await captureManagedFile(root, operation.version);
  const integrity = {
    checksum: captured.checksum,
    sizeBytes: captured.sizeBytes,
  };
  try {
    let targetVersionId = requestedVersion.id;
    if (operation.kind === "append") {
      const versions = await storage.listCandidateKnowledgeSourceVersions(
        knowledgeBaseId,
        sourceId,
      );
      const current = versions.at(-1);
      if (current?.checksum === captured.checksum) targetVersionId = current.id;
    }

    const sourceDirectory = await ensureManagedSourceDirectory(root, sourceId);
    const targetPath = managedVersionPath(root, sourceId, targetVersionId);
    let createdTarget = false;
    try {
      createdTarget = await publishManagedFile(captured.temporaryPath, targetPath, integrity);
      await operation.version.beforeDatabaseWrite?.();
      const result =
        operation.kind === "create"
          ? await storage.createManagedCandidateKnowledgeSource(
              { ...operation.source, id: sourceId, knowledgeBaseId },
              requestedVersion,
            )
          : await storage.appendManagedCandidateKnowledgeSourceVersion(
              knowledgeBaseId,
              sourceId,
              requestedVersion,
            );

      const committedPath = managedVersionPath(root, sourceId, result.version.id);
      if (committedPath !== targetPath) {
        await publishManagedFile(captured.temporaryPath, committedPath, result.version);
        await removeUncommittedManagedFile(
          storage,
          knowledgeBaseId,
          sourceId,
          targetVersionId,
          targetPath,
          captured.temporaryPath,
          createdTarget,
          sourceDirectory.created,
        );
      }
      await verifyManagedFile(committedPath, result.version);
      return result;
    } catch (error) {
      await removeUncommittedManagedFile(
        storage,
        knowledgeBaseId,
        sourceId,
        targetVersionId,
        targetPath,
        captured.temporaryPath,
        createdTarget,
        sourceDirectory.created,
      );
      throw error;
    }
  } finally {
    await rm(captured.temporaryPath, { force: true });
  }
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
    createManagedCandidateKnowledgeFileSource: (source, initialVersion) =>
      writeManagedCandidateKnowledgeFile(storage, root, {
        kind: "create",
        source,
        version: initialVersion,
      }),
    appendManagedCandidateKnowledgeFileVersion: (knowledgeBaseId, sourceId, version) =>
      writeManagedCandidateKnowledgeFile(storage, root, {
        kind: "append",
        knowledgeBaseId,
        sourceId,
        version,
      }),
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
