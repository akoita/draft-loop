import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

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
import {
  type DirectoryIngestionOptions,
  type DirectoryIngestionResult,
  ingestDirectory,
  ingestFile,
  ingestUrl,
  supportedMediaTypes,
} from "@draft-loop/ingestion";
import type {
  CandidateKnowledgeDirectoryBindingRecord,
  CandidateKnowledgeDirectoryMemberOriginRelationRecord,
  CandidateKnowledgeDirectoryMemberRecord,
  CandidateKnowledgeSourceRecord,
  CandidateKnowledgeSourceRefreshObservationRecord,
  CandidateKnowledgeSourceRetirementRecord,
  CandidateKnowledgeSourceUrlProvenanceRecord,
  CandidateKnowledgeSourceVersionRecord,
} from "@draft-loop/storage";
import {
  type CandidateKnowledgeBaseRecord,
  type CandidateKnowledgeStoreHandle,
  initializeCandidateKnowledgeStore,
  type ManagedCandidateKnowledgeFileInventory,
  type ManagedCandidateKnowledgeUrlVersionInput,
  maximumManagedCandidateKnowledgeFileBytes,
  maximumManagedCandidateKnowledgeUrlResponseBytes,
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

export interface ImportKnowledgeSourceDirectoryCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryPath: string;
  readonly options?: DirectoryIngestionOptions;
}

export interface PreviewKnowledgeSourceDirectoryRefreshCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly options?: DirectoryIngestionOptions;
}

export interface PreviewKnowledgeSourceDirectoryRootRebindCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly directoryPath: string;
  readonly options?: DirectoryIngestionOptions;
}

export interface PreviewKnowledgeSourceDirectoryMovedCandidatesCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly options?: DirectoryIngestionOptions;
}

export interface RecordKnowledgeSourceDirectoryRefreshCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly options?: DirectoryIngestionOptions;
}

export interface ApplyKnowledgeSourceDirectoryRefreshCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly options?: DirectoryIngestionOptions;
}

export interface AddKnowledgeSourceDirectoryMembersCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly options?: DirectoryIngestionOptions;
}

export interface RetireKnowledgeSourceDirectoryMemberCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly directoryId: string;
  readonly sourceId: string;
  readonly approved: boolean;
}

export interface ImportKnowledgeSourceUrlCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly url: string;
  readonly displayName?: string;
  readonly approved: boolean;
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

export interface ListKnowledgeSourceDuplicateGroupsCommand {
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

export interface RefreshKnowledgeSourceUrlCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly approved: boolean;
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

export interface RetireKnowledgeSourceCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
}

export interface GetKnowledgeSourceRetirementCommand {
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

export interface KnowledgeSourceRetirementActiveResult {
  readonly sourceId: string;
  readonly status: "active";
}

export interface KnowledgeSourceRetirementRetiredResult {
  readonly sourceId: string;
  readonly status: "retired";
  readonly retiredAt: string;
  readonly reason: "user-requested";
}

export type KnowledgeSourceRetirementResult =
  | KnowledgeSourceRetirementActiveResult
  | KnowledgeSourceRetirementRetiredResult;

/** Local application metadata; names and descriptions are not a diagnostic allowlist. */
export interface CandidateKnowledgeStoreView {
  readonly store: CandidateKnowledgeStore;
  readonly knowledgeBases: readonly CandidateKnowledgeBase[];
}

export interface CandidateKnowledgeSourceManifest {
  readonly source: CandidateKnowledgeSource;
  readonly versions: readonly CandidateKnowledgeSourceVersion[];
}

export interface KnowledgeSourceDuplicateGroupMember {
  readonly sourceId: string;
  readonly versionId: string;
}

export interface KnowledgeSourceDuplicateGroup {
  readonly members: readonly KnowledgeSourceDuplicateGroupMember[];
}

export interface CandidateKnowledgeSourceWriteResult extends CandidateKnowledgeSourceManifest {
  readonly created: boolean;
}

export interface ImportKnowledgeSourceDirectoryCompleteResult {
  readonly sources: readonly CandidateKnowledgeSourceWriteResult[];
  readonly status: "complete";
  readonly directoryId: string;
  readonly scannedEntryCount: number;
  readonly discoveredFileCount: number;
  readonly skippedEntryCount: number;
}

export interface ImportKnowledgeSourceDirectoryPartialResult {
  readonly sources: readonly CandidateKnowledgeSourceWriteResult[];
  readonly status: "partial";
  readonly scannedEntryCount: number;
  readonly discoveredFileCount: number;
  readonly skippedEntryCount: number;
}

export type ImportKnowledgeSourceDirectoryResult =
  | ImportKnowledgeSourceDirectoryCompleteResult
  | ImportKnowledgeSourceDirectoryPartialResult;

export type PreviewKnowledgeSourceDirectoryRefreshMemberStatus =
  | "current"
  | "changed"
  | "missing"
  | "retired"
  | "origin-conflict";

export interface PreviewKnowledgeSourceDirectoryRefreshMember {
  readonly sourceId: string;
  readonly status: PreviewKnowledgeSourceDirectoryRefreshMemberStatus;
}

export interface PreviewKnowledgeSourceDirectoryRefreshResult {
  readonly directoryId: string;
  readonly checkedAt: string;
  readonly members: readonly PreviewKnowledgeSourceDirectoryRefreshMember[];
  readonly newSourceCount: number;
  readonly scannedEntryCount: number;
  readonly discoveredFileCount: number;
  readonly skippedEntryCount: number;
}

export interface PreviewKnowledgeSourceDirectoryRootRebindResult {
  readonly directoryId: string;
  readonly checkedAt: string;
  readonly status: "current" | "ready";
  readonly memberCount: number;
  readonly scannedEntryCount: number;
  readonly discoveredFileCount: number;
  readonly skippedEntryCount: number;
}

export interface PreviewKnowledgeSourceDirectoryMovedCandidate {
  readonly sourceId: string;
  readonly status: "moved-candidate";
}

export interface PreviewKnowledgeSourceDirectoryMovedCandidatesResult {
  readonly directoryId: string;
  readonly checkedAt: string;
  readonly candidates: readonly PreviewKnowledgeSourceDirectoryMovedCandidate[];
  readonly candidateCount: number;
  readonly newSourceCount: number;
  readonly scannedEntryCount: number;
  readonly discoveredFileCount: number;
  readonly skippedEntryCount: number;
}

export interface RecordKnowledgeSourceDirectoryRefreshResult
  extends PreviewKnowledgeSourceDirectoryRefreshResult {
  readonly recordedObservationCount: number;
}

export interface ApplyKnowledgeSourceDirectoryRefreshBaseResult
  extends PreviewKnowledgeSourceDirectoryRefreshResult {
  readonly refreshedSourceIds: readonly string[];
}

export interface ApplyKnowledgeSourceDirectoryRefreshCompleteResult
  extends ApplyKnowledgeSourceDirectoryRefreshBaseResult {
  readonly status: "complete";
}

export interface ApplyKnowledgeSourceDirectoryRefreshPartialResult
  extends ApplyKnowledgeSourceDirectoryRefreshBaseResult {
  readonly status: "partial";
  readonly failedSourceId: string;
  readonly failedStatus: PreviewKnowledgeSourceDirectoryRefreshMemberStatus;
}

export type ApplyKnowledgeSourceDirectoryRefreshResult =
  | ApplyKnowledgeSourceDirectoryRefreshCompleteResult
  | ApplyKnowledgeSourceDirectoryRefreshPartialResult;

export interface AddKnowledgeSourceDirectoryMembersBaseResult
  extends PreviewKnowledgeSourceDirectoryRefreshResult {
  readonly addedSourceIds: readonly string[];
  readonly addedSourceCount: number;
}

export interface AddKnowledgeSourceDirectoryMembersCompleteResult
  extends AddKnowledgeSourceDirectoryMembersBaseResult {
  readonly status: "complete";
}

export interface AddKnowledgeSourceDirectoryMembersPartialResult
  extends AddKnowledgeSourceDirectoryMembersBaseResult {
  readonly status: "partial";
}

export type AddKnowledgeSourceDirectoryMembersResult =
  | AddKnowledgeSourceDirectoryMembersCompleteResult
  | AddKnowledgeSourceDirectoryMembersPartialResult;

export interface RetireKnowledgeSourceDirectoryMemberResult {
  readonly directoryId: string;
  readonly sourceId: string;
  readonly status: "removed" | "already-removed";
  readonly checkedAt: string;
  readonly retiredAt: string;
  readonly reason: "user-requested";
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
  readonly importKnowledgeSourceDirectory: (
    command: ImportKnowledgeSourceDirectoryCommand,
  ) => Promise<ImportKnowledgeSourceDirectoryResult>;
  readonly previewKnowledgeSourceDirectoryRefresh: (
    command: PreviewKnowledgeSourceDirectoryRefreshCommand,
  ) => Promise<PreviewKnowledgeSourceDirectoryRefreshResult>;
  readonly previewKnowledgeSourceDirectoryRootRebind: (
    command: PreviewKnowledgeSourceDirectoryRootRebindCommand,
  ) => Promise<PreviewKnowledgeSourceDirectoryRootRebindResult>;
  readonly previewKnowledgeSourceDirectoryMovedCandidates: (
    command: PreviewKnowledgeSourceDirectoryMovedCandidatesCommand,
  ) => Promise<PreviewKnowledgeSourceDirectoryMovedCandidatesResult>;
  readonly recordKnowledgeSourceDirectoryRefresh: (
    command: RecordKnowledgeSourceDirectoryRefreshCommand,
  ) => Promise<RecordKnowledgeSourceDirectoryRefreshResult>;
  readonly applyKnowledgeSourceDirectoryRefresh: (
    command: ApplyKnowledgeSourceDirectoryRefreshCommand,
  ) => Promise<ApplyKnowledgeSourceDirectoryRefreshResult>;
  readonly addKnowledgeSourceDirectoryMembers: (
    command: AddKnowledgeSourceDirectoryMembersCommand,
  ) => Promise<AddKnowledgeSourceDirectoryMembersResult>;
  readonly retireKnowledgeSourceDirectoryMember: (
    command: RetireKnowledgeSourceDirectoryMemberCommand,
  ) => Promise<RetireKnowledgeSourceDirectoryMemberResult>;
  readonly importKnowledgeSourceUrl: (
    command: ImportKnowledgeSourceUrlCommand,
  ) => Promise<CandidateKnowledgeSourceWriteResult>;
  readonly appendKnowledgeSourceFileVersion: (
    command: AppendKnowledgeSourceFileVersionCommand,
  ) => Promise<CandidateKnowledgeSourceWriteResult>;
  readonly listKnowledgeSourceManifests: (
    command: ListKnowledgeSourceManifestsCommand,
  ) => Promise<readonly CandidateKnowledgeSourceManifest[]>;
  readonly listKnowledgeSourceDuplicateGroups: (
    command: ListKnowledgeSourceDuplicateGroupsCommand,
  ) => Promise<readonly KnowledgeSourceDuplicateGroup[]>;
  readonly inspectManagedCandidateKnowledgeFiles: (
    command: InspectManagedCandidateKnowledgeFilesCommand,
  ) => Promise<ManagedCandidateKnowledgeFileInventory>;
  readonly checkKnowledgeSourceOriginStatus: (
    command: CheckKnowledgeSourceOriginStatusCommand,
  ) => Promise<KnowledgeSourceOriginStatusResult>;
  readonly refreshKnowledgeSourceFromOrigin: (
    command: RefreshKnowledgeSourceFromOriginCommand,
  ) => Promise<KnowledgeSourceOriginRefreshResult>;
  readonly refreshKnowledgeSourceUrl: (
    command: RefreshKnowledgeSourceUrlCommand,
  ) => Promise<KnowledgeSourceOriginRefreshResult>;
  readonly rebindKnowledgeSourceOrigin: (
    command: RebindKnowledgeSourceOriginCommand,
  ) => Promise<KnowledgeSourceOriginRebindResult>;
  readonly getKnowledgeSourceRefreshState: (
    command: GetKnowledgeSourceRefreshStateCommand,
  ) => Promise<KnowledgeSourceRefreshStateResult>;
  readonly retireKnowledgeSource: (
    command: RetireKnowledgeSourceCommand,
  ) => Promise<KnowledgeSourceRetirementRetiredResult>;
  readonly getKnowledgeSourceRetirement: (
    command: GetKnowledgeSourceRetirementCommand,
  ) => Promise<KnowledgeSourceRetirementResult>;
}

export interface CandidateKnowledgeStoreServiceDependencies {
  readonly generateId?: () => string;
  readonly now?: () => string;
  readonly initialize?: typeof initializeCandidateKnowledgeStore;
  readonly open?: typeof openCandidateKnowledgeStore;
  readonly ingestFile?: typeof ingestFile;
  readonly ingestDirectory?: typeof ingestDirectory;
  readonly ingestUrl?: typeof ingestUrl;
  /** @internal Narrow read-only seam for deterministic origin status checks. */
  readonly lstat?: typeof lstat;
  /** @internal Narrow seam for deterministic directory/store overlap checks. */
  readonly realpath?: typeof realpath;
}

interface ResolvedDependencies {
  readonly generateId: () => string;
  readonly now: () => string;
  readonly initialize: typeof initializeCandidateKnowledgeStore;
  readonly open: typeof openCandidateKnowledgeStore;
  readonly ingestFile: typeof ingestFile;
  readonly ingestDirectory: typeof ingestDirectory;
  readonly ingestUrl: typeof ingestUrl;
  readonly lstat: typeof lstat;
  readonly realpath: typeof realpath;
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

function importDirectoryFailure(): Error {
  return new Error("The selected candidate knowledge source directory could not be imported.");
}

function previewDirectoryRefreshFailure(): Error {
  return new Error(
    "The selected candidate knowledge source directory refresh preview could not be completed.",
  );
}

function previewDirectoryRootRebindFailure(): Error {
  return new Error(
    "The selected candidate knowledge source directory root rebind preview could not be completed.",
  );
}

function previewDirectoryMovedCandidatesFailure(): Error {
  return new Error(
    "The selected candidate knowledge source directory moved-candidate preview could not be completed.",
  );
}

function recordDirectoryRefreshFailure(): Error {
  return new Error(
    "The selected candidate knowledge source directory refresh observations could not be recorded.",
  );
}

function applyDirectoryRefreshFailure(): Error {
  return new Error(
    "The selected candidate knowledge source directory refresh could not be applied.",
  );
}

function addDirectoryMembersFailure(): Error {
  return new Error("The selected candidate knowledge source directory members could not be added.");
}

function retireDirectoryMemberFailure(): Error {
  return new Error(
    "The selected candidate knowledge source directory member could not be removed.",
  );
}

function importUrlFailure(): Error {
  return new Error("The selected candidate knowledge source URL could not be imported.");
}

function refreshUrlFailure(): Error {
  return new Error("The selected candidate knowledge source URL could not be refreshed.");
}

function appendFileVersionFailure(): Error {
  return new Error(
    "The selected candidate knowledge source file could not be added as a new version.",
  );
}

function pathsOverlap(left: string, right: string): boolean {
  const isWithin = (parent: string, candidate: string): boolean => {
    const candidateRelativePath = relative(parent, candidate);
    if (candidateRelativePath === "") return true;
    if (isAbsolute(candidateRelativePath)) {
      return false;
    }
    return (candidateRelativePath.split(/[\\/]/u, 1)[0] ?? "") !== "..";
  };
  return isWithin(left, right) || isWithin(right, left);
}

async function validateDirectoryImportScope(
  inspect: typeof lstat,
  resolveRealpath: typeof realpath,
  directoryPath: string,
  storeRoot: string,
): Promise<string> {
  try {
    const directoryDetails = await inspect(directoryPath, { bigint: true });
    if (directoryDetails.isSymbolicLink() || !directoryDetails.isDirectory()) {
      throw importDirectoryFailure();
    }
    const [canonicalDirectory, canonicalStore] = await Promise.all([
      resolveRealpath(directoryPath),
      resolveRealpath(storeRoot),
    ]);
    if (pathsOverlap(canonicalDirectory, canonicalStore)) {
      throw importDirectoryFailure();
    }
    return canonicalDirectory;
  } catch (error) {
    if (error instanceof Error && error.message === importDirectoryFailure().message) {
      throw error;
    }
    throw importDirectoryFailure();
  }
}

function validDirectoryIngestionSource(
  value: unknown,
): value is NonNullable<DirectoryIngestionResult["sources"][number]> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    readonly source?: unknown;
    readonly mediaType?: unknown;
    readonly checksum?: unknown;
    readonly sizeBytes?: unknown;
    readonly chunks?: unknown;
    readonly issues?: unknown;
  };
  if (
    typeof candidate.source !== "object" ||
    candidate.source === null ||
    typeof candidate.mediaType !== "string" ||
    !(supportedMediaTypes as readonly string[]).includes(candidate.mediaType) ||
    typeof candidate.checksum !== "string" ||
    !/^[0-9a-f]{64}$/u.test(candidate.checksum) ||
    !Number.isSafeInteger(candidate.sizeBytes) ||
    (candidate.sizeBytes as number) < 0 ||
    !Array.isArray(candidate.chunks) ||
    candidate.chunks.length === 0 ||
    !Array.isArray(candidate.issues) ||
    candidate.issues.length > 0
  ) {
    return false;
  }
  const source = candidate.source as { readonly path?: unknown };
  return typeof source.path === "string" && source.path.trim() !== "";
}

