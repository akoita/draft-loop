import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename } from "node:path";

import {
  type CandidateKnowledgeBase,
  type CandidateKnowledgeSource,
  type CandidateKnowledgeSourceKind,
  type CandidateKnowledgeSourceVersion,
  type CandidateKnowledgeStore,
  createCandidateKnowledgeSource,
  createCandidateKnowledgeSourceVersion,
  createCandidateKnowledgeStore,
} from "@draft-loop/domain";
import { ingestFile } from "@draft-loop/ingestion";
import type {
  CandidateKnowledgeSourceRecord,
  CandidateKnowledgeSourceRefreshObservationRecord,
  CandidateKnowledgeSourceVersionRecord,
} from "@draft-loop/storage";
import {
  type CandidateKnowledgeBaseRecord,
  type CandidateKnowledgeStoreHandle,
  initializeCandidateKnowledgeStore,
  type ManagedCandidateKnowledgeFileInventory,
  maximumManagedCandidateKnowledgeFileBytes,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";

export type {
  CandidateKnowledgeBase,
  CandidateKnowledgeSource,
  CandidateKnowledgeSourceKind,
  CandidateKnowledgeSourceVersion,
  CandidateKnowledgeStore,
} from "@draft-loop/domain";

const defaultKnowledgeBaseDisplayName = "Career evidence";

export interface InitializeStoreCommand {
  readonly storeRoot: string;
  readonly displayName?: string;
  readonly description?: string;
}

export interface OpenStoreCommand {
  readonly storeRoot: string;
}

export interface ListKnowledgeBasesCommand {
  readonly storeRoot: string;
}

export interface CreateKnowledgeBaseCommand {
  readonly storeRoot: string;
  readonly displayName: string;
  readonly description?: string;
}

export interface RenameKnowledgeBaseCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly displayName: string;
}

export interface ArchiveKnowledgeBaseCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
}

export interface CreateKnowledgeSourceCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly kind: CandidateKnowledgeSourceKind;
  readonly displayName: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
}

export interface AppendKnowledgeSourceVersionCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
}

export interface ImportKnowledgeSourceFileCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourcePath: string;
  readonly displayName?: string;
}

export interface AppendKnowledgeSourceFileVersionCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly sourcePath: string;
}

export interface ListKnowledgeSourceManifestsCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
}

export interface InspectManagedCandidateKnowledgeFilesCommand {
  readonly storeRoot: string;
}

export interface CheckKnowledgeSourceOriginStatusCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
}

export interface RefreshKnowledgeSourceFromOriginCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
}

export interface RebindKnowledgeSourceOriginCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly sourcePath: string;
}

export interface GetKnowledgeSourceRefreshStateCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
}

export type KnowledgeSourceOriginStatus =
  | "unbound"
  | "current"
  | "changed"
  | "missing"
  | "inaccessible";

export interface KnowledgeSourceOriginStatusResult {
  readonly sourceId: string;
  readonly checkedAt: string;
  readonly status: KnowledgeSourceOriginStatus;
}

export type KnowledgeSourceOriginRefreshStatus =
  | "unbound"
  | "current"
  | "refreshed"
  | "missing"
  | "inaccessible";

export interface KnowledgeSourceOriginRefreshResult {
  readonly sourceId: string;
  readonly checkedAt: string;
  readonly status: KnowledgeSourceOriginRefreshStatus;
  readonly versionId?: string;
}

export type KnowledgeSourceOriginRebindStatus = "current" | "rebound";

export interface KnowledgeSourceOriginRebindResult {
  readonly sourceId: string;
  readonly status: KnowledgeSourceOriginRebindStatus;
  readonly boundAt: string;
}

export type KnowledgeSourceRefreshStateStatus =
  | "unobserved"
  | "stale"
  | "current"
  | "changed"
  | "missing"
  | "inaccessible"
  | "unbound";

export interface KnowledgeSourceRefreshStateResult {
  readonly sourceId: string;
  readonly status: KnowledgeSourceRefreshStateStatus;
  readonly checkedAt?: string;
  readonly observedVersionId?: string;
  readonly lastRefreshedAt?: string;
  readonly lastRefreshedVersionId?: string;
}

/** Local application metadata; names and descriptions are not a diagnostic allowlist. */
export interface CandidateKnowledgeStoreView {
  readonly store: CandidateKnowledgeStore;
  readonly knowledgeBases: readonly CandidateKnowledgeBase[];
}

export interface CandidateKnowledgeSourceManifest {
  readonly source: CandidateKnowledgeSource;
  readonly versions: readonly CandidateKnowledgeSourceVersion[];
}

export interface CandidateKnowledgeSourceWriteResult extends CandidateKnowledgeSourceManifest {
  readonly created: boolean;
}

