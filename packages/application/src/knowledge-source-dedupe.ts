import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { ingestFile } from "@draft-loop/ingestion";
import {
  type CandidateKnowledgeStoreHandle,
  maximumManagedCandidateKnowledgeFileBytes,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";

import type {
  CandidateKnowledgeSourceWriteResult,
  CandidateKnowledgeStoreService,
  ImportKnowledgeSourceFileCommand,
} from "./knowledge-base.js";

/**
 * What adding a file did to the knowledge base.
 *
 * - `added`: the file became a new source.
 * - `new-version`: the file changed since it was last added from the same place, so it became a
 *   new version of that source instead of a second source.
 * - `already-present`: an active source already holds exactly this content; nothing was written.
 */
export type KnowledgeFileIntakeOutcome = "added" | "new-version" | "already-present";

export interface KnowledgeFileIntakeResult {
  readonly outcome: KnowledgeFileIntakeOutcome;
  readonly result: CandidateKnowledgeSourceWriteResult;
}

export interface KnowledgeFileIntakeDependencies {
  readonly open?: typeof openCandidateKnowledgeStore;
  readonly ingestFile?: typeof ingestFile;
  readonly realpath?: typeof realpath;
}

type FileIntakeService = Pick<
  CandidateKnowledgeStoreService,
  "importKnowledgeSourceFile" | "appendKnowledgeSourceFileVersion" | "listKnowledgeSourceManifests"
>;

type ExistingMatch =
  | { readonly kind: "identical"; readonly sourceId: string }
  | { readonly kind: "same-origin"; readonly sourceId: string }
  | { readonly kind: "none" };

interface IncomingFile {
  readonly checksum: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly originPath: string;
}

async function describeIncomingFile(
  sourcePath: string,
  dependencies: KnowledgeFileIntakeDependencies,
): Promise<IncomingFile | undefined> {
  try {
    const ingestion = await (dependencies.ingestFile ?? ingestFile)(
      { path: sourcePath },
      { maxSourceBytes: maximumManagedCandidateKnowledgeFileBytes },
    );
    const source = ingestion.source;
    // An unreadable or unusable file is left for the regular import to reject with its own error.
    if (
      source === null ||
      ingestion.issues.length > 0 ||
      source.issues.length > 0 ||
      source.chunks.length === 0
    ) {
      return undefined;
    }
    let originPath = resolve(sourcePath);
    try {
      originPath = await (dependencies.realpath ?? realpath)(sourcePath);
    } catch {
      // Fall back to the absolute path; it then simply fails to match a canonical binding.
    }
    return {
      checksum: source.checksum.toLowerCase(),
      mediaType: source.mediaType,
      sizeBytes: source.sizeBytes,
      originPath,
    };
  } catch {
    return undefined;
  }
}

async function findExistingSource(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
  incoming: IncomingFile,
): Promise<ExistingMatch> {
  let sameOrigin: string | undefined;
  const sources = [...(await handle.listCandidateKnowledgeSources(knowledgeBaseId))].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  for (const source of sources) {
    // A retired source no longer counts: re-adding its content starts a new source.
    if (
      (await handle.getCandidateKnowledgeSourceRetirement(knowledgeBaseId, source.id)) !== undefined
    ) {
      continue;
    }
    const versions = await handle.listCandidateKnowledgeSourceVersions(knowledgeBaseId, source.id);
    const latest = [...versions]
      .sort((left, right) => left.version - right.version || left.id.localeCompare(right.id))
      .at(-1);
    if (latest === undefined) continue;
    if (
      latest.checksum.toLowerCase() === incoming.checksum &&
      latest.mediaType === incoming.mediaType &&
      latest.sizeBytes === incoming.sizeBytes
    ) {
      return { kind: "identical", sourceId: source.id };
    }
    if (sameOrigin === undefined && source.kind === "file") {
      const binding = await handle.getCandidateKnowledgeSourceOriginBinding(
        knowledgeBaseId,
        source.id,
      );
      if (binding?.originPath === incoming.originPath) sameOrigin = source.id;
    }
  }
  return sameOrigin === undefined
    ? { kind: "none" }
    : { kind: "same-origin", sourceId: sameOrigin };
}

/**
 * Adds one file to a knowledge base without duplicating what it already holds.
 *
 * Identical content already held by an active source writes nothing. A changed file whose
 * remembered origin path matches an active source is appended to that source as a new version.
 * Anything else imports as a new source, exactly as {@link CandidateKnowledgeStoreService}'s
 * `importKnowledgeSourceFile` does. Retired sources are ignored throughout.
 */
export async function importKnowledgeFileWithoutDuplicates(
  service: FileIntakeService,
  command: ImportKnowledgeSourceFileCommand,
  dependencies: KnowledgeFileIntakeDependencies = {},
): Promise<KnowledgeFileIntakeResult> {
  const incoming = await describeIncomingFile(command.sourcePath, dependencies);
  if (incoming === undefined) {
    return { outcome: "added", result: await service.importKnowledgeSourceFile(command) };
  }

  const handle = await (dependencies.open ?? openCandidateKnowledgeStore)(command.storeRoot);
  let match: ExistingMatch;
  try {
    match = await findExistingSource(handle, command.knowledgeBaseId, incoming);
  } finally {
    await handle.close();
  }

  if (match.kind === "none") {
    return { outcome: "added", result: await service.importKnowledgeSourceFile(command) };
  }
  if (match.kind === "same-origin") {
    const result = await service.appendKnowledgeSourceFileVersion({
      storeRoot: command.storeRoot,
      knowledgeBaseId: command.knowledgeBaseId,
      sourceId: match.sourceId,
      sourcePath: command.sourcePath,
    });
    return { outcome: "new-version", result };
  }
  const manifests = await service.listKnowledgeSourceManifests({
    storeRoot: command.storeRoot,
    knowledgeBaseId: command.knowledgeBaseId,
  });
  const manifest = manifests.find((candidate) => candidate.source.id === match.sourceId);
  if (manifest === undefined) {
    throw new Error("Candidate knowledge source could not be found after an identical match.");
  }
  return { outcome: "already-present", result: { ...manifest, created: false } };
}