function validateDirectoryIngestionResult(
  value: unknown,
): asserts value is DirectoryIngestionResult {
  if (typeof value !== "object" || value === null) throw importDirectoryFailure();
  const result = value as {
    readonly sources?: unknown;
    readonly scannedEntryCount?: unknown;
    readonly discoveredFileCount?: unknown;
    readonly skippedEntryCount?: unknown;
  };
  if (
    !Array.isArray(result.sources) ||
    !Number.isSafeInteger(result.scannedEntryCount) ||
    (result.scannedEntryCount as number) < 0 ||
    !Number.isSafeInteger(result.discoveredFileCount) ||
    (result.discoveredFileCount as number) < 0 ||
    !Number.isSafeInteger(result.skippedEntryCount) ||
    (result.skippedEntryCount as number) < 0 ||
    (result.discoveredFileCount as number) > (result.scannedEntryCount as number) ||
    (result.skippedEntryCount as number) > (result.scannedEntryCount as number) ||
    (result.discoveredFileCount as number) + (result.skippedEntryCount as number) >
      (result.scannedEntryCount as number) ||
    result.discoveredFileCount !== result.sources.length ||
    result.sources.some((source) => !validDirectoryIngestionSource(source))
  ) {
    throw importDirectoryFailure();
  }
}

function directoryImportResult(
  preflight: DirectoryIngestionResult,
  sources: readonly CandidateKnowledgeSourceWriteResult[],
  directoryId?: string,
): ImportKnowledgeSourceDirectoryResult {
  const common = {
    sources: Object.freeze([...sources]),
    scannedEntryCount: preflight.scannedEntryCount,
    discoveredFileCount: preflight.discoveredFileCount,
    skippedEntryCount: preflight.skippedEntryCount,
  };
  return Object.freeze(
    directoryId === undefined
      ? { ...common, status: "partial" as const }
      : { ...common, status: "complete" as const, directoryId },
  );
}

function validatePreviewDirectoryBinding(
  binding: CandidateKnowledgeDirectoryBindingRecord | undefined,
  knowledgeBaseId: string,
  directoryId: string,
): CandidateKnowledgeDirectoryBindingRecord {
  if (
    binding === undefined ||
    typeof binding !== "object" ||
    binding === null ||
    binding.id !== directoryId ||
    binding.knowledgeBaseId !== knowledgeBaseId ||
    typeof binding.rootPath !== "string" ||
    binding.rootPath.trim() === "" ||
    !isValidRefreshTimestamp(binding.boundAt)
  ) {
    throw previewDirectoryRefreshFailure();
  }
  return binding;
}

function validatePreviewDirectoryMember(
  member: CandidateKnowledgeDirectoryMemberRecord,
  knowledgeBaseId: string,
  directoryId: string,
  sourceIds: Set<string>,
  hashes: Set<string>,
): void {
  if (
    typeof member !== "object" ||
    member === null ||
    member.directoryId !== directoryId ||
    member.knowledgeBaseId !== knowledgeBaseId ||
    typeof member.sourceId !== "string" ||
    member.sourceId.trim() === "" ||
    sourceIds.has(member.sourceId) ||
    typeof member.relativePathHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(member.relativePathHash) ||
    hashes.has(member.relativePathHash)
  ) {
    throw previewDirectoryRefreshFailure();
  }
  sourceIds.add(member.sourceId);
  hashes.add(member.relativePathHash);
}

function validatePreviewDirectorySource(
  source: CandidateKnowledgeSourceRecord | undefined,
  knowledgeBaseId: string,
  sourceId: string,
): CandidateKnowledgeSourceRecord {
  if (
    source === undefined ||
    typeof source !== "object" ||
    source === null ||
    source.id !== sourceId ||
    source.knowledgeBaseId !== knowledgeBaseId ||
    source.kind !== "file" ||
    typeof source.displayName !== "string" ||
    source.displayName.trim() === "" ||
    !isValidRefreshTimestamp(source.createdAt)
  ) {
    throw previewDirectoryRefreshFailure();
  }
  return source;
}

function latestPreviewDirectorySourceVersion(
  versions: readonly CandidateKnowledgeSourceVersionRecord[],
  sourceId: string,
): CandidateKnowledgeSourceVersionRecord {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw previewDirectoryRefreshFailure();
  }
  const ordered = [...versions].sort(
    (left, right) => left.version - right.version || lexicalCompare(left.id, right.id),
  );
  const versionIds = new Set<string>();
  let previousId: string | null = null;
  let previousCreatedAt: string | undefined;
  for (const [index, version] of ordered.entries()) {
    if (
      typeof version !== "object" ||
      version === null ||
      typeof version.id !== "string" ||
      version.id.trim() === "" ||
      versionIds.has(version.id) ||
      version.sourceId !== sourceId ||
      !Number.isSafeInteger(version.version) ||
      version.version !== index + 1 ||
      version.parentVersionId !== previousId ||
      typeof version.mediaType !== "string" ||
      version.mediaType.trim() === "" ||
      typeof version.checksum !== "string" ||
      !/^[0-9a-f]{64}$/iu.test(version.checksum) ||
      !Number.isSafeInteger(version.sizeBytes) ||
      version.sizeBytes < 0 ||
      !isValidRefreshTimestamp(version.createdAt) ||
      (previousCreatedAt !== undefined &&
        Date.parse(version.createdAt) < Date.parse(previousCreatedAt))
    ) {
      throw previewDirectoryRefreshFailure();
    }
    versionIds.add(version.id);
    previousId = version.id;
    previousCreatedAt = version.createdAt;
  }
  return ordered[ordered.length - 1] as CandidateKnowledgeSourceVersionRecord;
}