export interface CandidateKnowledgeStoreService {
  readonly initializeStore: (
    command: InitializeStoreCommand,
  ) => Promise<CandidateKnowledgeStoreView>;
  readonly openStore: (command: OpenStoreCommand) => Promise<CandidateKnowledgeStoreView>;
  readonly listKnowledgeBases: (
    command: ListKnowledgeBasesCommand,
  ) => Promise<CandidateKnowledgeStoreView>;
  readonly createKnowledgeBase: (
    command: CreateKnowledgeBaseCommand,
  ) => Promise<CandidateKnowledgeStoreView>;
  readonly renameKnowledgeBase: (
    command: RenameKnowledgeBaseCommand,
  ) => Promise<CandidateKnowledgeStoreView>;
  readonly archiveKnowledgeBase: (
    command: ArchiveKnowledgeBaseCommand,
  ) => Promise<CandidateKnowledgeStoreView>;
  readonly createKnowledgeSource: (
    command: CreateKnowledgeSourceCommand,
  ) => Promise<CandidateKnowledgeSourceWriteResult>;
  readonly appendKnowledgeSourceVersion: (
    command: AppendKnowledgeSourceVersionCommand,
  ) => Promise<CandidateKnowledgeSourceWriteResult>;
  readonly importKnowledgeSourceFile: (
    command: ImportKnowledgeSourceFileCommand,
  ) => Promise<CandidateKnowledgeSourceWriteResult>;
  readonly appendKnowledgeSourceFileVersion: (
    command: AppendKnowledgeSourceFileVersionCommand,
  ) => Promise<CandidateKnowledgeSourceWriteResult>;
  readonly listKnowledgeSourceManifests: (
    command: ListKnowledgeSourceManifestsCommand,
  ) => Promise<readonly CandidateKnowledgeSourceManifest[]>;
  readonly inspectManagedCandidateKnowledgeFiles: (
    command: InspectManagedCandidateKnowledgeFilesCommand,
  ) => Promise<ManagedCandidateKnowledgeFileInventory>;
  readonly checkKnowledgeSourceOriginStatus: (
    command: CheckKnowledgeSourceOriginStatusCommand,
  ) => Promise<KnowledgeSourceOriginStatusResult>;
  readonly refreshKnowledgeSourceFromOrigin: (
    command: RefreshKnowledgeSourceFromOriginCommand,
  ) => Promise<KnowledgeSourceOriginRefreshResult>;
  readonly rebindKnowledgeSourceOrigin: (
    command: RebindKnowledgeSourceOriginCommand,
  ) => Promise<KnowledgeSourceOriginRebindResult>;
  readonly getKnowledgeSourceRefreshState: (
    command: GetKnowledgeSourceRefreshStateCommand,
  ) => Promise<KnowledgeSourceRefreshStateResult>;
}

export interface CandidateKnowledgeStoreServiceDependencies {
  readonly generateId?: () => string;
  readonly now?: () => string;
  readonly initialize?: typeof initializeCandidateKnowledgeStore;
  readonly open?: typeof openCandidateKnowledgeStore;
  readonly ingestFile?: typeof ingestFile;
  /** @internal Narrow read-only seam for deterministic origin status checks. */
  readonly lstat?: typeof lstat;
}

interface ResolvedDependencies {
  readonly generateId: () => string;
  readonly now: () => string;
  readonly initialize: typeof initializeCandidateKnowledgeStore;
  readonly open: typeof openCandidateKnowledgeStore;
  readonly ingestFile: typeof ingestFile;
  readonly lstat: typeof lstat;
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function requireStoreRoot(storeRoot: string): string {
  if (typeof storeRoot !== "string" || storeRoot.trim() === "") {
    throw new Error("Candidate knowledge store root is required.");
  }
  return storeRoot;
}

const maximumSourceDisplayNameCharacters = 200;
const unsafeSourceDisplayNamePattern = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function sourceDisplayName(sourcePath: string, explicitDisplayName?: string): string {
  const value = (explicitDisplayName ?? basename(sourcePath)).trim();
  if (value === "") {
    throw new Error("Candidate knowledge source display name is required.");
  }
  if (Array.from(value).length > maximumSourceDisplayNameCharacters) {
    throw new Error(
      `Candidate knowledge source display name must be at most ${maximumSourceDisplayNameCharacters} characters.`,
    );
  }
  if (unsafeSourceDisplayNamePattern.test(value)) {
    throw new Error("Candidate knowledge source display name contains unsupported characters.");
  }
  if (explicitDisplayName !== undefined && /[\\/]/u.test(value)) {
    throw new Error("Candidate knowledge source display name must not contain path separators.");
  }
  return value;
}

function importFailure(): Error {
  return new Error("The selected candidate knowledge source file could not be imported.");
}

function appendFileVersionFailure(): Error {
  return new Error(
    "The selected candidate knowledge source file could not be added as a new version.",
  );
}

async function ingestManagedCandidateKnowledgeFile(
  ingest: typeof ingestFile,
  sourcePath: string,
  failure: () => Error,
): Promise<NonNullable<Awaited<ReturnType<typeof ingestFile>>["source"]>> {
  let ingestion: Awaited<ReturnType<typeof ingestFile>>;
  try {
    ingestion = await ingest(
      { path: sourcePath },
      { maxSourceBytes: maximumManagedCandidateKnowledgeFileBytes },
    );
  } catch {
    throw failure();
  }
  const normalized = ingestion.source;
  if (
    normalized === null ||
    ingestion.issues.length > 0 ||
    normalized.issues.length > 0 ||
    normalized.chunks.length === 0
  ) {
    throw failure();
  }
  return normalized;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

function isDefinitelyMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR";
}

type LocalOriginPathStatus = "readable" | "missing" | "inaccessible";

async function inspectLocalOriginPath(
  inspect: typeof lstat,
  originPath: string,
): Promise<LocalOriginPathStatus> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await inspect(originPath);
  } catch (error) {
    return isDefinitelyMissing(error) ? "missing" : "inaccessible";
  }
  return details.isFile() && !details.isSymbolicLink() ? "readable" : "inaccessible";
}

