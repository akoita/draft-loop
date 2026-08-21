import { randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { candidateKnowledgeStoreSchema } from "@draft-loop/schemas";

import {
  type CandidateKnowledgeBaseInput,
  type CandidateKnowledgeBaseRecord,
  type CandidateKnowledgeBaseStoragePort,
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

export interface CandidateKnowledgeStoreHandle extends CandidateKnowledgeBaseStoragePort {
  readonly descriptor: CandidateKnowledgeStoreDescriptor;
  /** Canonical physical root. It is runtime state and is never persisted in the manifest. */
  readonly root: string;
  readonly close: () => Promise<void>;
}

function requiredPath(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new StorageValidationError("Candidate knowledge store root is required.");
  }
  return resolve(value);
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