function previewDirectoryRefreshResult(
  directoryId: string,
  checkedAt: string,
  preflight: DirectoryIngestionResult,
  members: readonly PreviewKnowledgeSourceDirectoryRefreshMember[],
  newSourceCount: number,
): PreviewKnowledgeSourceDirectoryRefreshResult {
  return Object.freeze({
    directoryId,
    checkedAt,
    members: Object.freeze(members.map((member) => Object.freeze({ ...member }))),
    newSourceCount,
    scannedEntryCount: preflight.scannedEntryCount,
    discoveredFileCount: preflight.discoveredFileCount,
    skippedEntryCount: preflight.skippedEntryCount,
  });
}

interface CollectedDirectoryRefreshMember {
  readonly sourceId: string;
  readonly status: PreviewKnowledgeSourceDirectoryRefreshMemberStatus;
  readonly observedVersionId: string;
  readonly latestVersion: CandidateKnowledgeSourceVersionRecord;
  readonly expectedOriginBoundAt?: string;
  readonly originRelation: CandidateKnowledgeDirectoryMemberOriginRelationRecord["relation"];
  readonly retirement?: CandidateKnowledgeSourceRetirementRecord;
}

interface CollectedDirectoryRefresh {
  readonly directoryId: string;
  readonly checkedAt: string;
  readonly preflight: DirectoryIngestionResult;
  readonly members: readonly CollectedDirectoryRefreshMember[];
  readonly newSourceCount: number;
  readonly matchedSources: ReadonlyMap<
    string,
    NonNullable<DirectoryIngestionResult["sources"][number]>
  >;
  readonly unmatchedSources: readonly NonNullable<DirectoryIngestionResult["sources"][number]>[];
}

function validatePreviewDirectoryOriginRelation(
  relation: CandidateKnowledgeDirectoryMemberOriginRelationRecord,
  knowledgeBaseId: string,
  directoryId: string,
  sourceId: string,
): CandidateKnowledgeDirectoryMemberOriginRelationRecord {
  const relations = [
    "same-member",
    "other-member",
    "unmatched",
    "outside-root",
    "unbound",
  ] as const;
  if (
    typeof relation !== "object" ||
    relation === null ||
    relation.knowledgeBaseId !== knowledgeBaseId ||
    relation.directoryId !== directoryId ||
    relation.sourceId !== sourceId ||
    !relations.includes(relation.relation) ||
    (relation.relation === "unbound"
      ? relation.originBoundAt !== undefined
      : !isValidRefreshTimestamp(relation.originBoundAt))
  ) {
    throw previewDirectoryRefreshFailure();
  }
  return relation;
}

async function collectDirectoryRefresh(
  handle: CandidateKnowledgeStoreHandle,
  dependencies: ResolvedDependencies,
  storeRoot: string,
  knowledgeBaseId: string,
  directoryId: string,
  options: DirectoryIngestionOptions | undefined,
): Promise<CollectedDirectoryRefresh> {
  const knowledgeBase = await handle.getCandidateKnowledgeBase(knowledgeBaseId);
  if (
    knowledgeBase === undefined ||
    typeof knowledgeBase !== "object" ||
    knowledgeBase === null ||
    knowledgeBase.id !== knowledgeBaseId ||
    knowledgeBase.state !== "active"
  ) {
    throw previewDirectoryRefreshFailure();
  }

  const binding = validatePreviewDirectoryBinding(
    await handle.getCandidateKnowledgeDirectoryBinding(knowledgeBaseId, directoryId),
    knowledgeBaseId,
    directoryId,
  );
  const canonicalRoot = await validateDirectoryImportScope(
    dependencies.lstat,
    dependencies.realpath,
    binding.rootPath,
    storeRoot,
  );
  if (canonicalRoot !== binding.rootPath) {
    throw previewDirectoryRefreshFailure();
  }

  let preflight: DirectoryIngestionResult;
  try {
    preflight = await dependencies.ingestDirectory(canonicalRoot, options);
    validateDirectoryIngestionResult(preflight);
  } catch {
    throw previewDirectoryRefreshFailure();
  }

  const historicalMembers = await handle.listCandidateKnowledgeDirectoryMembers(
    knowledgeBaseId,
    directoryId,
  );
  if (!Array.isArray(historicalMembers)) {
    throw previewDirectoryRefreshFailure();
  }
  const historicalBySource = new Map<string, CandidateKnowledgeDirectoryMemberRecord>();
  const historicalByHash = new Map<string, CandidateKnowledgeDirectoryMemberRecord>();
  const historicalSourceIds = new Set<string>();
  const historicalHashes = new Set<string>();
  for (const member of historicalMembers) {
    validatePreviewDirectoryMember(
      member,
      knowledgeBaseId,
      directoryId,
      historicalSourceIds,
      historicalHashes,
    );
    historicalBySource.set(member.sourceId, member);
    historicalByHash.set(member.relativePathHash, member);
  }

  const scannedByPath = new Map<string, NonNullable<DirectoryIngestionResult["sources"][number]>>();
  const matchedPathBySource = new Map<string, string>();
  const matchedSources = new Map<
    string,
    NonNullable<DirectoryIngestionResult["sources"][number]>
  >();
  const unmatchedSources: NonNullable<DirectoryIngestionResult["sources"][number]>[] = [];
  let newSourceCount = 0;
  for (const normalized of preflight.sources) {
    const sourcePath = normalized.source.path;
    if (scannedByPath.has(sourcePath)) {
      throw previewDirectoryRefreshFailure();
    }
    scannedByPath.set(sourcePath, normalized);
    const matched = await handle.findCandidateKnowledgeDirectoryMemberByPath(
      knowledgeBaseId,
      directoryId,
      sourcePath,
    );
    if (matched === undefined) {
      newSourceCount += 1;
      unmatchedSources.push(normalized);
      continue;
    }
    if (
      typeof matched !== "object" ||
      matched === null ||
      matched.directoryId !== directoryId ||
      matched.knowledgeBaseId !== knowledgeBaseId ||
      typeof matched.sourceId !== "string" ||
      matched.sourceId.trim() === "" ||
      !/^[0-9a-f]{64}$/u.test(matched.relativePathHash)
    ) {
      throw previewDirectoryRefreshFailure();
    }
    const expected = historicalBySource.get(matched.sourceId);
    const expectedByHash = historicalByHash.get(matched.relativePathHash);
    if (
      expected === undefined ||
      expectedByHash === undefined ||
      expected.sourceId !== expectedByHash.sourceId ||
      expected.relativePathHash !== matched.relativePathHash ||
      matchedPathBySource.has(matched.sourceId)
    ) {
      throw previewDirectoryRefreshFailure();
    }
    matchedPathBySource.set(matched.sourceId, sourcePath);
    matchedSources.set(matched.sourceId, normalized);
  }

  const collectedMembers: CollectedDirectoryRefreshMember[] = [];
  for (const member of [...historicalMembers].sort((left, right) =>
    lexicalCompare(left.sourceId, right.sourceId),
  )) {
    const source = validatePreviewDirectorySource(
      await handle.getCandidateKnowledgeSource(knowledgeBaseId, member.sourceId),
      knowledgeBaseId,
      member.sourceId,
    );
    const versions = await handle.listCandidateKnowledgeSourceVersions(
      knowledgeBaseId,
      member.sourceId,
    );
    const latestVersion = latestPreviewDirectorySourceVersion(versions, member.sourceId);
    const relation = validatePreviewDirectoryOriginRelation(
      await handle.getCandidateKnowledgeDirectoryMemberOriginRelation(
        knowledgeBaseId,
        directoryId,
        member.sourceId,
      ),
      knowledgeBaseId,
      directoryId,
      member.sourceId,
    );
    const retirement = await handle.getCandidateKnowledgeSourceRetirement(
      knowledgeBaseId,
      member.sourceId,
    );
    if (retirement !== undefined) {
      validateRetirementRecord(retirement, member.sourceId);
    }

    let status: PreviewKnowledgeSourceDirectoryRefreshMemberStatus;
    if (retirement !== undefined) {
      status = "retired";
    } else if (relation.relation !== "same-member") {
      status = "origin-conflict";
    } else {
      const matchedPath = matchedPathBySource.get(member.sourceId);
      if (matchedPath === undefined) {
        status = "missing";
      } else {
        const scanned = scannedByPath.get(matchedPath);
        if (scanned === undefined) {
          throw previewDirectoryRefreshFailure();
        }
        status =
          scanned.mediaType === latestVersion.mediaType &&
          scanned.checksum === latestVersion.checksum &&
          scanned.sizeBytes === latestVersion.sizeBytes
            ? "current"
            : "changed";
      }
    }
    if (source.kind !== "file") {
      throw previewDirectoryRefreshFailure();
    }
    collectedMembers.push({
      sourceId: member.sourceId,
      status,
      observedVersionId: latestVersion.id,
      latestVersion,
      ...(relation.originBoundAt === undefined
        ? {}
        : { expectedOriginBoundAt: relation.originBoundAt }),
      originRelation: relation.relation,
      ...(retirement === undefined ? {} : { retirement }),
    });
  }

  const checkedAt = dependencies.now();
  if (!isValidRefreshTimestamp(checkedAt)) {
    throw previewDirectoryRefreshFailure();
  }
  return {
    directoryId,
    checkedAt,
    preflight,
    members: collectedMembers,
    newSourceCount,
    matchedSources,
    unmatchedSources: [...unmatchedSources].sort((left, right) =>
      lexicalCompare(left.source.path, right.source.path),
    ),
  };
}

interface CollectedDirectoryRootRebindPreview {
  readonly directoryId: string;
  readonly checkedAt: string;
  readonly status: "current" | "ready";
  readonly memberCount: number;
  readonly preflight: DirectoryIngestionResult;
}