function originStatusResult(
  sourceId: string,
  status: KnowledgeSourceOriginStatus,
  now: () => string,
): KnowledgeSourceOriginStatusResult {
  return Object.freeze({ sourceId, checkedAt: now(), status });
}

function originRefreshResult(
  sourceId: string,
  status: KnowledgeSourceOriginRefreshStatus,
  checkedAt: string,
  versionId?: string,
): KnowledgeSourceOriginRefreshResult {
  return Object.freeze({
    sourceId,
    checkedAt,
    status,
    ...(versionId === undefined ? {} : { versionId }),
  });
}

function sourceNotFound(knowledgeBaseId: string, sourceId: string): Error {
  return new Error(
    `candidate knowledge source ${sourceId} was not found in candidate knowledge base ${knowledgeBaseId}`,
  );
}

function latestSourceVersion(
  versions: readonly CandidateKnowledgeSourceVersionRecord[],
  sourceId: string,
): CandidateKnowledgeSourceVersionRecord {
  if (versions.length === 0 || versions.some((version) => version.sourceId !== sourceId)) {
    throw new Error("Candidate knowledge source version graph is inconsistent.");
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

type InspectedKnowledgeSourceOrigin =
  | {
      readonly status: "unbound" | "missing" | "inaccessible";
      readonly latestVersion: CandidateKnowledgeSourceVersionRecord;
    }
  | {
      readonly status: "current" | "changed";
      readonly originPath: string;
      readonly mediaType: string;
      readonly checksum: string;
      readonly sizeBytes: number;
      readonly latestVersion: CandidateKnowledgeSourceVersionRecord;
    };

function originInspectionInvariantFailure(): Error {
  return new Error("Candidate knowledge source origin inspection returned inconsistent state.");
}

function refreshAppendInvariantFailure(): Error {
  return new Error("Candidate knowledge source refresh returned inconsistent storage state.");
}

function rebindFailure(): Error {
  return new Error("The selected candidate knowledge source file could not be rebound.");
}

function rebindInvariantFailure(): Error {
  return new Error("Candidate knowledge source rebind returned inconsistent storage state.");
}

function validateRebindResult(
  result: Awaited<
    ReturnType<CandidateKnowledgeStoreHandle["rebindManagedCandidateKnowledgeFileOrigin"]>
  >,
  sourceId: string,
  requestedBoundAt: string,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.rebound !== "boolean" ||
    typeof result.binding !== "object" ||
    result.binding === null ||
    result.binding.sourceId !== sourceId ||
    typeof result.binding.originPath !== "string" ||
    result.binding.originPath.trim() === "" ||
    typeof result.binding.boundAt !== "string" ||
    result.binding.boundAt.trim() === ""
  ) {
    throw rebindInvariantFailure();
  }
  if (result.rebound && result.binding.boundAt !== requestedBoundAt) {
    throw rebindInvariantFailure();
  }
}

function refreshStateInvariantFailure(): Error {
  return new Error("Candidate knowledge source refresh state returned inconsistent storage state.");
}

function isValidRefreshTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validateRefreshStateObservation(
  observation: CandidateKnowledgeSourceRefreshObservationRecord,
  sourceId: string,
): void {
  if (
    typeof observation !== "object" ||
    observation === null ||
    observation.sourceId !== sourceId ||
    typeof observation.observedVersionId !== "string" ||
    observation.observedVersionId.trim() === "" ||
    typeof observation.status !== "string" ||
    !["current", "changed", "missing", "inaccessible", "unbound"].includes(observation.status) ||
    !isValidRefreshTimestamp(observation.checkedAt) ||
    typeof observation.stale !== "boolean" ||
    (observation.lastRefreshedVersionId === null) !== (observation.lastRefreshedAt === null) ||
    (observation.lastRefreshedVersionId !== null &&
      (typeof observation.lastRefreshedVersionId !== "string" ||
        observation.lastRefreshedVersionId.trim() === "")) ||
    (observation.lastRefreshedAt !== null &&
      !isValidRefreshTimestamp(observation.lastRefreshedAt)) ||
    (observation.lastRefreshedAt !== null &&
      Date.parse(observation.lastRefreshedAt) > Date.parse(observation.checkedAt))
  ) {
    throw refreshStateInvariantFailure();
  }
}

function projectRefreshState(
  observation: CandidateKnowledgeSourceRefreshObservationRecord,
  sourceId: string,
): KnowledgeSourceRefreshStateResult {
  validateRefreshStateObservation(observation, sourceId);
  return Object.freeze({
    sourceId,
    status: observation.stale ? ("stale" as const) : observation.status,
    checkedAt: observation.checkedAt,
    observedVersionId: observation.observedVersionId,
    ...(observation.lastRefreshedAt === null
      ? {}
      : { lastRefreshedAt: observation.lastRefreshedAt }),
    ...(observation.lastRefreshedVersionId === null
      ? {}
      : { lastRefreshedVersionId: observation.lastRefreshedVersionId }),
  });
}

function assertSourceInScope(
  source: CandidateKnowledgeSourceRecord,
  knowledgeBaseId: string,
  sourceId: string,
): void {
  if (source.id !== sourceId || source.knowledgeBaseId !== knowledgeBaseId) {
    throw originInspectionInvariantFailure();
  }
}

async function inspectKnowledgeSourceOrigin(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
  sourceId: string,
  inspect: typeof lstat,
  ingest: typeof ingestFile,
): Promise<InspectedKnowledgeSourceOrigin> {
  const source = await handle.getCandidateKnowledgeSource(knowledgeBaseId, sourceId);
  if (source === undefined) {
    throw sourceNotFound(knowledgeBaseId, sourceId);
  }
  assertSourceInScope(source, knowledgeBaseId, sourceId);
  const versions = await handle.listCandidateKnowledgeSourceVersions(knowledgeBaseId, sourceId);
  const latestVersion = latestSourceVersion(versions, sourceId);
  if (source.kind !== "file") {
    return { status: "unbound", latestVersion };
  }

  const binding = await handle.getCandidateKnowledgeSourceOriginBinding(knowledgeBaseId, sourceId);
  if (binding === undefined) {
    return { status: "unbound", latestVersion };
  }
  if (
    binding.sourceId !== sourceId ||
    typeof binding.originPath !== "string" ||
    binding.originPath.trim() === ""
  ) {
    throw originInspectionInvariantFailure();
  }

  const initialPathStatus = await inspectLocalOriginPath(inspect, binding.originPath);
  if (initialPathStatus !== "readable") {
    return { status: initialPathStatus, latestVersion };
  }

  let normalized: NonNullable<Awaited<ReturnType<typeof ingestFile>>["source"]>;
  try {
    normalized = await ingestManagedCandidateKnowledgeFile(
      ingest,
      binding.originPath,
      () => new Error("The bound candidate knowledge source could not be checked."),
    );
  } catch {
    const finalPathStatus = await inspectLocalOriginPath(inspect, binding.originPath);
    return {
      status: finalPathStatus === "missing" ? "missing" : "inaccessible",
      latestVersion,
    };
  }

  const status: "current" | "changed" =
    normalized.mediaType === latestVersion.mediaType &&
    normalized.checksum === latestVersion.checksum &&
    normalized.sizeBytes === latestVersion.sizeBytes
      ? "current"
      : "changed";
  return {
    status,
    originPath: binding.originPath,
    mediaType: normalized.mediaType,
    checksum: normalized.checksum,
    sizeBytes: normalized.sizeBytes,
    latestVersion,
  };
}

function validateRefreshAppendResult(
  result: Awaited<
    ReturnType<CandidateKnowledgeStoreHandle["appendManagedCandidateKnowledgeFileVersion"]>
  >,
  knowledgeBaseId: string,
  sourceId: string,
  requestedVersion: {
    readonly id: string;
    readonly mediaType: string;
    readonly checksum: string;
    readonly sizeBytes: number;
    readonly createdAt: string;
  },
  latestVersion: CandidateKnowledgeSourceVersionRecord,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.source !== "object" ||
    result.source === null ||
    typeof result.version !== "object" ||
    result.version === null ||
    typeof result.created !== "boolean"
  ) {
    throw refreshAppendInvariantFailure();
  }
  if (
    result.source.id !== sourceId ||
    result.source.knowledgeBaseId !== knowledgeBaseId ||
    result.source.kind !== "file" ||
    result.version.sourceId !== sourceId ||
    result.version.mediaType !== requestedVersion.mediaType ||
    result.version.checksum !== requestedVersion.checksum ||
    result.version.sizeBytes !== requestedVersion.sizeBytes
  ) {
    throw refreshAppendInvariantFailure();
  }

  if (result.created) {
    if (
      result.version.id !== requestedVersion.id ||
      result.version.version !== latestVersion.version + 1 ||
      result.version.parentVersionId !== latestVersion.id ||
      result.version.createdAt !== requestedVersion.createdAt
    ) {
      throw refreshAppendInvariantFailure();
    }
    return;
  }

  if (
    result.version.version <= latestVersion.version ||
    result.version.id === latestVersion.id ||
    result.version.createdAt < latestVersion.createdAt
  ) {
    throw refreshAppendInvariantFailure();
  }
}

