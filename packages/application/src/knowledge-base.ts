import { randomUUID } from "node:crypto";
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
}

export interface CandidateKnowledgeStoreServiceDependencies {
  readonly generateId?: () => string;
  readonly now?: () => string;
  readonly initialize?: typeof initializeCandidateKnowledgeStore;
  readonly open?: typeof openCandidateKnowledgeStore;
  readonly ingestFile?: typeof ingestFile;
}

interface ResolvedDependencies {
  readonly generateId: () => string;
  readonly now: () => string;
  readonly initialize: typeof initializeCandidateKnowledgeStore;
  readonly open: typeof openCandidateKnowledgeStore;
  readonly ingestFile: typeof ingestFile;
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
export const inspectManagedCandidateKnowledgeFiles =
  defaultService.inspectManagedCandidateKnowledgeFiles;