async function collectDirectoryRootRebindPreview(
  handle: CandidateKnowledgeStoreHandle,
  dependencies: ResolvedDependencies,
  storeRoot: string,
  knowledgeBaseId: string,
  directoryId: string,
  directoryPath: string,
  options: DirectoryIngestionOptions | undefined,
): Promise<CollectedDirectoryRootRebindPreview> {
  const knowledgeBase = await handle.getCandidateKnowledgeBase(knowledgeBaseId);
  if (
    knowledgeBase === undefined ||
    typeof knowledgeBase !== "object" ||
    knowledgeBase === null ||
    knowledgeBase.id !== knowledgeBaseId ||
    knowledgeBase.state !== "active"
  ) {
    throw previewDirectoryRootRebindFailure();
  }

  const binding = validatePreviewDirectoryBinding(
    await handle.getCandidateKnowledgeDirectoryBinding(knowledgeBaseId, directoryId),
    knowledgeBaseId,
    directoryId,
  );
  if (!isAbsolute(binding.rootPath) || resolve(binding.rootPath) !== binding.rootPath) {
    throw previewDirectoryRootRebindFailure();
  }
  const canonicalCandidateRoot = await validateDirectoryImportScope(
    dependencies.lstat,
    dependencies.realpath,
    directoryPath,
    storeRoot,
  );
  const existingBinding = await handle.findCandidateKnowledgeDirectoryBinding(
    knowledgeBaseId,
    canonicalCandidateRoot,
  );
  if (existingBinding !== undefined) {
    if (typeof existingBinding.id !== "string" || existingBinding.id.trim() === "") {
      throw previewDirectoryRootRebindFailure();
    }
    const validatedExistingBinding = validatePreviewDirectoryBinding(
      existingBinding,
      knowledgeBaseId,
      existingBinding.id,
    );
    if (
      validatedExistingBinding.rootPath !== canonicalCandidateRoot ||
      validatedExistingBinding.id !== directoryId ||
      validatedExistingBinding.rootPath !== binding.rootPath
    ) {
      throw previewDirectoryRootRebindFailure();
    }
  }

  let preflight: DirectoryIngestionResult;
  try {
    preflight = await dependencies.ingestDirectory(canonicalCandidateRoot, options);
    validateDirectoryIngestionResult(preflight);
  } catch {
    throw previewDirectoryRootRebindFailure();
  }

  const historicalMembers = await handle.listCandidateKnowledgeDirectoryMembers(
    knowledgeBaseId,
    directoryId,
  );
  if (!Array.isArray(historicalMembers)) {
    throw previewDirectoryRootRebindFailure();
  }
  const historicalBySource = new Map<string, CandidateKnowledgeDirectoryMemberRecord>();
  const historicalByHash = new Map<string, CandidateKnowledgeDirectoryMemberRecord>();
  const historicalSourceIds = new Set<string>();
  const historicalHashes = new Set<string>();
  for (const member of historicalMembers) {
    validatePreviewDirectoryMember(
      member,
      knowledgeBaseId,
      directoryId,
      historicalSourceIds,
      historicalHashes,
    );
    historicalBySource.set(member.sourceId, member);
    historicalByHash.set(member.relativePathHash, member);
  }

  const latestBySource = new Map<string, CandidateKnowledgeSourceVersionRecord>();
  const sourceById = new Map<string, CandidateKnowledgeSourceRecord>();
  const originBoundAtBySource = new Map<string, string>();
  for (const member of [...historicalMembers].sort((left, right) =>
    lexicalCompare(left.sourceId, right.sourceId),
  )) {
    const source = validatePreviewDirectorySource(
      await handle.getCandidateKnowledgeSource(knowledgeBaseId, member.sourceId),
      knowledgeBaseId,
      member.sourceId,
    );
    sourceById.set(member.sourceId, source);
    const latestVersion = latestPreviewDirectorySourceVersion(
      await handle.listCandidateKnowledgeSourceVersions(knowledgeBaseId, member.sourceId),
      member.sourceId,
    );
    const managedPath = await handle.getManagedCandidateKnowledgeFilePath(
      knowledgeBaseId,
      member.sourceId,
      latestVersion.id,
    );
    if (typeof managedPath !== "string" || managedPath.trim() === "") {
      throw previewDirectoryRootRebindFailure();
    }
    const relation = validatePreviewDirectoryOriginRelation(
      await handle.getCandidateKnowledgeDirectoryMemberOriginRelation(
        knowledgeBaseId,
        directoryId,
        member.sourceId,
      ),
      knowledgeBaseId,
      directoryId,
      member.sourceId,
    );
    if (relation.relation !== "same-member" || relation.originBoundAt === undefined) {
      throw previewDirectoryRootRebindFailure();
    }
    const retirement = await handle.getCandidateKnowledgeSourceRetirement(
      knowledgeBaseId,
      member.sourceId,
    );
    if (retirement !== undefined) {
      validateRetirementRecord(retirement, member.sourceId);
      throw previewDirectoryRootRebindFailure();
    }
    latestBySource.set(member.sourceId, latestVersion);
    originBoundAtBySource.set(member.sourceId, relation.originBoundAt);
  }

  const scannedPaths = new Set<string>();
  const matchedSourceIds = new Set<string>();
  for (const normalized of preflight.sources) {
    const sourcePath = normalized.source.path;
    if (!isAbsolute(sourcePath) || scannedPaths.has(sourcePath)) {
      throw previewDirectoryRootRebindFailure();
    }
    scannedPaths.add(sourcePath);
    const matched = await handle.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
      knowledgeBaseId,
      directoryId,
      canonicalCandidateRoot,
      sourcePath,
    );
    if (
      matched === undefined ||
      typeof matched !== "object" ||
      matched === null ||
      matched.directoryId !== directoryId ||
      matched.knowledgeBaseId !== knowledgeBaseId ||
      typeof matched.sourceId !== "string" ||
      matched.sourceId.trim() === "" ||
      !/^[0-9a-f]{64}$/u.test(matched.relativePathHash)
    ) {
      throw previewDirectoryRootRebindFailure();
    }
    const expectedBySource = historicalBySource.get(matched.sourceId);
    const expectedByHash = historicalByHash.get(matched.relativePathHash);
    const latestVersion = latestBySource.get(matched.sourceId);
    const originBoundAt = originBoundAtBySource.get(matched.sourceId);
    if (
      expectedBySource === undefined ||
      expectedByHash === undefined ||
      expectedBySource.sourceId !== expectedByHash.sourceId ||
      expectedBySource.relativePathHash !== matched.relativePathHash ||
      latestVersion === undefined ||
      originBoundAt === undefined ||
      matchedSourceIds.has(matched.sourceId) ||
      normalized.mediaType !== latestVersion.mediaType ||
      normalized.checksum !== latestVersion.checksum ||
      normalized.sizeBytes !== latestVersion.sizeBytes
    ) {
      throw previewDirectoryRootRebindFailure();
    }
    matchedSourceIds.add(matched.sourceId);
  }
  if (matchedSourceIds.size !== historicalMembers.length) {
    throw previewDirectoryRootRebindFailure();
  }

  const checkedAt = dependencies.now();
  if (!isValidRefreshTimestamp(checkedAt)) {
    throw previewDirectoryRootRebindFailure();
  }
  const checkedAtMillis = Date.parse(checkedAt);
  if (checkedAtMillis < Date.parse(binding.boundAt)) {
    throw previewDirectoryRootRebindFailure();
  }
  for (const member of historicalMembers) {
    const source = sourceById.get(member.sourceId);
    if (source === undefined || checkedAtMillis < Date.parse(source.createdAt)) {
      throw previewDirectoryRootRebindFailure();
    }
    const latestVersion = latestBySource.get(member.sourceId);
    const originBoundAt = originBoundAtBySource.get(member.sourceId);
    if (
      latestVersion === undefined ||
      originBoundAt === undefined ||
      checkedAtMillis < Date.parse(latestVersion.createdAt) ||
      checkedAtMillis < Date.parse(originBoundAt)
    ) {
      throw previewDirectoryRootRebindFailure();
    }
  }

  return {
    directoryId,
    checkedAt,
    status: canonicalCandidateRoot === binding.rootPath ? "current" : "ready",
    memberCount: historicalMembers.length,
    preflight,
  };
}

function directoryRootRebindPreviewResult(
  collected: CollectedDirectoryRootRebindPreview,
): PreviewKnowledgeSourceDirectoryRootRebindResult {
  return Object.freeze({
    directoryId: collected.directoryId,
    checkedAt: collected.checkedAt,
    status: collected.status,
    memberCount: collected.memberCount,
    scannedEntryCount: collected.preflight.scannedEntryCount,
    discoveredFileCount: collected.preflight.discoveredFileCount,
    skippedEntryCount: collected.preflight.skippedEntryCount,
  });
}

function directoryMovedCandidateTuple(
  mediaType: string,
  checksum: string,
  sizeBytes: number,
): string {
  return JSON.stringify([mediaType, checksum, sizeBytes]);
}

async function collectDirectoryMovedCandidateSourceIds(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
  collected: CollectedDirectoryRefresh,
): Promise<readonly string[]> {
  const eligibleByTuple = new Map<string, CollectedDirectoryRefreshMember[]>();
  for (const member of collected.members) {
    if (
      member.status !== "missing" ||
      member.originRelation !== "same-member" ||
      member.retirement !== undefined ||
      member.expectedOriginBoundAt === undefined ||
      !isValidRefreshTimestamp(member.expectedOriginBoundAt)
    ) {
      continue;
    }
    const managedPath = await handle.getManagedCandidateKnowledgeFilePath(
      knowledgeBaseId,
      member.sourceId,
      member.latestVersion.id,
    );
    if (typeof managedPath !== "string" || managedPath.trim() === "") {
      throw previewDirectoryMovedCandidatesFailure();
    }
    const tuple = directoryMovedCandidateTuple(
      member.latestVersion.mediaType,
      member.latestVersion.checksum,
      member.latestVersion.sizeBytes,
    );
    const entries = eligibleByTuple.get(tuple);
    if (entries === undefined) {
      eligibleByTuple.set(tuple, [member]);
    } else {
      entries.push(member);
    }
  }

  const unmatchedByTuple = new Map<
    string,
    NonNullable<DirectoryIngestionResult["sources"][number]>[]
  >();
  for (const source of collected.unmatchedSources) {
    const tuple = directoryMovedCandidateTuple(source.mediaType, source.checksum, source.sizeBytes);
    const entries = unmatchedByTuple.get(tuple);
    if (entries === undefined) {
      unmatchedByTuple.set(tuple, [source]);
    } else {
      entries.push(source);
    }
  }

  const candidateSourceIds: string[] = [];
  for (const [tuple, members] of eligibleByTuple) {
    const unmatched = unmatchedByTuple.get(tuple);
    if (members.length === 1 && unmatched?.length === 1) {
      const member = members[0];
      if (member !== undefined) candidateSourceIds.push(member.sourceId);
    }
  }
  return candidateSourceIds.sort(lexicalCompare);
}

async function directoryMovedCandidatesPreviewResult(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
  collected: CollectedDirectoryRefresh,
): Promise<PreviewKnowledgeSourceDirectoryMovedCandidatesResult> {
  const candidateSourceIds = await collectDirectoryMovedCandidateSourceIds(
    handle,
    knowledgeBaseId,
    collected,
  );
  return Object.freeze({
    directoryId: collected.directoryId,
    checkedAt: collected.checkedAt,
    candidates: Object.freeze(
      candidateSourceIds.map((sourceId) =>
        Object.freeze({ sourceId, status: "moved-candidate" as const }),
      ),
    ),
    candidateCount: candidateSourceIds.length,
    newSourceCount: collected.newSourceCount,
    scannedEntryCount: collected.preflight.scannedEntryCount,
    discoveredFileCount: collected.preflight.discoveredFileCount,
    skippedEntryCount: collected.preflight.skippedEntryCount,
  });
}

