import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { IngestionResult } from "@draft-loop/ingestion";
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

function successfulIngestion(sourcePath: string): IngestionResult {
  return {
    source: {
      source: { path: sourcePath },
      mediaType: "text/plain",
      checksum,
      sizeBytes: 12,
      text: "Safe content",
      chunks: [
        {
          id: "chunk-1",
          sourcePath,
          mediaType: "text/plain",
          checksum,
          locator: { lineStart: 1, lineEnd: 1 },
          text: "Safe content",
        },
      ],
      issues: [],
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
    expect(databaseBytes.includes(Buffer.from(sourcePath, "utf8"))).toBe(false);

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
    } finally {
      await store.close();
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