function validateRefreshObservationWriteResult(
  result: CandidateKnowledgeSourceRefreshObservationRecord,
  sourceId: string,
  expected: {
    readonly observedVersionId: string;
    readonly status: CandidateKnowledgeSourceRefreshObservationRecord["status"];
    readonly checkedAt: string;
    readonly lastRefreshedVersionId?: string;
    readonly lastRefreshedAt?: string;
  },
): void {
  validateRefreshStateObservation(result, sourceId);
  if (
    result.observedVersionId !== expected.observedVersionId ||
    result.status !== expected.status ||
    result.checkedAt !== expected.checkedAt ||
    result.stale ||
    (expected.lastRefreshedVersionId !== undefined &&
      result.lastRefreshedVersionId !== expected.lastRefreshedVersionId) ||
    (expected.lastRefreshedAt !== undefined && result.lastRefreshedAt !== expected.lastRefreshedAt)
  ) {
    throw refreshStateInvariantFailure();
  }
}

function toKnowledgeBase(record: CandidateKnowledgeBaseRecord): CandidateKnowledgeBase {
  const knowledgeBase: CandidateKnowledgeBase = {
    id: record.id as CandidateKnowledgeBase["id"],
    displayName: record.displayName,
    description: record.description,
    isDefault: record.isDefault,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.archivedAt === null ? {} : { archivedAt: record.archivedAt }),
  };
  return Object.freeze(knowledgeBase);
}