function recordDirectoryRefreshResult(
  collected: CollectedDirectoryRefresh,
  recordedObservationCount: number,
): RecordKnowledgeSourceDirectoryRefreshResult {
  return Object.freeze({
    directoryId: collected.directoryId,
    checkedAt: collected.checkedAt,
    members: Object.freeze(
      collected.members.map((member) =>
        Object.freeze({ sourceId: member.sourceId, status: member.status }),
      ),
    ),
    newSourceCount: collected.newSourceCount,
    scannedEntryCount: collected.preflight.scannedEntryCount,
    discoveredFileCount: collected.preflight.discoveredFileCount,
    skippedEntryCount: collected.preflight.skippedEntryCount,
    recordedObservationCount,
  });
}

function applyDirectoryRefreshResult(
  collected: CollectedDirectoryRefresh,
  refreshedSourceIds: readonly string[],
  failure?: {
    readonly sourceId: string;
    readonly status: PreviewKnowledgeSourceDirectoryRefreshMemberStatus;
  },
): ApplyKnowledgeSourceDirectoryRefreshResult {
  const common = {
    directoryId: collected.directoryId,
    checkedAt: collected.checkedAt,
    members: Object.freeze(
      collected.members.map((member) =>
        Object.freeze({ sourceId: member.sourceId, status: member.status }),
      ),
    ),
    newSourceCount: collected.newSourceCount,
    scannedEntryCount: collected.preflight.scannedEntryCount,
    discoveredFileCount: collected.preflight.discoveredFileCount,
    skippedEntryCount: collected.preflight.skippedEntryCount,
    refreshedSourceIds: Object.freeze([...refreshedSourceIds]),
  };
  return Object.freeze(
    failure === undefined
      ? { ...common, status: "complete" as const }
      : {
          ...common,
          status: "partial" as const,
          failedSourceId: failure.sourceId,
          failedStatus: failure.status,
        },
  );
}

function addDirectoryMembersResult(
  collected: CollectedDirectoryRefresh,
  addedSourceIds: readonly string[],
  status: "complete" | "partial",
): AddKnowledgeSourceDirectoryMembersResult {
  return Object.freeze({
    directoryId: collected.directoryId,
    checkedAt: collected.checkedAt,
    members: Object.freeze(
      collected.members.map((member) =>
        Object.freeze({ sourceId: member.sourceId, status: member.status }),
      ),
    ),
    newSourceCount: collected.newSourceCount,
    scannedEntryCount: collected.preflight.scannedEntryCount,
    discoveredFileCount: collected.preflight.discoveredFileCount,
    skippedEntryCount: collected.preflight.skippedEntryCount,
    addedSourceIds: Object.freeze([...addedSourceIds]),
    addedSourceCount: addedSourceIds.length,
    status,
  });
}

function retireDirectoryMemberResult(
  directoryId: string,
  sourceId: string,
  status: RetireKnowledgeSourceDirectoryMemberResult["status"],
  checkedAt: string,
  retirement: CandidateKnowledgeSourceRetirementRecord,
): RetireKnowledgeSourceDirectoryMemberResult {
  return Object.freeze({
    directoryId,
    sourceId,
    status,
    checkedAt,
    retiredAt: retirement.retiredAt,
    reason: retirement.reason,
  });
}

function validateRecordedDirectoryRefreshObservations(
  observations: readonly CandidateKnowledgeSourceRefreshObservationRecord[],
  entries: readonly {
    readonly sourceId: string;
    readonly observedVersionId: string;
    readonly status: "current" | "changed" | "missing";
  }[],
  previousObservations: readonly (CandidateKnowledgeSourceRefreshObservationRecord | undefined)[],
  checkedAt: string,
): void {
  if (
    !Array.isArray(observations) ||
    observations.length !== entries.length ||
    previousObservations.length !== entries.length
  ) {
    throw previewDirectoryRefreshFailure();
  }
  for (const [index, entry] of entries.entries()) {
    const observation = observations[index];
    if (observation === undefined) {
      throw previewDirectoryRefreshFailure();
    }
    validateRefreshStateObservation(observation, entry.sourceId);
    if (
      observation.observedVersionId !== entry.observedVersionId ||
      observation.status !== entry.status ||
      observation.checkedAt !== checkedAt ||
      observation.stale
    ) {
      throw previewDirectoryRefreshFailure();
    }
    const previous = previousObservations[index];
    if (
      observation.lastRefreshedVersionId !== (previous?.lastRefreshedVersionId ?? null) ||
      observation.lastRefreshedAt !== (previous?.lastRefreshedAt ?? null)
    ) {
      throw previewDirectoryRefreshFailure();
    }
  }
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

async function ingestManagedCandidateKnowledgeUrl(
  ingest: typeof ingestUrl,
  url: string,
): Promise<NonNullable<Awaited<ReturnType<typeof ingestUrl>>["source"]>> {
  let ingestion: Awaited<ReturnType<typeof ingestUrl>>;
  try {
    ingestion = await ingest(url, { approved: true });
  } catch {
    throw importUrlFailure();
  }
  const normalized = ingestion.source;
  const provenance = normalized?.url;
  const responseBytes = normalized?.urlResponseBytes;
  const checksum =
    responseBytes instanceof Uint8Array
      ? createHash("sha256").update(responseBytes).digest("hex")
      : "";
  const validUrl = (value: unknown): value is string => {
    if (typeof value !== "string" || value.trim() === "") return false;
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hash === "" &&
        parsed.hostname !== ""
      );
    } catch {
      return false;
    }
  };
  const validKind =
    provenance?.kind === "github" ||
    provenance?.kind === "certification" ||
    provenance?.kind === "profile" ||
    provenance?.kind === "portfolio" ||
    provenance?.kind === "job-description" ||
    provenance?.kind === "generic";
  if (
    normalized === null ||
    ingestion.issues.length > 0 ||
    normalized.issues.length > 0 ||
    normalized.chunks.length === 0 ||
    normalized.chunks.some((chunk) => chunk.text.trim() === "") ||
    provenance === undefined ||
    !validUrl(provenance.originalUrl) ||
    !validUrl(provenance.finalUrl) ||
    typeof provenance.fetchedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      provenance.fetchedAt,
    ) ||
    Number.isNaN(Date.parse(provenance.fetchedAt)) ||
    !validKind ||
    !(responseBytes instanceof Uint8Array) ||
    responseBytes.byteLength !== normalized.sizeBytes ||
    responseBytes.byteLength > maximumManagedCandidateKnowledgeUrlResponseBytes ||
    normalized.checksum !== checksum
  ) {
    throw importUrlFailure();
  }
  return {
    ...normalized,
    urlResponseBytes: new Uint8Array(responseBytes),
  };
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

function retirementInvariantFailure(): Error {
  return new Error("Candidate knowledge source retirement returned inconsistent storage state.");
}

function validateRetirementRecord(
  retirement: CandidateKnowledgeSourceRetirementRecord,
  sourceId: string,
): void {
  if (
    typeof retirement !== "object" ||
    retirement === null ||
    retirement.sourceId !== sourceId ||
    !isValidRefreshTimestamp(retirement.retiredAt) ||
    retirement.reason !== "user-requested"
  ) {
    throw retirementInvariantFailure();
  }
}

function projectRetirement(
  retirement: CandidateKnowledgeSourceRetirementRecord | undefined,
  sourceId: string,
): KnowledgeSourceRetirementResult {
  if (retirement === undefined) {
    return Object.freeze({ sourceId, status: "active" as const });
  }
  validateRetirementRecord(retirement, sourceId);
  return Object.freeze({
    sourceId,
    status: "retired" as const,
    retiredAt: retirement.retiredAt,
    reason: retirement.reason,
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

function validateAppliedDirectoryAppendResult(
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
    typeof result.created !== "boolean" ||
    result.source.id !== sourceId ||
    result.source.knowledgeBaseId !== knowledgeBaseId ||
    result.source.kind !== "file" ||
    result.version.sourceId !== sourceId ||
    result.version.mediaType !== requestedVersion.mediaType ||
    result.version.checksum !== requestedVersion.checksum ||
    result.version.sizeBytes !== requestedVersion.sizeBytes
  ) {
    throw applyDirectoryRefreshFailure();
  }
  if (result.created) {
    if (
      result.version.id !== requestedVersion.id ||
      result.version.version !== latestVersion.version + 1 ||
      result.version.parentVersionId !== latestVersion.id ||
      result.version.createdAt !== requestedVersion.createdAt
    ) {
      throw applyDirectoryRefreshFailure();
    }
    return;
  }
  if (
    result.version.id !== latestVersion.id ||
    result.version.version !== latestVersion.version ||
    result.version.parentVersionId !== latestVersion.parentVersionId ||
    result.version.createdAt !== latestVersion.createdAt
  ) {
    throw applyDirectoryRefreshFailure();
  }
}

function validateAddedDirectorySourceWriteResult(
  result: Awaited<
    ReturnType<CandidateKnowledgeStoreHandle["createManagedCandidateKnowledgeFileSource"]>
  >,
  requestedSource: CandidateKnowledgeSource,
  requestedVersion: CandidateKnowledgeSourceVersionRecord,
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.source !== "object" ||
    result.source === null ||
    typeof result.version !== "object" ||
    result.version === null ||
    result.created !== true ||
    result.source.id !== requestedSource.id ||
    result.source.knowledgeBaseId !== requestedSource.knowledgeBaseId ||
    result.source.kind !== "file" ||
    result.source.displayName !== requestedSource.displayName ||
    result.source.createdAt !== requestedSource.createdAt ||
    result.version.id !== requestedVersion.id ||
    result.version.sourceId !== requestedVersion.sourceId ||
    result.version.version !== 1 ||
    result.version.parentVersionId !== null ||
    result.version.mediaType !== requestedVersion.mediaType ||
    result.version.checksum !== requestedVersion.checksum ||
    result.version.sizeBytes !== requestedVersion.sizeBytes ||
    result.version.createdAt !== requestedVersion.createdAt
  ) {
    throw addDirectoryMembersFailure();
  }
}

interface UrlRefreshPreflight {
  readonly originalUrl: string;
  readonly latestVersion: CandidateKnowledgeSourceVersionRecord;
}

function isSafeKnowledgeSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.hash === "" &&
      parsed.hostname !== ""
    );
  } catch {
    return false;
  }
}

function validateUrlRefreshProvenance(
  provenance: CandidateKnowledgeSourceUrlProvenanceRecord | undefined,
  sourceId: string,
  version: CandidateKnowledgeSourceVersionRecord,
): CandidateKnowledgeSourceUrlProvenanceRecord {
  if (
    provenance === undefined ||
    typeof provenance !== "object" ||
    provenance === null ||
    provenance.sourceId !== sourceId ||
    provenance.versionId !== version.id ||
    !isSafeKnowledgeSourceUrl(provenance.originalUrl) ||
    !isSafeKnowledgeSourceUrl(provenance.finalUrl) ||
    !isValidRefreshTimestamp(provenance.fetchedAt) ||
    Date.parse(provenance.fetchedAt) !== Date.parse(version.createdAt) ||
    !["github", "certification", "profile", "portfolio", "job-description", "generic"].includes(
      provenance.kind,
    )
  ) {
    throw refreshUrlFailure();
  }
  return provenance;
}

