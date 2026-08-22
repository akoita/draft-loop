import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  type IngestionResult,
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
const appendFailureMessage =
  "The selected candidate knowledge source file could not be added as a new version.";

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
      const generateId = vi.fn(() => "must-not-generate");
      const close = vi.fn(async () => undefined);
      const handle = {
        getCandidateKnowledgeSource: vi.fn(async () => source),
        getCandidateKnowledgeSourceOriginBinding: vi.fn(async () =>
          testCase.binding ? { sourceId: source.id, originPath, boundAt: createdAt } : undefined,
        ),
        listCandidateKnowledgeSourceVersions: vi.fn(async () => [latestVersion]),
        appendManagedCandidateKnowledgeFileVersion: append,
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
      expect(append).not.toHaveBeenCalled();
      expect(generateId).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
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
    const handle = {
      getCandidateKnowledgeSource: vi.fn(async () => source),
      getCandidateKnowledgeSourceOriginBinding: vi.fn(async () => ({
        sourceId: source.id,
        originPath,
        boundAt: createdAt,
      })),
      listCandidateKnowledgeSourceVersions: vi.fn(async () => [latestVersion]),
      appendManagedCandidateKnowledgeFileVersion,
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
