import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  type IngestionResult,
  ingestDirectory as ingestDirectoryImplementation,
  ingestFile as ingestFileImplementation,
} from "@draft-loop/ingestion";
import type { CandidateKnowledgeSourceVersionRecord } from "@draft-loop/storage";
import {
  type CandidateKnowledgeStoreHandle,
  maximumManagedCandidateKnowledgeFileBytes,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-21T09:00:00.000Z";
const changedAt = "2026-08-21T10:00:00.000Z";
const checksum = "a".repeat(64);
const importFailureMessage = "The selected candidate knowledge source file could not be imported.";
const directoryImportFailureMessage =
  "The selected candidate knowledge source directory could not be imported.";
const appendFailureMessage =
  "The selected candidate knowledge source file could not be added as a new version.";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function successfulIngestion(
  sourcePath: string,
  options: {
    readonly checksum?: string;
    readonly mediaType?: NonNullable<IngestionResult["source"]>["mediaType"];
    readonly sizeBytes?: number;
    readonly text?: string;
  } = {},
): IngestionResult {
  const normalizedChecksum = options.checksum ?? checksum;
  const mediaType = options.mediaType ?? "text/plain";
  const sizeBytes = options.sizeBytes ?? 12;
  const text = options.text ?? "Safe content";
  return {
    source: {
      source: { path: sourcePath },
      mediaType,
      checksum: normalizedChecksum,
      sizeBytes,
      text,
      chunks: [
        {
          id: "chunk-1",
          sourcePath,
          mediaType,
          checksum: normalizedChecksum,
          locator: { lineStart: 1, lineEnd: 1 },
          text,
        },
      ],
      issues: [],
    },
    issues: [],
  };
}

function successfulUrlIngestion(
  originalUrl: string,
  bytes: Uint8Array,
  fetchedAt: string,
  finalUrl = originalUrl,
): IngestionResult {
  const responseChecksum = createHash("sha256").update(bytes).digest("hex");
  const provenance = { originalUrl, finalUrl, fetchedAt, kind: "generic" as const };
  return {
    source: {
      source: { path: originalUrl, mediaType: "text/plain", url: provenance },
      mediaType: "text/plain",
      checksum: responseChecksum,
      sizeBytes: bytes.byteLength,
      urlResponseBytes: bytes,
      text: new TextDecoder().decode(bytes),
      chunks: [
        {
          id: "chunk-1",
          sourcePath: originalUrl,
          mediaType: "text/plain",
          checksum: responseChecksum,
          locator: { lineStart: 1, lineEnd: 1 },
          text: new TextDecoder().decode(bytes),
          url: provenance,
        },
      ],
      issues: [],
      url: provenance,
    },
    issues: [],
  };
}

describe("candidate knowledge store application service", () => {
  let temporaryParent: string;
  let storeRoot: string;

  beforeEach(async () => {
    temporaryParent = await mkdtemp(join(tmpdir(), "draft-loop-application-ckb-"));
    storeRoot = join(temporaryParent, "candidate-knowledge");
  });

  afterEach(async () => {
    await rm(temporaryParent, { recursive: true, force: true });
  });

  it("initializes a portable store with deterministic identities and reopens it", async () => {
    const ids = ["store-uuid", "default-ckb-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });

    const initialized = await service.initializeStore({ storeRoot });

    expect(initialized).toEqual({
      store: { schemaVersion: 1, id: "store-uuid", createdAt },
      knowledgeBases: [
        {
          id: "default-ckb-uuid",
          displayName: "Career evidence",
          description: "",
          isDefault: true,
          state: "active",
          createdAt,
          updatedAt: createdAt,
        },
      ],
    });
    await expect(service.openStore({ storeRoot })).resolves.toEqual(initialized);
    await expect(service.listKnowledgeBases({ storeRoot })).resolves.toEqual(initialized);
  });

  it("creates, renames, and archives an additional knowledge base across reopens", async () => {
    const ids = ["store-uuid", "default-ckb-uuid", "other-ckb-uuid"];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });
    await service.initializeStore({ storeRoot, displayName: "Main evidence" });

    const created = await service.createKnowledgeBase({
      storeRoot,
      displayName: "  Public projects  ",
      description: "  Selected public work  ",
    });
    expect(created.knowledgeBases[1]).toMatchObject({
      id: "other-ckb-uuid",
      displayName: "Public projects",
      description: "Selected public work",
      isDefault: false,
      state: "active",
    });

    now = changedAt;
    const renamed = await service.renameKnowledgeBase({
      storeRoot,
      knowledgeBaseId: " other-ckb-uuid ",
      displayName: " Open-source work ",
    });
    expect(renamed.knowledgeBases[1]).toMatchObject({
      displayName: "Open-source work",
      updatedAt: changedAt,
    });

    const archived = await service.archiveKnowledgeBase({
      storeRoot,
      knowledgeBaseId: "other-ckb-uuid",
    });
    expect(archived.knowledgeBases[1]).toMatchObject({
      state: "archived",
      archivedAt: changedAt,
    });
    await expect(service.openStore({ storeRoot })).resolves.toEqual(archived);
  });

  it("creates and lists source metadata, appends lineage, and exposes idempotence", async () => {
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "source-uuid",
      "version-1-uuid",
      "version-2-uuid",
      "unused-version-uuid",
    ];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });
    await service.initializeStore({ storeRoot });

    const created = await service.createKnowledgeSource({
      storeRoot,
      knowledgeBaseId: " default-ckb-uuid ",
      kind: "file",
      displayName: "  Current CV  ",
      mediaType: "  text/markdown  ",
      checksum: "A".repeat(64),
      sizeBytes: 0,
    });

    expect(created).toEqual({
      created: true,
      source: {
        id: "source-uuid",
        knowledgeBaseId: "default-ckb-uuid",
        kind: "file",
        displayName: "Current CV",
        createdAt,
      },
      versions: [
        {
          id: "version-1-uuid",
          sourceId: "source-uuid",
          version: 1,
          mediaType: "text/markdown",
          checksum: "a".repeat(64),
          sizeBytes: 0,
          createdAt,
        },
      ],
    });
    await expect(
      service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toEqual([{ source: created.source, versions: created.versions }]);

    now = changedAt;
    const appended = await service.appendKnowledgeSourceVersion({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: " source-uuid ",
      mediaType: " text/markdown ",
      checksum: "B".repeat(64),
      sizeBytes: 2048,
    });
    expect(appended.created).toBe(true);
    expect(appended.versions).toEqual([
      created.versions[0],
      {
        id: "version-2-uuid",
        sourceId: "source-uuid",
        version: 2,
        parentVersionId: "version-1-uuid",
        mediaType: "text/markdown",
        checksum: "b".repeat(64),
        sizeBytes: 2048,
        createdAt: changedAt,
      },
    ]);

    const unchanged = await service.appendKnowledgeSourceVersion({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      mediaType: "text/markdown",
      checksum: "B".repeat(64),
      sizeBytes: 2048,
    });
    expect(unchanged.created).toBe(false);
    expect(unchanged.versions).toEqual(appended.versions);
    await expect(
      service.listKnowledgeSourceManifests({ storeRoot, knowledgeBaseId: "default-ckb-uuid" }),
    ).resolves.toHaveLength(1);
    expect(unchanged.versions).toHaveLength(2);

    for (const value of [created, appended, unchanged]) {
      expect(value.source).not.toHaveProperty("path");
      expect(value.source).not.toHaveProperty("url");
      expect(value.source).not.toHaveProperty("content");
      expect(value.versions[0]).not.toHaveProperty("path");
      expect(value.versions[0]).not.toHaveProperty("url");
      expect(value.versions[0]).not.toHaveProperty("content");
    }
  });

  it("imports approved bytes into an opaque managed file while keeping AGENTS.md inert", async () => {
    const sourcePath = join(temporaryParent, "AGENTS.md");
    const content = "# Candidate evidence\nBuilt reliable systems.\n";
    await writeFile(sourcePath, content, "utf8");
    const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });

    const imported = await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: " default-ckb-uuid ",
      sourcePath,
    });

    expect(imported).toMatchObject({
      created: true,
      source: {
        id: "source-uuid",
        knowledgeBaseId: "default-ckb-uuid",
        kind: "file",
        displayName: "AGENTS.md",
        createdAt,
      },
      versions: [
        {
          id: "version-uuid",
          sourceId: "source-uuid",
          version: 1,
          mediaType: "text/markdown",
          sizeBytes: Buffer.byteLength(content),
          createdAt,
        },
      ],
    });
    expect(imported.versions[0]?.checksum).toMatch(/^[0-9a-f]{64}$/u);
    const serialized = JSON.stringify(imported);
    expect(serialized).not.toContain(sourcePath);
    expect(serialized).not.toContain(temporaryParent);
    expect(serialized).not.toContain(content);
    expect(imported.source).not.toHaveProperty("path");
    expect(imported.source).not.toHaveProperty("content");
    expect(imported.versions[0]).not.toHaveProperty("path");
    expect(imported.versions[0]).not.toHaveProperty("content");
    await expect(
      readFile(join(storeRoot, "draft-loop-knowledge.json"), "utf8"),
    ).resolves.not.toContain(sourcePath);
    const databaseBytes = await readFile(join(storeRoot, ".draft-loop", "knowledge.sqlite"));
    expect(databaseBytes.includes(Buffer.from(sourcePath, "utf8"))).toBe(true);

    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      const managedPath = await store.getManagedCandidateKnowledgeFilePath(
        "default-ckb-uuid",
        "source-uuid",
        "version-uuid",
      );
      expect(managedPath).toBeDefined();
      expect(basename(managedPath ?? "")).toMatch(/^[0-9a-f]{64}$/u);
      expect(managedPath).not.toContain("AGENTS.md");
      await expect(readFile(managedPath ?? "", "utf8")).resolves.toBe(content);
      const binding = await store.getCandidateKnowledgeSourceOriginBinding(
        "default-ckb-uuid",
        "source-uuid",
      );
      expect(binding).toEqual({
        sourceId: "source-uuid",
        originPath: sourcePath,
        boundAt: createdAt,
      });
      expect(Object.isFrozen(binding)).toBe(true);
    } finally {
      await store.close();
    }
  });

  it("imports a directory as independent managed file sources in lexical order", async () => {
    const directoryPath = join(temporaryParent, "candidate-directory");
    await mkdir(join(directoryPath, "nested"), { recursive: true });
    const firstPath = join(directoryPath, "nested", "first.txt");
    const secondPath = join(directoryPath, "second.txt");
    const content = "# Candidate evidence\nBuilt reliable systems.\n";
    await writeFile(firstPath, content, "utf8");
    await writeFile(secondPath, content, "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "first-source-uuid",
      "first-version-uuid",
      "second-source-uuid",
      "second-version-uuid",
      "directory-binding-uuid",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });

    const imported = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });

    expect(imported.status).toBe("complete");
    if (imported.status !== "complete") throw new Error("expected complete directory import");
    expect(imported.directoryId).toBe("directory-binding-uuid");
    expect(imported.scannedEntryCount).toBe(3);
    expect(imported.discoveredFileCount).toBe(2);
    expect(imported.skippedEntryCount).toBe(0);
    expect(imported.sources.map((source) => source.source.id)).toEqual([
      "first-source-uuid",
      "second-source-uuid",
    ]);
    expect(imported.sources.map((source) => source.source.displayName)).toEqual([
      "first.txt",
      "second.txt",
    ]);
    expect(imported.sources.map((source) => source.versions[0]?.id)).toEqual([
      "first-version-uuid",
      "second-version-uuid",
    ]);

    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        store.getCandidateKnowledgeSourceOriginBinding("default-ckb-uuid", "first-source-uuid"),
      ).resolves.toMatchObject({ originPath: firstPath });
      await expect(
        store.getCandidateKnowledgeSourceOriginBinding("default-ckb-uuid", "second-source-uuid"),
      ).resolves.toMatchObject({ originPath: secondPath });
      await expect(
        store.getCandidateKnowledgeDirectoryBinding("default-ckb-uuid", "directory-binding-uuid"),
      ).resolves.toMatchObject({ rootPath: directoryPath });
      await expect(
        store.listCandidateKnowledgeDirectoryMembers("default-ckb-uuid", "directory-binding-uuid"),
      ).resolves.toHaveLength(2);
    } finally {
      await store.close();
    }

    await expect(
      service.listKnowledgeSourceDuplicateGroups({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toEqual([
      {
        members: [
          { sourceId: "first-source-uuid", versionId: "first-version-uuid" },
          { sourceId: "second-source-uuid", versionId: "second-version-uuid" },
        ],
      },
    ]);
  });

  it("previews directory refresh states without changing persisted membership or source state", async () => {
    const directoryPath = join(temporaryParent, "candidate-directory");
    const outsidePath = join(temporaryParent, "rebound-conflict.txt");
    await mkdir(directoryPath);
    const paths = {
      current: join(directoryPath, "a-current.txt"),
      changed: join(directoryPath, "b-changed.txt"),
      missing: join(directoryPath, "c-missing.txt"),
      retired: join(directoryPath, "d-retired.txt"),
      conflict: join(directoryPath, "e-conflict.txt"),
      newSource: join(directoryPath, "f-new.txt"),
    };
    await writeFile(paths.current, "current", "utf8");
    await writeFile(paths.changed, "before", "utf8");
    await writeFile(paths.missing, "missing", "utf8");
    await writeFile(paths.retired, "retired", "utf8");
    await writeFile(paths.conflict, "conflict", "utf8");
    const generatedIds = [
      "store-uuid",
      "default-ckb-uuid",
      "current-source",
      "current-version",
      "changed-source",
      "changed-version",
      "missing-source",
      "missing-version",
      "retired-source",
      "retired-version",
      "conflict-source",
      "conflict-version",
      "directory-binding",
    ];
    const generateId = vi.fn(() => generatedIds.shift() ?? "unexpected-id");
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId,
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });
    expect(imported.status).toBe("complete");
    if (imported.status !== "complete") throw new Error("expected complete directory import");

    await writeFile(paths.changed, "after", "utf8");
    await rm(paths.missing);
    await writeFile(outsidePath, "conflict", "utf8");
    now = changedAt;
    await service.rebindKnowledgeSourceOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "conflict-source",
      sourcePath: outsidePath,
    });
    await service.retireKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "retired-source",
    });
    await writeFile(paths.newSource, "new", "utf8");

    const memberSourceIds = [
      "current-source",
      "changed-source",
      "missing-source",
      "retired-source",
      "conflict-source",
    ];
    const before = await openCandidateKnowledgeStore(storeRoot);
    const beforeState = {
      members: await before.listCandidateKnowledgeDirectoryMembers(
        "default-ckb-uuid",
        "directory-binding",
      ),
      sources: await before.listCandidateKnowledgeSources("default-ckb-uuid"),
      versions: await Promise.all(
        memberSourceIds.map((sourceId) =>
          before.listCandidateKnowledgeSourceVersions("default-ckb-uuid", sourceId),
        ),
      ),
      observations: await Promise.all(
        memberSourceIds.map((sourceId) =>
          before.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", sourceId),
        ),
      ),
      retirements: await Promise.all(
        memberSourceIds.map((sourceId) =>
          before.getCandidateKnowledgeSourceRetirement("default-ckb-uuid", sourceId),
        ),
      ),
      inventory: await before.inspectManagedCandidateKnowledgeFiles(),
    };
    await before.close();

    const preview = await service.previewKnowledgeSourceDirectoryRefresh({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: "directory-binding",
    });
    expect(preview).toEqual({
      directoryId: "directory-binding",
      checkedAt: changedAt,
      members: [
        { sourceId: "changed-source", status: "changed" },
        { sourceId: "conflict-source", status: "origin-conflict" },
        { sourceId: "current-source", status: "current" },
        { sourceId: "missing-source", status: "missing" },
        { sourceId: "retired-source", status: "retired" },
      ],
      newSourceCount: 1,
      scannedEntryCount: 5,
      discoveredFileCount: 5,
      skippedEntryCount: 0,
    });
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.members)).toBe(true);
    expect(preview.members.every((member) => Object.isFrozen(member))).toBe(true);
    expect(JSON.stringify(preview)).not.toContain(temporaryParent);
    expect(JSON.stringify(preview)).not.toContain("before");
    expect(JSON.stringify(preview)).not.toContain(sha256("after"));
    expect(generateId).toHaveBeenCalledTimes(13);

    const after = await openCandidateKnowledgeStore(storeRoot);
    const afterState = {
      members: await after.listCandidateKnowledgeDirectoryMembers(
        "default-ckb-uuid",
        "directory-binding",
      ),
      sources: await after.listCandidateKnowledgeSources("default-ckb-uuid"),
      versions: await Promise.all(
        memberSourceIds.map((sourceId) =>
          after.listCandidateKnowledgeSourceVersions("default-ckb-uuid", sourceId),
        ),
      ),
      observations: await Promise.all(
        memberSourceIds.map((sourceId) =>
          after.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", sourceId),
        ),
      ),
      retirements: await Promise.all(
        memberSourceIds.map((sourceId) =>
          after.getCandidateKnowledgeSourceRetirement("default-ckb-uuid", sourceId),
        ),
      ),
      inventory: await after.inspectManagedCandidateKnowledgeFiles(),
    };
    await after.close();
    expect(afterState).toEqual(beforeState);
  });

  it("records only unambiguous directory observations after one bounded scan", async () => {
    const directoryPath = join(temporaryParent, "record-directory");
    const outsidePath = join(temporaryParent, "record-conflict.txt");
    await mkdir(directoryPath);
    const paths = {
      current: join(directoryPath, "a-current.txt"),
      changed: join(directoryPath, "b-changed.txt"),
      missing: join(directoryPath, "c-missing.txt"),
      conflict: join(directoryPath, "d-conflict.txt"),
      retired: join(directoryPath, "e-retired.txt"),
      newSource: join(directoryPath, "f-new.txt"),
    };
    await writeFile(paths.current, "current", "utf8");
    await writeFile(paths.changed, "before", "utf8");
    await writeFile(paths.missing, "missing", "utf8");
    await writeFile(paths.conflict, "conflict", "utf8");
    await writeFile(paths.retired, "retired", "utf8");
    const generatedIds = [
      "store-uuid",
      "default-ckb-uuid",
      "current-source",
      "current-version",
      "changed-source",
      "changed-version",
      "missing-source",
      "missing-version",
      "conflict-source",
      "conflict-version",
      "retired-source",
      "retired-version",
      "directory-binding",
      "applied-changed-version",
    ];
    const generateId = vi.fn(() => generatedIds.shift() ?? "unexpected-id");
    const ingestDirectory = vi.fn<typeof ingestDirectoryImplementation>();
    ingestDirectory.mockImplementation(ingestDirectoryImplementation);
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId,
      ingestDirectory: ingestDirectory as never,
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });
    if (imported.status !== "complete") throw new Error("expected complete directory import");
    ingestDirectory.mockClear();

    await writeFile(paths.changed, "after", "utf8");
    await rm(paths.missing);
    await writeFile(outsidePath, "conflict", "utf8");
    await rm(paths.conflict);
    now = changedAt;
    await service.rebindKnowledgeSourceOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "conflict-source",
      sourcePath: outsidePath,
    });
    await service.retireKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "retired-source",
    });
    await writeFile(paths.newSource, "new", "utf8");

    const before = await openCandidateKnowledgeStore(storeRoot);
    const beforeState = {
      sources: await before.listCandidateKnowledgeSources("default-ckb-uuid"),
      versions: await Promise.all(
        [
          "current-source",
          "changed-source",
          "missing-source",
          "conflict-source",
          "retired-source",
        ].map((sourceId) =>
          before.listCandidateKnowledgeSourceVersions("default-ckb-uuid", sourceId),
        ),
      ),
      members: await before.listCandidateKnowledgeDirectoryMembers(
        "default-ckb-uuid",
        "directory-binding",
      ),
      inventory: await before.inspectManagedCandidateKnowledgeFiles(),
    };
    await before.close();

    const recordedAt = "2026-08-21T11:00:00.000Z";
    now = recordedAt;
    await expect(
      service.previewKnowledgeSourceDirectoryRefresh({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: "directory-binding",
      }),
    ).resolves.toMatchObject({
      members: [
        { sourceId: "changed-source", status: "changed" },
        { sourceId: "conflict-source", status: "origin-conflict" },
        { sourceId: "current-source", status: "current" },
        { sourceId: "missing-source", status: "missing" },
        { sourceId: "retired-source", status: "retired" },
      ],
    });
    ingestDirectory.mockClear();
    const result = await service.recordKnowledgeSourceDirectoryRefresh({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: "directory-binding",
    });
    expect(result).toEqual({
      directoryId: "directory-binding",
      checkedAt: recordedAt,
      members: [
        { sourceId: "changed-source", status: "changed" },
        { sourceId: "conflict-source", status: "origin-conflict" },
        { sourceId: "current-source", status: "current" },
        { sourceId: "missing-source", status: "missing" },
        { sourceId: "retired-source", status: "retired" },
      ],
      newSourceCount: 1,
      scannedEntryCount: 4,
      discoveredFileCount: 4,
      skippedEntryCount: 0,
      recordedObservationCount: 3,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.members)).toBe(true);
    expect(result.members.every((member) => Object.isFrozen(member))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(temporaryParent);
    expect(JSON.stringify(result)).not.toContain("after");
    expect(JSON.stringify(result)).not.toContain(sha256("after"));
    expect(generateId).toHaveBeenCalledTimes(13);
    expect(ingestDirectory).toHaveBeenCalledOnce();

    const after = await openCandidateKnowledgeStore(storeRoot);
    const afterState = {
      sources: await after.listCandidateKnowledgeSources("default-ckb-uuid"),
      versions: await Promise.all(
        [
          "current-source",
          "changed-source",
          "missing-source",
          "conflict-source",
          "retired-source",
        ].map((sourceId) =>
          after.listCandidateKnowledgeSourceVersions("default-ckb-uuid", sourceId),
        ),
      ),
      members: await after.listCandidateKnowledgeDirectoryMembers(
        "default-ckb-uuid",
        "directory-binding",
      ),
      inventory: await after.inspectManagedCandidateKnowledgeFiles(),
      observations: await Promise.all(
        [
          "current-source",
          "changed-source",
          "missing-source",
          "conflict-source",
          "retired-source",
        ].map((sourceId) =>
          after.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", sourceId),
        ),
      ),
    };
    await after.close();
    expect({ ...afterState, observations: undefined }).toEqual({
      ...beforeState,
      observations: undefined,
    });
    expect(afterState.observations).toEqual([
      expect.objectContaining({
        sourceId: "current-source",
        observedVersionId: "current-version",
        status: "current",
        checkedAt: recordedAt,
        stale: false,
      }),
      expect.objectContaining({
        sourceId: "changed-source",
        observedVersionId: "changed-version",
        status: "changed",
        checkedAt: recordedAt,
        stale: false,
      }),
      expect.objectContaining({
        sourceId: "missing-source",
        observedVersionId: "missing-version",
        status: "missing",
        checkedAt: recordedAt,
        stale: false,
      }),
      undefined,
      undefined,
    ]);

    ingestDirectory.mockClear();
    const applyStore = await openCandidateKnowledgeStore(storeRoot);
    const observationBatch = vi.fn<
      CandidateKnowledgeStoreHandle["upsertCandidateKnowledgeDirectoryRefreshObservations"]
    >(async (knowledgeBaseId, directoryId, input) =>
      applyStore.upsertCandidateKnowledgeDirectoryRefreshObservations(
        knowledgeBaseId,
        directoryId,
        input,
      ),
    );
    const applyClose = vi.fn(async () => applyStore.close());
    const applyService = createCandidateKnowledgeStoreService({
      generateId,
      ingestDirectory: ingestDirectory as never,
      now: () => now,
      open: vi.fn(
        async () =>
          ({
            ...applyStore,
            upsertCandidateKnowledgeDirectoryRefreshObservations: observationBatch,
            close: applyClose,
          }) as unknown as CandidateKnowledgeStoreHandle,
      ),
    });
    const applied = await applyService.applyKnowledgeSourceDirectoryRefresh({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: "directory-binding",
    });
    expect(applied).toEqual({
      directoryId: "directory-binding",
      checkedAt: recordedAt,
      members: [
        { sourceId: "changed-source", status: "changed" },
        { sourceId: "conflict-source", status: "origin-conflict" },
        { sourceId: "current-source", status: "current" },
        { sourceId: "missing-source", status: "missing" },
        { sourceId: "retired-source", status: "retired" },
      ],
      newSourceCount: 1,
      scannedEntryCount: 4,
      discoveredFileCount: 4,
      skippedEntryCount: 0,
      refreshedSourceIds: ["changed-source"],
      status: "complete",
    });
    expect(observationBatch).toHaveBeenCalledOnce();
    expect(observationBatch).toHaveBeenCalledWith("default-ckb-uuid", "directory-binding", {
      checkedAt: recordedAt,
      entries: [
        {
          sourceId: "current-source",
          observedVersionId: "current-version",
          status: "current",
          expectedOriginBoundAt: createdAt,
        },
        {
          sourceId: "missing-source",
          observedVersionId: "missing-version",
          status: "missing",
          expectedOriginBoundAt: createdAt,
        },
      ],
    });
    expect(applyClose).toHaveBeenCalledOnce();
    expect(Object.isFrozen(applied)).toBe(true);
    expect(Object.isFrozen(applied.members)).toBe(true);
    expect(Object.isFrozen(applied.refreshedSourceIds)).toBe(true);
    expect(ingestDirectory).toHaveBeenCalledOnce();
    expect(generateId).toHaveBeenCalledTimes(14);
    expect(JSON.stringify(applied)).not.toContain(temporaryParent);
    expect(JSON.stringify(applied)).not.toContain("after");

    const appliedStore = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        appliedStore.listCandidateKnowledgeSourceVersions("default-ckb-uuid", "changed-source"),
      ).resolves.toHaveLength(2);
      await expect(
        appliedStore.getCandidateKnowledgeSourceRefreshObservation(
          "default-ckb-uuid",
          "changed-source",
        ),
      ).resolves.toMatchObject({
        observedVersionId: "applied-changed-version",
        status: "current",
        lastRefreshedVersionId: "applied-changed-version",
        lastRefreshedAt: recordedAt,
        stale: false,
      });
      await expect(
        appliedStore.getCandidateKnowledgeSourceRefreshObservation(
          "default-ckb-uuid",
          "current-source",
        ),
      ).resolves.toMatchObject({ observedVersionId: "current-version", status: "current" });
      await expect(
        appliedStore.getCandidateKnowledgeSourceRefreshObservation(
          "default-ckb-uuid",
          "missing-source",
        ),
      ).resolves.toMatchObject({ observedVersionId: "missing-version", status: "missing" });
    } finally {
      await appliedStore.close();
    }
  });

  it("previews an empty bound directory without allocating IDs or writing state", async () => {
    const directoryPath = join(temporaryParent, "empty-directory");
    await mkdir(directoryPath);
    const ids = ["store-uuid", "default-ckb-uuid", "directory-binding"];
    const generateId = vi.fn(() => ids.shift() ?? "unexpected-id");
    const service = createCandidateKnowledgeStoreService({
      generateId,
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await expect(
      service.importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryPath,
      }),
    ).resolves.toMatchObject({ status: "complete", directoryId: "directory-binding" });

    const preview = await service.previewKnowledgeSourceDirectoryRefresh({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: "directory-binding",
    });
    expect(preview).toEqual({
      directoryId: "directory-binding",
      checkedAt: createdAt,
      members: [],
      newSourceCount: 0,
      scannedEntryCount: 0,
      discoveredFileCount: 0,
      skippedEntryCount: 0,
    });
    expect(generateId).toHaveBeenCalledTimes(3);
  });

  it("applies changed members in source order and returns a path-free partial result", async () => {
    const directoryPath = join(temporaryParent, "partial-apply-directory");
    const firstPath = join(directoryPath, "a-first.md");
    const secondPath = join(directoryPath, "b-second.md");
    await mkdir(directoryPath);
    await writeFile(firstPath, "first before", "utf8");
    await writeFile(secondPath, "second before", "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "a-source",
      "a-version",
      "b-source",
      "b-version",
      "directory-binding",
    ];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });
    if (imported.status !== "complete") throw new Error("expected complete directory import");

    await writeFile(firstPath, "first after", "utf8");
    await writeFile(secondPath, "second after", "utf8");
    now = changedAt;
    await expect(
      service.applyKnowledgeSourceDirectoryRefresh({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: "directory-binding",
        options: { maxScannedEntries: 1 },
      }),
    ).rejects.toThrow(
      "The selected candidate knowledge source directory refresh could not be applied.",
    );
    const afterScanFailure = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        afterScanFailure.listCandidateKnowledgeSourceVersions("default-ckb-uuid", "a-source"),
      ).resolves.toHaveLength(1);
      await expect(
        afterScanFailure.getCandidateKnowledgeSourceRefreshObservation(
          "default-ckb-uuid",
          "a-source",
        ),
      ).resolves.toBeUndefined();
      await expect(
        afterScanFailure.listCandidateKnowledgeSourceVersions("default-ckb-uuid", "b-source"),
      ).resolves.toHaveLength(1);
      await expect(
        afterScanFailure.getCandidateKnowledgeSourceRefreshObservation(
          "default-ckb-uuid",
          "b-source",
        ),
      ).resolves.toBeUndefined();
    } finally {
      await afterScanFailure.close();
    }
    const realStore = await openCandidateKnowledgeStore(storeRoot);
    let appendCalls = 0;
    const append = vi.fn<
      CandidateKnowledgeStoreHandle["appendManagedCandidateKnowledgeFileVersion"]
    >(async (knowledgeBaseId, sourceId, version) => {
      appendCalls += 1;
      if (appendCalls === 2) throw new Error("injected publication failure");
      return realStore.appendManagedCandidateKnowledgeFileVersion(
        knowledgeBaseId,
        sourceId,
        version,
      );
    });
    const close = vi.fn(async () => realStore.close());
    const applyService = createCandidateKnowledgeStoreService({
      generateId: () => "a-version-2",
      now: () => now,
      open: vi.fn(
        async () =>
          ({
            ...realStore,
            appendManagedCandidateKnowledgeFileVersion: append,
            close,
          }) as unknown as CandidateKnowledgeStoreHandle,
      ),
    });

    const result = await applyService.applyKnowledgeSourceDirectoryRefresh({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: "directory-binding",
    });
    expect(result).toEqual({
      directoryId: "directory-binding",
      checkedAt: changedAt,
      members: [
        { sourceId: "a-source", status: "changed" },
        { sourceId: "b-source", status: "changed" },
      ],
      newSourceCount: 0,
      scannedEntryCount: 2,
      discoveredFileCount: 2,
      skippedEntryCount: 0,
      refreshedSourceIds: ["a-source"],
      status: "partial",
      failedSourceId: "b-source",
      failedStatus: "changed",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.refreshedSourceIds)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(temporaryParent);
    expect(JSON.stringify(result)).not.toContain("publication");
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[1]).toBe("a-source");
    expect(append.mock.calls[1]?.[1]).toBe("b-source");
    expect(close).toHaveBeenCalledOnce();

    const reopened = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        reopened.listCandidateKnowledgeSourceVersions("default-ckb-uuid", "a-source"),
      ).resolves.toHaveLength(2);
      await expect(
        reopened.listCandidateKnowledgeSourceVersions("default-ckb-uuid", "b-source"),
      ).resolves.toHaveLength(1);
      await expect(
        reopened.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", "a-source"),
      ).resolves.toMatchObject({
        observedVersionId: "a-version-2",
        status: "current",
        lastRefreshedVersionId: "a-version-2",
        stale: false,
      });
      await expect(
        reopened.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", "b-source"),
      ).resolves.toBeUndefined();
    } finally {
      await reopened.close();
    }
  });

  it("adds unmatched directory members deterministically, supports retry after partial failure, and allocates no IDs for existing files", async () => {
    const directoryPath = join(temporaryParent, "add-members-directory");
    const initialPath = join(directoryPath, "m-initial.md");
    const firstNewPath = join(directoryPath, "a-new.md");
    const secondNewPath = join(directoryPath, "z-new.md");
    await mkdir(directoryPath);
    await writeFile(initialPath, "initial", "utf8");
    const generatedIds = [
      "store-uuid",
      "default-ckb-uuid",
      "initial-source",
      "initial-version",
      "directory-binding",
      "a-source",
      "a-version",
      "z-source",
      "z-version",
    ];
    const generateId = vi.fn(() => generatedIds.shift() ?? "unexpected-id");
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId,
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });
    if (imported.status !== "complete") throw new Error("expected complete directory import");

    await writeFile(firstNewPath, "first new", "utf8");
    await writeFile(secondNewPath, "second new", "utf8");
    now = changedAt;
    const beforeAddIdCount = generateId.mock.calls.length;
    await expect(
      service.addKnowledgeSourceDirectoryMembers({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: imported.directoryId,
        options: { maxScannedEntries: 1 },
      }),
    ).rejects.toThrow(
      "The selected candidate knowledge source directory members could not be added.",
    );
    expect(generateId).toHaveBeenCalledTimes(beforeAddIdCount);
    const afterScanFailure = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        afterScanFailure.listCandidateKnowledgeDirectoryMembers(
          "default-ckb-uuid",
          imported.directoryId,
        ),
      ).resolves.toHaveLength(1);
      await expect(
        afterScanFailure.listCandidateKnowledgeSources("default-ckb-uuid"),
      ).resolves.toHaveLength(1);
    } finally {
      await afterScanFailure.close();
    }

    const added = await service.addKnowledgeSourceDirectoryMembers({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: imported.directoryId,
    });
    expect(added).toEqual({
      directoryId: imported.directoryId,
      checkedAt: changedAt,
      members: [{ sourceId: "initial-source", status: "current" }],
      newSourceCount: 2,
      scannedEntryCount: 3,
      discoveredFileCount: 3,
      skippedEntryCount: 0,
      addedSourceIds: ["a-source", "z-source"],
      addedSourceCount: 2,
      status: "complete",
    });
    expect(Object.isFrozen(added)).toBe(true);
    expect(Object.isFrozen(added.members)).toBe(true);
    expect(Object.isFrozen(added.addedSourceIds)).toBe(true);
    expect(JSON.stringify(added)).not.toContain(temporaryParent);
    expect(JSON.stringify(added)).not.toContain("first new");
    expect(generateId).toHaveBeenCalledTimes(9);

    const noOp = await service.addKnowledgeSourceDirectoryMembers({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: imported.directoryId,
    });
    expect(noOp).toMatchObject({
      directoryId: imported.directoryId,
      newSourceCount: 0,
      addedSourceIds: [],
      addedSourceCount: 0,
      status: "complete",
    });
    expect(generateId).toHaveBeenCalledTimes(9);
  });

  it("returns a path-free partial add result and retries only the remaining unmatched member", async () => {
    const directoryPath = join(temporaryParent, "partial-add-members-directory");
    const initialPath = join(directoryPath, "initial.md");
    const firstNewPath = join(directoryPath, "a-new.md");
    const secondNewPath = join(directoryPath, "b-new.md");
    await mkdir(directoryPath);
    await writeFile(initialPath, "initial", "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "initial-source",
      "initial-version",
      "directory-binding",
    ];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });
    if (imported.status !== "complete") throw new Error("expected complete directory import");
    await writeFile(firstNewPath, "first new", "utf8");
    await writeFile(secondNewPath, "second new", "utf8");
    now = changedAt;

    const realStore = await openCandidateKnowledgeStore(storeRoot);
    let createCalls = 0;
    const create = vi.fn<
      CandidateKnowledgeStoreHandle["createManagedCandidateKnowledgeFileSource"]
    >(async (source, version) => {
      createCalls += 1;
      if (createCalls === 2) throw new Error("injected member failure");
      return realStore.createManagedCandidateKnowledgeFileSource(source, version);
    });
    const close = vi.fn(async () => realStore.close());
    const partialService = createCandidateKnowledgeStoreService({
      generateId: vi
        .fn()
        .mockReturnValueOnce("a-source")
        .mockReturnValueOnce("a-version")
        .mockReturnValueOnce("b-source")
        .mockReturnValueOnce("b-version"),
      now: () => now,
      open: vi.fn(
        async () =>
          ({
            ...realStore,
            createManagedCandidateKnowledgeFileSource: create,
            close,
          }) as unknown as CandidateKnowledgeStoreHandle,
      ),
    });
    const partial = await partialService.addKnowledgeSourceDirectoryMembers({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: imported.directoryId,
    });
    expect(partial).toEqual({
      directoryId: imported.directoryId,
      checkedAt: changedAt,
      members: [{ sourceId: "initial-source", status: "current" }],
      newSourceCount: 2,
      scannedEntryCount: 3,
      discoveredFileCount: 3,
      skippedEntryCount: 0,
      addedSourceIds: ["a-source"],
      addedSourceCount: 1,
      status: "partial",
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
    const retryIds = vi
      .fn()
      .mockReturnValueOnce("b-retry-source")
      .mockReturnValueOnce("b-retry-version");
    const retryService = createCandidateKnowledgeStoreService({
      generateId: retryIds,
      now: () => now,
    });
    const retry = await retryService.addKnowledgeSourceDirectoryMembers({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryId: imported.directoryId,
    });
    expect(retry).toMatchObject({
      newSourceCount: 1,
      addedSourceIds: ["b-retry-source"],
      addedSourceCount: 1,
      status: "complete",
    });
    expect(retryIds).toHaveBeenCalledTimes(2);
    const reopened = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        reopened.listCandidateKnowledgeDirectoryMembers("default-ckb-uuid", imported.directoryId),
      ).resolves.toHaveLength(3);
    } finally {
      await reopened.close();
    }
  });

  it("classifies an active member without an origin binding as an origin conflict", async () => {
    const sourcePath = "/selected/current.txt";
    const normalized = successfulIngestion(sourcePath, {
      checksum: sha256("current"),
      sizeBytes: 7,
    }).source;
    if (normalized === null) throw new Error("expected normalized source");
    const member = {
      directoryId: "directory-binding",
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      relativePathHash: "a".repeat(64),
    };
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "default-ckb-uuid",
      kind: "file" as const,
      displayName: "current.txt",
      createdAt,
    };
    const version: CandidateKnowledgeSourceVersionRecord = {
      id: "version-uuid",
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
      mediaType: normalized.mediaType,
      checksum: normalized.checksum,
      sizeBytes: normalized.sizeBytes,
      createdAt,
    };
    const close = vi.fn(async () => undefined);
    const findMember = vi.fn(async () => member);
    const handle = {
      getCandidateKnowledgeBase: vi.fn(async () => ({
        id: "default-ckb-uuid",
        displayName: "Evidence",
        description: "",
        state: "active" as const,
        isDefault: true,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
      })),
      getCandidateKnowledgeDirectoryBinding: vi.fn(async () => ({
        id: "directory-binding",
        knowledgeBaseId: "default-ckb-uuid",
        rootPath: "/selected",
        boundAt: createdAt,
      })),
      listCandidateKnowledgeDirectoryMembers: vi.fn(async () => [member]),
      findCandidateKnowledgeDirectoryMemberByPath: findMember,
      getCandidateKnowledgeDirectoryMemberOriginRelation: vi.fn(async () => ({
        directoryId: member.directoryId,
        knowledgeBaseId: member.knowledgeBaseId,
        sourceId: member.sourceId,
        relation: "unbound" as const,
      })),
      getCandidateKnowledgeSource: vi.fn(async () => source),
      listCandidateKnowledgeSourceVersions: vi.fn(async () => [version]),
      getCandidateKnowledgeSourceOriginBinding: vi.fn(async () => undefined),
      getCandidateKnowledgeSourceRetirement: vi.fn(async () => undefined),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      open: vi.fn(async () => handle),
      ingestDirectory: vi.fn(async () => ({
        sources: [normalized],
        scannedEntryCount: 1,
        discoveredFileCount: 1,
        skippedEntryCount: 0,
      })) as never,
      lstat: vi.fn(async () => ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      })) as never,
      realpath: vi.fn(async (path: string) =>
        path === "/selected" ? "/selected" : "/store",
      ) as never,
      now: () => createdAt,
    });
    await expect(
      service.previewKnowledgeSourceDirectoryRefresh({
        storeRoot: "/store",
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: "directory-binding",
      }),
    ).resolves.toMatchObject({
      directoryId: "directory-binding",
      members: [{ sourceId: "source-uuid", status: "origin-conflict" }],
      newSourceCount: 0,
    });
    expect(close).toHaveBeenCalledOnce();

    findMember.mockResolvedValueOnce({ ...member, sourceId: "unexpected-source" });
    await expect(
      service.previewKnowledgeSourceDirectoryRefresh({
        storeRoot: "/store",
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: "directory-binding",
      }),
    ).rejects.toThrow(
      "The selected candidate knowledge source directory refresh preview could not be completed.",
    );
  });

  it("fails closed when directory observation storage returns an inconsistent batch", async () => {
    const sourcePath = "/selected/current.txt";
    const normalized = successfulIngestion(sourcePath, {
      checksum: sha256("current"),
      sizeBytes: 7,
    }).source;
    if (normalized === null) throw new Error("expected normalized source");
    const member = {
      directoryId: "directory-binding",
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      relativePathHash: "a".repeat(64),
    };
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "default-ckb-uuid",
      kind: "file" as const,
      displayName: "current.txt",
      createdAt,
    };
    const version: CandidateKnowledgeSourceVersionRecord = {
      id: "version-uuid",
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
      mediaType: normalized.mediaType,
      checksum: normalized.checksum,
      sizeBytes: normalized.sizeBytes,
      createdAt,
    };
    const close = vi.fn(async () => undefined);
    const handle = {
      getCandidateKnowledgeBase: vi.fn(async () => ({
        id: "default-ckb-uuid",
        displayName: "Evidence",
        description: "",
        state: "active" as const,
        isDefault: true,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
      })),
      getCandidateKnowledgeDirectoryBinding: vi.fn(async () => ({
        id: "directory-binding",
        knowledgeBaseId: "default-ckb-uuid",
        rootPath: "/selected",
        boundAt: createdAt,
      })),
      listCandidateKnowledgeDirectoryMembers: vi.fn(async () => [member]),
      findCandidateKnowledgeDirectoryMemberByPath: vi.fn(async () => member),
      getCandidateKnowledgeDirectoryMemberOriginRelation: vi.fn(async () => ({
        directoryId: member.directoryId,
        knowledgeBaseId: member.knowledgeBaseId,
        sourceId: member.sourceId,
        relation: "same-member" as const,
        originBoundAt: createdAt,
      })),
      getCandidateKnowledgeSource: vi.fn(async () => source),
      listCandidateKnowledgeSourceVersions: vi.fn(async () => [version]),
      getCandidateKnowledgeSourceRetirement: vi.fn(async () => undefined),
      getCandidateKnowledgeSourceRefreshObservation: vi.fn(async () => undefined),
      upsertCandidateKnowledgeDirectoryRefreshObservations: vi.fn(async () => [
        {
          sourceId: "unexpected-source",
          observedVersionId: version.id,
          status: "current" as const,
          checkedAt: createdAt,
          lastRefreshedVersionId: null,
          lastRefreshedAt: null,
          stale: true,
        },
      ]),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      open: vi.fn(async () => handle),
      ingestDirectory: vi.fn(async () => ({
        sources: [normalized],
        scannedEntryCount: 1,
        discoveredFileCount: 1,
        skippedEntryCount: 0,
      })) as never,
      lstat: vi.fn(async () => ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      })) as never,
      realpath: vi.fn(async (path: string) =>
        path === "/selected" ? "/selected" : "/store",
      ) as never,
      now: () => createdAt,
    });
    const error = await service
      .recordKnowledgeSourceDirectoryRefresh({
        storeRoot: "/store",
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: "directory-binding",
      })
      .then(
        () => undefined,
        (failure) => failure,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The selected candidate knowledge source directory refresh observations could not be recorded.",
    );
    expect((error as Error).message).not.toContain(sourcePath);
    expect((error as Error).message).not.toContain(normalized.checksum);
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails directory refresh preview generically before scan or writes on scope and scan failures", async () => {
    const directoryPath = join(temporaryParent, "preview-failures");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "first.txt"), "first", "utf8");
    await writeFile(join(directoryPath, "second.txt"), "second", "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "first-source",
      "first-version",
      "second-source",
      "second-version",
      "directory-binding",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });
    if (imported.status !== "complete") throw new Error("expected complete directory import");
    await expect(
      service.previewKnowledgeSourceDirectoryRefresh({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: "missing-directory",
      }),
    ).rejects.toThrow(
      "The selected candidate knowledge source directory refresh preview could not be completed.",
    );
    await expect(
      service.previewKnowledgeSourceDirectoryRefresh({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: imported.directoryId,
        options: { maxScannedEntries: 1 },
      }),
    ).rejects.toThrow(
      "The selected candidate knowledge source directory refresh preview could not be completed.",
    );
    await expect(
      service.recordKnowledgeSourceDirectoryRefresh({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryId: imported.directoryId,
        options: { maxScannedEntries: 1 },
      }),
    ).rejects.toThrow(
      "The selected candidate knowledge source directory refresh observations could not be recorded.",
    );
    const reopened = await openCandidateKnowledgeStore(storeRoot);
    await expect(
      reopened.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", "first-source"),
    ).resolves.toBeUndefined();
    await expect(
      reopened.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", "second-source"),
    ).resolves.toBeUndefined();
    await reopened.close();
  });

  it("preflights a directory before any managed source write and rejects store overlap", async () => {
    const directoryPath = join(temporaryParent, "candidate-directory");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "first.txt"), "first", "utf8");
    await writeFile(join(directoryPath, "second.txt"), "second", "utf8");
    const service = createCandidateKnowledgeStoreService({
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce("store-uuid")
        .mockReturnValueOnce("default-ckb-uuid")
        .mockReturnValue("unexpected-id"),
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });

    await expect(
      service.importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryPath,
        options: { maxAcceptedFiles: 1 },
      }),
    ).rejects.toThrow("The selected candidate knowledge source directory could not be imported.");
    await expect(
      service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toEqual([]);

    await expect(
      service.importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryPath: storeRoot,
      }),
    ).rejects.toThrow("The selected candidate knowledge source directory could not be imported.");
    await expect(
      service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toEqual([]);

    const selectedDirectoryContainingStore = join(temporaryParent, "directory-containing-store");
    const nestedStoreRoot = join(selectedDirectoryContainingStore, "candidate-knowledge");
    await mkdir(selectedDirectoryContainingStore);
    const nestedService = createCandidateKnowledgeStoreService({
      generateId: (() => {
        const ids = ["nested-store-uuid", "nested-ckb-uuid"];
        return () => ids.shift() ?? "unexpected-nested-id";
      })(),
      now: () => createdAt,
    });
    await nestedService.initializeStore({ storeRoot: nestedStoreRoot });
    await expect(
      service.importKnowledgeSourceDirectory({
        storeRoot: nestedStoreRoot,
        knowledgeBaseId: "nested-ckb-uuid",
        directoryPath: selectedDirectoryContainingStore,
      }),
    ).rejects.toThrow(directoryImportFailureMessage);

    const selectedDirectoryInsideStore = join(storeRoot, "selected-directory");
    await mkdir(selectedDirectoryInsideStore);
    await expect(
      service.importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryPath: selectedDirectoryInsideStore,
      }),
    ).rejects.toThrow(directoryImportFailureMessage);
  });

  it("binds an empty directory with an opaque identity", async () => {
    const directoryPath = join(temporaryParent, "empty-candidate-directory");
    await mkdir(directoryPath);
    const ids = ["store-uuid", "default-ckb-uuid", "directory-binding-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });

    const result = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });

    expect(result).toEqual({
      sources: [],
      status: "complete",
      directoryId: "directory-binding-uuid",
      scannedEntryCount: 0,
      discoveredFileCount: 0,
      skippedEntryCount: 0,
    });
    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        store.getCandidateKnowledgeDirectoryBinding("default-ckb-uuid", "directory-binding-uuid"),
      ).resolves.toMatchObject({ rootPath: directoryPath });
      await expect(
        store.listCandidateKnowledgeDirectoryMembers("default-ckb-uuid", "directory-binding-uuid"),
      ).resolves.toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("rejects a previously bound directory before allocating new source identities", async () => {
    const directoryPath = join(temporaryParent, "bound-candidate-directory");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "first.txt"), "first", "utf8");
    const generateId = vi
      .fn<() => string>()
      .mockReturnValueOnce("store-uuid")
      .mockReturnValueOnce("default-ckb-uuid")
      .mockReturnValueOnce("source-uuid")
      .mockReturnValueOnce("version-uuid")
      .mockReturnValueOnce("directory-binding-uuid")
      .mockReturnValue("unexpected-id");
    const service = createCandidateKnowledgeStoreService({
      generateId,
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await expect(
      service.importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryPath,
      }),
    ).resolves.toMatchObject({ status: "complete", directoryId: "directory-binding-uuid" });
    const idsAfterFirstImport = generateId.mock.calls.length;

    await expect(
      service.importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryPath,
      }),
    ).rejects.toThrow(directoryImportFailureMessage);
    expect(generateId).toHaveBeenCalledTimes(idsAfterFirstImport);
    await expect(
      service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toHaveLength(1);
  });

  it("hides a first managed write failure and leaves zero sources", async () => {
    const directoryPath = join(temporaryParent, "candidate-directory");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "first.txt"), "first", "utf8");
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async (root: string) => {
      const handle = await openCandidateKnowledgeStore(root);
      return {
        ...handle,
        close,
        createManagedCandidateKnowledgeFileSource: async () => {
          throw new Error("private storage detail");
        },
      } as CandidateKnowledgeStoreHandle;
    });
    const service = createCandidateKnowledgeStoreService({
      generateId: (() => {
        const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => createdAt,
      open,
    });
    await service.initializeStore({ storeRoot });

    const failure = await service
      .importKnowledgeSourceDirectory({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        directoryPath,
      })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(directoryImportFailureMessage);
    expect((failure as Error).message).not.toContain("private storage detail");
    expect(close).toHaveBeenCalledOnce();
    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(store.listCandidateKnowledgeSources("default-ckb-uuid")).resolves.toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("reports a partial import when projection fails after the first source commits", async () => {
    const directoryPath = join(temporaryParent, "candidate-directory");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "first.txt"), "first", "utf8");
    const open = vi.fn(async (root: string) => {
      const handle = await openCandidateKnowledgeStore(root);
      return {
        ...handle,
        listCandidateKnowledgeSourceVersions: async () => {
          throw new Error("private projection detail");
        },
      } as CandidateKnowledgeStoreHandle;
    });
    const service = createCandidateKnowledgeStoreService({
      generateId: (() => {
        const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => createdAt,
      open,
    });
    await service.initializeStore({ storeRoot });

    const result = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });

    expect(result).toMatchObject({ status: "partial", sources: [], discoveredFileCount: 1 });
    expect(JSON.stringify(result)).not.toContain("private projection detail");
    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(store.listCandidateKnowledgeSources("default-ckb-uuid")).resolves.toHaveLength(
        1,
      );
    } finally {
      await store.close();
    }
  });

  it("returns a path-free partial result when the final directory binding fails", async () => {
    const directoryPath = join(temporaryParent, "candidate-directory");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "first.txt"), "first", "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "source-uuid",
      "version-uuid",
      "directory-binding-uuid",
    ];
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async (root: string) => {
      const handle = await openCandidateKnowledgeStore(root);
      return {
        ...handle,
        close,
        createCandidateKnowledgeDirectoryBinding: async () => {
          throw new Error("private binding detail");
        },
      } as CandidateKnowledgeStoreHandle;
    });
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
      open,
    });
    await service.initializeStore({ storeRoot });

    const result = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });

    expect(result).toMatchObject({
      status: "partial",
      sources: [{ source: { id: "source-uuid" } }],
    });
    expect(result).not.toHaveProperty("directoryId");
    expect(JSON.stringify(result)).not.toContain("private binding detail");
    expect(close).toHaveBeenCalledOnce();
    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(store.listCandidateKnowledgeSources("default-ckb-uuid")).resolves.toHaveLength(
        1,
      );
      await expect(
        store.findCandidateKnowledgeDirectoryBinding("default-ckb-uuid", directoryPath),
      ).resolves.toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it("returns only successfully projected sources after a later managed write failure", async () => {
    const directoryPath = join(temporaryParent, "candidate-directory");
    await mkdir(directoryPath);
    await writeFile(join(directoryPath, "first.txt"), "first", "utf8");
    await writeFile(join(directoryPath, "second.txt"), "second", "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "first-source-uuid",
      "first-version-uuid",
      "second-source-uuid",
      "second-version-uuid",
    ];
    let writeCount = 0;
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async (root: string) => {
      const handle = await openCandidateKnowledgeStore(root);
      const originalCreate = handle.createManagedCandidateKnowledgeFileSource;
      return {
        ...handle,
        close,
        createManagedCandidateKnowledgeFileSource: async (
          ...args: Parameters<typeof originalCreate>
        ) => {
          writeCount += 1;
          if (writeCount === 2) throw new Error("private storage detail");
          return originalCreate(...args);
        },
      } as CandidateKnowledgeStoreHandle;
    });
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
      open,
    });
    await service.initializeStore({ storeRoot });

    const result = await service.importKnowledgeSourceDirectory({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      directoryPath,
    });

    expect(result.status).toBe("partial");
    expect(result.sources.map((source) => source.source.id)).toEqual(["first-source-uuid"]);
    expect(result.scannedEntryCount).toBe(2);
    expect(result.discoveredFileCount).toBe(2);
    expect(result.skippedEntryCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private storage detail");
    expect(close).toHaveBeenCalledOnce();
    await expect(
      service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toHaveLength(1);
  });

  it("imports an approved URL with exact injected response bytes and projects no URL state", async () => {
    const originalUrl = "https://example.com/candidate?view=full";
    const finalUrl = "https://cdn.example.com/candidate";
    const responseBytes = new Uint8Array([65, 66, 67, 194, 162]);
    const responseChecksum = createHash("sha256").update(responseBytes).digest("hex");
    const fetchedAt = "2026-08-21T09:30:00.000Z";
    const ingested: IngestionResult = {
      source: {
        source: {
          path: originalUrl,
          mediaType: "text/plain",
          url: { originalUrl, finalUrl, fetchedAt, kind: "generic" },
        },
        mediaType: "text/plain",
        checksum: responseChecksum,
        sizeBytes: responseBytes.byteLength,
        urlResponseBytes: responseBytes,
        text: "ABC¢",
        chunks: [
          {
            id: "chunk-1",
            sourcePath: originalUrl,
            mediaType: "text/plain",
            checksum: responseChecksum,
            locator: { lineStart: 1, lineEnd: 1 },
            text: "ABC¢",
            url: { originalUrl, finalUrl, fetchedAt, kind: "generic" },
          },
        ],
        issues: [],
        url: { originalUrl, finalUrl, fetchedAt, kind: "generic" },
      },
      issues: [],
    };
    const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
    const generateId = vi.fn(() => ids.shift() ?? "unexpected-id");
    const ingestUrl = vi.fn(async () => ingested);
    const service = createCandidateKnowledgeStoreService({
      generateId,
      ingestUrl,
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });

    const imported = await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      url: originalUrl,
      displayName: "Remote evidence",
      approved: true,
    });
    expect(ingestUrl).toHaveBeenCalledWith(originalUrl, { approved: true });
    expect(imported).toMatchObject({
      created: true,
      source: {
        id: "source-uuid",
        knowledgeBaseId: "default-ckb-uuid",
        kind: "url",
        displayName: "Remote evidence",
        createdAt: fetchedAt,
      },
      versions: [
        {
          id: "version-uuid",
          sourceId: "source-uuid",
          version: 1,
          mediaType: "text/plain",
          checksum: responseChecksum,
          sizeBytes: responseBytes.byteLength,
          createdAt: fetchedAt,
        },
      ],
    });
    const serialized = JSON.stringify(imported);
    expect(serialized).not.toContain(originalUrl);
    expect(serialized).not.toContain(finalUrl);
    expect(serialized).not.toContain("ABC¢");
    expect(imported.source).not.toHaveProperty("url");
    expect(Object.isFrozen(imported)).toBe(true);
    expect(Object.isFrozen(imported.source)).toBe(true);
    expect(Object.isFrozen(imported.versions)).toBe(true);
  });

  it("refreshes changed URL bytes with immutable provenance and restart-safe lineage", async () => {
    const originalUrl = "https://example.com/candidate";
    const firstBytes = new Uint8Array([65, 66, 67]);
    const secondBytes = new Uint8Array([68, 69, 70, 71]);
    const ingestUrl = vi
      .fn<typeof import("@draft-loop/ingestion").ingestUrl>()
      .mockResolvedValueOnce(successfulUrlIngestion(originalUrl, firstBytes, createdAt))
      .mockResolvedValueOnce(
        successfulUrlIngestion(
          originalUrl,
          secondBytes,
          changedAt,
          "https://cdn.example.com/candidate",
        ),
      );
    const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-1", "version-2"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      ingestUrl,
      now: () => changedAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      url: originalUrl,
      approved: true,
    });

    const refreshed = await service.refreshKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      approved: true,
    });
    expect(refreshed).toEqual({
      sourceId: "source-uuid",
      checkedAt: changedAt,
      status: "refreshed",
      versionId: "version-2",
    });
    expect(Object.isFrozen(refreshed)).toBe(true);
    expect(ingestUrl).toHaveBeenLastCalledWith(originalUrl, { approved: true });

    const manifest = await service.listKnowledgeSourceManifests({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
    });
    expect(manifest[0]?.versions).toMatchObject([
      { id: "version-1", version: 1 },
      { id: "version-2", version: 2, createdAt: changedAt },
    ]);
    const reopened = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        reopened.getCandidateKnowledgeSourceUrlProvenance(
          "default-ckb-uuid",
          "source-uuid",
          "version-2",
        ),
      ).resolves.toMatchObject({
        originalUrl,
        finalUrl: "https://cdn.example.com/candidate",
        fetchedAt: changedAt,
      });
      await expect(
        reopened.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", "source-uuid"),
      ).resolves.toMatchObject({
        observedVersionId: "version-2",
        lastRefreshedVersionId: "version-2",
        lastRefreshedAt: changedAt,
      });
    } finally {
      await reopened.close();
    }
  });

  it("treats identical URL bytes and redirect-only drift as a current no-op", async () => {
    const originalUrl = "https://example.com/candidate";
    const bytes = new Uint8Array([65, 66, 67]);
    const ingestUrl = vi
      .fn<typeof import("@draft-loop/ingestion").ingestUrl>()
      .mockResolvedValueOnce(successfulUrlIngestion(originalUrl, bytes, createdAt))
      .mockResolvedValueOnce(
        successfulUrlIngestion(originalUrl, bytes, changedAt, "https://cdn.example.com/candidate"),
      );
    const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-1", "unused-v2"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      ingestUrl,
      now: () => changedAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      url: originalUrl,
      approved: true,
    });
    const current = await service.refreshKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      approved: true,
    });
    expect(current).toEqual({ sourceId: "source-uuid", checkedAt: changedAt, status: "current" });
    expect(
      await service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).toMatchObject([{ versions: [{ id: "version-1", version: 1 }] }]);
    await expect(
      service.getKnowledgeSourceRefreshState({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toEqual({
      sourceId: "source-uuid",
      status: "current",
      checkedAt: changedAt,
      observedVersionId: "version-1",
    });
  });

  it("requires approval and records URL refresh failures as inaccessible without leakage", async () => {
    const originalUrl = "https://example.com/private?token=secret";
    const bytes = new Uint8Array([65, 66, 67]);
    const ingestUrl = vi
      .fn<typeof import("@draft-loop/ingestion").ingestUrl>()
      .mockResolvedValueOnce(successfulUrlIngestion(originalUrl, bytes, createdAt))
      .mockRejectedValueOnce(new Error(`fetch failed for ${originalUrl}`));
    const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-1"];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      ingestUrl,
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      url: originalUrl,
      approved: true,
    });
    await expect(
      service.refreshKnowledgeSourceUrl({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
        approved: false,
      }),
    ).rejects.toThrow("could not be refreshed");
    expect(ingestUrl).toHaveBeenCalledOnce();

    now = changedAt;
    const inaccessible = await service.refreshKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      approved: true,
    });
    expect(inaccessible).toEqual({
      sourceId: "source-uuid",
      checkedAt: changedAt,
      status: "inaccessible",
    });
    expect(Object.isFrozen(inaccessible)).toBe(true);
    expect(JSON.stringify(inaccessible)).not.toContain(originalUrl);
    await expect(
      service.getKnowledgeSourceRefreshState({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toEqual({
      sourceId: "source-uuid",
      status: "inaccessible",
      checkedAt: changedAt,
      observedVersionId: "version-1",
    });
  });

  it("rejects malformed URL refresh preflight state without fetching or observing", async () => {
    const originalUrl = "https://example.com/preflight";
    const ingestUrl = vi.fn(async () =>
      successfulUrlIngestion(originalUrl, new Uint8Array([1]), createdAt),
    );
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "good-source",
      "good-version",
      "file-source",
      "file-version",
      "retired-source",
      "retired-version",
      "archived-ckb",
      "archived-source",
      "archived-version",
      "missing-provenance-source",
      "missing-provenance-version",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      ingestUrl,
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      url: originalUrl,
      approved: true,
    });
    await service.createKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      kind: "file",
      displayName: "File source",
      mediaType: "text/plain",
      checksum: "a".repeat(64),
      sizeBytes: 1,
    });
    await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      url: originalUrl,
      approved: true,
    });
    await service.retireKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "retired-source",
    });
    const archived = await service.createKnowledgeBase({
      storeRoot,
      displayName: "Archived evidence",
    });
    await service.importKnowledgeSourceUrl({
      storeRoot,
      knowledgeBaseId: "archived-ckb",
      url: originalUrl,
      approved: true,
    });
    await service.archiveKnowledgeBase({
      storeRoot,
      knowledgeBaseId: archived.knowledgeBases[1]?.id ?? "",
    });
    await service.createKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      kind: "url",
      displayName: "Missing provenance",
      mediaType: "text/plain",
      checksum: "b".repeat(64),
      sizeBytes: 1,
    });

    const cases = [
      ["file-source", "default-ckb-uuid"],
      ["retired-source", "default-ckb-uuid"],
      ["archived-source", "archived-ckb"],
      ["missing-provenance-source", "default-ckb-uuid"],
    ] as const;
    for (const [sourceId, knowledgeBaseId] of cases) {
      await expect(
        service.refreshKnowledgeSourceUrl({
          storeRoot,
          knowledgeBaseId,
          sourceId,
          approved: true,
        }),
      ).rejects.toThrow("could not be refreshed");
      await expect(
        service.getKnowledgeSourceRefreshState({ storeRoot, knowledgeBaseId, sourceId }),
      ).resolves.toEqual({ sourceId, status: "unobserved" });
    }
    expect(ingestUrl).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(ingestUrl.mock.calls)).not.toContain("refresh");
  });

  it("requires URL approval and active scope before invoking ingestion", async () => {
    const ingestUrl = vi.fn(async () => {
      throw new Error("network must not be called");
    });
    const ids = ["store-uuid", "default-ckb-uuid", "other-ckb-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      ingestUrl,
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await expect(
      service.importKnowledgeSourceUrl({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        url: "https://example.com/private",
        approved: false,
      }),
    ).rejects.toThrow("The selected candidate knowledge source URL could not be imported.");
    expect(ingestUrl).not.toHaveBeenCalled();

    await expect(
      service.importKnowledgeSourceUrl({
        storeRoot,
        knowledgeBaseId: "missing-ckb",
        url: "https://example.com/private",
        approved: true,
      }),
    ).rejects.toThrow("The selected candidate knowledge source URL could not be imported.");
    expect(ingestUrl).not.toHaveBeenCalled();

    const other = await service.createKnowledgeBase({
      storeRoot,
      displayName: "Other evidence",
    });
    await service.archiveKnowledgeBase({
      storeRoot,
      knowledgeBaseId: other.knowledgeBases[1]?.id ?? "",
    });
    await expect(
      service.importKnowledgeSourceUrl({
        storeRoot,
        knowledgeBaseId: other.knowledgeBases[1]?.id ?? "",
        url: "https://example.com/private",
        approved: true,
      }),
    ).rejects.toThrow("The selected candidate knowledge source URL could not be imported.");
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it("rejects an active prefetch result from a different knowledge base without ingesting", async () => {
    const ingestUrl = vi.fn(async () => {
      throw new Error("network must not be called");
    });
    const getCandidateKnowledgeBase = vi.fn(async () => ({
      id: "different-ckb-uuid",
      displayName: "Different evidence",
      description: "",
      state: "active" as const,
      isDefault: false,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
    }));
    const close = vi.fn(async () => {});
    const open = vi.fn(
      async () =>
        ({ getCandidateKnowledgeBase, close }) as unknown as CandidateKnowledgeStoreHandle,
    );
    const ids = ["store-uuid", "default-ckb-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      ingestUrl,
      open,
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });

    await expect(
      service.importKnowledgeSourceUrl({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        url: "https://example.com/private",
        approved: true,
      }),
    ).rejects.toThrow("The selected candidate knowledge source URL could not be imported.");
    expect(getCandidateKnowledgeBase).toHaveBeenCalledWith("default-ckb-uuid");
    expect(close).toHaveBeenCalledTimes(1);
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it("rejects malformed URL ingestion results without consuming IDs or leaking URL data", async () => {
    const originalUrl = "https://example.com/private?token=secret";
    const malformedBytes = new Uint8Array([1, 2, 3, 4]);
    const malformedChecksum = createHash("sha256").update(malformedBytes).digest("hex");
    const generateId = vi
      .fn<() => string>()
      .mockReturnValueOnce("store-uuid")
      .mockReturnValueOnce("default-ckb-uuid");
    const service = createCandidateKnowledgeStoreService({
      generateId,
      ingestUrl: vi.fn(async () => ({
        source: {
          source: { path: originalUrl },
          mediaType: "text/plain",
          checksum: malformedChecksum,
          sizeBytes: malformedBytes.byteLength,
          url: {
            originalUrl: "https://different.example/private",
            finalUrl: "https://different.example/private",
            fetchedAt: createdAt,
            kind: "generic",
          },
          urlResponseBytes: malformedBytes,
          text: "safe",
          chunks: [
            {
              id: "chunk-1",
              sourcePath: originalUrl,
              mediaType: "text/plain",
              checksum: malformedChecksum,
              locator: { lineStart: 1, lineEnd: 1 },
              text: "safe",
            },
          ],
          issues: [],
        },
        issues: [],
      })) as never,
    });
    await service.initializeStore({ storeRoot });
    const error = await service
      .importKnowledgeSourceUrl({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        url: originalUrl,
        approved: true,
      })
      .then(
        () => undefined,
        (failure) => failure,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The selected candidate knowledge source URL could not be imported.",
    );
    expect((error as Error).message).not.toContain(originalUrl);
    expect(generateId).toHaveBeenCalledTimes(2);
  });

  it("appends approved managed bytes with lineage and deduplicates an identical approval", async () => {
    const initialPath = join(temporaryParent, "Career notes.md");
    const selectedVersionPath = join(temporaryParent, "AGENTS.md");
    const firstContent = "# Career notes\nBuilt reliable systems.\n";
    const secondContent = "# Career notes\nBuilt reliable distributed systems.\n";
    await writeFile(initialPath, firstContent, "utf8");
    await writeFile(selectedVersionPath, secondContent, "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "source-uuid",
      "version-1-uuid",
      "version-2-uuid",
      "unused-version-uuid",
    ];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath: initialPath,
    });

    now = changedAt;
    const appended = await service.appendKnowledgeSourceFileVersion({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      sourcePath: selectedVersionPath,
    });

    expect(appended.created).toBe(true);
    expect(appended.source).toEqual(imported.source);
    expect(appended.source.displayName).toBe("Career notes.md");
    expect(appended.versions).toHaveLength(2);
    expect(appended.versions[1]).toMatchObject({
      id: "version-2-uuid",
      sourceId: "source-uuid",
      version: 2,
      parentVersionId: "version-1-uuid",
      mediaType: "text/markdown",
      sizeBytes: Buffer.byteLength(secondContent),
      createdAt: changedAt,
    });

    const unchanged = await service.appendKnowledgeSourceFileVersion({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      sourcePath: selectedVersionPath,
    });
    expect(unchanged.created).toBe(false);
    expect(unchanged.versions).toEqual(appended.versions);

    const serialized = JSON.stringify({ appended, unchanged });
    expect(serialized).not.toContain(initialPath);
    expect(serialized).not.toContain(selectedVersionPath);
    expect(serialized).not.toContain(temporaryParent);
    await expect(
      readFile(join(storeRoot, "draft-loop-knowledge.json"), "utf8"),
    ).resolves.not.toContain(selectedVersionPath);
    const databaseBytes = await readFile(join(storeRoot, ".draft-loop", "knowledge.sqlite"));
    expect(databaseBytes.includes(Buffer.from(initialPath, "utf8"))).toBe(true);
    expect(databaseBytes.includes(Buffer.from(selectedVersionPath, "utf8"))).toBe(false);

    const reopened = await openCandidateKnowledgeStore(storeRoot);
    try {
      const firstManagedPath = await reopened.getManagedCandidateKnowledgeFilePath(
        "default-ckb-uuid",
        "source-uuid",
        "version-1-uuid",
      );
      const secondManagedPath = await reopened.getManagedCandidateKnowledgeFilePath(
        "default-ckb-uuid",
        "source-uuid",
        "version-2-uuid",
      );
      await expect(readFile(firstManagedPath ?? "", "utf8")).resolves.toBe(firstContent);
      await expect(
        reopened.getCandidateKnowledgeSourceOriginBinding("default-ckb-uuid", "source-uuid"),
      ).resolves.toEqual({
        sourceId: "source-uuid",
        originPath: initialPath,
        boundAt: createdAt,
      });
      await expect(readFile(secondManagedPath ?? "", "utf8")).resolves.toBe(secondContent);
      expect(await readdir(dirname(secondManagedPath ?? ""))).toHaveLength(2);
    } finally {
      await reopened.close();
    }
  });

  it("lists source manifests only from the requested knowledge base", async () => {
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "other-ckb-uuid",
      "default-source-uuid",
      "default-version-uuid",
      "other-source-uuid",
      "other-version-uuid",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.createKnowledgeBase({ storeRoot, displayName: "Other evidence" });
    const sourceInput = {
      storeRoot,
      kind: "file" as const,
      mediaType: "text/plain",
      checksum: "a".repeat(64),
      sizeBytes: 12,
    };
    await service.createKnowledgeSource({
      ...sourceInput,
      knowledgeBaseId: "default-ckb-uuid",
      displayName: "Default source",
    });
    await service.createKnowledgeSource({
      ...sourceInput,
      knowledgeBaseId: "other-ckb-uuid",
      displayName: "Other source",
    });

    const defaultManifests = await service.listKnowledgeSourceManifests({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
    });
    const otherManifests = await service.listKnowledgeSourceManifests({
      storeRoot,
      knowledgeBaseId: "other-ckb-uuid",
    });
    expect(defaultManifests.map((manifest) => manifest.source.id)).toEqual(["default-source-uuid"]);
    expect(otherManifests.map((manifest) => manifest.source.id)).toEqual(["other-source-uuid"]);
  });

  it("lists exact-integrity duplicate groups from each CKB's latest versions", async () => {
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "other-ckb-uuid",
      "source-a",
      "version-a-1",
      "source-b",
      "version-b-1",
      "source-c",
      "version-c-1",
      "near-checksum",
      "near-checksum-version-1",
      "near-media",
      "near-media-version-1",
      "near-size",
      "near-size-version-1",
      "other-source",
      "other-version-1",
      "version-a-2",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    await service.createKnowledgeBase({ storeRoot, displayName: "Other evidence" });
    const addSource = async (input: {
      readonly label: string;
      readonly knowledgeBaseId?: string;
      readonly checksum: string;
      readonly mediaType?: string;
      readonly sizeBytes?: number;
    }) =>
      service.createKnowledgeSource({
        storeRoot,
        knowledgeBaseId: input.knowledgeBaseId ?? "default-ckb-uuid",
        kind: "file",
        displayName: `Sensitive label ${input.label}`,
        mediaType: input.mediaType ?? "text/plain",
        checksum: input.checksum,
        sizeBytes: input.sizeBytes ?? 12,
      });

    await addSource({ label: "source-a", checksum: "a".repeat(64) });
    await addSource({ label: "source-b", checksum: "a".repeat(64) });
    await addSource({ label: "source-c", checksum: "a".repeat(64) });
    await addSource({
      label: "near-checksum",
      checksum: "b".repeat(64),
    });
    await addSource({
      label: "near-media",
      checksum: "a".repeat(64),
      mediaType: "text/markdown",
    });
    await addSource({
      label: "near-size",
      checksum: "a".repeat(64),
      sizeBytes: 13,
    });
    await addSource({
      label: "other-source",
      knowledgeBaseId: "other-ckb-uuid",
      checksum: "a".repeat(64),
    });

    const initial = await service.listKnowledgeSourceDuplicateGroups({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
    });
    expect(initial).toEqual([
      {
        members: [
          { sourceId: "source-a", versionId: "version-a-1" },
          { sourceId: "source-b", versionId: "version-b-1" },
          { sourceId: "source-c", versionId: "version-c-1" },
        ],
      },
    ]);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial[0])).toBe(true);
    expect(Object.isFrozen(initial[0]?.members)).toBe(true);
    expect(Object.isFrozen(initial[0]?.members[0])).toBe(true);
    const serializedInitial = JSON.stringify(initial);
    expect(serializedInitial).not.toContain("a".repeat(64));
    expect(serializedInitial).not.toContain("text/plain");
    expect(serializedInitial).not.toContain("12");
    expect(serializedInitial).not.toContain("Sensitive label");
    expect(serializedInitial).not.toContain("path");
    expect(serializedInitial).not.toContain("url");
    expect(serializedInitial).not.toContain("near-checksum");

    const updated = await service.appendKnowledgeSourceVersion({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-a",
      mediaType: "text/plain",
      checksum: "b".repeat(64),
      sizeBytes: 12,
    });
    expect(updated.versions.at(-1)?.id).toBe("version-a-2");
    await expect(
      service.listKnowledgeSourceDuplicateGroups({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toEqual([
      {
        members: [
          { sourceId: "near-checksum", versionId: "near-checksum-version-1" },
          { sourceId: "source-a", versionId: "version-a-2" },
        ],
      },
      {
        members: [
          { sourceId: "source-b", versionId: "version-b-1" },
          { sourceId: "source-c", versionId: "version-c-1" },
        ],
      },
    ]);
    await expect(
      service.listKnowledgeSourceDuplicateGroups({
        storeRoot,
        knowledgeBaseId: "other-ckb-uuid",
      }),
    ).resolves.toEqual([]);
  });

  it("sorts duplicate groups independently of storage order", async () => {
    const source = (id: string) => ({
      id,
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: `Private label ${id}`,
      createdAt,
    });
    const version = (
      id: string,
      sourceId: string,
      number: number,
      checksumValue: string,
      parentVersionId: string | null,
    ) => ({
      id,
      sourceId,
      version: number,
      parentVersionId,
      mediaType: "text/plain",
      checksum: checksumValue,
      sizeBytes: 12,
      createdAt,
    });
    const versions: Record<string, readonly CandidateKnowledgeSourceVersionRecord[]> = {
      "source-a": [
        version("a-version-2", "source-a", 2, "a".repeat(64), "a-version-1"),
        version("a-version-1", "source-a", 1, "a".repeat(64), null),
      ],
      "source-b": [version("b-version-1", "source-b", 1, "a".repeat(64), null)],
      "source-c": [version("c-version-1", "source-c", 1, "b".repeat(64), null)],
      "source-d": [version("d-version-1", "source-d", 1, "b".repeat(64), null)],
    };
    const close = vi.fn(async () => undefined);
    const handle = {
      listCandidateKnowledgeSources: vi.fn(async () => [
        source("source-d"),
        source("source-b"),
        source("source-c"),
        source("source-a"),
      ]),
      listCandidateKnowledgeSourceVersions: vi.fn(
        async (_knowledgeBaseId: string, sourceId: string) => versions[sourceId] ?? [],
      ),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      open: vi.fn(async () => handle),
    });

    await expect(
      service.listKnowledgeSourceDuplicateGroups({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
      }),
    ).resolves.toEqual([
      {
        members: [
          { sourceId: "source-a", versionId: "a-version-2" },
          { sourceId: "source-b", versionId: "b-version-1" },
        ],
      },
      {
        members: [
          { sourceId: "source-c", versionId: "c-version-1" },
          { sourceId: "source-d", versionId: "d-version-1" },
        ],
      },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed for malformed duplicate dependency graphs", async () => {
    const source = {
      id: "source-1",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Private label",
      createdAt,
    };
    const version = {
      id: "version-1",
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
      mediaType: "text/plain",
      checksum: "a".repeat(64),
      sizeBytes: 12,
      createdAt,
    };
    const cases: readonly {
      readonly sources: readonly (typeof source)[];
      readonly versions: readonly CandidateKnowledgeSourceVersionRecord[];
    }[] = [
      { sources: [source], versions: [] },
      { sources: [source], versions: [{ ...version, sourceId: "other-source" }] },
      { sources: [source, source], versions: [version] },
    ];
    for (const testCase of cases) {
      const close = vi.fn(async () => undefined);
      const handle = {
        listCandidateKnowledgeSources: vi.fn(async () => testCase.sources),
        listCandidateKnowledgeSourceVersions: vi.fn(async () => testCase.versions),
        close,
      } as unknown as CandidateKnowledgeStoreHandle;
      const service = createCandidateKnowledgeStoreService({
        open: vi.fn(async () => handle),
      });
      const error = await service
        .listKnowledgeSourceDuplicateGroups({
          storeRoot: "valid",
          knowledgeBaseId: "ckb-1",
        })
        .then(
          () => undefined,
          (failure) => failure,
        );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Candidate knowledge source duplicate graph returned inconsistent state.",
      );
      expect((error as Error).message).not.toContain("Private label");
      expect((error as Error).message).not.toContain("a".repeat(64));
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it("fails closed when version IDs are reused across source graphs", async () => {
    const firstSource = {
      id: "source-1",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Private first label",
      createdAt,
    };
    const secondSource = {
      id: "source-2",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Private second label",
      createdAt,
    };
    const version = (sourceId: string, checksumValue: string) => ({
      id: "reused-version-id",
      sourceId,
      version: 1,
      parentVersionId: null,
      mediaType: "text/plain",
      checksum: checksumValue,
      sizeBytes: 12,
      createdAt,
    });
    const close = vi.fn(async () => undefined);
    const handle = {
      listCandidateKnowledgeSources: vi.fn(async () => [firstSource, secondSource]),
      listCandidateKnowledgeSourceVersions: vi.fn(
        async (_knowledgeBaseId: string, sourceId: string) =>
          sourceId === firstSource.id
            ? [version(firstSource.id, "a".repeat(64))]
            : [version(secondSource.id, "b".repeat(64))],
      ),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      open: vi.fn(async () => handle),
    });

    const error = await service
      .listKnowledgeSourceDuplicateGroups({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
      })
      .then(
        () => undefined,
        (failure) => failure,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Candidate knowledge source duplicate graph returned inconsistent state.",
    );
    expect((error as Error).message).not.toContain("Private");
    expect((error as Error).message).not.toContain("a".repeat(64));
    expect(close).toHaveBeenCalledOnce();
  });

  it("checks current, changed, and missing bound origins without changing stored state", async () => {
    const sourcePath = join(temporaryParent, "candidate.md");
    const initialContent = "# Candidate evidence\n";
    await writeFile(sourcePath, initialContent, "utf8");
    const service = createCandidateKnowledgeStoreService({
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce("store-uuid")
        .mockReturnValueOnce("default-ckb-uuid")
        .mockReturnValueOnce("source-uuid")
        .mockReturnValueOnce("version-uuid"),
      now: () => createdAt,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath,
    });
    const beforeManifest = await service.listKnowledgeSourceManifests({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
    });
    const opened = await openCandidateKnowledgeStore(storeRoot);
    const beforeBinding = await opened.getCandidateKnowledgeSourceOriginBinding(
      "default-ckb-uuid",
      "source-uuid",
    );
    await opened.close();

    const current = await service.checkKnowledgeSourceOriginStatus({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: imported.source.id,
    });
    expect(current).toEqual({
      sourceId: "source-uuid",
      checkedAt: createdAt,
      status: "current",
    });

    await writeFile(sourcePath, "# Changed evidence\n", "utf8");
    await expect(
      service.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toMatchObject({ sourceId: "source-uuid", status: "changed" });

    await rm(sourcePath);
    const missing = await service.checkKnowledgeSourceOriginStatus({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(missing.status).toBe("missing");
    expect(
      await service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).toEqual(beforeManifest);
    const reopened = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        reopened.getCandidateKnowledgeSourceOriginBinding("default-ckb-uuid", "source-uuid"),
      ).resolves.toEqual(beforeBinding);
    } finally {
      await reopened.close();
    }
    expect(Object.isFrozen(current)).toBe(true);
    expect(JSON.stringify({ current, missing })).not.toContain(temporaryParent);
    expect(JSON.stringify({ current, missing })).not.toContain(checksum);
    expect(JSON.stringify({ current, missing })).not.toContain(initialContent);
  });

  it("explicitly rebinds an exact-byte origin and projects only status and boundAt", async () => {
    const originalPath = join(temporaryParent, "candidate.md");
    const replacementPath = join(temporaryParent, "replacement.md");
    const content = "# Candidate evidence\n";
    await writeFile(originalPath, content, "utf8");
    await writeFile(replacementPath, content, "utf8");
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: (() => {
        const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath: originalPath,
    });
    await service.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    const stateBeforeRebind = await service.getKnowledgeSourceRefreshState({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });

    now = changedAt;
    const rebound = await service.rebindKnowledgeSourceOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      sourcePath: replacementPath,
    });
    expect(rebound).toEqual({
      sourceId: "source-uuid",
      status: "rebound",
      boundAt: changedAt,
    });
    expect(Object.isFrozen(rebound)).toBe(true);
    expect(Object.keys(rebound)).toEqual(["sourceId", "status", "boundAt"]);
    expect(JSON.stringify(rebound)).not.toContain(temporaryParent);
    expect(JSON.stringify(rebound)).not.toContain(sha256(content));
    await expect(
      service.getKnowledgeSourceRefreshState({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toEqual(stateBeforeRebind);

    now = "2026-08-21T11:00:00.000Z";
    await expect(
      service.rebindKnowledgeSourceOrigin({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
        sourcePath: replacementPath,
      }),
    ).resolves.toEqual({
      sourceId: "source-uuid",
      status: "current",
      boundAt: changedAt,
    });
  });

  it("retires a source idempotently while preserving read-only projections", async () => {
    const sourcePath = join(temporaryParent, "candidate.md");
    const changedPath = join(temporaryParent, "changed.md");
    const initialContent = "# Candidate evidence\n";
    const changedContent = "# Changed candidate evidence\n";
    await writeFile(sourcePath, initialContent, "utf8");
    await writeFile(changedPath, changedContent, "utf8");
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: (() => {
        const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    const imported = await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath,
    });
    const active = await service.getKnowledgeSourceRetirement({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: imported.source.id,
    });
    expect(active).toEqual({ sourceId: "source-uuid", status: "active" });
    expect(Object.isFrozen(active)).toBe(true);

    now = changedAt;
    const retired = await service.retireKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: imported.source.id,
    });
    expect(retired).toEqual({
      sourceId: "source-uuid",
      status: "retired",
      retiredAt: changedAt,
      reason: "user-requested",
    });
    expect(Object.isFrozen(retired)).toBe(true);
    expect(JSON.stringify(retired)).not.toContain(temporaryParent);
    expect(JSON.stringify(retired)).not.toContain(initialContent);
    expect(JSON.stringify(retired)).not.toContain(sha256(initialContent));

    now = "2026-08-21T11:00:00.000Z";
    await expect(
      service.retireKnowledgeSource({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: imported.source.id,
      }),
    ).resolves.toEqual(retired);
    await expect(
      service.getKnowledgeSourceRetirement({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: imported.source.id,
      }),
    ).resolves.toEqual(retired);
    await expect(
      service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      }),
    ).resolves.toEqual([{ source: imported.source, versions: imported.versions }]);
    await expect(
      service.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: imported.source.id,
      }),
    ).resolves.toMatchObject({ sourceId: imported.source.id, status: "current" });

    await expect(
      service.appendKnowledgeSourceVersion({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: imported.source.id,
        mediaType: "text/markdown",
        checksum: sha256(changedContent),
        sizeBytes: Buffer.byteLength(changedContent),
      }),
    ).rejects.toThrow(/retired/i);
    await expect(
      service.appendKnowledgeSourceFileVersion({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: imported.source.id,
        sourcePath: changedPath,
      }),
    ).rejects.toThrow(/retired/i);
    await expect(
      service.rebindKnowledgeSourceOrigin({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: imported.source.id,
        sourcePath,
      }),
    ).rejects.toThrow("The selected candidate knowledge source file could not be rebound.");
    await writeFile(sourcePath, changedContent, "utf8");
    await expect(
      service.refreshKnowledgeSourceFromOrigin({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: imported.source.id,
      }),
    ).rejects.toThrow(/retired/i);
  });

  it("rejects malformed retirement dependency results without exposing sensitive fields", async () => {
    const sourcePath = "/private/candidate/selected.md";
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Candidate source",
      createdAt,
    };
    const close = vi.fn(async () => undefined);
    const handle = {
      getCandidateKnowledgeSource: vi.fn(async () => source),
      getCandidateKnowledgeSourceRetirement: vi.fn(async () => undefined),
      retireCandidateKnowledgeSource: vi.fn(async () => ({
        sourceId: "different-source",
        retiredAt: changedAt,
        reason: "user-requested" as const,
        path: sourcePath,
      })),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      now: () => changedAt,
      open: vi.fn(async () => handle),
    });

    const error = await service
      .retireKnowledgeSource({
        storeRoot: "valid",
        knowledgeBaseId: source.knowledgeBaseId,
        sourceId: source.id,
      })
      .then(
        () => undefined,
        (failure) => failure,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Candidate knowledge source retirement returned inconsistent storage state.",
    );
    expect((error as Error).message).not.toContain(sourcePath);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a changed rebind selection without exposing path or integrity data", async () => {
    const originalPath = join(temporaryParent, "candidate.md");
    const changedPath = join(temporaryParent, "changed.md");
    const originalContent = "# Candidate evidence\n";
    const changedContent = "# Different evidence\n";
    await writeFile(originalPath, originalContent, "utf8");
    await writeFile(changedPath, changedContent, "utf8");
    const service = createCandidateKnowledgeStoreService({
      generateId: (() => {
        const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
      now: () => changedAt,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath: originalPath,
    });

    const error = await service
      .rebindKnowledgeSourceOrigin({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
        sourcePath: changedPath,
      })
      .then(
        () => undefined,
        (failure) => failure,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The selected candidate knowledge source file could not be rebound.",
    );
    for (const secret of [changedPath, temporaryParent, sha256(changedContent), changedContent]) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("rejects malformed rebind dependency results without exposing sensitive fields", async () => {
    const sourcePath = "/private/candidate/selected.md";
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Candidate source",
      createdAt,
    };
    const close = vi.fn(async () => undefined);
    const handle = {
      getCandidateKnowledgeSource: vi.fn(async () => source),
      getCandidateKnowledgeSourceOriginBinding: vi.fn(async () => ({
        sourceId: source.id,
        originPath: sourcePath,
        boundAt: createdAt,
      })),
      rebindManagedCandidateKnowledgeFileOrigin: vi.fn(async () => ({
        binding: {
          sourceId: "different-source",
          originPath: sourcePath,
          boundAt: changedAt,
        },
        rebound: true,
      })),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      now: () => changedAt,
      ingestFile: vi.fn(async () => successfulIngestion(sourcePath)),
      open: vi.fn(async () => handle),
    });

    const error = await service
      .rebindKnowledgeSourceOrigin({
        storeRoot: "valid",
        knowledgeBaseId: source.knowledgeBaseId,
        sourceId: source.id,
        sourcePath,
      })
      .then(
        () => undefined,
        (failure) => failure,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Candidate knowledge source rebind returned inconsistent storage state.",
    );
    expect((error as Error).message).not.toContain(sourcePath);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed refresh-state dependency results without exposing sensitive fields", async () => {
    const sourcePath = "/private/candidate/selected.md";
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Candidate source",
      createdAt,
    };
    const close = vi.fn(async () => undefined);
    const handle = {
      getCandidateKnowledgeSource: vi.fn(async () => source),
      getCandidateKnowledgeSourceRefreshObservation: vi.fn(async () => ({
        sourceId: source.id,
        observedVersionId: "version-1-uuid",
        status: "not-a-status",
        checkedAt: createdAt,
        lastRefreshedVersionId: null,
        lastRefreshedAt: null,
        stale: false,
        path: sourcePath,
        checksum,
      })),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      open: vi.fn(async () => handle),
    });

    const error = await service
      .getKnowledgeSourceRefreshState({
        storeRoot: "valid",
        knowledgeBaseId: source.knowledgeBaseId,
        sourceId: source.id,
      })
      .then(
        () => undefined,
        (failure) => failure,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Candidate knowledge source refresh state returned inconsistent storage state.",
    );
    expect((error as Error).message).not.toContain(sourcePath);
    expect((error as Error).message).not.toContain(checksum);
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed for malformed refresh-state timestamps and derived flags", async () => {
    const sourcePath = "/private/candidate/selected.md";
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Candidate source",
      createdAt,
    };
    const validObservation = {
      sourceId: source.id,
      observedVersionId: "version-1-uuid",
      status: "current" as const,
      checkedAt: createdAt,
      lastRefreshedVersionId: "version-1-uuid",
      lastRefreshedAt: createdAt,
      stale: false,
    };
    const cases: readonly Record<string, unknown>[] = [
      { checkedAt: "not-a-time" },
      { lastRefreshedAt: "not-a-time" },
      { lastRefreshedAt: changedAt },
      { stale: "false" },
    ];
    for (const malformed of cases) {
      const close = vi.fn(async () => undefined);
      const handle = {
        getCandidateKnowledgeSource: vi.fn(async () => source),
        getCandidateKnowledgeSourceRefreshObservation: vi.fn(async () => ({
          ...validObservation,
          ...malformed,
          path: sourcePath,
          checksum,
        })),
        close,
      } as unknown as CandidateKnowledgeStoreHandle;
      const service = createCandidateKnowledgeStoreService({
        open: vi.fn(async () => handle),
      });
      await expect(
        service.getKnowledgeSourceRefreshState({
          storeRoot: "valid",
          knowledgeBaseId: source.knowledgeBaseId,
          sourceId: source.id,
        }),
      ).rejects.toThrow(
        "Candidate knowledge source refresh state returned inconsistent storage state.",
      );
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlink rebind selection with a generic path-free error",
    async () => {
      const originalPath = join(temporaryParent, "candidate.md");
      const selectedPath = join(temporaryParent, "selected-link.md");
      const content = "# Candidate evidence\n";
      await writeFile(originalPath, content, "utf8");
      await symlink(originalPath, selectedPath, "file");
      let now = createdAt;
      const service = createCandidateKnowledgeStoreService({
        generateId: (() => {
          const ids = ["store-uuid", "default-ckb-uuid", "source-uuid", "version-uuid"];
          return () => ids.shift() ?? "unexpected-id";
        })(),
        now: () => now,
      });
      await service.initializeStore({ storeRoot });
      await service.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourcePath: originalPath,
      });

      now = changedAt;
      const error = await service
        .rebindKnowledgeSourceOrigin({
          storeRoot,
          knowledgeBaseId: "default-ckb-uuid",
          sourceId: "source-uuid",
          sourcePath: selectedPath,
        })
        .then(
          () => undefined,
          (failure) => failure,
        );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "The selected candidate knowledge source file could not be rebound.",
      );
      expect((error as Error).message).not.toContain(selectedPath);
      expect((error as Error).message).not.toContain(temporaryParent);
    },
  );

  it("refreshes a changed bound origin once, preserves lineage, and keeps the binding", async () => {
    const sourcePath = join(temporaryParent, "candidate.md");
    const initialContent = "# Initial evidence\n";
    const changedContent = "# Changed evidence\n";
    await writeFile(sourcePath, initialContent, "utf8");
    const generateId = vi
      .fn<() => string>()
      .mockReturnValueOnce("store-uuid")
      .mockReturnValueOnce("default-ckb-uuid")
      .mockReturnValueOnce("source-uuid")
      .mockReturnValueOnce("version-1-uuid")
      .mockReturnValueOnce("version-2-uuid");
    const now = vi.fn(() => createdAt);
    const ingestFile = vi.fn((...args: Parameters<typeof ingestFileImplementation>) =>
      ingestFileImplementation(...args),
    );
    const service = createCandidateKnowledgeStoreService({ generateId, now, ingestFile });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath,
    });

    const beforeRefresh = await openCandidateKnowledgeStore(storeRoot);
    const beforeBinding = await beforeRefresh.getCandidateKnowledgeSourceOriginBinding(
      "default-ckb-uuid",
      "source-uuid",
    );
    await beforeRefresh.close();

    await writeFile(sourcePath, changedContent, "utf8");
    now.mockReturnValue(changedAt);
    generateId.mockClear();
    now.mockClear();
    ingestFile.mockClear();

    const refreshed = await service.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(refreshed).toEqual({
      sourceId: "source-uuid",
      checkedAt: changedAt,
      status: "refreshed",
      versionId: "version-2-uuid",
    });
    expect(Object.isFrozen(refreshed)).toBe(true);
    expect(generateId).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalledOnce();
    expect(ingestFile).toHaveBeenCalledWith(
      { path: sourcePath },
      { maxSourceBytes: maximumManagedCandidateKnowledgeFileBytes },
    );
    const afterRefresh = await openCandidateKnowledgeStore(storeRoot);
    try {
      const manifest = await service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      });
      expect(manifest[0]?.versions).toHaveLength(2);
      expect(manifest[0]?.versions[0]).toMatchObject({ id: "version-1-uuid", version: 1 });
      expect(manifest[0]?.versions[0]).not.toHaveProperty("parentVersionId");
      expect(manifest[0]?.versions[1]).toMatchObject({
        id: "version-2-uuid",
        version: 2,
        parentVersionId: "version-1-uuid",
      });
      await expect(
        afterRefresh.getCandidateKnowledgeSourceOriginBinding("default-ckb-uuid", "source-uuid"),
      ).resolves.toEqual(beforeBinding);
    } finally {
      await afterRefresh.close();
    }

    generateId.mockClear();
    now.mockClear();
    const current = await service.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(current).toEqual({ sourceId: "source-uuid", checkedAt: changedAt, status: "current" });
    expect(generateId).not.toHaveBeenCalled();
    expect(now).toHaveBeenCalledOnce();
    const refreshState = await service.getKnowledgeSourceRefreshState({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(refreshState).toEqual({
      sourceId: "source-uuid",
      status: "current",
      checkedAt: changedAt,
      observedVersionId: "version-2-uuid",
      lastRefreshedAt: changedAt,
      lastRefreshedVersionId: "version-2-uuid",
    });
    expect(Object.isFrozen(refreshState)).toBe(true);
    expect(JSON.stringify(refreshState)).not.toContain(sourcePath);
    expect(JSON.stringify(refreshState)).not.toContain(temporaryParent);
    const serialized = JSON.stringify(refreshed);
    const observedChecksum = (
      await service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      })
    )[0]?.versions[1]?.checksum;
    expect(observedChecksum).toMatch(/^[0-9a-f]{64}$/u);
    const checksumToCheck = observedChecksum as string;
    for (const secret of [
      sourcePath,
      temporaryParent,
      checksumToCheck,
      "text/markdown",
      String(Buffer.byteLength(changedContent)),
      "candidate.md",
      changedContent,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(refreshed)).toEqual(["sourceId", "checkedAt", "status", "versionId"]);
  });

  it("does not append or generate an id for non-refreshed origin states", async () => {
    const originPath = "/private/candidate/origin.md";
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Candidate source",
      createdAt,
    };
    const latestVersion = {
      id: "version-1-uuid",
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
      mediaType: "text/plain",
      checksum,
      sizeBytes: 12,
      createdAt,
    };
    const readable = async () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    const cases = [
      { name: "current", expected: "current" as const, binding: true, lstat: readable },
      {
        name: "unbound",
        expected: "unbound" as const,
        binding: false,
        lstat: vi.fn(readable),
      },
      {
        name: "missing",
        expected: "missing" as const,
        binding: true,
        lstat: vi.fn(async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }),
      },
      {
        name: "inaccessible",
        expected: "inaccessible" as const,
        binding: true,
        lstat: vi.fn(async () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        }),
      },
      {
        name: "non-regular",
        expected: "inaccessible" as const,
        binding: true,
        lstat: vi.fn(async () => ({
          isFile: () => false,
          isSymbolicLink: () => false,
        })),
      },
      {
        name: "symbolic-link",
        expected: "inaccessible" as const,
        binding: true,
        lstat: vi.fn(async () => ({
          isFile: () => true,
          isSymbolicLink: () => true,
        })),
      },
    ];

    for (const testCase of cases) {
      const append = vi.fn(async () => {
        throw new Error(`refresh append called for ${testCase.name}`);
      });
      const upsert = vi.fn(
        async (_knowledgeBaseId: string, _sourceId: string, input: Record<string, unknown>) => ({
          sourceId: source.id,
          observedVersionId: input.observedVersionId as string,
          status: input.status as string,
          checkedAt: input.checkedAt as string,
          lastRefreshedVersionId: null,
          lastRefreshedAt: null,
          stale: false,
        }),
      );
      const generateId = vi.fn(() => "must-not-generate");
      const close = vi.fn(async () => undefined);
      const handle = {
        getCandidateKnowledgeSource: vi.fn(async () => source),
        getCandidateKnowledgeSourceOriginBinding: vi.fn(async () =>
          testCase.binding ? { sourceId: source.id, originPath, boundAt: createdAt } : undefined,
        ),
        listCandidateKnowledgeSourceVersions: vi.fn(async () => [latestVersion]),
        appendManagedCandidateKnowledgeFileVersion: append,
        upsertCandidateKnowledgeSourceRefreshObservation: upsert,
        close,
      } as unknown as CandidateKnowledgeStoreHandle;
      const service = createCandidateKnowledgeStoreService({
        generateId,
        now: () => createdAt,
        ingestFile: vi.fn(async () => successfulIngestion(originPath)),
        lstat: testCase.lstat as never,
        open: vi.fn(async () => handle),
      });

      await expect(
        service.refreshKnowledgeSourceFromOrigin({
          storeRoot: "valid",
          knowledgeBaseId: source.knowledgeBaseId,
          sourceId: source.id,
        }),
      ).resolves.toEqual({
        sourceId: source.id,
        checkedAt: createdAt,
        status: testCase.expected,
      });
      expect(upsert).toHaveBeenCalledOnce();
      expect(upsert).toHaveBeenCalledWith(source.knowledgeBaseId, source.id, {
        observedVersionId: latestVersion.id,
        status: testCase.expected,
        checkedAt: createdAt,
      });
      expect(append).not.toHaveBeenCalled();
      expect(generateId).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it("projects unobserved state and derives stale after a manual append without status mutation", async () => {
    const sourcePath = join(temporaryParent, "candidate.md");
    const manualPath = join(temporaryParent, "manual.md");
    await writeFile(sourcePath, "# Candidate evidence\n", "utf8");
    await writeFile(manualPath, "# Manually selected evidence\n", "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "source-uuid",
      "version-1-uuid",
      "version-2-uuid",
      "version-3-uuid",
    ];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath,
    });

    const unobserved = await service.getKnowledgeSourceRefreshState({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(unobserved).toEqual({ sourceId: "source-uuid", status: "unobserved" });
    expect(Object.isFrozen(unobserved)).toBe(true);
    const beforeStatus = await service.getKnowledgeSourceRefreshState({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    await service.checkKnowledgeSourceOriginStatus({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    await expect(
      service.getKnowledgeSourceRefreshState({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toEqual(beforeStatus);

    const initialRefresh = await service.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(initialRefresh).toEqual({
      sourceId: "source-uuid",
      checkedAt: createdAt,
      status: "current",
    });
    await expect(
      service.getKnowledgeSourceRefreshState({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toMatchObject({
      status: "current",
      observedVersionId: "version-1-uuid",
    });

    now = changedAt;
    await service.appendKnowledgeSourceFileVersion({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      sourcePath: manualPath,
    });
    const staleState = await service.getKnowledgeSourceRefreshState({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(staleState).toEqual({
      sourceId: "source-uuid",
      status: "stale",
      checkedAt: createdAt,
      observedVersionId: "version-1-uuid",
    });
    await service.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    const refreshedState = await service.getKnowledgeSourceRefreshState({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(refreshedState.status).toBe("current");
    expect(refreshedState.lastRefreshedVersionId).toBe("version-3-uuid");

    const reopened = await openCandidateKnowledgeStore(storeRoot);
    try {
      await expect(
        reopened.getCandidateKnowledgeSourceRefreshObservation("default-ckb-uuid", "source-uuid"),
      ).resolves.toMatchObject({
        observedVersionId: "version-3-uuid",
        status: "current",
        stale: false,
      });
    } finally {
      await reopened.close();
    }
  });

  it("refreshes from the original binding after a manual append from another path", async () => {
    const initialPath = join(temporaryParent, "initial.md");
    const manualPath = join(temporaryParent, "manual-selection.md");
    const initialContent = "# Initial evidence\n";
    const manualContent = "# Manual selection\n";
    const refreshedContent = "# Refreshed original evidence\n";
    await writeFile(initialPath, initialContent, "utf8");
    await writeFile(manualPath, manualContent, "utf8");
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "source-uuid",
      "version-1-uuid",
      "version-2-uuid",
      "version-3-uuid",
    ];
    let now = createdAt;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => now,
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath: initialPath,
    });

    now = changedAt;
    await service.appendKnowledgeSourceFileVersion({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
      sourcePath: manualPath,
    });
    await writeFile(initialPath, refreshedContent, "utf8");
    now = "2026-08-21T11:00:00.000Z";

    const refreshed = await service.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourceId: "source-uuid",
    });
    expect(refreshed).toEqual({
      sourceId: "source-uuid",
      checkedAt: "2026-08-21T11:00:00.000Z",
      status: "refreshed",
      versionId: "version-3-uuid",
    });

    const store = await openCandidateKnowledgeStore(storeRoot);
    try {
      const binding = await store.getCandidateKnowledgeSourceOriginBinding(
        "default-ckb-uuid",
        "source-uuid",
      );
      expect(binding).toEqual({
        sourceId: "source-uuid",
        originPath: initialPath,
        boundAt: createdAt,
      });
      const refreshedManagedPath = await store.getManagedCandidateKnowledgeFilePath(
        "default-ckb-uuid",
        "source-uuid",
        "version-3-uuid",
      );
      await expect(readFile(refreshedManagedPath ?? "", "utf8")).resolves.toBe(refreshedContent);
      const manifests = await service.listKnowledgeSourceManifests({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
      });
      expect(manifests[0]?.versions[2]).toMatchObject({
        id: "version-3-uuid",
        version: 3,
        parentVersionId: "version-2-uuid",
      });
    } finally {
      await store.close();
    }
  });

  it("maps a managed append race to current and propagates append failures", async () => {
    const originPath = "/private/candidate/origin.md";
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Candidate source",
      createdAt,
    };
    const latestVersion = {
      id: "version-1-uuid",
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
      mediaType: "text/plain",
      checksum,
      sizeBytes: 12,
      createdAt,
    };
    const close = vi.fn(async () => undefined);
    const appendManagedCandidateKnowledgeFileVersion = vi.fn<
      CandidateKnowledgeStoreHandle["appendManagedCandidateKnowledgeFileVersion"]
    >(async (_knowledgeBaseId, sourceId, version) => ({
      source,
      version: {
        ...version,
        sourceId,
        version: 2,
        parentVersionId: latestVersion.id,
      },
      created: false,
    }));
    const upsertCandidateKnowledgeSourceRefreshObservation = vi.fn(
      async (_knowledgeBaseId: string, _sourceId: string, input: Record<string, unknown>) => ({
        sourceId: source.id,
        observedVersionId: input.observedVersionId as string,
        status: input.status as string,
        checkedAt: input.checkedAt as string,
        lastRefreshedVersionId: null,
        lastRefreshedAt: null,
        stale: false,
      }),
    );
    const handle = {
      getCandidateKnowledgeSource: vi.fn(async () => source),
      getCandidateKnowledgeSourceOriginBinding: vi.fn(async () => ({
        sourceId: source.id,
        originPath,
        boundAt: createdAt,
      })),
      listCandidateKnowledgeSourceVersions: vi.fn(async () => [latestVersion]),
      appendManagedCandidateKnowledgeFileVersion,
      upsertCandidateKnowledgeSourceRefreshObservation,
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const generateId = vi.fn(() => "version-2-uuid");
    const now = vi.fn(() => changedAt);
    const ingestFile = vi.fn(async () =>
      successfulIngestion(originPath, { checksum: "b".repeat(64) }),
    );
    const service = createCandidateKnowledgeStoreService({
      generateId,
      now,
      ingestFile,
      lstat: vi.fn(async () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
      })) as never,
      open: vi.fn(async () => handle),
    });

    const raced = await service.refreshKnowledgeSourceFromOrigin({
      storeRoot: "valid",
      knowledgeBaseId: "ckb-1",
      sourceId: source.id,
    });
    expect(raced).toEqual({ sourceId: source.id, checkedAt: changedAt, status: "current" });
    expect(raced).not.toHaveProperty("versionId");
    expect(generateId).toHaveBeenCalledOnce();
    expect(ingestFile).toHaveBeenCalledWith(
      { path: originPath },
      { maxSourceBytes: maximumManagedCandidateKnowledgeFileBytes },
    );
    expect(appendManagedCandidateKnowledgeFileVersion).toHaveBeenCalledWith("ckb-1", source.id, {
      id: "version-2-uuid",
      sourcePath: originPath,
      mediaType: "text/plain",
      checksum: "b".repeat(64),
      sizeBytes: 12,
      createdAt: changedAt,
    });
    expect(upsertCandidateKnowledgeSourceRefreshObservation).toHaveBeenCalledOnce();
    expect(upsertCandidateKnowledgeSourceRefreshObservation).toHaveBeenCalledWith(
      "ckb-1",
      source.id,
      {
        observedVersionId: "version-2-uuid",
        status: "current",
        checkedAt: changedAt,
      },
    );

    const failure = new Error("publication failed");
    appendManagedCandidateKnowledgeFileVersion.mockRejectedValueOnce(failure);
    await expect(
      service.refreshKnowledgeSourceFromOrigin({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourceId: source.id,
      }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("fails refresh on invalid version graphs and malformed append results", async () => {
    const originPath = "/private/candidate/secret.md";
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Private source label",
      createdAt,
    };
    const latestVersion = {
      id: "version-1-uuid",
      sourceId: source.id,
      version: 1,
      parentVersionId: null,
      mediaType: "text/plain",
      checksum,
      sizeBytes: 12,
      createdAt,
    };
    type AppendResult = Awaited<
      ReturnType<CandidateKnowledgeStoreHandle["appendManagedCandidateKnowledgeFileVersion"]>
    >;

    const run = async (
      versions: readonly CandidateKnowledgeSourceVersionRecord[],
      appendResult?: AppendResult,
    ) => {
      const append = vi.fn(async () => appendResult as AppendResult);
      const upsertCandidateKnowledgeSourceRefreshObservation = vi.fn(
        async (_knowledgeBaseId: string, _sourceId: string, input: Record<string, unknown>) => ({
          sourceId: source.id,
          observedVersionId: input.observedVersionId as string,
          status: input.status as string,
          checkedAt: input.checkedAt as string,
          lastRefreshedVersionId: null,
          lastRefreshedAt: null,
          stale: false,
        }),
      );
      const close = vi.fn(async () => undefined);
      const handle = {
        getCandidateKnowledgeSource: vi.fn(async () => source),
        getCandidateKnowledgeSourceOriginBinding: vi.fn(async () => ({
          sourceId: source.id,
          originPath,
          boundAt: createdAt,
        })),
        listCandidateKnowledgeSourceVersions: vi.fn(async () => versions),
        appendManagedCandidateKnowledgeFileVersion: append,
        upsertCandidateKnowledgeSourceRefreshObservation,
        close,
      } as unknown as CandidateKnowledgeStoreHandle;
      const service = createCandidateKnowledgeStoreService({
        generateId: vi.fn(() => "version-2-uuid"),
        now: () => changedAt,
        ingestFile: vi.fn(async () =>
          successfulIngestion(originPath, { checksum: "b".repeat(64) }),
        ),
        lstat: vi.fn(async () => ({
          isFile: () => true,
          isSymbolicLink: () => false,
        })) as never,
        open: vi.fn(async () => handle),
      });
      const error = await service
        .refreshKnowledgeSourceFromOrigin({
          storeRoot: "valid",
          knowledgeBaseId: source.knowledgeBaseId,
          sourceId: source.id,
        })
        .then(
          () => undefined,
          (failure) => failure,
        );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/inconsistent/u);
      expect((error as Error).message).not.toContain(originPath);
      expect(close).toHaveBeenCalledOnce();
      return append;
    };

    const emptyAppend = await run([]);
    expect(emptyAppend).not.toHaveBeenCalled();
    const crossSourceAppend = await run([{ ...latestVersion, sourceId: "other-source-uuid" }]);
    expect(crossSourceAppend).not.toHaveBeenCalled();

    const malformedCreatedAppend = await run([latestVersion], {
      source,
      version: {
        ...latestVersion,
        id: "wrong-version-uuid",
        sourceId: source.id,
        version: 2,
        parentVersionId: latestVersion.id,
        checksum: "b".repeat(64),
        createdAt: changedAt,
      },
      created: true,
    });
    expect(malformedCreatedAppend).toHaveBeenCalledOnce();

    const malformedNoopAppend = await run([latestVersion], {
      source,
      version: {
        ...latestVersion,
        sourceId: source.id,
        checksum: "b".repeat(64),
        createdAt: changedAt,
      },
      created: false,
    });
    expect(malformedNoopAppend).toHaveBeenCalledOnce();
  });

  it("reports inaccessible and non-regular bound origins without exposing local paths", async () => {
    const sourcePath = join(temporaryParent, "candidate.md");
    await writeFile(sourcePath, "# Candidate evidence\n", "utf8");
    const base = createCandidateKnowledgeStoreService({
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce("store-uuid")
        .mockReturnValueOnce("default-ckb-uuid")
        .mockReturnValueOnce("source-uuid")
        .mockReturnValueOnce("version-uuid"),
      now: () => createdAt,
    });
    await base.initializeStore({ storeRoot });
    await base.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      sourcePath,
    });

    const permissionDenied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const inaccessibleLstat = vi.fn(async () => {
      throw permissionDenied;
    });
    const inaccessibleService = createCandidateKnowledgeStoreService({
      now: () => createdAt,
      lstat: inaccessibleLstat as never,
    });
    await expect(
      inaccessibleService.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toMatchObject({ sourceId: "source-uuid", status: "inaccessible" });

    const nonRegularLstat = vi.fn(async () => ({
      isFile: () => false,
      isSymbolicLink: () => false,
    }));
    const nonRegularService = createCandidateKnowledgeStoreService({
      now: () => createdAt,
      lstat: nonRegularLstat as never,
    });
    await expect(
      nonRegularService.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      }),
    ).resolves.toMatchObject({ sourceId: "source-uuid", status: "inaccessible" });
    expect(
      JSON.stringify(
        await nonRegularService.checkKnowledgeSourceOriginStatus({
          storeRoot,
          knowledgeBaseId: "default-ckb-uuid",
          sourceId: "source-uuid",
        }),
      ),
    ).not.toContain(sourcePath);
  });

  it.skipIf(process.platform === "win32")(
    "reports a substituted symbolic-link origin as inaccessible without following its target",
    async () => {
      const sourcePath = join(temporaryParent, "candidate.md");
      const targetPath = join(temporaryParent, "private-target.md");
      const targetContent = "target content must never be read";
      await writeFile(sourcePath, "# Candidate evidence\n", "utf8");
      await writeFile(targetPath, targetContent, "utf8");
      const generateId = vi
        .fn<() => string>()
        .mockReturnValueOnce("store-uuid")
        .mockReturnValueOnce("default-ckb-uuid")
        .mockReturnValueOnce("source-uuid")
        .mockReturnValueOnce("version-uuid");
      const service = createCandidateKnowledgeStoreService({
        generateId,
        now: () => createdAt,
      });
      await service.initializeStore({ storeRoot });
      await service.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourcePath,
      });

      await rm(sourcePath);
      await symlink(targetPath, sourcePath, "file");

      const result = await service.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      });
      expect(result).toEqual({
        sourceId: "source-uuid",
        checkedAt: createdAt,
        status: "inaccessible",
      });
      expect(JSON.stringify(result)).not.toContain(targetPath);
      expect(JSON.stringify(result)).not.toContain(targetContent);
      await expect(readFile(targetPath, "utf8")).resolves.toBe(targetContent);

      generateId.mockClear();
      const refreshed = await service.refreshKnowledgeSourceFromOrigin({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "source-uuid",
      });
      expect(refreshed).toEqual({
        sourceId: "source-uuid",
        checkedAt: createdAt,
        status: "inaccessible",
      });
      expect(generateId).not.toHaveBeenCalled();
      expect(
        await service.listKnowledgeSourceManifests({
          storeRoot,
          knowledgeBaseId: "default-ckb-uuid",
        }),
      ).toHaveLength(1);
    },
  );

  it("does not inspect an unbound source and rejects sources outside the requested CKB", async () => {
    const ids = [
      "store-uuid",
      "default-ckb-uuid",
      "other-ckb-uuid",
      "unbound-source-uuid",
      "unbound-version-uuid",
      "other-source-uuid",
      "other-version-uuid",
    ];
    const lstat = vi.fn();
    const ingestFile = vi.fn();
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
      lstat: lstat as never,
      ingestFile: ingestFile as never,
    });
    await service.initializeStore({ storeRoot });
    await service.createKnowledgeBase({ storeRoot, displayName: "Other evidence" });
    await service.createKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "default-ckb-uuid",
      kind: "file",
      displayName: "Metadata only",
      mediaType: "text/plain",
      checksum,
      sizeBytes: 12,
    });
    const otherSource = await service.createKnowledgeSource({
      storeRoot,
      knowledgeBaseId: "other-ckb-uuid",
      kind: "file",
      displayName: "Other source",
      mediaType: "text/plain",
      checksum,
      sizeBytes: 12,
    });

    await expect(
      service.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "unbound-source-uuid",
      }),
    ).resolves.toMatchObject({ status: "unbound" });
    expect(lstat).not.toHaveBeenCalled();
    expect(ingestFile).not.toHaveBeenCalled();
    await expect(
      service.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: otherSource.source.id,
      }),
    ).rejects.toThrow(/not found in candidate knowledge base default-ckb-uuid/i);
    await expect(
      service.checkKnowledgeSourceOriginStatus({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "missing-source",
      }),
    ).rejects.toThrow(/not found in candidate knowledge base default-ckb-uuid/i);
    await expect(
      service.refreshKnowledgeSourceFromOrigin({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: otherSource.source.id,
      }),
    ).rejects.toThrow(/not found in candidate knowledge base default-ckb-uuid/i);
    await expect(
      service.refreshKnowledgeSourceFromOrigin({
        storeRoot,
        knowledgeBaseId: "default-ckb-uuid",
        sourceId: "missing-source",
      }),
    ).rejects.toThrow(/not found in candidate knowledge base default-ckb-uuid/i);
  });

  it("uses the managed-file bound and compares only the latest recorded version", async () => {
    const originPath = "/private/candidate/secret.md";
    const close = vi.fn(async () => undefined);
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Candidate source",
      createdAt,
    };
    const ingestFile = vi.fn(async () => successfulIngestion(originPath));
    const handle = {
      getCandidateKnowledgeSource: vi.fn(async () => source),
      getCandidateKnowledgeSourceOriginBinding: vi.fn(async () => ({
        sourceId: source.id,
        originPath,
        boundAt: createdAt,
      })),
      listCandidateKnowledgeSourceVersions: vi.fn(async () => [
        {
          id: "version-2-uuid",
          sourceId: source.id,
          version: 2,
          parentVersionId: "version-1-uuid",
          mediaType: "text/plain",
          checksum,
          sizeBytes: 12,
          createdAt,
        },
        {
          id: "version-1-uuid",
          sourceId: source.id,
          version: 1,
          parentVersionId: null,
          mediaType: "text/markdown",
          checksum: "b".repeat(64),
          sizeBytes: 1,
          createdAt,
        },
      ]),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      now: () => createdAt,
      ingestFile,
      lstat: vi.fn(async () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
      })) as never,
      open: vi.fn(async () => handle),
    });

    await expect(
      service.checkKnowledgeSourceOriginStatus({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourceId: source.id,
      }),
    ).resolves.toEqual({ sourceId: source.id, checkedAt: createdAt, status: "current" });
    expect(ingestFile).toHaveBeenCalledWith(
      { path: originPath },
      { maxSourceBytes: maximumManagedCandidateKnowledgeFileBytes },
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns portable local metadata without its host root and omits null archive dates", async () => {
    const service = createCandidateKnowledgeStoreService({
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce("store-uuid")
        .mockReturnValueOnce("default-ckb-uuid"),
      now: () => createdAt,
    });

    const view = await service.initializeStore({ storeRoot });
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain(storeRoot);
    expect(serialized).not.toContain("root");
    expect(serialized).not.toContain("path");
    expect(view.knowledgeBases[0]).not.toHaveProperty("archivedAt");
  });

  it("rejects an invalid managed-file inventory root before opening storage", async () => {
    const open = vi.fn();
    const service = createCandidateKnowledgeStoreService({ open: open as never });

    await expect(service.inspectManagedCandidateKnowledgeFiles({ storeRoot: " " })).rejects.toThrow(
      /root is required/i,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("returns a deeply frozen pathless managed-file inventory projection", async () => {
    const close = vi.fn(async () => undefined);
    const inspectManagedCandidateKnowledgeFiles = vi.fn(async () => ({
      schemaVersion: 1 as const,
      verifiedManagedFileCount: 3,
      scannedEntryCount: 11,
      unknownEntries: {
        intakeShapedFilesAtSourcesRoot: 1,
        opaqueEntriesAtSourcesRoot: 2,
        entriesInsideManagedSourceDirectories: 3,
        symbolicLinks: 1,
        otherEntries: 1,
        path: "/private/nested",
        label: "secret",
      },
      complete: false,
      scanLimitReached: true,
      root: "/private/store",
      filename: "secret-resume.txt",
      id: "source-secret",
      checksum,
      content: "private candidate material",
      cleanupToken: "cleanup-secret",
      orphan: true,
    }));
    const handle = {
      inspectManagedCandidateKnowledgeFiles,
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const open = vi.fn(async () => handle);
    const service = createCandidateKnowledgeStoreService({ open });

    const inventory = await service.inspectManagedCandidateKnowledgeFiles({ storeRoot: "valid" });

    expect(inventory).toEqual({
      schemaVersion: 1,
      verifiedManagedFileCount: 3,
      scannedEntryCount: 11,
      unknownEntries: {
        intakeShapedFilesAtSourcesRoot: 1,
        opaqueEntriesAtSourcesRoot: 2,
        entriesInsideManagedSourceDirectories: 3,
        symbolicLinks: 1,
        otherEntries: 1,
      },
      complete: false,
      scanLimitReached: true,
    });
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(Object.isFrozen(inventory.unknownEntries)).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("valid");
    expect(inspectManagedCandidateKnowledgeFiles).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves a managed-file inventory failure after attempting to close", async () => {
    const failure = new Error("inventory failed");
    const close = vi.fn(async () => {
      throw new Error("close failed");
    });
    const handle = {
      inspectManagedCandidateKnowledgeFiles: vi.fn(async () => {
        throw failure;
      }),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      open: vi.fn(async () => handle),
    });

    await expect(
      service.inspectManagedCandidateKnowledgeFiles({ storeRoot: "valid" }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects invalid roots, ids, and names before a storage adapter is called", async () => {
    const initialize = vi.fn();
    const open = vi.fn();
    const ingestFile = vi.fn();
    const service = createCandidateKnowledgeStoreService({
      initialize: initialize as never,
      open: open as never,
      ingestFile: ingestFile as never,
    });

    await expect(service.initializeStore({ storeRoot: " " })).rejects.toThrow(/root is required/i);
    await expect(service.openStore({ storeRoot: "" })).rejects.toThrow(/root is required/i);
    await expect(
      service.createKnowledgeBase({ storeRoot: "valid", displayName: " " }),
    ).rejects.toThrow(/display name is required/i);
    await expect(
      service.renameKnowledgeBase({
        storeRoot: "valid",
        knowledgeBaseId: " ",
        displayName: "Valid",
      }),
    ).rejects.toThrow(/id is required/i);
    await expect(
      service.archiveKnowledgeBase({ storeRoot: "valid", knowledgeBaseId: " " }),
    ).rejects.toThrow(/id is required/i);
    await expect(
      service.createKnowledgeSource({
        storeRoot: "valid",
        knowledgeBaseId: " ",
        kind: "file",
        displayName: "CV",
        mediaType: "text/plain",
        checksum,
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/id is required/i);
    await expect(
      service.createKnowledgeSource({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        kind: "directory" as never,
        displayName: "CV",
        mediaType: "text/plain",
        checksum,
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/kind must be one of/i);
    await expect(
      service.createKnowledgeSource({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        kind: "file",
        displayName: " ",
        mediaType: "text/plain",
        checksum,
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/display name is required/i);
    await expect(
      service.createKnowledgeSource({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        kind: "file",
        displayName: "CV",
        mediaType: " ",
        checksum,
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/media type is required/i);
    await expect(
      service.appendKnowledgeSourceVersion({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourceId: "source-1",
        mediaType: "text/plain",
        checksum: `sha256:${checksum}`,
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/SHA-256/i);
    await expect(
      service.appendKnowledgeSourceVersion({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourceId: "source-1",
        mediaType: "text/plain",
        checksum,
        sizeBytes: -1,
      }),
    ).rejects.toThrow(/nonnegative integer/i);
    await expect(
      service.listKnowledgeSourceManifests({ storeRoot: "valid", knowledgeBaseId: " " }),
    ).rejects.toThrow(/id is required/i);
    await expect(
      service.importKnowledgeSourceFile({
        storeRoot: " ",
        knowledgeBaseId: "ckb-1",
        sourcePath: "/private/resume.md",
      }),
    ).rejects.toThrow(/root is required/i);
    await expect(
      service.importKnowledgeSourceFile({
        storeRoot: "valid",
        knowledgeBaseId: " ",
        sourcePath: "/private/resume.md",
      }),
    ).rejects.toThrow(/id is required/i);
    await expect(
      service.importKnowledgeSourceFile({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourcePath: " ",
      }),
    ).rejects.toThrow(/path is required/i);
    await expect(
      service.importKnowledgeSourceFile({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourcePath: "/private/resume.md",
        displayName: "x".repeat(201),
      }),
    ).rejects.toThrow(/at most 200 characters/i);
    for (const displayName of [
      "unsafe/name",
      "unsafe\\name",
      "unsafe\u0000name",
      "unsafe\u202ename",
    ]) {
      await expect(
        service.importKnowledgeSourceFile({
          storeRoot: "valid",
          knowledgeBaseId: "ckb-1",
          sourcePath: "/private/resume.md",
          displayName,
        }),
      ).rejects.toThrow(/display name/i);
    }
    await expect(
      service.appendKnowledgeSourceFileVersion({
        storeRoot: " ",
        knowledgeBaseId: "ckb-1",
        sourceId: "source-1",
        sourcePath: "/private/resume.md",
      }),
    ).rejects.toThrow(/root is required/i);
    await expect(
      service.appendKnowledgeSourceFileVersion({
        storeRoot: "valid",
        knowledgeBaseId: " ",
        sourceId: "source-1",
        sourcePath: "/private/resume.md",
      }),
    ).rejects.toThrow(/knowledge base id is required/i);
    await expect(
      service.appendKnowledgeSourceFileVersion({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourceId: " ",
        sourcePath: "/private/resume.md",
      }),
    ).rejects.toThrow(/source id is required/i);
    await expect(
      service.appendKnowledgeSourceFileVersion({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourceId: "source-1",
        sourcePath: " ",
      }),
    ).rejects.toThrow(/path is required/i);

    expect(initialize).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(ingestFile).not.toHaveBeenCalled();
  });

  it("fails generically before storage when extraction does not produce a usable source", async () => {
    const sourcePath = "/private/candidate/secret-resume.txt";
    const issue = {
      code: "read-failure" as const,
      sourcePath,
      message: `could not read ${sourcePath}`,
      recoverable: true,
    };
    const successful = successfulIngestion(sourcePath);
    if (successful.source === null) throw new Error("Test setup requires a normalized source.");
    const unusableResults: readonly IngestionResult[] = [
      { source: null, issues: [issue] },
      { ...successful, issues: [issue] },
      {
        ...successful,
        source: { ...successful.source, chunks: [] },
      },
      {
        ...successful,
        source: { ...successful.source, issues: [issue] },
      },
    ];

    for (const result of unusableResults) {
      const open = vi.fn();
      const generateId = vi.fn(() => "unused-id");
      const service = createCandidateKnowledgeStoreService({
        generateId,
        open: open as never,
        ingestFile: vi.fn(async () => result),
      });

      const error = await service
        .importKnowledgeSourceFile({
          storeRoot: "valid",
          knowledgeBaseId: "ckb-1",
          sourcePath,
        })
        .then(
          () => undefined,
          (failure: unknown) => failure,
        );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(importFailureMessage);
      expect((error as Error).message).not.toContain(sourcePath);
      expect(open).not.toHaveBeenCalled();
      expect(generateId).not.toHaveBeenCalled();
    }
  });

  it("normalizes thrown ingestion failures without exposing their path", async () => {
    const sourcePath = "/private/candidate/secret-resume.txt";
    const open = vi.fn();
    const service = createCandidateKnowledgeStoreService({
      open: open as never,
      ingestFile: vi.fn(async () => {
        throw new Error(`failed to read ${sourcePath}`);
      }),
    });

    const error = await service
      .importKnowledgeSourceFile({ storeRoot: "valid", knowledgeBaseId: "ckb-1", sourcePath })
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );
    expect((error as Error).message).toBe(importFailureMessage);
    expect((error as Error).message).not.toContain(sourcePath);
    expect(open).not.toHaveBeenCalled();
  });

  it("fails a managed append generically before storage or identity generation for unusable ingestion", async () => {
    const sourcePath = "/private/candidate/secret-version.txt";
    const issue = {
      code: "read-failure" as const,
      sourcePath,
      message: `could not read ${sourcePath}`,
      recoverable: true,
    };
    const successful = successfulIngestion(sourcePath);
    if (successful.source === null) throw new Error("Test setup requires a normalized source.");
    const normalizedSource = successful.source;
    const failures: readonly (() => Promise<IngestionResult>)[] = [
      async () => ({ source: null, issues: [issue] }),
      async () => ({ ...successful, issues: [issue] }),
      async () => ({ ...successful, source: { ...normalizedSource, issues: [issue] } }),
      async () => ({ ...successful, source: { ...normalizedSource, chunks: [] } }),
      async () => {
        throw new Error(`failed to read ${sourcePath}`);
      },
    ];

    for (const ingestFile of failures) {
      const open = vi.fn();
      const generateId = vi.fn(() => "unused-id");
      const service = createCandidateKnowledgeStoreService({
        generateId,
        open: open as never,
        ingestFile,
      });
      const error = await service
        .appendKnowledgeSourceFileVersion({
          storeRoot: "valid",
          knowledgeBaseId: "ckb-1",
          sourceId: "source-1",
          sourcePath,
        })
        .then(
          () => undefined,
          (failure: unknown) => failure,
        );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(appendFailureMessage);
      expect((error as Error).message).not.toContain(sourcePath);
      expect(open).not.toHaveBeenCalled();
      expect(generateId).not.toHaveBeenCalled();
    }
  });

  it("normalizes a validated import before opening storage", async () => {
    const sourcePath = "/private/candidate/resume.txt";
    const ingestion = successfulIngestion(sourcePath);
    const ingestFile = vi.fn(async () => ingestion);
    const close = vi.fn(async () => undefined);
    const createManagedCandidateKnowledgeFileSource = vi.fn<
      CandidateKnowledgeStoreHandle["createManagedCandidateKnowledgeFileSource"]
    >(async (source, version) => ({
      source,
      version: { ...version, sourceId: source.id, version: 1, parentVersionId: null },
      created: true,
    }));
    const handle = {
      createManagedCandidateKnowledgeFileSource,
      listCandidateKnowledgeSourceVersions: vi.fn(
        async (_knowledgeBaseId: string, sourceId: string) => [
          {
            id: "version-uuid",
            sourceId,
            version: 1,
            parentVersionId: null,
            mediaType: "text/plain",
            checksum,
            sizeBytes: 12,
            createdAt,
          },
        ],
      ),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const open = vi.fn(async () => handle);
    const ids = ["source-uuid", "version-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
      ingestFile,
      open,
    });

    const result = await service.importKnowledgeSourceFile({
      storeRoot: " valid ",
      knowledgeBaseId: " ckb-1 ",
      sourcePath,
      displayName: "  Candidate CV  ",
    });

    expect(ingestFile).toHaveBeenCalledWith(
      { path: sourcePath },
      { maxSourceBytes: maximumManagedCandidateKnowledgeFileBytes },
    );
    expect(open).toHaveBeenCalledWith(" valid ");
    expect(createManagedCandidateKnowledgeFileSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "source-uuid",
        knowledgeBaseId: "ckb-1",
        kind: "file",
        displayName: "Candidate CV",
        createdAt,
      }),
      {
        id: "version-uuid",
        sourcePath,
        mediaType: "text/plain",
        checksum,
        sizeBytes: 12,
        createdAt,
      },
    );
    expect(result.source).not.toHaveProperty("path");
    expect(result.versions[0]).not.toHaveProperty("sourcePath");
    expect(close).toHaveBeenCalledOnce();
  });

  it("passes the exact managed-file gate and normalized metadata to a managed append", async () => {
    const sourcePath = "/private/candidate/AGENTS.md";
    const nextChecksum = "b".repeat(64);
    const ingestion = successfulIngestion(sourcePath, {
      checksum: nextChecksum,
      mediaType: "text/markdown",
      sizeBytes: maximumManagedCandidateKnowledgeFileBytes,
    });
    const ingestFile = vi.fn(async () => ingestion);
    const close = vi.fn(async () => undefined);
    const source = {
      id: "source-uuid",
      knowledgeBaseId: "ckb-1",
      kind: "file" as const,
      displayName: "Existing career notes",
      createdAt,
    };
    const appendManagedCandidateKnowledgeFileVersion = vi.fn<
      CandidateKnowledgeStoreHandle["appendManagedCandidateKnowledgeFileVersion"]
    >(async (_knowledgeBaseId, sourceId, version) => ({
      source,
      version: { ...version, sourceId, version: 2, parentVersionId: "version-1-uuid" },
      created: true,
    }));
    const handle = {
      appendManagedCandidateKnowledgeFileVersion,
      listCandidateKnowledgeSourceVersions: vi.fn(async () => [
        {
          id: "version-1-uuid",
          sourceId: "source-uuid",
          version: 1,
          parentVersionId: null,
          mediaType: "text/markdown",
          checksum,
          sizeBytes: 12,
          createdAt,
        },
        {
          id: "version-2-uuid",
          sourceId: "source-uuid",
          version: 2,
          parentVersionId: "version-1-uuid",
          mediaType: "text/markdown",
          checksum: nextChecksum,
          sizeBytes: maximumManagedCandidateKnowledgeFileBytes,
          createdAt: changedAt,
        },
      ]),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const open = vi.fn(async () => handle);
    const service = createCandidateKnowledgeStoreService({
      generateId: () => "version-2-uuid",
      now: () => changedAt,
      ingestFile,
      open,
    });

    const result = await service.appendKnowledgeSourceFileVersion({
      storeRoot: " valid ",
      knowledgeBaseId: " ckb-1 ",
      sourceId: " source-uuid ",
      sourcePath,
    });

    expect(ingestFile).toHaveBeenCalledWith(
      { path: sourcePath },
      { maxSourceBytes: 20 * 1024 * 1024 },
    );
    expect(open).toHaveBeenCalledWith(" valid ");
    expect(appendManagedCandidateKnowledgeFileVersion).toHaveBeenCalledWith(
      "ckb-1",
      "source-uuid",
      {
        id: "version-2-uuid",
        sourcePath,
        mediaType: "text/markdown",
        checksum: nextChecksum,
        sizeBytes: 20 * 1024 * 1024,
        createdAt: changedAt,
      },
    );
    expect(result.source.displayName).toBe("Existing career notes");
    expect(JSON.stringify(result)).not.toContain(sourcePath);
    expect(result.versions).toHaveLength(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects managed appends to the wrong CKB, missing and URL sources, and archived CKBs", async () => {
    let sequence = 0;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => `generated-${++sequence}`,
      now: () => createdAt,
    });
    const initialized = await service.initializeStore({ storeRoot });
    const defaultKnowledgeBaseId = initialized.knowledgeBases[0]?.id ?? "missing-default";
    const withOther = await service.createKnowledgeBase({ storeRoot, displayName: "Other" });
    const otherKnowledgeBaseId =
      withOther.knowledgeBases.find((knowledgeBase) => !knowledgeBase.isDefault)?.id ??
      "missing-other";
    const sourcePath = join(temporaryParent, "candidate.md");
    await writeFile(sourcePath, "# Candidate evidence\n", "utf8");
    const imported = await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: otherKnowledgeBaseId,
      sourcePath,
    });
    const urlSource = await service.createKnowledgeSource({
      storeRoot,
      knowledgeBaseId: otherKnowledgeBaseId,
      kind: "url",
      displayName: "Public profile",
      mediaType: "text/html",
      checksum,
      sizeBytes: 12,
    });
    const append = (knowledgeBaseId: string, sourceId: string) =>
      service.appendKnowledgeSourceFileVersion({
        storeRoot,
        knowledgeBaseId,
        sourceId,
        sourcePath,
      });

    await expect(append(defaultKnowledgeBaseId, imported.source.id)).rejects.toThrow();
    await expect(append(otherKnowledgeBaseId, "missing-source")).rejects.toThrow();
    await expect(append(otherKnowledgeBaseId, urlSource.source.id)).rejects.toThrow(/file source/i);

    await service.archiveKnowledgeBase({ storeRoot, knowledgeBaseId: otherKnowledgeBaseId });
    await expect(append(otherKnowledgeBaseId, imported.source.id)).rejects.toThrow(/archived/i);
  });

  it("closes an acquired handle when managed source registration fails", async () => {
    const sourcePath = "/private/candidate/resume.txt";
    const failure = new Error("managed source registration failed");
    const close = vi.fn(async () => undefined);
    const handle = {
      createManagedCandidateKnowledgeFileSource: vi.fn(async () => {
        throw failure;
      }),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const ids = ["source-uuid", "version-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
      ingestFile: vi.fn(async () => successfulIngestion(sourcePath)),
      open: vi.fn(async () => handle),
    });

    await expect(
      service.importKnowledgeSourceFile({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourcePath,
      }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes an acquired handle when a managed append fails", async () => {
    const sourcePath = "/private/candidate/resume.txt";
    const failure = new Error("managed append failed");
    const close = vi.fn(async () => undefined);
    const handle = {
      appendManagedCandidateKnowledgeFileVersion: vi.fn(async () => {
        throw failure;
      }),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      generateId: () => "version-uuid",
      now: () => createdAt,
      ingestFile: vi.fn(async () => successfulIngestion(sourcePath)),
      open: vi.fn(async () => handle),
    });

    await expect(
      service.appendKnowledgeSourceFileVersion({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        sourceId: "source-uuid",
        sourcePath,
      }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes an acquired handle when an operation fails", async () => {
    const failure = new Error("list failed");
    const close = vi.fn(async () => undefined);
    const handle = {
      descriptor: { schemaVersion: 1, id: "store-uuid", createdAt },
      root: "/not-exposed",
      listCandidateKnowledgeBases: vi.fn(async () => {
        throw failure;
      }),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const service = createCandidateKnowledgeStoreService({
      open: vi.fn(async () => handle),
    });

    await expect(service.openStore({ storeRoot: "valid" })).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes an acquired handle when source registration fails", async () => {
    const failure = new Error("source registration failed");
    const close = vi.fn(async () => undefined);
    const handle = {
      createCandidateKnowledgeSource: vi.fn(async () => {
        throw failure;
      }),
      close,
    } as unknown as CandidateKnowledgeStoreHandle;
    const ids = ["source-uuid", "version-uuid"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => createdAt,
      open: vi.fn(async () => handle),
    });

    await expect(
      service.createKnowledgeSource({
        storeRoot: "valid",
        knowledgeBaseId: "ckb-1",
        kind: "file",
        displayName: "CV",
        mediaType: "text/plain",
        checksum,
        sizeBytes: 12,
      }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("propagates initialization conflicts without overwriting an existing store", async () => {
    const first = createCandidateKnowledgeStoreService({
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce("store-uuid")
        .mockReturnValueOnce("default-ckb-uuid"),
      now: () => createdAt,
    });
    await first.initializeStore({ storeRoot });

    const second = createCandidateKnowledgeStoreService({
      generateId: () => "replacement-uuid",
      now: () => changedAt,
    });
    await expect(second.initializeStore({ storeRoot })).rejects.toThrow(/already exists/i);

    await expect(first.openStore({ storeRoot })).resolves.toMatchObject({
      store: { id: "store-uuid", createdAt },
      knowledgeBases: [{ id: "default-ckb-uuid" }],
    });
  });
});