async function prepareUrlRefresh(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
  sourceId: string,
): Promise<UrlRefreshPreflight> {
  const knowledgeBase = await handle.getCandidateKnowledgeBase(knowledgeBaseId);
  if (
    knowledgeBase === undefined ||
    typeof knowledgeBase !== "object" ||
    knowledgeBase === null ||
    knowledgeBase.id !== knowledgeBaseId ||
    knowledgeBase.state !== "active"
  ) {
    throw refreshUrlFailure();
  }
  const source = await handle.getCandidateKnowledgeSource(knowledgeBaseId, sourceId);
  if (
    source === undefined ||
    typeof source !== "object" ||
    source === null ||
    source.id !== sourceId ||
    source.knowledgeBaseId !== knowledgeBaseId ||
    source.kind !== "url"
  ) {
    throw refreshUrlFailure();
  }
  const versions = await handle.listCandidateKnowledgeSourceVersions(knowledgeBaseId, sourceId);
  if (!Array.isArray(versions) || versions.length === 0) {
    throw refreshUrlFailure();
  }
  const ordered = [...versions].sort(
    (left, right) => left.version - right.version || left.id.localeCompare(right.id),
  );
  const versionIds = new Set<string>();
  let parentId: string | null = null;
  let previousCreatedAt: string | undefined;
  for (const [index, version] of ordered.entries()) {
    if (
      typeof version !== "object" ||
      version === null ||
      version.sourceId !== sourceId ||
      typeof version.id !== "string" ||
      version.id.trim() === "" ||
      versionIds.has(version.id) ||
      !Number.isInteger(version.version) ||
      version.version !== index + 1 ||
      version.parentVersionId !== parentId ||
      typeof version.mediaType !== "string" ||
      version.mediaType.trim() === "" ||
      !/^[0-9a-f]{64}$/u.test(version.checksum) ||
      !Number.isInteger(version.sizeBytes) ||
      version.sizeBytes < 0 ||
      !isValidRefreshTimestamp(version.createdAt) ||
      (previousCreatedAt !== undefined &&
        Date.parse(version.createdAt) < Date.parse(previousCreatedAt))
    ) {
      throw refreshUrlFailure();
    }
    versionIds.add(version.id);
    parentId = version.id;
    previousCreatedAt = version.createdAt;
  }
  const latestVersion = ordered.at(-1) as CandidateKnowledgeSourceVersionRecord;
  const provenance = validateUrlRefreshProvenance(
    await handle.getCandidateKnowledgeSourceUrlProvenance(
      knowledgeBaseId,
      sourceId,
      latestVersion.id,
    ),
    sourceId,
    latestVersion,
  );
  const retirement = await handle.getCandidateKnowledgeSourceRetirement(knowledgeBaseId, sourceId);
  if (retirement !== undefined) throw refreshUrlFailure();
  return { originalUrl: provenance.originalUrl, latestVersion };
}

function validateUrlRefreshAppendResult(
  result: Awaited<
    ReturnType<CandidateKnowledgeStoreHandle["appendManagedCandidateKnowledgeUrlVersion"]>
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
    typeof result.created !== "boolean" ||
    result.source.id !== sourceId ||
    result.source.knowledgeBaseId !== knowledgeBaseId ||
    result.source.kind !== "url" ||
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
    result.version.id !== latestVersion.id ||
    result.version.version !== latestVersion.version ||
    result.version.parentVersionId !== latestVersion.parentVersionId ||
    result.version.createdAt !== latestVersion.createdAt
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

interface DuplicateGroupMemberInternal extends KnowledgeSourceDuplicateGroupMember {}

interface DuplicateGroupInternal {
  readonly members: DuplicateGroupMemberInternal[];
}

function duplicateGraphInvariantFailure(): Error {
  return new Error("Candidate knowledge source duplicate graph returned inconsistent state.");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function duplicateMemberCompare(
  left: KnowledgeSourceDuplicateGroupMember,
  right: KnowledgeSourceDuplicateGroupMember,
): number {
  return (
    lexicalCompare(left.sourceId, right.sourceId) || lexicalCompare(left.versionId, right.versionId)
  );
}

function validateDuplicateSourceRecord(
  record: CandidateKnowledgeSourceRecord,
  knowledgeBaseId: string,
  sourceIds: Set<string>,
): void {
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.id !== "string" ||
    record.id.trim() === "" ||
    record.knowledgeBaseId !== knowledgeBaseId ||
    (record.kind !== "file" && record.kind !== "url") ||
    typeof record.displayName !== "string" ||
    record.displayName.trim() === "" ||
    !isValidRefreshTimestamp(record.createdAt)
  ) {
    throw duplicateGraphInvariantFailure();
  }
  if (sourceIds.has(record.id)) {
    throw duplicateGraphInvariantFailure();
  }
  sourceIds.add(record.id);
}

function latestDuplicateSourceVersion(
  versions: readonly CandidateKnowledgeSourceVersionRecord[],
  sourceId: string,
  queryVersionIds: Set<string>,
): CandidateKnowledgeSourceVersionRecord {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw duplicateGraphInvariantFailure();
  }
  const versionIds = new Set<string>();
  const versionNumbers = new Set<number>();
  for (const version of versions) {
    if (
      typeof version !== "object" ||
      version === null ||
      typeof version.id !== "string" ||
      version.id.trim() === "" ||
      versionIds.has(version.id) ||
      queryVersionIds.has(version.id) ||
      version.sourceId !== sourceId ||
      !Number.isInteger(version.version) ||
      version.version < 1 ||
      versionNumbers.has(version.version) ||
      (version.version === 1
        ? version.parentVersionId !== null
        : typeof version.parentVersionId !== "string" || version.parentVersionId.trim() === "") ||
      typeof version.mediaType !== "string" ||
      version.mediaType.trim() === "" ||
      typeof version.checksum !== "string" ||
      !/^[0-9a-f]{64}$/iu.test(version.checksum) ||
      !Number.isInteger(version.sizeBytes) ||
      version.sizeBytes < 0 ||
      !isValidRefreshTimestamp(version.createdAt)
    ) {
      throw duplicateGraphInvariantFailure();
    }
    versionIds.add(version.id);
    queryVersionIds.add(version.id);
    versionNumbers.add(version.version);
  }

  const ordered = [...versions].sort(
    (left, right) => left.version - right.version || lexicalCompare(left.id, right.id),
  );
  let previous: CandidateKnowledgeSourceVersionRecord | undefined;
  for (const [index, version] of ordered.entries()) {
    if (
      version.version !== index + 1 ||
      (previous === undefined
        ? version.parentVersionId !== null
        : version.parentVersionId !== previous.id) ||
      (previous !== undefined && Date.parse(version.createdAt) < Date.parse(previous.createdAt))
    ) {
      throw duplicateGraphInvariantFailure();
    }
    previous = version;
  }
  return ordered.reduce((latest, version) => {
    if (
      version.version > latest.version ||
      (version.version === latest.version && lexicalCompare(version.id, latest.id) > 0)
    ) {
      return version;
    }
    return latest;
  });
}