function toKnowledgeSource(record: CandidateKnowledgeSourceRecord): CandidateKnowledgeSource {
  return Object.freeze(
    createCandidateKnowledgeSource(
      record.id,
      {
        knowledgeBaseId: record.knowledgeBaseId,
        kind: record.kind,
        displayName: record.displayName,
      },
      record.createdAt,
    ),
  );
}

function toKnowledgeSourceVersion(
  record: CandidateKnowledgeSourceVersionRecord,
): CandidateKnowledgeSourceVersion {
  return Object.freeze(
    createCandidateKnowledgeSourceVersion(
      record.id,
      {
        sourceId: record.sourceId,
        version: record.version,
        ...(record.parentVersionId === null ? {} : { parentVersionId: record.parentVersionId }),
        mediaType: record.mediaType,
        checksum: record.checksum,
        sizeBytes: record.sizeBytes,
      },
      record.createdAt,
    ),
  );
}

async function projectSourceManifest(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
  record: CandidateKnowledgeSourceRecord,
): Promise<CandidateKnowledgeSourceManifest> {
  if (record.knowledgeBaseId !== knowledgeBaseId) {
    throw new Error(
      "Storage returned a candidate knowledge source outside the requested knowledge base.",
    );
  }
  const versions = await handle.listCandidateKnowledgeSourceVersions(knowledgeBaseId, record.id);
  if (versions.some((version) => version.sourceId !== record.id)) {
    throw new Error("Storage returned a candidate knowledge source version outside its source.");
  }
  return Object.freeze({
    source: toKnowledgeSource(record),
    versions: Object.freeze(
      versions
        .map(toKnowledgeSourceVersion)
        .sort((left, right) => left.version - right.version || left.id.localeCompare(right.id)),
    ),
  });
}

async function projectSourceWriteResult(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
  record: CandidateKnowledgeSourceRecord,
  created: boolean,
): Promise<CandidateKnowledgeSourceWriteResult> {
  const manifest = await projectSourceManifest(handle, knowledgeBaseId, record);
  return Object.freeze({ ...manifest, created });
}

async function project(
  handle: CandidateKnowledgeStoreHandle,
): Promise<CandidateKnowledgeStoreView> {
  const records = await handle.listCandidateKnowledgeBases();
  return Object.freeze({
    store: Object.freeze(
      createCandidateKnowledgeStore(handle.descriptor.id, handle.descriptor.createdAt),
    ),
    knowledgeBases: Object.freeze(records.map(toKnowledgeBase)),
  });
}

