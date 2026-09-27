import type { CandidateKnowledgeStoreService } from "@draft-loop/application";

import type {
  BridgeResult,
  KnowledgeDirectoryImportResult,
  KnowledgeDirectoryImportSourceResult,
} from "../bridge.js";

export type KnowledgeDirectoryImport = Awaited<
  ReturnType<CandidateKnowledgeStoreService["importKnowledgeSourceDirectory"]>
>;

const inconsistentResult: BridgeResult<KnowledgeDirectoryImportResult> = {
  ok: false,
  error: {
    code: "operation-failed",
    message: "Candidate knowledge directory intake returned inconsistent state.",
  },
};

export function projectKnowledgeDirectoryImportResult(input: {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly imported: KnowledgeDirectoryImport;
  readonly maximumInspectionEntries: number;
}): BridgeResult<KnowledgeDirectoryImportResult> {
  const { imported } = input;
  if (
    !Number.isSafeInteger(imported.scannedEntryCount) ||
    imported.scannedEntryCount < 0 ||
    !Number.isSafeInteger(imported.discoveredFileCount) ||
    imported.discoveredFileCount < 0 ||
    imported.discoveredFileCount > imported.scannedEntryCount ||
    !Number.isSafeInteger(imported.skippedEntryCount) ||
    imported.skippedEntryCount < 0 ||
    imported.skippedEntryCount > imported.scannedEntryCount ||
    imported.discoveredFileCount + imported.skippedEntryCount > imported.scannedEntryCount ||
    imported.sources.length > imported.discoveredFileCount ||
    (imported.status === "complete" && imported.sources.length !== imported.discoveredFileCount) ||
    (imported.status === "complete" &&
      (typeof imported.directoryId !== "string" || imported.directoryId.trim() === "")) ||
    (imported.status === "partial" && Object.hasOwn(imported, "directoryId")) ||
    (imported.status !== "complete" && imported.status !== "partial")
  ) {
    return inconsistentResult;
  }

  const sources: KnowledgeDirectoryImportSourceResult[] = [];
  const seenSourceIds = new Set<string>();
  for (const importedSource of imported.sources) {
    const sourceId = importedSource.source.id;
    const versionIds = new Set<string>();
    const versionNumbers = new Set<number>();
    if (
      !Array.isArray(importedSource.versions) ||
      importedSource.versions.length === 0 ||
      importedSource.versions.some((candidateVersion) => {
        const valid =
          typeof candidateVersion.id === "string" &&
          candidateVersion.id.trim() !== "" &&
          !versionIds.has(candidateVersion.id) &&
          candidateVersion.sourceId === sourceId &&
          Number.isSafeInteger(candidateVersion.version) &&
          candidateVersion.version >= 1 &&
          !versionNumbers.has(candidateVersion.version);
        versionIds.add(candidateVersion.id);
        versionNumbers.add(candidateVersion.version);
        return !valid;
      })
    ) {
      return inconsistentResult;
    }
    const versions = [...importedSource.versions].sort(
      (left, right) => right.version - left.version || left.id.localeCompare(right.id),
    );
    const version = versions[0];
    if (
      importedSource.source.knowledgeBaseId !== input.knowledgeBaseId ||
      importedSource.source.kind !== "file" ||
      typeof sourceId !== "string" ||
      sourceId.trim() === "" ||
      seenSourceIds.has(sourceId) ||
      version === undefined ||
      typeof importedSource.created !== "boolean"
    ) {
      return inconsistentResult;
    }
    seenSourceIds.add(sourceId);
    sources.push({
      sourceId,
      versionId: version.id,
      version: version.version,
      created: importedSource.created,
    });
  }
  sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const projectedSources = sources.slice(0, input.maximumInspectionEntries);
  return {
    ok: true,
    value: {
      storeId: input.storeId,
      knowledgeBaseId: input.knowledgeBaseId,
      status: imported.status,
      ...(imported.status === "complete" ? { directoryId: imported.directoryId } : {}),
      scannedEntryCount: imported.scannedEntryCount,
      discoveredFileCount: imported.discoveredFileCount,
      skippedEntryCount: imported.skippedEntryCount,
      sourceCount: sources.length,
      sources: projectedSources,
      sourcesTruncated: sources.length > projectedSources.length,
    },
  };
}