function projectDuplicateGroups(
  groups: readonly DuplicateGroupInternal[],
): readonly KnowledgeSourceDuplicateGroup[] {
  const projected = groups
    .map((group) => {
      const members = [...group.members]
        .sort(duplicateMemberCompare)
        .map((member) => Object.freeze({ sourceId: member.sourceId, versionId: member.versionId }));
      return Object.freeze({ members: Object.freeze(members) });
    })
    .sort((left, right) => {
      for (let index = 0; index < Math.min(left.members.length, right.members.length); index += 1) {
        const leftMember = left.members[index];
        const rightMember = right.members[index];
        if (leftMember === undefined || rightMember === undefined) {
          throw duplicateGraphInvariantFailure();
        }
        const comparison = duplicateMemberCompare(leftMember, rightMember);
        if (comparison !== 0) return comparison;
      }
      return left.members.length - right.members.length;
    });
  return Object.freeze(projected);
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
    ingestDirectory: dependencies.ingestDirectory ?? ingestDirectory,
    ingestUrl: dependencies.ingestUrl ?? ingestUrl,
    lstat: dependencies.lstat ?? lstat,
    realpath: dependencies.realpath ?? realpath,
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
    importKnowledgeSourceDirectory: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const directoryPath = requireText(
        command.directoryPath,
        "Candidate knowledge source directory path",
      );

      let canonicalDirectory: string;
      try {
        canonicalDirectory = await validateDirectoryImportScope(
          resolved.lstat,
          resolved.realpath,
          directoryPath,
          storeRoot,
        );
      } catch {
        throw importDirectoryFailure();
      }

      let preflight: DirectoryIngestionResult;
      try {
        preflight = await resolved.ingestDirectory(directoryPath, command.options);
        validateDirectoryIngestionResult(preflight);
      } catch {
        throw importDirectoryFailure();
      }

      const orderedSources = [...preflight.sources].sort((left, right) =>
        left.source.path < right.source.path ? -1 : left.source.path > right.source.path ? 1 : 0,
      );
      const orderedPreflight: DirectoryIngestionResult = {
        ...preflight,
        sources: orderedSources,
      };
      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const knowledgeBase = await handle.getCandidateKnowledgeBase(knowledgeBaseId);
            if (
              knowledgeBase === undefined ||
              knowledgeBase.id !== knowledgeBaseId ||
              knowledgeBase.state !== "active"
            ) {
              throw importDirectoryFailure();
            }
            const existingBinding = await handle.findCandidateKnowledgeDirectoryBinding(
              knowledgeBaseId,
              canonicalDirectory,
            );
            if (existingBinding !== undefined) {
              throw importDirectoryFailure();
            }
            const projected: CandidateKnowledgeSourceWriteResult[] = [];
            const committedSourceIds: string[] = [];
            let committedCount = 0;
            for (const normalized of orderedSources) {
              try {
                const sourceId = requireText(
                  resolved.generateId(),
                  "Candidate knowledge source id",
                );
                const versionId = requireText(
                  resolved.generateId(),
                  "Candidate knowledge source version id",
                );
                const createdAt = resolved.now();
                const source = createCandidateKnowledgeSource(
                  sourceId,
                  {
                    knowledgeBaseId,
                    kind: "file",
                    displayName: sourceDisplayName(normalized.source.path),
                  },
                  createdAt,
                );
                const result = await handle.createManagedCandidateKnowledgeFileSource(source, {
                  id: versionId,
                  sourcePath: normalized.source.path,
                  mediaType: normalized.mediaType,
                  checksum: normalized.checksum,
                  sizeBytes: normalized.sizeBytes,
                  createdAt,
                });
                committedCount += 1;
                projected.push(
                  await projectSourceWriteResult(
                    handle,
                    knowledgeBaseId,
                    result.source,
                    result.created,
                  ),
                );
                committedSourceIds.push(result.source.id);
              } catch {
                if (committedCount === 0) throw importDirectoryFailure();
                return directoryImportResult(orderedPreflight, projected);
              }
            }
            try {
              const directoryId = requireText(
                resolved.generateId(),
                "Candidate knowledge directory id",
              );
              const boundAt = resolved.now();
              const binding = await handle.createCandidateKnowledgeDirectoryBinding({
                id: directoryId,
                knowledgeBaseId,
                rootPath: canonicalDirectory,
                boundAt,
                sourceIds: committedSourceIds,
              });
              if (
                typeof binding !== "object" ||
                binding === null ||
                binding.id !== directoryId ||
                binding.knowledgeBaseId !== knowledgeBaseId ||
                binding.rootPath !== canonicalDirectory ||
                binding.boundAt !== boundAt
              ) {
                throw importDirectoryFailure();
              }
              return directoryImportResult(orderedPreflight, projected, directoryId);
            } catch {
              if (committedCount === 0) throw importDirectoryFailure();
              return directoryImportResult(orderedPreflight, projected);
            }
          },
        );
      } catch {
        throw importDirectoryFailure();
      }
    },
    previewKnowledgeSourceDirectoryRefresh: async (command) => {
      let storeRoot: string;
      let knowledgeBaseId: string;
      let directoryId: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        directoryId = requireText(command.directoryId, "Candidate knowledge directory id");
      } catch {
        throw previewDirectoryRefreshFailure();
      }

      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const collected = await collectDirectoryRefresh(
              handle,
              resolved,
              storeRoot,
              knowledgeBaseId,
              directoryId,
              command.options,
            );
            return previewDirectoryRefreshResult(
              collected.directoryId,
              collected.checkedAt,
              collected.preflight,
              collected.members.map(({ sourceId, status }) => ({ sourceId, status })),
              collected.newSourceCount,
            );
          },
        );
      } catch {
        throw previewDirectoryRefreshFailure();
      }
    },
    previewKnowledgeSourceDirectoryRootRebind: async (command) => {
      let storeRoot: string;
      let knowledgeBaseId: string;
      let directoryId: string;
      let directoryPath: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        directoryId = requireText(command.directoryId, "Candidate knowledge directory id");
        directoryPath = requireText(
          command.directoryPath,
          "Candidate knowledge source directory path",
        );
      } catch {
        throw previewDirectoryRootRebindFailure();
      }

      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) =>
            directoryRootRebindPreviewResult(
              await collectDirectoryRootRebindPreview(
                handle,
                resolved,
                storeRoot,
                knowledgeBaseId,
                directoryId,
                directoryPath,
                command.options,
              ),
            ),
        );
      } catch {
        throw previewDirectoryRootRebindFailure();
      }
    },
    previewKnowledgeSourceDirectoryMovedCandidates: async (command) => {
      let storeRoot: string;
      let knowledgeBaseId: string;
      let directoryId: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        directoryId = requireText(command.directoryId, "Candidate knowledge directory id");
      } catch {
        throw previewDirectoryMovedCandidatesFailure();
      }

      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const collected = await collectDirectoryRefresh(
              handle,
              resolved,
              storeRoot,
              knowledgeBaseId,
              directoryId,
              command.options,
            );
            return directoryMovedCandidatesPreviewResult(handle, knowledgeBaseId, collected);
          },
        );
      } catch {
        throw previewDirectoryMovedCandidatesFailure();
      }
    },
    recordKnowledgeSourceDirectoryRefresh: async (command) => {
      let storeRoot: string;
      let knowledgeBaseId: string;
      let directoryId: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        directoryId = requireText(command.directoryId, "Candidate knowledge directory id");
      } catch {
        throw recordDirectoryRefreshFailure();
      }

      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const collected = await collectDirectoryRefresh(
              handle,
              resolved,
              storeRoot,
              knowledgeBaseId,
              directoryId,
              command.options,
            );
            const entries = collected.members
              .filter(
                (member) =>
                  member.originRelation === "same-member" &&
                  (member.status === "current" ||
                    member.status === "changed" ||
                    member.status === "missing") &&
                  member.expectedOriginBoundAt !== undefined,
              )
              .map((member) => ({
                sourceId: member.sourceId,
                observedVersionId: member.observedVersionId,
                status: member.status as "current" | "changed" | "missing",
                expectedOriginBoundAt: member.expectedOriginBoundAt as string,
              }));
            const previousObservations = await Promise.all(
              entries.map((entry) =>
                handle.getCandidateKnowledgeSourceRefreshObservation(
                  knowledgeBaseId,
                  entry.sourceId,
                ),
              ),
            );
            const observations = await handle.upsertCandidateKnowledgeDirectoryRefreshObservations(
              knowledgeBaseId,
              directoryId,
              { checkedAt: collected.checkedAt, entries },
            );
            validateRecordedDirectoryRefreshObservations(
              observations,
              entries,
              previousObservations,
              collected.checkedAt,
            );
            return recordDirectoryRefreshResult(collected, entries.length);
          },
        );
      } catch {
        throw recordDirectoryRefreshFailure();
      }
    },
    applyKnowledgeSourceDirectoryRefresh: async (command) => {
      let storeRoot: string;
      let knowledgeBaseId: string;
      let directoryId: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        directoryId = requireText(command.directoryId, "Candidate knowledge directory id");
      } catch {
        throw applyDirectoryRefreshFailure();
      }

      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const collected = await collectDirectoryRefresh(
              handle,
              resolved,
              storeRoot,
              knowledgeBaseId,
              directoryId,
              command.options,
            );
            const observationEntries = collected.members
              .filter(
                (member) =>
                  member.originRelation === "same-member" &&
                  (member.status === "current" || member.status === "missing") &&
                  member.expectedOriginBoundAt !== undefined,
              )
              .map((member) => ({
                sourceId: member.sourceId,
                observedVersionId: member.observedVersionId,
                status: member.status as "current" | "missing",
                expectedOriginBoundAt: member.expectedOriginBoundAt as string,
              }));
            const previousObservations = await Promise.all(
              observationEntries.map((entry) =>
                handle.getCandidateKnowledgeSourceRefreshObservation(
                  knowledgeBaseId,
                  entry.sourceId,
                ),
              ),
            );
            const observations = await handle.upsertCandidateKnowledgeDirectoryRefreshObservations(
              knowledgeBaseId,
              directoryId,
              { checkedAt: collected.checkedAt, entries: observationEntries },
            );
            validateRecordedDirectoryRefreshObservations(
              observations,
              observationEntries,
              previousObservations,
              collected.checkedAt,
            );
            const refreshedSourceIds: string[] = [];
            for (const member of collected.members.filter(({ status }) => status === "changed")) {
              try {
                const normalized = collected.matchedSources.get(member.sourceId);
                if (normalized === undefined || member.expectedOriginBoundAt === undefined) {
                  throw applyDirectoryRefreshFailure();
                }
                const versionId = requireText(
                  resolved.generateId(),
                  "Candidate knowledge source version id",
                );
                const requestedVersion = {
                  id: versionId,
                  sourcePath: normalized.source.path,
                  mediaType: normalized.mediaType,
                  checksum: normalized.checksum,
                  sizeBytes: normalized.sizeBytes,
                  createdAt: collected.checkedAt,
                  expectedCurrentVersionId: member.observedVersionId,
                  expectedOriginBoundAt: member.expectedOriginBoundAt,
                };
                const result = await handle.appendManagedCandidateKnowledgeFileVersion(
                  knowledgeBaseId,
                  member.sourceId,
                  requestedVersion,
                );
                validateAppliedDirectoryAppendResult(
                  result,
                  knowledgeBaseId,
                  member.sourceId,
                  requestedVersion,
                  member.latestVersion,
                );
                const observationInput = result.created
                  ? {
                      observedVersionId: result.version.id,
                      status: "current" as const,
                      checkedAt: collected.checkedAt,
                      lastRefreshedVersionId: result.version.id,
                      lastRefreshedAt: collected.checkedAt,
                    }
                  : {
                      observedVersionId: result.version.id,
                      status: "current" as const,
                      checkedAt: collected.checkedAt,
                    };
                const observation = await handle.upsertCandidateKnowledgeSourceRefreshObservation(
                  knowledgeBaseId,
                  member.sourceId,
                  observationInput,
                );
                validateRefreshObservationWriteResult(
                  observation,
                  member.sourceId,
                  observationInput,
                );
                if (result.created) refreshedSourceIds.push(member.sourceId);
              } catch {
                return applyDirectoryRefreshResult(collected, refreshedSourceIds, {
                  sourceId: member.sourceId,
                  status: member.status,
                });
              }
            }
            return applyDirectoryRefreshResult(collected, refreshedSourceIds);
          },
        );
      } catch {
        throw applyDirectoryRefreshFailure();
      }
    },
    addKnowledgeSourceDirectoryMembers: async (command) => {
      let storeRoot: string;
      let knowledgeBaseId: string;
      let directoryId: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        directoryId = requireText(command.directoryId, "Candidate knowledge directory id");
      } catch {
        throw addDirectoryMembersFailure();
      }

      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const collected = await collectDirectoryRefresh(
              handle,
              resolved,
              storeRoot,
              knowledgeBaseId,
              directoryId,
              command.options,
            );
            const addedSourceIds: string[] = [];
            const createdAt = collected.checkedAt;
            for (const normalized of collected.unmatchedSources) {
              try {
                const sourceId = requireText(
                  resolved.generateId(),
                  "Candidate knowledge source id",
                );
                const versionId = requireText(
                  resolved.generateId(),
                  "Candidate knowledge source version id",
                );
                const source = createCandidateKnowledgeSource(
                  sourceId,
                  {
                    knowledgeBaseId,
                    kind: "file",
                    displayName: sourceDisplayName(normalized.source.path),
                  },
                  createdAt,
                );
                const requestedVersion: CandidateKnowledgeSourceVersionRecord = {
                  id: versionId,
                  sourceId,
                  version: 1,
                  parentVersionId: null,
                  mediaType: normalized.mediaType,
                  checksum: normalized.checksum,
                  sizeBytes: normalized.sizeBytes,
                  createdAt,
                };
                const result = await handle.createManagedCandidateKnowledgeFileSource(source, {
                  id: versionId,
                  sourcePath: normalized.source.path,
                  mediaType: normalized.mediaType,
                  checksum: normalized.checksum,
                  sizeBytes: normalized.sizeBytes,
                  createdAt,
                  directoryId,
                });
                validateAddedDirectorySourceWriteResult(result, source, requestedVersion);
                addedSourceIds.push(sourceId);
              } catch {
                return addDirectoryMembersResult(collected, addedSourceIds, "partial");
              }
            }
            return addDirectoryMembersResult(collected, addedSourceIds, "complete");
          },
        );
      } catch {
        throw addDirectoryMembersFailure();
      }
    },
    retireKnowledgeSourceDirectoryMember: async (command) => {
      if (command.approved !== true) {
        throw retireDirectoryMemberFailure();
      }
      let storeRoot: string;
      let knowledgeBaseId: string;
      let directoryId: string;
      let sourceId: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        directoryId = requireText(command.directoryId, "Candidate knowledge directory id");
        sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      } catch {
        throw retireDirectoryMemberFailure();
      }

      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const collected = await collectDirectoryRefresh(
              handle,
              resolved,
              storeRoot,
              knowledgeBaseId,
              directoryId,
              undefined,
            );
            const member = collected.members.find((candidate) => candidate.sourceId === sourceId);
            if (member === undefined) {
              throw retireDirectoryMemberFailure();
            }
            if (member.status === "retired") {
              if (member.retirement === undefined) {
                throw retireDirectoryMemberFailure();
              }
              validateRetirementRecord(member.retirement, sourceId);
              return retireDirectoryMemberResult(
                directoryId,
                sourceId,
                "already-removed",
                collected.checkedAt,
                member.retirement,
              );
            }
            if (
              member.status !== "missing" ||
              member.originRelation !== "same-member" ||
              member.expectedOriginBoundAt === undefined
            ) {
              throw retireDirectoryMemberFailure();
            }
            const retirement = await handle.retireCandidateKnowledgeDirectoryMember(
              knowledgeBaseId,
              directoryId,
              sourceId,
              {
                retiredAt: collected.checkedAt,
                expectedVersionId: member.observedVersionId,
                expectedOriginBoundAt: member.expectedOriginBoundAt,
              },
            );
            validateRetirementRecord(retirement, sourceId);
            return retireDirectoryMemberResult(
              directoryId,
              sourceId,
              retirement.retiredAt === collected.checkedAt ? "removed" : "already-removed",
              collected.checkedAt,
              retirement,
            );
          },
        );
      } catch {
        throw retireDirectoryMemberFailure();
      }
    },
    importKnowledgeSourceUrl: async (command) => {
      if (command.approved !== true) throw importUrlFailure();
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      const url = requireText(command.url, "Candidate knowledge source URL");
      let canonicalRequestedUrl: string;
      try {
        canonicalRequestedUrl = new URL(url).href;
      } catch {
        throw importUrlFailure();
      }
      const displayName = sourceDisplayName(
        command.displayName ?? "Imported URL source",
        command.displayName,
      );
      const knowledgeBase = await useHandle(
        () => resolved.open(storeRoot),
        (handle) => handle.getCandidateKnowledgeBase(knowledgeBaseId),
      );
      if (
        knowledgeBase === undefined ||
        knowledgeBase.id !== knowledgeBaseId ||
        knowledgeBase.state !== "active"
      ) {
        throw importUrlFailure();
      }
      const normalized = await ingestManagedCandidateKnowledgeUrl(resolved.ingestUrl, url);
      const provenance = normalized.url as NonNullable<typeof normalized.url>;
      const responseBytes = normalized.urlResponseBytes as Uint8Array;
      if (provenance.originalUrl !== canonicalRequestedUrl) throw importUrlFailure();
      const sourceId = requireText(resolved.generateId(), "Candidate knowledge source id");
      const versionId = requireText(resolved.generateId(), "Candidate knowledge source version id");
      const source = createCandidateKnowledgeSource(
        sourceId,
        { knowledgeBaseId, kind: "url", displayName },
        provenance.fetchedAt,
      );
      const initialVersion: ManagedCandidateKnowledgeUrlVersionInput = {
        id: versionId,
        mediaType: normalized.mediaType,
        checksum: normalized.checksum,
        sizeBytes: normalized.sizeBytes,
        createdAt: provenance.fetchedAt,
        responseBytes,
        provenance,
      };
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          const result = await handle.createManagedCandidateKnowledgeUrlSource(
            source,
            initialVersion,
          );
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
    listKnowledgeSourceDuplicateGroups: async (command) => {
      const storeRoot = requireStoreRoot(command.storeRoot);
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
      return useHandle(
        () => resolved.open(storeRoot),
        async (handle) => {
          try {
            const sources = await handle.listCandidateKnowledgeSources(knowledgeBaseId);
            const sourceIds = new Set<string>();
            const queryVersionIds = new Set<string>();
            const groups = new Map<string, DuplicateGroupInternal>();
            for (const source of sources) {
              validateDuplicateSourceRecord(source, knowledgeBaseId, sourceIds);
              const versions = await handle.listCandidateKnowledgeSourceVersions(
                knowledgeBaseId,
                source.id,
              );
              const latest = latestDuplicateSourceVersion(versions, source.id, queryVersionIds);
              const checksum = latest.checksum.toLowerCase();
              const key = JSON.stringify([checksum, latest.mediaType, latest.sizeBytes]);
              const group = groups.get(key);
              const member = { sourceId: source.id, versionId: latest.id };
              if (group === undefined) {
                groups.set(key, { members: [member] });
              } else {
                if (group.members.some((existing) => existing.sourceId === member.sourceId)) {
                  throw duplicateGraphInvariantFailure();
                }
                group.members.push(member);
              }
            }
            return projectDuplicateGroups(
              [...groups.values()].filter((group) => group.members.length >= 2),
            );
          } catch {
            throw duplicateGraphInvariantFailure();
          }
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
    refreshKnowledgeSourceUrl: async (command) => {
      if (command.approved !== true) throw refreshUrlFailure();
      let storeRoot: string;
      let knowledgeBaseId: string;
      let sourceId: string;
      try {
        storeRoot = requireStoreRoot(command.storeRoot);
        knowledgeBaseId = requireText(command.knowledgeBaseId, "Candidate knowledge base id");
        sourceId = requireText(command.sourceId, "Candidate knowledge source id");
      } catch {
        throw refreshUrlFailure();
      }
      try {
        return await useHandle(
          () => resolved.open(storeRoot),
          async (handle) => {
            const preflight = await prepareUrlRefresh(handle, knowledgeBaseId, sourceId);
            let normalized: NonNullable<Awaited<ReturnType<typeof ingestUrl>>["source"]>;
            try {
              normalized = await ingestManagedCandidateKnowledgeUrl(
                resolved.ingestUrl,
                preflight.originalUrl,
              );
              if (
                normalized.url === undefined ||
                normalized.url.originalUrl !== preflight.originalUrl ||
                !(normalized.urlResponseBytes instanceof Uint8Array)
              ) {
                throw new Error("malformed URL refresh result");
              }
            } catch {
              const checkedAt = resolved.now();
              const observation = await handle.upsertCandidateKnowledgeSourceRefreshObservation(
                knowledgeBaseId,
                sourceId,
                {
                  observedVersionId: preflight.latestVersion.id,
                  status: "inaccessible",
                  checkedAt,
                },
              );
              validateRefreshObservationWriteResult(observation, sourceId, {
                observedVersionId: preflight.latestVersion.id,
                status: "inaccessible",
                checkedAt,
              });
              return originRefreshResult(sourceId, "inaccessible", checkedAt);
            }

            const provenance = normalized.url as NonNullable<typeof normalized.url>;
            const responseBytes = normalized.urlResponseBytes as Uint8Array;
            const versionId = requireText(
              resolved.generateId(),
              "Candidate knowledge source version id",
            );
            const requestedVersion = {
              id: versionId,
              mediaType: normalized.mediaType,
              checksum: normalized.checksum,
              sizeBytes: normalized.sizeBytes,
              createdAt: provenance.fetchedAt,
              responseBytes: new Uint8Array(responseBytes),
              provenance,
              expectedCurrentVersionId: preflight.latestVersion.id,
            } satisfies ManagedCandidateKnowledgeUrlVersionInput;
            const result = await handle.appendManagedCandidateKnowledgeUrlVersion(
              knowledgeBaseId,
              sourceId,
              requestedVersion,
            );
            validateUrlRefreshAppendResult(
              result,
              knowledgeBaseId,
              sourceId,
              requestedVersion,
              preflight.latestVersion,
            );
            const observationInput = result.created
              ? {
                  observedVersionId: result.version.id,
                  status: "current" as const,
                  checkedAt: provenance.fetchedAt,
                  lastRefreshedVersionId: result.version.id,
                  lastRefreshedAt: provenance.fetchedAt,
                }
              : {
                  observedVersionId: result.version.id,
                  status: "current" as const,
                  checkedAt: provenance.fetchedAt,
                };
            const observation = await handle.upsertCandidateKnowledgeSourceRefreshObservation(
              knowledgeBaseId,
              sourceId,
              observationInput,
            );
            validateRefreshObservationWriteResult(observation, sourceId, observationInput);
            return result.created
              ? originRefreshResult(sourceId, "refreshed", provenance.fetchedAt, result.version.id)
              : originRefreshResult(sourceId, "current", provenance.fetchedAt);
          },
        );
      } catch {
        throw refreshUrlFailure();
      }
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
    retireKnowledgeSource: async (command) => {
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
          const existingRetirement = await handle.getCandidateKnowledgeSourceRetirement(
            knowledgeBaseId,
            sourceId,
          );
          if (existingRetirement !== undefined) {
            const projectedExisting = projectRetirement(existingRetirement, sourceId);
            if (projectedExisting.status !== "retired") {
              throw retirementInvariantFailure();
            }
            return projectedExisting;
          }
          const retirement = await handle.retireCandidateKnowledgeSource(
            knowledgeBaseId,
            sourceId,
            { retiredAt: resolved.now(), reason: "user-requested" },
          );
          validateRetirementRecord(retirement, sourceId);
          const projected = projectRetirement(retirement, sourceId);
          if (projected.status !== "retired") {
            throw retirementInvariantFailure();
          }
          return projected;
        },
      );
    },
    getKnowledgeSourceRetirement: async (command) => {
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
          return projectRetirement(
            await handle.getCandidateKnowledgeSourceRetirement(knowledgeBaseId, sourceId),
            sourceId,
          );
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
export const importKnowledgeSourceDirectory = defaultService.importKnowledgeSourceDirectory;
export const importKnowledgeSourceUrl = defaultService.importKnowledgeSourceUrl;
export const appendKnowledgeSourceFileVersion = defaultService.appendKnowledgeSourceFileVersion;
export const listKnowledgeSourceManifests = defaultService.listKnowledgeSourceManifests;
export const listKnowledgeSourceDuplicateGroups = defaultService.listKnowledgeSourceDuplicateGroups;
export const previewKnowledgeSourceDirectoryRefresh =
  defaultService.previewKnowledgeSourceDirectoryRefresh;
export const previewKnowledgeSourceDirectoryRootRebind =
  defaultService.previewKnowledgeSourceDirectoryRootRebind;
export const previewKnowledgeSourceDirectoryMovedCandidates =
  defaultService.previewKnowledgeSourceDirectoryMovedCandidates;
export const recordKnowledgeSourceDirectoryRefresh =
  defaultService.recordKnowledgeSourceDirectoryRefresh;
export const applyKnowledgeSourceDirectoryRefresh =
  defaultService.applyKnowledgeSourceDirectoryRefresh;
export const addKnowledgeSourceDirectoryMembers = defaultService.addKnowledgeSourceDirectoryMembers;
export const retireKnowledgeSourceDirectoryMember =
  defaultService.retireKnowledgeSourceDirectoryMember;
export const checkKnowledgeSourceOriginStatus = defaultService.checkKnowledgeSourceOriginStatus;
export const refreshKnowledgeSourceFromOrigin = defaultService.refreshKnowledgeSourceFromOrigin;
export const refreshKnowledgeSourceUrl = defaultService.refreshKnowledgeSourceUrl;
export const getKnowledgeSourceRefreshState = defaultService.getKnowledgeSourceRefreshState;
export const retireKnowledgeSource = defaultService.retireKnowledgeSource;
export const getKnowledgeSourceRetirement = defaultService.getKnowledgeSourceRetirement;
export const rebindKnowledgeSourceOrigin = defaultService.rebindKnowledgeSourceOrigin;
export const inspectManagedCandidateKnowledgeFiles =
  defaultService.inspectManagedCandidateKnowledgeFiles;
