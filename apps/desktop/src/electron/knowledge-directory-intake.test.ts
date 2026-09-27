import { describe, expect, it } from "vitest";

import {
  type KnowledgeDirectoryImport,
  projectKnowledgeDirectoryImportResult,
} from "./knowledge-directory-intake.js";

function importedDirectory(): Extract<KnowledgeDirectoryImport, { readonly status: "complete" }> {
  type SourceId = KnowledgeDirectoryImport["sources"][number]["source"]["id"];
  type KnowledgeBaseId = KnowledgeDirectoryImport["sources"][number]["source"]["knowledgeBaseId"];
  type VersionId = KnowledgeDirectoryImport["sources"][number]["versions"][number]["id"];
  type VersionSourceId =
    KnowledgeDirectoryImport["sources"][number]["versions"][number]["sourceId"];
  return {
    status: "complete",
    directoryId: "directory-1",
    scannedEntryCount: 3,
    discoveredFileCount: 2,
    skippedEntryCount: 1,
    sources: [
      {
        created: true,
        source: {
          id: "source-b" as SourceId,
          knowledgeBaseId: "kb-1" as KnowledgeBaseId,
          kind: "file",
          displayName: "Source B",
          createdAt: "2026-09-27T00:00:00.000Z",
        },
        versions: [
          {
            id: "version-b1" as VersionId,
            sourceId: "source-b" as VersionSourceId,
            version: 1,
            mediaType: "text/plain",
            checksum: "a".repeat(64),
            sizeBytes: 10,
            createdAt: "2026-09-27T00:00:00.000Z",
          },
          {
            id: "version-b2" as VersionId,
            sourceId: "source-b" as VersionSourceId,
            version: 2,
            mediaType: "text/plain",
            checksum: "b".repeat(64),
            sizeBytes: 11,
            createdAt: "2026-09-27T00:00:00.000Z",
          },
        ],
      },
      {
        created: false,
        source: {
          id: "source-a" as SourceId,
          knowledgeBaseId: "kb-1" as KnowledgeBaseId,
          kind: "file",
          displayName: "Source A",
          createdAt: "2026-09-27T00:00:00.000Z",
        },
        versions: [
          {
            id: "version-a1" as VersionId,
            sourceId: "source-a" as VersionSourceId,
            version: 1,
            mediaType: "text/plain",
            checksum: "c".repeat(64),
            sizeBytes: 12,
            createdAt: "2026-09-27T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}

describe("workspace knowledge directory result projection", () => {
  it("sorts source summaries, retains latest versions and caps only the returned list", () => {
    expect(
      projectKnowledgeDirectoryImportResult({
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        imported: importedDirectory(),
        maximumInspectionEntries: 1,
      }),
    ).toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        status: "complete",
        directoryId: "directory-1",
        scannedEntryCount: 3,
        discoveredFileCount: 2,
        skippedEntryCount: 1,
        sourceCount: 2,
        sources: [{ sourceId: "source-a", versionId: "version-a1", version: 1, created: false }],
        sourcesTruncated: true,
      },
    });
  });

  it("preserves partial status and rejects inconsistent importer metadata", () => {
    const imported = importedDirectory();
    const { directoryId: _directoryId, ...withoutDirectoryId } = imported;
    const partial = projectKnowledgeDirectoryImportResult({
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      imported: { ...withoutDirectoryId, status: "partial" },
      maximumInspectionEntries: 256,
    });
    expect(partial).toMatchObject({ ok: true, value: { status: "partial", sourceCount: 2 } });
    expect(partial.ok && partial.value).not.toHaveProperty("directoryId");

    const invalid = projectKnowledgeDirectoryImportResult({
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      imported: { ...imported, discoveredFileCount: 1 },
      maximumInspectionEntries: 256,
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: {
        code: "operation-failed",
        message: "Candidate knowledge directory intake returned inconsistent state.",
      },
    });
  });
});