function projectManagedCandidateKnowledgeFileInventory(
  inventory: ManagedCandidateKnowledgeFileInventory,
): ManagedCandidateKnowledgeFileInventory {
  return Object.freeze({
    schemaVersion: inventory.schemaVersion,
    verifiedManagedFileCount: inventory.verifiedManagedFileCount,
    scannedEntryCount: inventory.scannedEntryCount,
    unknownEntries: Object.freeze({
      intakeShapedFilesAtSourcesRoot: inventory.unknownEntries.intakeShapedFilesAtSourcesRoot,
      opaqueEntriesAtSourcesRoot: inventory.unknownEntries.opaqueEntriesAtSourcesRoot,
      entriesInsideManagedSourceDirectories:
        inventory.unknownEntries.entriesInsideManagedSourceDirectories,
      symbolicLinks: inventory.unknownEntries.symbolicLinks,
      otherEntries: inventory.unknownEntries.otherEntries,
    }),
    complete: inventory.complete,
    scanLimitReached: inventory.scanLimitReached,
  });
}

async function useHandle<T>(
  acquire: () => Promise<CandidateKnowledgeStoreHandle>,
  operation: (handle: CandidateKnowledgeStoreHandle) => Promise<T>,
): Promise<T> {
  const handle = await acquire();
  let result: T;
  try {
    result = await operation(handle);
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Preserve the operation failure; the handle was still given a close attempt.
    }
    throw error;
  }
  await handle.close();
  return result;
}

function resolveDependencies(
  dependencies: CandidateKnowledgeStoreServiceDependencies,
): ResolvedDependencies {
  return {
    generateId: dependencies.generateId ?? randomUUID,
    now: dependencies.now ?? (() => new Date().toISOString()),
    initialize: dependencies.initialize ?? initializeCandidateKnowledgeStore,
    open: dependencies.open ?? openCandidateKnowledgeStore,
    ingestFile: dependencies.ingestFile ?? ingestFile,
    lstat: dependencies.lstat ?? lstat,
  };
}

export function createCandidateKnowledgeStoreService(
  dependencies: CandidateKnowledgeStoreServiceDependencies = {},
): CandidateKnowledgeStoreService {
  const resolved = resolveDependencies(dependencies);

  const openAndProject = async (storeRoot: string): Promise<CandidateKnowledgeStoreView> =>
    useHandle(() => resolved.open(storeRoot), project);

  const prepareVersion = (
    sourceId: string,
    command: {
      readonly mediaType: string;
      readonly checksum: string;
      readonly sizeBytes: number;
    },
  ): CandidateKnowledgeSourceVersion =>
    createCandidateKnowledgeSourceVersion(
      requireText(resolved.generateId(), "Candidate knowledge source version id"),
      {
        sourceId,
        version: 1,
        mediaType: command.mediaType,
        checksum: command.checksum,
        sizeBytes: command.sizeBytes,
      },
      resolved.now(),
    );

  const service: CandidateKnowledgeStoreService = {
    initializeStore: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const displayName = requireText(
        command.displayName ?? defaultKnowledgeBaseDisplayName,
        "Candidate knowledge base display name",
      );
      const createdAt = resolved.now();
      const storeId = requireText(resolved.generateId(), "Candidate knowledge store id");
      const knowledgeBaseId = requireText(
        resolved.generateId(),
        "Default candidate knowledge base id",
      );
      return useHandle(
        () =>
          resolved.initialize({
            root: storeRoot,
            descriptor: { schemaVersion: 1, id: storeId, createdAt },
            defaultKnowledgeBase: {
              id: knowledgeBaseId,
              displayName,
              ...(command.description === undefined
                ? {}
                : { description: command.description.trim() }),
              createdAt,
            },
          }),
        project,
      );
    },
    openStore: async (command) => openAndProject(requireStoreRoot(command.storeRoot)),
    listKnowledgeBases: async (command) => openAndProject(requireStoreRoot(command.storeRoot)),
    createKnowledgeBase: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const displayName = requireText(command.displayName, "Candidate knowledge base display name");
      const id = requireText(resolved.generateId(), "Candidate knowledge base id");
      const createdAt = resolved.now();
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          await handle.createCandidateKnowledgeBase({
            id,
            displayName,
            ...(command.description === undefined
              ? {}
              : { description: command.description.trim() }),
            isDefault: false,
            createdAt,
          });
          return project(handle);
        },
      );
    },
    renameKnowledgeBase: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const id = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const displayName = requireText(command.displayName, "Candidate knowledge base display name");
      const updatedAt = resolved.now();
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          await handle.renameCandidateKnowledgeBase(id, displayName, updatedAt);
          return project(handle);
        },
      );
    },
    archiveKnowledgeBase: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const id = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const archivedAt = resolved.now();
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          await handle.archiveCandidateKnowledgeBase(id, archivedAt);
          return project(handle);
        },
      );
    },
    createKnowledgeSource: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const source = createCandidateKnowledgeSource(
        requireText(resolved.generateId(), "Candidate knowledge source id"),
        {
          knowledgeBaseId,
          kind: command.kind,
          displayName: command.displayName,
        },
        resolved.now(),
      );
      const version = prepareVersion(source.id, command);
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const result = await handle.createCandidateKnowledgeSource(source, {
            id: version.id,
            mediaType: version.mediaType,
            checksum: version.checksum,
            sizeBytes: version.sizeBytes,
            createdAt: version.createdAt,
          });
          return projectSourceWriteResult(handle, knowledgeBaseId, result.source, result.created);
        },
      );
    },
    appendKnowledgeSourceVersion: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      const version = prepareVersion(sourceId, command);
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const result = await handle.appendCandidateKnowledgeSourceVersion(
            knowledgeBaseId,
            sourceId,
            {
              id: version.id,
              mediaType: version.mediaType,
              checksum: version.checksum,
              sizeBytes: version.sizeBytes,
              createdAt: version.createdAt,
            },
          );
          return projectSourceWriteResult(handle, knowledgeBaseId, result.source, result.created);
        },
      );
    },
    importKnowledgeSourceFile: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const sourcePath = requireText(command.sourcePath, "Candidate knowledge source path");
      const displayName = sourceDisplayName(sourcePath, command.displayName);
      const normalized = await ingestManagedCandidateKnowledgeFile(
        resolved.ingestFile,
        sourcePath,
        importFailure,
      );

      const sourceId = requireText(resolved.generateId(), "Candidate knowledge source id");
      const versionId = requireText(resolved.generateId(), "Candidate knowledge source version id");
      const createdAt = resolved.now();
      const source = createCandidateKnowledgeSource(
        sourceId,
        { knowledgeBaseId, kind: "file", displayName },
        createdAt,
      );
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const result = await handle.createManagedCandidateKnowledgeFileSource(source, {
            id: versionId,
            sourcePath,
            mediaType: normalized.mediaType,
            checksum: normalized.checksum,
            sizeBytes: normalized.sizeBytes,
            createdAt,
          });
          return projectSourceWriteResult(handle, knowledgeBaseId, result.source, result.created);
        },
      );
    },
    appendKnowledgeSourceFileVersion: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      const sourcePath = requireText(command.sourcePath, "Candidate knowledge source path");
      const normalized = await ingestManagedCandidateKnowledgeFile(
        resolved.ingestFile,
        sourcePath,
        appendFileVersionFailure,
      );
      const versionId = requireText(resolved.generateId(), "Candidate knowledge source version id");
      const createdAt = resolved.now();
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const result = await handle.appendManagedCandidateKnowledgeFileVersion(
            knowledgeBaseId,
            sourceId,
            {
              id: versionId,
              sourcePath,
              mediaType: normalized.mediaType,
              checksum: normalized.checksum,
              sizeBytes: normalized.sizeBytes,
              createdAt,
            },
          );
          return projectSourceWriteResult(handle, knowledgeBaseId, result.source, result.created);
        },
      );
    },
    listKnowledgeSourceManifests: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const sources = await handle.listCandidateKnowledgeSources(knowledgeBaseId);
          return Object.freeze(
            await Promise.all(
              sources.map((source) => projectSourceManifest(handle, knowledgeBaseId, source)),
            ),
          );
        },
      );
    },
    checkKnowledgeSourceOriginStatus: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) =>
          originStatusResult(
            sourceId,
            (
              await inspectKnowledgeSourceOrigin(
                handle,
                knowledgeBaseId,
                sourceId,
                resolved.lstat,
                resolved.ingestFile,
              )
            ).status,
            resolved.now,
          ),
      );
    },
    refreshKnowledgeSourceFromOrigin: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const inspected = await inspectKnowledgeSourceOrigin(
            handle,
            knowledgeBaseId,
            sourceId,
            resolved.lstat,
            resolved.ingestFile,
          );
          if (inspected.status !== "changed") {
            const status: KnowledgeSourceOriginRefreshStatus = inspected.status;
            const checkedAt = resolved.now();
            const observation = await handle.upsertCandidateKnowledgeSourceRefreshObservation(
              knowledgeBaseId,
              sourceId,
              {
                observedVersionId: inspected.latestVersion.id,
                status,
                checkedAt,
              },
            );
            validateRefreshObservationWriteResult(observation, sourceId, {
              observedVersionId: inspected.latestVersion.id,
              status,
              checkedAt,
            });
            return originRefreshResult(sourceId, status, checkedAt);
          }

          const versionId = requireText(
            resolved.generateId(),
            "Candidate knowledge source version id",
          );
          const checkedAt = resolved.now();
          const result = await handle.appendManagedCandidateKnowledgeFileVersion(
            knowledgeBaseId,
            sourceId,
            {
              id: versionId,
              sourcePath: inspected.originPath,
              mediaType: inspected.mediaType,
              checksum: inspected.checksum,
              sizeBytes: inspected.sizeBytes,
              createdAt: checkedAt,
            },
          );
          validateRefreshAppendResult(
            result,
            knowledgeBaseId,
            sourceId,
            {
              id: versionId,
              mediaType: inspected.mediaType,
              checksum: inspected.checksum,
              sizeBytes: inspected.sizeBytes,
              createdAt: checkedAt,
            },
            inspected.latestVersion,
          );
          const observationInput = result.created
            ? {
                observedVersionId: result.version.id,
                status: "current" as const,
                checkedAt,
                lastRefreshedVersionId: result.version.id,
                lastRefreshedAt: checkedAt,
              }
            : {
                observedVersionId: result.version.id,
                status: "current" as const,
                checkedAt,
              };
          const observation = await handle.upsertCandidateKnowledgeSourceRefreshObservation(
            knowledgeBaseId,
            sourceId,
            observationInput,
          );
          validateRefreshObservationWriteResult(observation, sourceId, observationInput);
          return result.created
            ? originRefreshResult(sourceId, "refreshed", checkedAt, result.version.id)
            : originRefreshResult(sourceId, "current", checkedAt);
        },
      );
    },
    getKnowledgeSourceRefreshState: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const source = await handle.getCandidateKnowledgeSource(knowledgeBaseId, sourceId);
          if (source === undefined) {
            throw sourceNotFound(knowledgeBaseId, sourceId);
          }
          assertSourceInScope(source, knowledgeBaseId, sourceId);
          const observation = await handle.getCandidateKnowledgeSourceRefreshObservation(
            knowledgeBaseId,
            sourceId,
          );
          if (observation === undefined) {
            return Object.freeze({ sourceId, status: "unobserved" as const });
          }
          return projectRefreshState(observation, sourceId);
        },
      );
    },
    rebindKnowledgeSourceOrigin: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      const sourcePath = requireText(command.sourcePath, "Candidate knowledge source path");
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const source = await handle.getCandidateKnowledgeSource(knowledgeBaseId, sourceId);
          if (source === undefined) {
            throw sourceNotFound(knowledgeBaseId, sourceId);
          }
          assertSourceInScope(source, knowledgeBaseId, sourceId);
          if (source.kind !== "file") {
            throw rebindFailure();
          }
          const normalized = await ingestManagedCandidateKnowledgeFile(
            resolved.ingestFile,
            sourcePath,
            rebindFailure,
          );
          const boundAt = resolved.now();
          let result: Awaited<
            ReturnType<CandidateKnowledgeStoreHandle["rebindManagedCandidateKnowledgeFileOrigin"]>
          >;
          try {
            result = await handle.rebindManagedCandidateKnowledgeFileOrigin(
              knowledgeBaseId,
              sourceId,
              {
                sourcePath,
                mediaType: normalized.mediaType,
                checksum: normalized.checksum,
                sizeBytes: normalized.sizeBytes,
                boundAt,
              },
            );
          } catch {
            throw rebindFailure();
          }
          validateRebindResult(result, sourceId, boundAt);
          return Object.freeze({
            sourceId,
            status: result.rebound ? ("rebound" as const) : ("current" as const),
            boundAt: result.binding.boundAt,
          });
        },
      );
    },
    inspectManagedCandidateKnowledgeFiles: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) =>
          projectManagedCandidateKnowledgeFileInventory(
            await handle.inspectManagedCandidateKnowledgeFiles(),
          ),
      );
    },
  };
  return Object.freeze(service);
}

const defaultService = createCandidateKnowledgeStoreService();

export const initializeStore = defaultService.initializeStore;
export const openStore = defaultService.openStore;
export const listKnowledgeBases = defaultService.listKnowledgeBases;
export const createKnowledgeBase = defaultService.createKnowledgeBase;
export const renameKnowledgeBase = defaultService.renameKnowledgeBase;
export const archiveKnowledgeBase = defaultService.archiveKnowledgeBase;
export const createKnowledgeSource = defaultService.createKnowledgeSource;
export const appendKnowledgeSourceVersion = defaultService.appendKnowledgeSourceVersion;
export const importKnowledgeSourceFile = defaultService.importKnowledgeSourceFile;
export const appendKnowledgeSourceFileVersion = defaultService.appendKnowledgeSourceFileVersion;
export const listKnowledgeSourceManifests = defaultService.listKnowledgeSourceManifests;
export const checkKnowledgeSourceOriginStatus = defaultService.checkKnowledgeSourceOriginStatus;
export const refreshKnowledgeSourceFromOrigin = defaultService.refreshKnowledgeSourceFromOrigin;
export const getKnowledgeSourceRefreshState = defaultService.getKnowledgeSourceRefreshState;
export const rebindKnowledgeSourceOrigin = defaultService.rebindKnowledgeSourceOrigin;
export const inspectManagedCandidateKnowledgeFiles =
  defaultService.inspectManagedCandidateKnowledgeFiles;
