import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  candidateKnowledgeRetentionClasses,
  openSqliteStorage,
  StorageConflictError,
  StorageValidationError,
} from "./index.js";
import {
  initializeCandidateKnowledgeStore,
  type ManagedCandidateKnowledgeFileVersionInput,
  type ManagedCandidateKnowledgeUrlVersionInput,
  type MoveManagedCandidateKnowledgeDirectoryMemberInput,
  maximumManagedCandidateKnowledgeFileBytes,
  maximumManagedCandidateKnowledgeInventoryEntries,
  openCandidateKnowledgeStore,
  type RebindManagedCandidateKnowledgeDirectoryRootInput,
} from "./knowledge-store.js";
import { StorageWriterLeaseConflictError, StorageWriterLeaseLostError } from "./writer-lease.js";

const createdAt = "2026-08-21T14:00:00.000Z";
const cleanupRoots: string[] = [];
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

interface MutableSqliteDatabase {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => {
    readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
    readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
  };
  readonly close: () => void;
}

const Database = require("better-sqlite3") as new (path: string) => MutableSqliteDatabase;

async function temporaryParent(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-store-"));
  cleanupRoots.push(path);
  return path;
}

function initialization(root: string) {
  return {
    root,
    descriptor: {
      schemaVersion: 1 as const,
      id: "knowledge-store-1",
      createdAt,
    },
    defaultKnowledgeBase: {
      id: "ckb-default",
      displayName: "Career evidence",
      description: "Sanitized test knowledge",
      createdAt,
    },
  };
}

function mutateDatabase(root: string, sql: string): void {
  const database = new Database(join(root, ".draft-loop", "knowledge.sqlite"));
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

function queryDatabase(
  root: string,
  sql: string,
  ...parameters: readonly unknown[]
): readonly Record<string, unknown>[] {
  const database = new Database(join(root, ".draft-loop", "knowledge.sqlite"));
  try {
    return database.prepare(sql).all(...parameters);
  } finally {
    database.close();
  }
}

async function snapshotSourcesTree(root: string): Promise<readonly string[]> {
  const entries: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        entries.push(`${relativePath}/`);
        await visit(path, `${relativePath}/`);
      } else if (entry.isFile()) {
        entries.push(`${relativePath}:${sha256(await readFile(path))}`);
      } else if (entry.isSymbolicLink()) {
        entries.push(`${relativePath}:symlink`);
      } else {
        entries.push(`${relativePath}:other`);
      }
    }
  };
  await visit(join(root, "sources"), "");
  return entries.sort();
}

function sha256(content: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function managedVersion(
  sourcePath: string,
  content: string | Buffer,
  overrides: Partial<ManagedCandidateKnowledgeFileVersionInput> = {},
): ManagedCandidateKnowledgeFileVersionInput {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    sourcePath,
    id: "managed-version-1",
    mediaType: "text/markdown",
    checksum: sha256(bytes),
    sizeBytes: bytes.byteLength,
    createdAt: "2026-08-21T14:01:00.000Z",
    ...overrides,
  };
}

function managedUrlVersion(
  responseBytes: Uint8Array,
  overrides: Partial<ManagedCandidateKnowledgeUrlVersionInput> = {},
): ManagedCandidateKnowledgeUrlVersionInput {
  return {
    id: "managed-url-version-1",
    mediaType: "text/plain",
    checksum: sha256(responseBytes),
    sizeBytes: responseBytes.byteLength,
    createdAt: "2026-08-21T14:01:00.000Z",
    responseBytes,
    provenance: {
      originalUrl: "https://example.com/evidence",
      finalUrl: "https://example.com/evidence",
      fetchedAt: "2026-08-21T14:01:00.000Z",
      kind: "generic",
    },
    ...overrides,
  };
}

function digestSegment(value: string): string {
  return createHash("sha256").update(value.trim(), "utf8").digest("hex");
}

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("portable candidate knowledge store", () => {
  it("initializes, opens, and reopens a new store with a durable default", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");

    const initialized = await initializeCandidateKnowledgeStore(initialization(root));
    expect(initialized.descriptor).toEqual(initialization(root).descriptor);
    expect(initialized.root).toBe(await realpath(root));
    await expect(initialized.listCandidateKnowledgeBases()).resolves.toMatchObject([
      { id: "ckb-default", isDefault: true, state: "active" },
    ]);
    await initialized.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(reopened.getCandidateKnowledgeBase("ckb-default")).resolves.toMatchObject({
      displayName: "Career evidence",
      isDefault: true,
    });
    await reopened.close();
  });

  it("persists additional lifecycle changes across reopen", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createCandidateKnowledgeBase({
      id: "ckb-public",
      displayName: "Public work",
      isDefault: false,
      createdAt: "2026-08-21T14:01:00.000Z",
    });
    await store.renameCandidateKnowledgeBase(
      "ckb-public",
      "Selected public work",
      "2026-08-21T14:02:00.000Z",
    );
    await store.archiveCandidateKnowledgeBase("ckb-public", "2026-08-21T14:03:00.000Z");
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(reopened.getCandidateKnowledgeBase("ckb-public")).resolves.toMatchObject({
      displayName: "Selected public work",
      state: "archived",
      archivedAt: "2026-08-21T14:03:00.000Z",
    });
    await reopened.close();
  });

  it("persists scoped source identities and immutable versions across reopen", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const first = await store.createCandidateKnowledgeSource(
      {
        id: "source-1",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Career notes.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      {
        id: "source-version-1",
        mediaType: "text/markdown",
        checksum: "a".repeat(64),
        sizeBytes: 128,
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );
    const second = await store.appendCandidateKnowledgeSourceVersion("ckb-default", "source-1", {
      id: "source-version-2",
      mediaType: "text/markdown",
      checksum: "b".repeat(64),
      sizeBytes: 256,
      createdAt: "2026-08-21T14:02:00.000Z",
    });
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(reopened.getCandidateKnowledgeSource("ckb-default", "source-1")).resolves.toEqual(
      first.source,
    );
    await expect(reopened.listCandidateKnowledgeSources("ckb-default")).resolves.toEqual([
      first.source,
    ]);
    await expect(
      reopened.listCandidateKnowledgeSourceVersions("ckb-default", "source-1"),
    ).resolves.toEqual([first.version, second.version]);
    await reopened.close();
  });

  it("projects a frozen, path-free lifecycle readiness view and keeps it stable across reopen", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "private-evidence.md");
    const content = "Local evidence only.";
    await writeFile(inputPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "lifecycle-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Private evidence",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, content, {
        id: "lifecycle-version",
        createdAt: "2026-08-21T14:01:00.000Z",
      }),
    );

    const readiness = await store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default");
    expect(readiness).toMatchObject({
      knowledgeBaseId: "ckb-default",
      state: "active",
      archivedAt: null,
      sources: [
        {
          sourceId: "lifecycle-source",
          latestVersionId: "lifecycle-version",
          status: "ready",
          reasons: [],
          lifecycleRevision: {
            versionId: "lifecycle-version",
            version: 1,
            managed: true,
            originBoundAt: "2026-08-21T14:01:00.000Z",
            observation: null,
            retirement: null,
            provenanceFetchedAt: null,
            directory: null,
          },
        },
      ],
    });
    expect(readiness).not.toBeUndefined();
    expect(Object.isFrozen(readiness)).toBe(true);
    expect(Object.isFrozen(readiness?.sources)).toBe(true);
    expect(Object.isFrozen(readiness?.sources[0])).toBe(true);
    expect(Object.isFrozen(readiness?.sources[0]?.lifecycleRevision)).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain(inputPath);
    expect(JSON.stringify(readiness)).not.toContain(content);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default"),
    ).resolves.toEqual(readiness);
    await reopened.close();
  });

  it("accepts stale observations and preserves an earlier successful refresh", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "stale-observation.md");
    await writeFile(inputPath, "first", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "stale-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Stale observation",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "first", {
        id: "stale-version-1",
        createdAt: "2026-08-21T14:01:00.000Z",
      }),
    );
    await store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", "stale-source", {
      observedVersionId: "stale-version-1",
      status: "current",
      checkedAt: "2026-08-21T14:01:00.000Z",
      lastRefreshedVersionId: "stale-version-1",
      lastRefreshedAt: "2026-08-21T14:01:00.000Z",
    });
    await writeFile(inputPath, "second", "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "stale-source",
      managedVersion(inputPath, "second", {
        id: "stale-version-2",
        createdAt: "2026-08-21T14:02:00.000Z",
      }),
    );
    await store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", "stale-source", {
      observedVersionId: "stale-version-1",
      status: "changed",
      checkedAt: "2026-08-21T14:03:00.000Z",
    });

    await expect(
      store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default"),
    ).resolves.toMatchObject({
      sources: [
        {
          sourceId: "stale-source",
          status: "blocked",
          reasons: ["refresh-stale", "refresh-changed"],
          lifecycleRevision: {
            versionId: "stale-version-2",
            observation: {
              observedVersionId: "stale-version-1",
              status: "changed",
              stale: true,
              lastRefreshedVersionId: "stale-version-1",
              lastRefreshedAt: "2026-08-21T14:01:00.000Z",
            },
          },
        },
      ],
    });
    await store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", "stale-source", {
      observedVersionId: "stale-version-2",
      status: "current",
      checkedAt: "2026-08-21T14:04:00.000Z",
    });
    await expect(
      store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default"),
    ).resolves.toMatchObject({
      sources: [
        {
          sourceId: "stale-source",
          status: "ready",
          reasons: [],
          lifecycleRevision: {
            versionId: "stale-version-2",
            observation: {
              observedVersionId: "stale-version-2",
              status: "current",
              stale: false,
              lastRefreshedVersionId: "stale-version-1",
              lastRefreshedAt: "2026-08-21T14:01:00.000Z",
            },
          },
        },
      ],
    });
    await store.close();
  });

  it("projects managed URL readiness without URL, checksum, or response data", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const responseBytes = new Uint8Array([65, 66, 67, 194, 162]);
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeUrlSource(
      {
        id: "url-lifecycle-source",
        knowledgeBaseId: "ckb-default",
        kind: "url",
        displayName: "Remote private label",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedUrlVersion(responseBytes, {
        id: "url-lifecycle-version",
        createdAt: "2026-08-21T14:01:00.000Z",
        provenance: {
          originalUrl: "https://example.com/private?token=secret",
          finalUrl: "https://cdn.example.com/private",
          fetchedAt: "2026-08-21T14:01:00.000Z",
          kind: "generic",
        },
      }),
    );

    await expect(
      store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default"),
    ).resolves.toMatchObject({
      sources: [
        {
          sourceId: "url-lifecycle-source",
          latestVersionId: "url-lifecycle-version",
          status: "ready",
          reasons: [],
          lifecycleRevision: {
            managed: true,
            originBoundAt: null,
            provenanceFetchedAt: "2026-08-21T14:01:00.000Z",
          },
        },
      ],
    });
    const readiness = await store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default");
    expect(JSON.stringify(readiness)).not.toContain("example.com");
    expect(JSON.stringify(readiness)).not.toContain("private");
    expect(JSON.stringify(readiness)).not.toContain(sha256(responseBytes));
    expect(JSON.stringify(readiness)).not.toContain("65,66,67");
    await store.close();
  });

  it("projects each refresh blocker and archived state without exposing source details", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const statuses = ["current", "changed", "missing", "inaccessible", "unbound"] as const;
    for (const status of statuses) {
      const sourcePath = join(parent, `${status}.md`);
      await writeFile(sourcePath, `${status} private bytes`, "utf8");
      const sourceId = `${status}-source`;
      const versionId = `${status}-version`;
      await store.createManagedCandidateKnowledgeFileSource(
        {
          id: sourceId,
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: `${status} private label`,
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(sourcePath, `${status} private bytes`, {
          id: versionId,
          createdAt: "2026-08-21T14:01:00.000Z",
        }),
      );
      await store.upsertCandidateKnowledgeSourceRefreshObservation(
        "ckb-default",
        sourceId,
        status === "current"
          ? {
              observedVersionId: versionId,
              status,
              checkedAt: "2026-08-21T14:02:00.000Z",
              lastRefreshedVersionId: versionId,
              lastRefreshedAt: "2026-08-21T14:02:00.000Z",
            }
          : {
              observedVersionId: versionId,
              status,
              checkedAt: "2026-08-21T14:02:00.000Z",
            },
      );
    }

    const archivedPath = join(parent, "archived.md");
    await writeFile(archivedPath, "archived private bytes", "utf8");
    await store.createCandidateKnowledgeBase({
      id: "archived-ckb",
      displayName: "Archived private label",
      isDefault: false,
      createdAt: "2026-08-21T14:01:00.000Z",
    });
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "archived-source",
        knowledgeBaseId: "archived-ckb",
        kind: "file",
        displayName: "Archived private source",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(archivedPath, "archived private bytes", {
        id: "archived-version",
        createdAt: "2026-08-21T14:01:00.000Z",
      }),
    );
    await store.archiveCandidateKnowledgeBase("archived-ckb", "2026-08-21T14:02:00.000Z");

    const readiness = await store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default");
    expect(
      readiness?.sources.map((source) => [source.sourceId, source.status, source.reasons]),
    ).toEqual([
      ["changed-source", "blocked", ["refresh-changed"]],
      ["current-source", "ready", []],
      ["inaccessible-source", "blocked", ["refresh-inaccessible"]],
      ["missing-source", "blocked", ["refresh-missing"]],
      ["unbound-source", "blocked", ["refresh-unbound"]],
    ]);
    await expect(
      store.getCandidateKnowledgeBaseLifecycleReadiness("archived-ckb"),
    ).resolves.toMatchObject({
      state: "archived",
      archivedAt: "2026-08-21T14:02:00.000Z",
      sources: [
        {
          sourceId: "archived-source",
          status: "blocked",
          reasons: ["knowledge-base-archived"],
        },
      ],
    });
    expect(JSON.stringify(readiness)).not.toContain(parent);
    expect(JSON.stringify(readiness)).not.toContain("private bytes");
    expect(JSON.stringify(readiness)).not.toContain("private label");
    await store.close();
  });

  it("projects current directory revisions and detects a rebound origin conflict", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const directoryPath = join(parent, "evidence-directory");
    const originalPath = join(directoryPath, "evidence.md");
    const movedPath = join(directoryPath, "moved.md");
    const reboundDirectoryPath = join(parent, "rebound-evidence-directory");
    const reboundPath = join(reboundDirectoryPath, "moved.md");
    const replacementPath = join(parent, "replacement.md");
    const content = "Directory private bytes";
    await mkdir(directoryPath, { recursive: true });
    await mkdir(reboundDirectoryPath, { recursive: true });
    await writeFile(originalPath, content, "utf8");
    await writeFile(movedPath, content, "utf8");
    await writeFile(reboundPath, content, "utf8");
    await writeFile(replacementPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "directory-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Directory private label",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(originalPath, content, {
        id: "directory-version",
        createdAt: "2026-08-21T14:01:00.000Z",
      }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "directory-binding",
      knowledgeBaseId: "ckb-default",
      rootPath: directoryPath,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["directory-source"],
    });
    const current = await store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default");
    expect(current?.sources[0]).toMatchObject({
      status: "ready",
      reasons: [],
      lifecycleRevision: {
        directory: {
          directoryId: "directory-binding",
          rootRevision: 1,
          memberRevision: 1,
          rootBoundAt: "2026-08-21T14:02:00.000Z",
          memberBoundAt: "2026-08-21T14:02:00.000Z",
        },
      },
    });
    await store.moveManagedCandidateKnowledgeDirectoryMember({
      knowledgeBaseId: "ckb-default",
      directoryId: "directory-binding",
      sourceId: "directory-source",
      sourcePath: movedPath,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      expectedRootPath: await realpath(directoryPath),
      expectedRootRevision: 1,
      expectedMemberRevision: 1,
      expectedRelativePathHash: sha256("evidence.md"),
      expectedVersionId: "directory-version",
      expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
      movedAt: "2026-08-21T14:03:00.000Z",
    });
    await expect(
      store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default"),
    ).resolves.toMatchObject({
      sources: [
        {
          status: "ready",
          lifecycleRevision: {
            originBoundAt: "2026-08-21T14:03:00.000Z",
            directory: { rootRevision: 1, memberRevision: 2 },
          },
        },
      ],
    });
    await store.rebindManagedCandidateKnowledgeDirectoryRoot({
      knowledgeBaseId: "ckb-default",
      directoryId: "directory-binding",
      candidateRootPath: reboundDirectoryPath,
      expectedRootPath: await realpath(directoryPath),
      expectedRevision: 1,
      reboundAt: "2026-08-21T14:04:00.000Z",
      members: [
        {
          sourceId: "directory-source",
          sourcePath: reboundPath,
          mediaType: "text/markdown",
          checksum: sha256(content),
          sizeBytes: Buffer.byteLength(content),
          expectedVersionId: "directory-version",
          expectedOriginBoundAt: "2026-08-21T14:03:00.000Z",
        },
      ],
    });
    await expect(
      store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default"),
    ).resolves.toMatchObject({
      sources: [
        {
          status: "ready",
          lifecycleRevision: {
            originBoundAt: "2026-08-21T14:04:00.000Z",
            directory: { rootRevision: 2, memberRevision: 2 },
          },
        },
      ],
    });
    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "directory-source", {
      sourcePath: replacementPath,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      boundAt: "2026-08-21T14:05:00.000Z",
    });
    await expect(
      store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-default"),
    ).resolves.toMatchObject({
      sources: [
        {
          sourceId: "directory-source",
          status: "blocked",
          reasons: ["directory-origin-conflict"],
          lifecycleRevision: {
            directory: {
              directoryId: "directory-binding",
              rootRevision: 2,
              memberRevision: 2,
            },
          },
        },
      ],
    });
    await store.close();
  });

  it("copies managed bytes into ID-derived private paths and validates them across reopen", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "AGENTS.md");
    const content = "Untrusted candidate evidence.\n";
    await writeFile(inputPath, content, "utf8");
    const sourceId = " ../../source/AGENTS.md ";
    const versionId = " /absolute/version\\name ";
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const written = await store.createManagedCandidateKnowledgeFileSource(
      {
        id: sourceId,
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "../../AGENTS.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, content, { id: versionId }),
    );

    expect(written).toMatchObject({
      created: true,
      source: { id: sourceId.trim(), displayName: "../../AGENTS.md" },
      version: { id: versionId.trim(), checksum: sha256(content), sizeBytes: content.length },
    });
    expect(JSON.stringify(written)).not.toContain(inputPath);
    const managedPath = await store.getManagedCandidateKnowledgeFilePath(
      "ckb-default",
      sourceId,
      versionId,
    );
    expect(managedPath).toBe(
      join(root, "sources", digestSegment(sourceId), digestSegment(versionId)),
    );
    expect(managedPath).not.toContain("AGENTS.md");
    await expect(readFile(managedPath as string, "utf8")).resolves.toBe(content);
    if (process.platform !== "win32") {
      expect((await stat(dirname(managedPath as string))).mode & 0o777).toBe(0o700);
      expect((await stat(managedPath as string)).mode & 0o777).toBe(0o600);
    }
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.getManagedCandidateKnowledgeFilePath("ckb-default", sourceId, versionId),
    ).resolves.toBe(managedPath);
    await reopened.close();
  });

  it("stores exact URL response bytes with provenance without exposing URL state", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const body = new Uint8Array([65, 66, 67, 194, 162]);
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const written = await store.createManagedCandidateKnowledgeUrlSource(
      {
        id: "url-source",
        knowledgeBaseId: "ckb-default",
        kind: "url",
        displayName: "Remote evidence",
        createdAt,
      },
      managedUrlVersion(body),
    );
    expect(written).toMatchObject({
      source: { id: "url-source", kind: "url" },
      version: { checksum: sha256(body), sizeBytes: body.byteLength },
      created: true,
    });
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "url-source"),
    ).resolves.toBeUndefined();
    expect(
      queryDatabase(
        root,
        "SELECT source_id, version_id, original_url, final_url, fetched_at, kind FROM candidate_knowledge_source_url_provenance",
      ),
    ).toEqual([
      {
        source_id: "url-source",
        version_id: "managed-url-version-1",
        original_url: "https://example.com/evidence",
        final_url: "https://example.com/evidence",
        fetched_at: "2026-08-21T14:01:00.000Z",
        kind: "generic",
      },
    ]);
    const inventory = await store.inspectManagedCandidateKnowledgeFiles();
    expect(inventory.verifiedManagedFileCount).toBe(1);
    expect(JSON.stringify(inventory)).not.toContain("example.com");
    expect(
      queryDatabase(
        root,
        "SELECT operation_id, state FROM candidate_knowledge_managed_write_events ORDER BY operation_id, sequence",
      ),
    ).toEqual([
      { operation_id: expect.any(String), state: "targeted" },
      { operation_id: expect.any(String), state: "published" },
      { operation_id: expect.any(String), state: "committed" },
      { operation_id: expect.any(String), state: "completed" },
    ]);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(reopened.listCandidateKnowledgeSources("ckb-default")).resolves.toMatchObject([
      { id: "url-source", kind: "url" },
    ]);
    await reopened.close();

    const afterReopen = await openCandidateKnowledgeStore(root);
    const beforeSources = await snapshotSourcesTree(root);
    await expect(
      afterReopen.createManagedCandidateKnowledgeUrlSource(
        {
          id: "mismatched-url-source",
          knowledgeBaseId: "ckb-default",
          kind: "url",
          displayName: "Mismatched remote evidence",
          createdAt,
        },
        managedUrlVersion(body, {
          id: "mismatched-url-version",
          checksum: "0".repeat(64),
        }),
      ),
    ).rejects.toThrow(/integrity metadata/i);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeSources);
    expect(
      queryDatabase(
        root,
        "SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_operations",
      ),
    ).toEqual([{ count: 1 }]);
    await afterReopen.close();
  });

  it("appends changed URL bytes with parent lineage and journals redirect-only no-ops", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const firstBody = new Uint8Array([65, 66, 67]);
    const secondBody = new Uint8Array([68, 69, 70]);
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeUrlSource(
      {
        id: "url-source",
        knowledgeBaseId: "ckb-default",
        kind: "url",
        displayName: "Remote evidence",
        createdAt,
      },
      managedUrlVersion(firstBody, {
        id: "url-version-1",
        provenance: {
          originalUrl: "https://example.com/evidence",
          finalUrl: "https://example.com/evidence",
          fetchedAt: "2026-08-21T14:01:00.000Z",
          kind: "generic",
        },
      }),
    );
    const second = await store.appendManagedCandidateKnowledgeUrlVersion(
      "ckb-default",
      "url-source",
      managedUrlVersion(secondBody, {
        id: "url-version-2",
        createdAt: "2026-08-21T14:02:00.000Z",
        provenance: {
          originalUrl: "https://example.com/evidence",
          finalUrl: "https://cdn.example.com/evidence",
          fetchedAt: "2026-08-21T14:02:00.000Z",
          kind: "generic",
        },
      }),
    );
    expect(second).toMatchObject({
      created: true,
      version: { id: "url-version-2", version: 2, parentVersionId: "url-version-1" },
    });
    await expect(
      store.getCandidateKnowledgeSourceUrlProvenance("ckb-default", "url-source", "url-version-2"),
    ).resolves.toEqual({
      sourceId: "url-source",
      versionId: "url-version-2",
      originalUrl: "https://example.com/evidence",
      finalUrl: "https://cdn.example.com/evidence",
      fetchedAt: "2026-08-21T14:02:00.000Z",
      kind: "generic",
    });
    await expect(
      readFile(join(root, "sources", digestSegment("url-source"), digestSegment("url-version-2"))),
    ).resolves.toEqual(Buffer.from(secondBody));

    const noop = await store.appendManagedCandidateKnowledgeUrlVersion(
      "ckb-default",
      "url-source",
      managedUrlVersion(secondBody, {
        id: "unused-url-version",
        createdAt: "2026-08-21T14:03:00.000Z",
        provenance: {
          originalUrl: "https://example.com/evidence",
          finalUrl: "https://other.example.com/evidence",
          fetchedAt: "2026-08-21T14:03:00.000Z",
          kind: "generic",
        },
      }),
    );
    expect(noop).toEqual({ ...second, created: false });
    expect(
      queryDatabase(
        root,
        "SELECT operation.requested_version_id, event.state, event.target_version_id FROM candidate_knowledge_managed_write_operations AS operation JOIN candidate_knowledge_managed_write_events AS event ON event.operation_id = operation.operation_id ORDER BY operation.rowid, event.sequence",
      ).at(-1),
    ).toEqual({
      requested_version_id: "unused-url-version",
      state: "noop",
      target_version_id: "url-version-2",
    });
    await store.close();
  });

  it("rejects URL appends before publication for scope, kind, and retirement guards", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const filePath = join(parent, "candidate.md");
    await writeFile(filePath, "candidate", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createCandidateKnowledgeBase({
      id: "ckb-other",
      displayName: "Other evidence",
      isDefault: false,
      createdAt,
    });
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "file-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "File source",
        createdAt,
      },
      managedVersion(filePath, "candidate"),
    );
    await store.createManagedCandidateKnowledgeUrlSource(
      {
        id: "retired-url-source",
        knowledgeBaseId: "ckb-default",
        kind: "url",
        displayName: "Retired URL",
        createdAt,
      },
      managedUrlVersion(new Uint8Array([1]), { id: "retired-url-version" }),
    );
    await store.retireCandidateKnowledgeSource("ckb-default", "retired-url-source", {
      retiredAt: "2026-08-21T14:02:00.000Z",
      reason: "user-requested",
    });
    const beforeSources = await snapshotSourcesTree(root);
    const appendInput = managedUrlVersion(new Uint8Array([2]), {
      id: "unused-url-version",
      createdAt: "2026-08-21T14:03:00.000Z",
      provenance: {
        originalUrl: "https://example.com/evidence",
        finalUrl: "https://example.com/evidence",
        fetchedAt: "2026-08-21T14:03:00.000Z",
        kind: "generic",
      },
    });
    await expect(
      store.appendManagedCandidateKnowledgeUrlVersion("ckb-default", "file-source", appendInput),
    ).rejects.toThrow(/URL source/i);
    await expect(
      store.appendManagedCandidateKnowledgeUrlVersion(
        "ckb-other",
        "retired-url-source",
        appendInput,
      ),
    ).rejects.toThrow(/not found|scope|source/i);
    await expect(
      store.appendManagedCandidateKnowledgeUrlVersion(
        "ckb-default",
        "retired-url-source",
        appendInput,
      ),
    ).rejects.toThrow(/retired/i);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeSources);
    expect(
      queryDatabase(
        root,
        "SELECT COUNT(*) AS count FROM candidate_knowledge_source_versions WHERE version = 2",
      ),
    ).toEqual([{ count: 0 }]);
    await store.close();
  });

  it("rolls back URL append publication when provenance is invalid or rebound", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeUrlSource(
      {
        id: "url-source",
        knowledgeBaseId: "ckb-default",
        kind: "url",
        displayName: "Remote evidence",
        createdAt,
      },
      managedUrlVersion(new Uint8Array([1]), { id: "url-version-1" }),
    );
    const beforeSources = await snapshotSourcesTree(root);
    const beforeVersions = await store.listCandidateKnowledgeSourceVersions(
      "ckb-default",
      "url-source",
    );
    const beforeProvenance = await store.getCandidateKnowledgeSourceUrlProvenance(
      "ckb-default",
      "url-source",
      "url-version-1",
    );
    for (const provenance of [
      {
        originalUrl: "https://different.example/evidence",
        finalUrl: "https://example.com/evidence",
        fetchedAt: "2026-08-21T14:02:00.000Z",
        kind: "generic" as const,
      },
      {
        originalUrl: "http://example.com/evidence",
        finalUrl: "https://example.com/evidence",
        fetchedAt: "2026-08-21T14:02:00.000Z",
        kind: "generic" as const,
      },
    ]) {
      await expect(
        store.appendManagedCandidateKnowledgeUrlVersion(
          "ckb-default",
          "url-source",
          managedUrlVersion(new Uint8Array([2]), {
            id: `invalid-${provenance.originalUrl.startsWith("http:") ? "scheme" : "original"}`,
            createdAt: "2026-08-21T14:02:00.000Z",
            provenance,
          }),
        ),
      ).rejects.toThrow();
      await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeSources);
      await expect(
        store.listCandidateKnowledgeSourceVersions("ckb-default", "url-source"),
      ).resolves.toEqual(beforeVersions);
      await expect(
        store.getCandidateKnowledgeSourceUrlProvenance(
          "ckb-default",
          "url-source",
          "url-version-1",
        ),
      ).resolves.toEqual(beforeProvenance);
    }
    await store.close();
  });

  it("remembers one canonical origin binding for a managed create and scopes reads", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const nested = join(parent, "nested");
    const inputPath = join(parent, "candidate.md");
    const selectedPath = `${nested}/../candidate.md`;
    await mkdir(nested);
    await writeFile(inputPath, "candidate evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));

    await store.createCandidateKnowledgeBase({
      id: "ckb-other",
      displayName: "Other evidence",
      isDefault: false,
      createdAt: "2026-08-21T14:01:00.000Z",
    });
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "bound-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(selectedPath, "candidate evidence"),
    );
    await store.createCandidateKnowledgeSource(
      {
        id: "metadata-only-file",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Metadata only",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      {
        id: "metadata-only-file-version",
        mediaType: "text/markdown",
        checksum: "a".repeat(64),
        sizeBytes: 1,
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );
    await store.createCandidateKnowledgeSource(
      {
        id: "url-source",
        knowledgeBaseId: "ckb-default",
        kind: "url",
        displayName: "Public profile",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      {
        id: "url-source-version",
        mediaType: "text/plain",
        checksum: "b".repeat(64),
        sizeBytes: 1,
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );

    const binding = await store.getCandidateKnowledgeSourceOriginBinding(
      "ckb-default",
      "bound-source",
    );
    expect(binding).toEqual({
      sourceId: "bound-source",
      originPath: await realpath(selectedPath),
      boundAt: "2026-08-21T14:01:00.000Z",
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(
      queryDatabase(
        root,
        "SELECT source_id, origin_path, bound_at FROM candidate_knowledge_source_origin_bindings",
      ),
    ).toHaveLength(1);
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-other", "bound-source"),
    ).resolves.toBeUndefined();
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "metadata-only-file"),
    ).resolves.toBeUndefined();
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "url-source"),
    ).resolves.toBeUndefined();
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "missing-source"),
    ).resolves.toBeUndefined();
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.getCandidateKnowledgeSourceOriginBinding("ckb-default", "bound-source"),
    ).resolves.toEqual(binding);
    await reopened.close();
  });

  it("persists immutable directory bindings and hashed members across reopen", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const nestedDirectory = join(selectedDirectory, "nested");
    const firstPath = join(selectedDirectory, "first.md");
    const secondPath = join(nestedDirectory, "second.md");
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(firstPath, "first evidence", "utf8");
    await writeFile(secondPath, "second evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "directory-source-first",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "first.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(firstPath, "first evidence", {
        id: "directory-version-first",
      }),
    );
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "directory-source-second",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "second.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(secondPath, "second evidence", {
        id: "directory-version-second",
      }),
    );

    const binding = await store.createCandidateKnowledgeDirectoryBinding({
      id: "directory-binding-1",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["directory-source-first", "directory-source-second"],
    });
    expect(binding).toEqual({
      id: "directory-binding-1",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
    });
    expect(Object.isFrozen(binding)).toBe(true);
    const members = await store.listCandidateKnowledgeDirectoryMembers(
      "ckb-default",
      "directory-binding-1",
    );
    expect(members.map((member) => member.sourceId).sort()).toEqual([
      "directory-source-first",
      "directory-source-second",
    ]);
    expect(members.map((member) => member.relativePathHash).sort()).toEqual(
      [sha256("first.md"), sha256("nested/second.md")].sort(),
    );
    expect(Object.isFrozen(members)).toBe(true);
    expect(Object.isFrozen(members[0])).toBe(true);
    await expect(
      store.findCandidateKnowledgeDirectoryBinding(
        "ckb-default",
        await realpath(selectedDirectory),
      ),
    ).resolves.toEqual(binding);
    await expect(
      store.getCandidateKnowledgeDirectoryBinding("ckb-default", "directory-binding-1"),
    ).resolves.toEqual(binding);
    await expect(
      store.createCandidateKnowledgeDirectoryBinding({
        id: "directory-binding-2",
        knowledgeBaseId: "ckb-default",
        rootPath: await realpath(selectedDirectory),
        boundAt: "2026-08-21T14:02:00.000Z",
        sourceIds: [],
      }),
    ).rejects.toThrow(StorageConflictError);
    await store.createCandidateKnowledgeBase({
      id: "directory-other-ckb",
      displayName: "Other directory CKB",
      isDefault: false,
      createdAt: "2026-08-21T14:01:00.000Z",
    });
    const otherDirectory = join(parent, "other-selected");
    await mkdir(otherDirectory);
    await expect(
      store.createCandidateKnowledgeDirectoryBinding({
        id: "directory-binding-1",
        knowledgeBaseId: "directory-other-ckb",
        rootPath: await realpath(otherDirectory),
        boundAt: "2026-08-21T14:02:00.000Z",
        sourceIds: [],
      }),
    ).rejects.toThrow(StorageConflictError);
    expect(() =>
      mutateDatabase(
        root,
        "UPDATE candidate_knowledge_directory_bindings SET bound_at = '2026-08-21T14:03:00.000Z' WHERE id = 'directory-binding-1'",
      ),
    ).toThrow();
    expect(() =>
      mutateDatabase(
        root,
        "UPDATE candidate_knowledge_directory_root_revisions SET bound_at = '2026-08-21T14:03:00.000Z' WHERE directory_id = 'directory-binding-1' AND revision = 1",
      ),
    ).toThrow();
    expect(() =>
      mutateDatabase(
        root,
        "DELETE FROM candidate_knowledge_directory_root_revisions WHERE directory_id = 'directory-binding-1' AND revision = 1",
      ),
    ).toThrow();
    expect(() =>
      mutateDatabase(
        root,
        "DELETE FROM candidate_knowledge_directory_members WHERE directory_id = 'directory-binding-1'",
      ),
    ).toThrow();
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.listCandidateKnowledgeDirectoryMembers("ckb-default", "directory-binding-1"),
    ).resolves.toEqual(members);
    await reopened.close();
    mutateDatabase(
      root,
      `PRAGMA ignore_check_constraints = ON;
       DROP TRIGGER candidate_knowledge_directory_members_immutable_update;
       UPDATE candidate_knowledge_directory_members
       SET relative_path_hash = 'malformed'
       WHERE directory_id = 'directory-binding-1' AND source_id = 'directory-source-first'`,
    );
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(
      /invalid directory membership/i,
    );
  });

  it("backfills member revisions for an archived v14 candidate knowledge base", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "archived.md");
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, "archived evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "archived-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "archived.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(sourcePath, "archived evidence", {
        id: "archived-version",
      }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "archived-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["archived-source"],
    });
    await store.close();

    mutateDatabase(
      root,
      `DROP VIEW candidate_knowledge_directory_current_members;
       DROP TRIGGER candidate_knowledge_directory_members_create_revision;
       DROP TRIGGER candidate_knowledge_directory_member_revisions_require_valid_insert;
       DROP TRIGGER candidate_knowledge_directory_member_revisions_immutable_update;
       DROP TRIGGER candidate_knowledge_directory_member_revisions_immutable_delete;
       DROP TABLE candidate_knowledge_directory_member_revisions;
       DELETE FROM schema_migrations WHERE version = 15;
       UPDATE candidate_knowledge_bases
       SET is_default = 0, state = 'archived', archived_at = '2026-08-21T15:00:00.000Z'
       WHERE id = 'ckb-default';`,
    );
    const database = openSqliteStorage(join(root, ".draft-loop", "knowledge.sqlite"));
    expect(database.appliedMigrationVersions()).toContain(15);
    expect(
      queryDatabase(
        root,
        `SELECT directory_id, candidate_knowledge_base_id, source_id, revision,
                relative_path_hash, bound_at
         FROM candidate_knowledge_directory_member_revisions`,
      ),
    ).toEqual([
      {
        directory_id: "archived-directory",
        candidate_knowledge_base_id: "ckb-default",
        source_id: "archived-source",
        revision: 1,
        relative_path_hash: sha256("archived.md"),
        bound_at: "2026-08-21T14:02:00.000Z",
      },
    ]);
    database.close();
  });

  it.each([
    {
      field: "bound_at",
      value: "2026-08-21T14:03:00.000Z",
    },
    {
      field: "relative_path_hash",
      value: sha256("tampered-renamed.md"),
    },
  ])("rejects a tampered v15 revision-one $field on reopen", async ({ field, value }) => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "tampered.md");
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, "tampered evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "tampered-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "tampered.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(sourcePath, "tampered evidence", { id: "tampered-version" }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "tampered-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["tampered-source"],
    });
    await store.close();
    mutateDatabase(
      root,
      `PRAGMA ignore_check_constraints = ON;
       DROP TRIGGER candidate_knowledge_directory_member_revisions_immutable_update;
       UPDATE candidate_knowledge_directory_member_revisions
       SET ${field} = '${value}'
       WHERE directory_id = 'tampered-directory' AND source_id = 'tampered-source' AND revision = 1;`,
    );
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(
      /revision-one baseline mismatch/i,
    );
  });

  it("adds managed files to an existing directory atomically and keeps their membership historical", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "added.md");
    const replacementPath = join(parent, "moved-added.md");
    const outsidePath = join(parent, "outside.md");
    const earlyPath = join(selectedDirectory, "early.md");
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, "added evidence", "utf8");
    await writeFile(replacementPath, "added updated", "utf8");
    await writeFile(outsidePath, "outside evidence", "utf8");
    await writeFile(earlyPath, "early evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "append-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: [],
    });

    const created = await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "added-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "added.md",
        createdAt: "2026-08-21T14:03:00.000Z",
      },
      managedVersion(sourcePath, "added evidence", {
        id: "added-version",
        createdAt: "2026-08-21T14:03:00.000Z",
        directoryId: "append-directory",
      }),
    );
    expect(created.created).toBe(true);
    await expect(
      store.listCandidateKnowledgeDirectoryMembers("ckb-default", "append-directory"),
    ).resolves.toEqual([
      {
        directoryId: "append-directory",
        knowledgeBaseId: "ckb-default",
        sourceId: "added-source",
        relativePathHash: sha256("added.md"),
      },
    ]);

    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "early-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "early.md",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(earlyPath, "early evidence", {
          id: "early-version",
          createdAt: "2026-08-21T14:01:00.000Z",
          directoryId: "append-directory",
        }),
      ),
    ).rejects.toThrow(/must not precede its binding/i);
    await expect(store.getCandidateKnowledgeSource("ckb-default", "early-source")).resolves.toBe(
      undefined,
    );

    const beforeOutsideFailure = await snapshotSourcesTree(root);
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "outside-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "outside.md",
          createdAt: "2026-08-21T14:04:00.000Z",
        },
        managedVersion(outsidePath, "outside evidence", {
          id: "outside-version",
          createdAt: "2026-08-21T14:04:00.000Z",
          directoryId: "append-directory",
        }),
      ),
    ).rejects.toThrow(/strictly inside its root/i);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeOutsideFailure);
    await expect(
      store.getCandidateKnowledgeSource("ckb-default", "outside-source"),
    ).resolves.toBeUndefined();

    const beforeHashCollision = await snapshotSourcesTree(root);
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "collision-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "collision.md",
          createdAt: "2026-08-21T14:04:00.000Z",
        },
        managedVersion(sourcePath, "added evidence", {
          id: "collision-version",
          createdAt: "2026-08-21T14:04:00.000Z",
          directoryId: "append-directory",
        }),
      ),
    ).rejects.toThrow(/relative path is already bound/i);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeHashCollision);
    await expect(
      store.getCandidateKnowledgeSource("ckb-default", "collision-source"),
    ).resolves.toBeUndefined();

    await writeFile(sourcePath, "added updated", "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "added-source",
      managedVersion(sourcePath, "added updated", {
        id: "added-version-2",
        createdAt: "2026-08-21T14:04:00.000Z",
      }),
    );
    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "added-source", {
      sourcePath: replacementPath,
      mediaType: "text/markdown",
      checksum: sha256("added updated"),
      sizeBytes: Buffer.byteLength("added updated"),
      boundAt: "2026-08-21T14:05:00.000Z",
    });
    await store.retireCandidateKnowledgeSource("ckb-default", "added-source", {
      retiredAt: "2026-08-21T14:06:00.000Z",
      reason: "user-requested",
    });
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.listCandidateKnowledgeDirectoryMembers("ckb-default", "append-directory"),
    ).resolves.toEqual([
      {
        directoryId: "append-directory",
        knowledgeBaseId: "ckb-default",
        sourceId: "added-source",
        relativePathHash: sha256("added.md"),
      },
    ]);
    await reopened.close();
  });

  it("serializes concurrent directory member additions by rejecting the losing path collision", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "concurrent.md");
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, "concurrent evidence", "utf8");
    const firstStore = await initializeCandidateKnowledgeStore(initialization(root));
    await firstStore.createCandidateKnowledgeDirectoryBinding({
      id: "concurrent-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: [],
    });
    const secondStore = await openCandidateKnowledgeStore(root);
    const outcomes = await Promise.allSettled([
      firstStore.createManagedCandidateKnowledgeFileSource(
        {
          id: "concurrent-source-a",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "concurrent.md",
          createdAt: "2026-08-21T14:03:00.000Z",
        },
        managedVersion(sourcePath, "concurrent evidence", {
          id: "concurrent-version-a",
          createdAt: "2026-08-21T14:03:00.000Z",
          directoryId: "concurrent-directory",
        }),
      ),
      secondStore.createManagedCandidateKnowledgeFileSource(
        {
          id: "concurrent-source-b",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "concurrent.md",
          createdAt: "2026-08-21T14:03:00.000Z",
        },
        managedVersion(sourcePath, "concurrent evidence", {
          id: "concurrent-version-b",
          createdAt: "2026-08-21T14:03:00.000Z",
          directoryId: "concurrent-directory",
        }),
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const successfulSourceId =
      outcomes[0]?.status === "fulfilled" ? "concurrent-source-a" : "concurrent-source-b";
    const successfulVersionId =
      outcomes[0]?.status === "fulfilled" ? "concurrent-version-a" : "concurrent-version-b";
    await expect(
      firstStore.listCandidateKnowledgeDirectoryMembers("ckb-default", "concurrent-directory"),
    ).resolves.toHaveLength(1);
    await expect(firstStore.listCandidateKnowledgeSources("ckb-default")).resolves.toHaveLength(1);
    await expect(firstStore.inspectManagedCandidateKnowledgeFiles()).resolves.toMatchObject({
      verifiedManagedFileCount: 1,
    });
    await expect(snapshotSourcesTree(root)).resolves.toEqual([
      `${sha256(successfulSourceId)}/`,
      `${sha256(successfulSourceId)}/${sha256(successfulVersionId)}:${sha256("concurrent evidence")}`,
    ]);
    await secondStore.close();
    await firstStore.close();
  });

  it("coordinates direct store mutations under one recoverable store-wide writer lease", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const firstStore = await initializeCandidateKnowledgeStore(initialization(root));
    const secondStore = await openCandidateKnowledgeStore(root);
    let releaseWriter!: () => void;
    let reportAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      reportAcquired = resolve;
    });
    const holdWriter = firstStore.withWriterLease(
      "ckb-directory-refresh",
      async () => {
        reportAcquired();
        await new Promise<void>((resolve) => {
          releaseWriter = resolve;
        });
      },
      {
        coordinatorPath: join(parent, "untrusted-coordinator.sqlite"),
        scope: "workspace",
        operation: "untrusted-operation",
      } as never,
    );
    await acquired;

    const conflict = await secondStore
      .renameCandidateKnowledgeBase("ckb-default", "Blocked rename", "2026-08-21T14:01:00.000Z")
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(StorageWriterLeaseConflictError);
    expect((conflict as StorageWriterLeaseConflictError).diagnostic).toEqual({
      scope: "candidate-knowledge-store",
      activeOperation: "ckb-directory-refresh",
      retryable: true,
      status: "active",
    });
    expect((conflict as Error).message).not.toContain(root);
    await expect(openCandidateKnowledgeStore(root)).rejects.toMatchObject({
      diagnostic: {
        scope: "candidate-knowledge-store",
        activeOperation: "ckb-directory-refresh",
        retryable: true,
        status: "active",
      },
    });

    releaseWriter();
    await holdWriter;
    await expect(
      secondStore.renameCandidateKnowledgeBase(
        "ckb-default",
        "Renamed safely",
        "2026-08-21T14:02:00.000Z",
      ),
    ).resolves.toMatchObject({ displayName: "Renamed safely" });
    await secondStore.close();
    await firstStore.close();
  });

  it("fences a stale managed writer before its next durable transition", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "stale-writer.md");
    await writeFile(sourcePath, "stale writer evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    let clock = 1_000;

    await expect(
      store.withWriterLease(
        "ckb-stale-writer-test",
        () =>
          store.createManagedCandidateKnowledgeFileSource(
            {
              id: "stale-writer-source",
              knowledgeBaseId: "ckb-default",
              kind: "file",
              displayName: "Stale writer",
              createdAt,
            },
            managedVersion(sourcePath, "stale writer evidence", {
              id: "stale-writer-version",
              afterTargetPublication: async () => {
                clock = 1_200;
              },
            }),
          ),
        { now: () => clock, leaseDurationMs: 100 },
      ),
    ).rejects.toBeInstanceOf(StorageWriterLeaseLostError);
    await store.close();

    const recovered = await openCandidateKnowledgeStore(root);
    expect(recovered.recoveryReport.entries).toEqual([
      { kind: "create", phase: "targeted", outcome: "aborted" },
    ]);
    await expect(
      recovered.getCandidateKnowledgeSource("ckb-default", "stale-writer-source"),
    ).resolves.toBeUndefined();
    await recovered.close();
  });

  it("rejects an owned event after recovery claims the prepared operation", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "recovery-claim-race");
    const sourcePath = join(parent, "recovery-claim-race.md");
    await writeFile(sourcePath, "recovery claim race evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    let clock = 1_000;
    let releaseWriter!: () => void;
    let reportPaused!: () => void;
    const paused = new Promise<void>((resolve) => {
      reportPaused = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });

    const writePromise = store.withWriterLease(
      "ckb-recovery-claim-race",
      () =>
        store.createManagedCandidateKnowledgeFileSource(
          {
            id: "recovery-claim-race-source",
            knowledgeBaseId: "ckb-default",
            kind: "file",
            displayName: "Recovery claim race",
            createdAt,
          },
          managedVersion(sourcePath, "recovery claim race evidence", {
            id: "recovery-claim-race-version",
            afterLeaseRenewBeforeDatabaseWrite: async () => {
              reportPaused();
              await resume;
            },
          }),
        ),
      { now: () => clock, leaseDurationMs: 100 },
    );

    let recovered: Awaited<ReturnType<typeof openCandidateKnowledgeStore>> | undefined;
    try {
      await paused;
      clock = 1_200;
      recovered = await openCandidateKnowledgeStore(root);
      expect(recovered.recoveryReport.entries).toEqual([
        { kind: "create", phase: "prepared", outcome: "aborted" },
      ]);
      await recovered.close();
      recovered = undefined;

      releaseWriter();
      await expect(writePromise).rejects.toBeInstanceOf(StorageWriterLeaseLostError);
      await store.close();

      const [{ operation_id: operationId }] = queryDatabase(
        root,
        "SELECT operation_id FROM candidate_knowledge_managed_write_operations",
      ) as [{ readonly operation_id: string }];
      expect(
        queryDatabase(
          root,
          `SELECT state, target_version_id
           FROM candidate_knowledge_managed_write_events
           WHERE operation_id = '${operationId}'
           ORDER BY sequence DESC
           LIMIT 1`,
        ),
      ).toEqual([{ state: "aborted", target_version_id: "recovery-claim-race-version" }]);
      expect(
        queryDatabase(
          root,
          `SELECT COUNT(*) AS count
           FROM candidate_knowledge_source_versions
           WHERE id = 'recovery-claim-race-version'`,
        ),
      ).toEqual([{ count: 0 }]);
      await expect(
        lstat(
          join(
            root,
            "sources",
            digestSegment("recovery-claim-race-source"),
            digestSegment("recovery-claim-race-version"),
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (recovered !== undefined) await recovered.close();
      releaseWriter();
      await writePromise.catch(() => undefined);
      await store.close().catch(() => undefined);
    }
  });

  it("keeps directory membership stable across append, rebind, retirement, and reopen", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "first.md");
    const replacementPath = join(parent, "moved-first.md");
    const initialContent = "initial evidence";
    const updatedContent = "updated evidence";
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, initialContent, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "lifecycle-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "first.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(sourcePath, initialContent, {
        id: "lifecycle-version-first",
      }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "lifecycle-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["lifecycle-source"],
    });
    const membersBefore = await store.listCandidateKnowledgeDirectoryMembers(
      "ckb-default",
      "lifecycle-directory",
    );
    expect(membersBefore).toEqual([
      {
        directoryId: "lifecycle-directory",
        knowledgeBaseId: "ckb-default",
        sourceId: "lifecycle-source",
        relativePathHash: sha256("first.md"),
      },
    ]);

    await writeFile(sourcePath, updatedContent, "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "lifecycle-source",
      managedVersion(sourcePath, updatedContent, {
        id: "lifecycle-version-second",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );
    await writeFile(replacementPath, updatedContent, "utf8");
    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "lifecycle-source", {
      sourcePath: replacementPath,
      mediaType: "text/markdown",
      checksum: sha256(updatedContent),
      sizeBytes: Buffer.byteLength(updatedContent),
      boundAt: "2026-08-21T14:04:00.000Z",
    });
    await store.retireCandidateKnowledgeSource("ckb-default", "lifecycle-source", {
      retiredAt: "2026-08-21T14:05:00.000Z",
      reason: "user-requested",
    });
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.listCandidateKnowledgeDirectoryMembers("ckb-default", "lifecycle-directory"),
    ).resolves.toEqual(membersBefore);
    await reopened.close();
  });

  it("rebinds a directory root through append-only revisions after verifying every member", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const firstDirectory = join(parent, "selected-first");
    const secondDirectory = join(parent, "selected-second");
    const firstPath = join(firstDirectory, "nested", "first.md");
    const secondPath = join(secondDirectory, "nested", "first.md");
    const content = "stable evidence";
    await mkdir(dirname(firstPath), { recursive: true });
    await mkdir(dirname(secondPath), { recursive: true });
    await writeFile(firstPath, content, "utf8");
    await writeFile(secondPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "revision-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "first.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(firstPath, content, {
        id: "revision-version",
      }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "revision-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(firstDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["revision-source"],
    });

    const firstRevision = await store.getCandidateKnowledgeDirectoryCurrentRootRevision(
      "ckb-default",
      "revision-directory",
    );
    expect(firstRevision).toEqual({
      directoryId: "revision-directory",
      knowledgeBaseId: "ckb-default",
      revision: 1,
      rootPath: await realpath(firstDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
    });
    const membersBefore = await store.listCandidateKnowledgeDirectoryMembers(
      "ckb-default",
      "revision-directory",
    );
    await store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", "revision-source", {
      observedVersionId: "revision-version",
      status: "current",
      checkedAt: "2026-08-21T14:03:00.000Z",
    });
    const observationBefore = await store.getCandidateKnowledgeSourceRefreshObservation(
      "ckb-default",
      "revision-source",
    );
    const retirementBefore = await store.getCandidateKnowledgeSourceRetirement(
      "ckb-default",
      "revision-source",
    );
    const inventoryBefore = await store.inspectManagedCandidateKnowledgeFiles();
    const journalBefore = queryDatabase(
      root,
      "SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_events",
    );
    const sourcesBefore = await store.listCandidateKnowledgeSources("ckb-default");
    const versionsBefore = await store.listCandidateKnowledgeSourceVersions(
      "ckb-default",
      "revision-source",
    );

    const rebound = await store.rebindManagedCandidateKnowledgeDirectoryRoot({
      knowledgeBaseId: "ckb-default",
      directoryId: "revision-directory",
      candidateRootPath: secondDirectory,
      expectedRootPath: await realpath(firstDirectory),
      expectedRevision: 1,
      reboundAt: "2026-08-21T14:04:00.000Z",
      members: [
        {
          sourceId: "revision-source",
          sourcePath: secondPath,
          mediaType: "text/markdown",
          checksum: sha256(content),
          sizeBytes: Buffer.byteLength(content),
          expectedVersionId: "revision-version",
          expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
        },
      ],
    });
    expect(rebound).toEqual({
      binding: {
        id: "revision-directory",
        knowledgeBaseId: "ckb-default",
        rootPath: await realpath(secondDirectory),
        boundAt: "2026-08-21T14:04:00.000Z",
      },
      revision: {
        directoryId: "revision-directory",
        knowledgeBaseId: "ckb-default",
        revision: 2,
        rootPath: await realpath(secondDirectory),
        boundAt: "2026-08-21T14:04:00.000Z",
      },
      rebound: true,
    });
    expect(Object.isFrozen(rebound)).toBe(true);
    expect(Object.isFrozen(rebound.binding)).toBe(true);
    expect(Object.isFrozen(rebound.revision)).toBe(true);
    await expect(
      store.getCandidateKnowledgeDirectoryBinding("ckb-default", "revision-directory"),
    ).resolves.toEqual(rebound.binding);
    await expect(
      store.findCandidateKnowledgeDirectoryBinding("ckb-default", await realpath(firstDirectory)),
    ).resolves.toEqual({
      id: "revision-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(firstDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
    });
    await expect(
      store.findCandidateKnowledgeDirectoryBinding("ckb-default", await realpath(secondDirectory)),
    ).resolves.toEqual(rebound.binding);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-default",
        "revision-directory",
        secondPath,
      ),
    ).resolves.toEqual(membersBefore[0]);
    await expect(
      store.getCandidateKnowledgeDirectoryMemberOriginRelation(
        "ckb-default",
        "revision-directory",
        "revision-source",
      ),
    ).resolves.toMatchObject({
      relation: "same-member",
      originBoundAt: "2026-08-21T14:04:00.000Z",
    });
    await expect(
      store.createCandidateKnowledgeDirectoryBinding({
        id: "historical-root-directory",
        knowledgeBaseId: "ckb-default",
        rootPath: await realpath(firstDirectory),
        boundAt: "2026-08-21T14:05:00.000Z",
        sourceIds: [],
      }),
    ).rejects.toThrow(StorageConflictError);
    expect(
      await store.listCandidateKnowledgeDirectoryMembers("ckb-default", "revision-directory"),
    ).toEqual(membersBefore);
    expect(await store.listCandidateKnowledgeSources("ckb-default")).toEqual(sourcesBefore);
    expect(
      await store.listCandidateKnowledgeSourceVersions("ckb-default", "revision-source"),
    ).toEqual(versionsBefore);
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "revision-source"),
    ).resolves.toEqual(observationBefore);
    await expect(
      store.getCandidateKnowledgeSourceRetirement("ckb-default", "revision-source"),
    ).resolves.toEqual(retirementBefore);
    await expect(store.inspectManagedCandidateKnowledgeFiles()).resolves.toEqual(inventoryBefore);
    expect(
      queryDatabase(root, "SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_events"),
    ).toEqual(journalBefore);

    const noop = await store.rebindManagedCandidateKnowledgeDirectoryRoot({
      knowledgeBaseId: "ckb-default",
      directoryId: "revision-directory",
      candidateRootPath: secondDirectory,
      expectedRootPath: await realpath(secondDirectory),
      expectedRevision: 2,
      reboundAt: "2026-08-21T14:05:00.000Z",
      members: [
        {
          sourceId: "revision-source",
          sourcePath: secondPath,
          mediaType: "text/markdown",
          checksum: sha256(content),
          sizeBytes: Buffer.byteLength(content),
          expectedVersionId: "revision-version",
          expectedOriginBoundAt: "2026-08-21T14:04:00.000Z",
        },
      ],
    });
    expect(noop.rebound).toBe(false);
    expect(noop.revision.revision).toBe(2);
    expect(
      await store.getCandidateKnowledgeDirectoryCurrentRootRevision(
        "ckb-default",
        "revision-directory",
      ),
    ).toEqual(noop.revision);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.getCandidateKnowledgeDirectoryCurrentRootRevision(
        "ckb-default",
        "revision-directory",
      ),
    ).resolves.toEqual(noop.revision);
    await expect(
      reopened.listCandidateKnowledgeDirectoryMembers("ckb-default", "revision-directory"),
    ).resolves.toEqual(membersBefore);
    await reopened.close();
  });

  it("moves a directory member through immutable revisions and preserves its baseline evidence", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const initialPath = join(selectedDirectory, "first.md");
    const movedPath = join(selectedDirectory, "nested", "first.md");
    const otherPath = join(selectedDirectory, "other.md");
    const content = "stable member evidence";
    await mkdir(selectedDirectory, { recursive: true });
    await mkdir(dirname(movedPath), { recursive: true });
    await writeFile(initialPath, content, "utf8");
    await writeFile(movedPath, content, "utf8");
    await writeFile(otherPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "move-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "first.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(initialPath, content, { id: "move-version" }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "move-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["move-source"],
    });
    const baselineMember = (
      await store.listCandidateKnowledgeDirectoryMembers("ckb-default", "move-directory")
    )[0];
    const baselineRevision = await store.getCandidateKnowledgeDirectoryMemberCurrentRevision(
      "ckb-default",
      "move-directory",
      "move-source",
    );
    if (baselineMember === undefined || baselineRevision === undefined) {
      throw new Error("expected directory member revision baseline");
    }
    expect(baselineRevision).toEqual({
      directoryId: "move-directory",
      knowledgeBaseId: "ckb-default",
      sourceId: "move-source",
      revision: 1,
      relativePathHash: sha256("first.md"),
      boundAt: "2026-08-21T14:02:00.000Z",
    });
    expect(() =>
      mutateDatabase(
        root,
        `UPDATE candidate_knowledge_directory_member_revisions
         SET relative_path_hash = '${sha256("tampered.md")}'
         WHERE directory_id = 'move-directory' AND source_id = 'move-source' AND revision = 1`,
      ),
    ).toThrow(/immutable/i);
    expect(() =>
      mutateDatabase(
        root,
        `DELETE FROM candidate_knowledge_directory_member_revisions
         WHERE directory_id = 'move-directory' AND source_id = 'move-source' AND revision = 1`,
      ),
    ).toThrow(/immutable/i);
    await store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", "move-source", {
      observedVersionId: "move-version",
      status: "current",
      checkedAt: "2026-08-21T14:03:00.000Z",
    });
    const before = {
      source: await store.getCandidateKnowledgeSource("ckb-default", "move-source"),
      versions: await store.listCandidateKnowledgeSourceVersions("ckb-default", "move-source"),
      observation: await store.getCandidateKnowledgeSourceRefreshObservation(
        "ckb-default",
        "move-source",
      ),
      retirement: await store.getCandidateKnowledgeSourceRetirement("ckb-default", "move-source"),
      inventory: await store.inspectManagedCandidateKnowledgeFiles(),
      journal: queryDatabase(
        root,
        "SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_events",
      ),
      baseline: queryDatabase(
        root,
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_members`,
      ),
    };
    const moveInput: MoveManagedCandidateKnowledgeDirectoryMemberInput = {
      knowledgeBaseId: "ckb-default",
      directoryId: "move-directory",
      sourceId: "move-source",
      sourcePath: movedPath,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      expectedRootPath: await realpath(selectedDirectory),
      expectedRootRevision: 1,
      expectedMemberRevision: 1,
      expectedRelativePathHash: sha256("first.md"),
      expectedVersionId: "move-version",
      expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
      movedAt: "2026-08-21T14:04:00.000Z",
    };
    const expectUnchanged = async (): Promise<void> => {
      await expect(
        store.getCandidateKnowledgeDirectoryMemberCurrentRevision(
          "ckb-default",
          "move-directory",
          "move-source",
        ),
      ).resolves.toEqual(baselineRevision);
      await expect(
        store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "move-source"),
      ).resolves.toEqual({
        sourceId: "move-source",
        originPath: await realpath(initialPath),
        boundAt: "2026-08-21T14:01:00.000Z",
      });
    };
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        expectedMemberRevision: 2,
      }),
    ).rejects.toThrow(/member changed/i);
    await expectUnchanged();
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        expectedRootRevision: 2,
      }),
    ).rejects.toThrow(/root changed/i);
    await expectUnchanged();
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        expectedVersionId: "stale-version",
      }),
    ).rejects.toThrow(/latest version changed/i);
    await expectUnchanged();
    const outsidePath = join(parent, "outside.md");
    await writeFile(outsidePath, content, "utf8");
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        sourcePath: outsidePath,
      }),
    ).rejects.toThrow(/strictly inside its current root/i);
    await expectUnchanged();
    if (process.platform !== "win32") {
      const symlinkPath = join(selectedDirectory, "symlink.md");
      await symlink(initialPath, symlinkPath);
      await expect(
        store.moveManagedCandidateKnowledgeDirectoryMember({
          ...moveInput,
          sourcePath: symlinkPath,
        }),
      ).rejects.toThrow(/symbolic link/i);
      await expectUnchanged();
      await rm(symlinkPath, { force: true });
    }
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        movedAt: "2026-08-21T14:01:30.000Z",
      }),
    ).rejects.toThrow(/must not precede member state/i);
    await expectUnchanged();
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        mediaType: "text/plain",
      }),
    ).rejects.toThrow(/latest version changed/i);
    await expectUnchanged();
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        expectedOriginBoundAt: "2026-08-21T14:01:01.000Z",
      }),
    ).rejects.toThrow(/origin changed/i);
    await expectUnchanged();
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        beforeSourceRecheck: async () => {
          await writeFile(movedPath, "changed during verification", "utf8");
        },
      }),
    ).rejects.toThrow(/changed while it was being verified/i);
    await writeFile(movedPath, content, "utf8");
    await expectUnchanged();

    mutateDatabase(
      root,
      `CREATE TRIGGER move_source_origin_update_abort
       BEFORE UPDATE ON candidate_knowledge_source_origin_bindings
       WHEN OLD.source_id = 'move-source'
       BEGIN SELECT RAISE(ABORT, 'move source origin update blocked'); END;`,
    );
    await expect(store.moveManagedCandidateKnowledgeDirectoryMember(moveInput)).rejects.toThrow(
      /origin update blocked/i,
    );
    await expectUnchanged();
    expect(
      queryDatabase(
        root,
        `SELECT revision, relative_path_hash
         FROM candidate_knowledge_directory_member_revisions
         WHERE directory_id = 'move-directory' AND source_id = 'move-source'
         ORDER BY revision`,
      ),
    ).toEqual([{ revision: 1, relative_path_hash: sha256("first.md") }]);
    mutateDatabase(root, "DROP TRIGGER move_source_origin_update_abort;");

    const moved = await store.moveManagedCandidateKnowledgeDirectoryMember(moveInput);
    expect(moved).toEqual({
      member: {
        directoryId: "move-directory",
        knowledgeBaseId: "ckb-default",
        sourceId: "move-source",
        relativePathHash: sha256("nested/first.md"),
      },
      revision: {
        directoryId: "move-directory",
        knowledgeBaseId: "ckb-default",
        sourceId: "move-source",
        revision: 2,
        relativePathHash: sha256("nested/first.md"),
        boundAt: "2026-08-21T14:04:00.000Z",
      },
      binding: {
        sourceId: "move-source",
        originPath: await realpath(movedPath),
        boundAt: "2026-08-21T14:04:00.000Z",
      },
      moved: true,
    });
    expect(Object.isFrozen(moved)).toBe(true);
    expect(Object.isFrozen(moved.member)).toBe(true);
    expect(Object.isFrozen(moved.revision)).toBe(true);
    expect(Object.isFrozen(moved.binding)).toBe(true);
    await expect(
      store.getCandidateKnowledgeDirectoryMemberCurrentRevision(
        "ckb-default",
        "move-directory",
        "move-source",
      ),
    ).resolves.toEqual(moved.revision);
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "move-source"),
    ).resolves.toEqual(moved.binding);
    expect(await store.getCandidateKnowledgeSource("ckb-default", "move-source")).toEqual(
      before.source,
    );
    expect(await store.listCandidateKnowledgeSourceVersions("ckb-default", "move-source")).toEqual(
      before.versions,
    );
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "move-source"),
    ).resolves.toEqual(before.observation);
    await expect(
      store.getCandidateKnowledgeSourceRetirement("ckb-default", "move-source"),
    ).resolves.toEqual(before.retirement);
    await expect(store.inspectManagedCandidateKnowledgeFiles()).resolves.toEqual(before.inventory);
    expect(
      queryDatabase(root, "SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_events"),
    ).toEqual(before.journal);
    expect(
      queryDatabase(
        root,
        `SELECT directory_id, candidate_knowledge_base_id, source_id, relative_path_hash
         FROM candidate_knowledge_directory_members`,
      ),
    ).toEqual(before.baseline);

    const noop = await store.moveManagedCandidateKnowledgeDirectoryMember({
      ...moveInput,
      sourcePath: movedPath,
      expectedMemberRevision: 2,
      expectedRelativePathHash: sha256("nested/first.md"),
      expectedOriginBoundAt: "2026-08-21T14:04:00.000Z",
      movedAt: "2026-08-21T14:05:00.000Z",
    });
    expect(noop.moved).toBe(false);
    expect(noop.revision).toEqual(moved.revision);

    await writeFile(initialPath, content, "utf8");
    const returned = await store.moveManagedCandidateKnowledgeDirectoryMember({
      ...moveInput,
      sourcePath: initialPath,
      expectedMemberRevision: 2,
      expectedRelativePathHash: sha256("nested/first.md"),
      expectedOriginBoundAt: "2026-08-21T14:04:00.000Z",
      movedAt: "2026-08-21T14:06:00.000Z",
    });
    expect(returned.moved).toBe(true);
    expect(returned.revision.revision).toBe(3);
    expect(returned.revision.relativePathHash).toBe(sha256("first.md"));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "other-move-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "other.md",
        createdAt: "2026-08-21T14:07:00.000Z",
      },
      managedVersion(otherPath, content, {
        id: "other-move-version",
        createdAt: "2026-08-21T14:07:00.000Z",
        directoryId: "move-directory",
      }),
    );
    await expect(
      store.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        sourcePath: otherPath,
        expectedMemberRevision: 3,
        expectedRelativePathHash: sha256("first.md"),
        expectedOriginBoundAt: "2026-08-21T14:06:00.000Z",
        movedAt: "2026-08-21T14:08:00.000Z",
      }),
    ).rejects.toThrow(/belongs to another source/i);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.getCandidateKnowledgeDirectoryMemberCurrentRevision(
        "ckb-default",
        "move-directory",
        "move-source",
      ),
    ).resolves.toEqual(returned.revision);
    await expect(
      reopened.listCandidateKnowledgeDirectoryMembers("ckb-default", "move-directory"),
    ).resolves.toEqual([
      {
        directoryId: "move-directory",
        knowledgeBaseId: "ckb-default",
        sourceId: "move-source",
        relativePathHash: sha256("first.md"),
      },
      {
        directoryId: "move-directory",
        knowledgeBaseId: "ckb-default",
        sourceId: "other-move-source",
        relativePathHash: sha256("other.md"),
      },
    ]);
    await reopened.retireCandidateKnowledgeSource("ckb-default", "move-source", {
      retiredAt: "2026-08-21T14:09:00.000Z",
      reason: "user-requested",
    });
    await expect(
      reopened.moveManagedCandidateKnowledgeDirectoryMember({
        ...moveInput,
        expectedMemberRevision: 3,
        expectedRelativePathHash: sha256("first.md"),
        expectedOriginBoundAt: "2026-08-21T14:06:00.000Z",
        movedAt: "2026-08-21T14:10:00.000Z",
      }),
    ).rejects.toThrow(/retired/i);
    await reopened.close();
    mutateDatabase(
      root,
      `DROP TRIGGER candidate_knowledge_directory_member_revisions_immutable_update;
       UPDATE candidate_knowledge_directory_member_revisions
       SET revision = 4
       WHERE directory_id = 'move-directory' AND source_id = 'move-source' AND revision = 3;`,
    );
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/non-contiguous/i);
  });

  it("fails closed and rolls back every guarded multi-member root rebind failure", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const firstDirectory = join(parent, "selected-first");
    const secondDirectory = join(parent, "selected-second");
    const firstPath = join(firstDirectory, "nested", "first.md");
    const secondPath = join(firstDirectory, "nested", "second.md");
    const reboundFirstPath = join(secondDirectory, "nested", "first.md");
    const reboundSecondPath = join(secondDirectory, "nested", "second.md");
    const firstContent = "first evidence";
    const secondContent = "second evidence";
    const updatedFirstContent = "first evidence updated";
    await mkdir(dirname(firstPath), { recursive: true });
    await mkdir(dirname(reboundFirstPath), { recursive: true });
    await writeFile(firstPath, firstContent, "utf8");
    await writeFile(secondPath, secondContent, "utf8");
    await writeFile(reboundFirstPath, firstContent, "utf8");
    await writeFile(reboundSecondPath, secondContent, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "rebind-first-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "first.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(firstPath, firstContent, { id: "rebind-first-version-1" }),
    );
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "rebind-second-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "second.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(secondPath, secondContent, { id: "rebind-second-version-1" }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "multi-rebind-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(firstDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["rebind-first-source", "rebind-second-source"],
    });
    await writeFile(firstPath, updatedFirstContent, "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "rebind-first-source",
      managedVersion(firstPath, updatedFirstContent, {
        id: "rebind-first-version-2",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );
    await writeFile(reboundFirstPath, updatedFirstContent, "utf8");
    const origins = new Map<string, string>();
    for (const sourceId of ["rebind-first-source", "rebind-second-source"]) {
      const origin = await store.getCandidateKnowledgeSourceOriginBinding("ckb-default", sourceId);
      if (origin === undefined) throw new Error(`expected origin for ${sourceId}`);
      origins.set(sourceId, origin.boundAt);
    }
    await store.upsertCandidateKnowledgeSourceRefreshObservation(
      "ckb-default",
      "rebind-first-source",
      {
        observedVersionId: "rebind-first-version-2",
        status: "current",
        checkedAt: "2026-08-21T14:05:00.000Z",
      },
    );

    type RebindMember = RebindManagedCandidateKnowledgeDirectoryRootInput["members"][number];
    const validMembers = (): readonly RebindMember[] => [
      {
        sourceId: "rebind-first-source",
        sourcePath: reboundFirstPath,
        mediaType: "text/markdown",
        checksum: sha256(updatedFirstContent),
        sizeBytes: Buffer.byteLength(updatedFirstContent),
        expectedVersionId: "rebind-first-version-2",
        expectedOriginBoundAt: origins.get("rebind-first-source") as string,
      },
      {
        sourceId: "rebind-second-source",
        sourcePath: reboundSecondPath,
        mediaType: "text/markdown",
        checksum: sha256(secondContent),
        sizeBytes: Buffer.byteLength(secondContent),
        expectedVersionId: "rebind-second-version-1",
        expectedOriginBoundAt: origins.get("rebind-second-source") as string,
      },
    ];
    const currentRoot = await realpath(firstDirectory);
    const makeInput = (
      overrides: Partial<RebindManagedCandidateKnowledgeDirectoryRootInput> = {},
    ): RebindManagedCandidateKnowledgeDirectoryRootInput => ({
      knowledgeBaseId: "ckb-default",
      directoryId: "multi-rebind-directory",
      candidateRootPath: secondDirectory,
      expectedRootPath: currentRoot,
      expectedRevision: 1,
      reboundAt: "2026-08-21T14:06:00.000Z",
      members: validMembers(),
      ...overrides,
    });
    const baselineMembers = validMembers();
    const firstMember = baselineMembers[0];
    const secondMember = baselineMembers[1];
    if (firstMember === undefined || secondMember === undefined) {
      throw new Error("expected two directory rebind members");
    }
    const before = {
      binding: await store.getCandidateKnowledgeDirectoryBinding(
        "ckb-default",
        "multi-rebind-directory",
      ),
      revision: await store.getCandidateKnowledgeDirectoryCurrentRootRevision(
        "ckb-default",
        "multi-rebind-directory",
      ),
      members: await store.listCandidateKnowledgeDirectoryMembers(
        "ckb-default",
        "multi-rebind-directory",
      ),
      origins: await Promise.all(
        ["rebind-first-source", "rebind-second-source"].map((sourceId) =>
          store.getCandidateKnowledgeSourceOriginBinding("ckb-default", sourceId),
        ),
      ),
      observation: await store.getCandidateKnowledgeSourceRefreshObservation(
        "ckb-default",
        "rebind-first-source",
      ),
      retirement: await store.getCandidateKnowledgeSourceRetirement(
        "ckb-default",
        "rebind-first-source",
      ),
      inventory: await store.inspectManagedCandidateKnowledgeFiles(),
      journal: queryDatabase(
        root,
        "SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_events",
      ),
    };
    const expectGraphUnchanged = async (): Promise<void> => {
      await expect(
        store.getCandidateKnowledgeDirectoryBinding("ckb-default", "multi-rebind-directory"),
      ).resolves.toEqual(before.binding);
      await expect(
        store.getCandidateKnowledgeDirectoryCurrentRootRevision(
          "ckb-default",
          "multi-rebind-directory",
        ),
      ).resolves.toEqual(before.revision);
      await expect(
        store.listCandidateKnowledgeDirectoryMembers("ckb-default", "multi-rebind-directory"),
      ).resolves.toEqual(before.members);
      await expect(
        Promise.all(
          ["rebind-first-source", "rebind-second-source"].map((sourceId) =>
            store.getCandidateKnowledgeSourceOriginBinding("ckb-default", sourceId),
          ),
        ),
      ).resolves.toEqual(before.origins);
    };
    const expectRejected = async (
      input: RebindManagedCandidateKnowledgeDirectoryRootInput,
      message: RegExp,
    ): Promise<void> => {
      await expect(store.rebindManagedCandidateKnowledgeDirectoryRoot(input)).rejects.toThrow(
        message,
      );
      await expectGraphUnchanged();
    };

    await expectRejected(
      makeInput({ expectedRootPath: join(parent, "not-the-current-root") }),
      /root changed/i,
    );
    await expectRejected(makeInput({ expectedRevision: 2 }), /root changed/i);
    const staleVersionMembers = baselineMembers.map<RebindMember>((member, index) =>
      index === 0 ? { ...member, expectedVersionId: "rebind-first-version-1" } : member,
    );
    await expectRejected(makeInput({ members: staleVersionMembers }), /latest version changed/i);
    const staleOriginMembers = baselineMembers.map<RebindMember>((member, index) =>
      index === 1 ? { ...member, expectedOriginBoundAt: "2026-08-21T14:01:01.000Z" } : member,
    );
    await expectRejected(makeInput({ members: staleOriginMembers }), /origin changed/i);
    await expectRejected(
      makeInput({ members: baselineMembers.slice(0, 1) }),
      /immutable membership/i,
    );
    await expectRejected(
      makeInput({
        members: [
          ...baselineMembers,
          {
            ...secondMember,
            sourceId: "unmatched-source",
          },
        ],
      }),
      /immutable membership/i,
    );
    await expectRejected(makeInput({ members: [...baselineMembers, secondMember] }), /unique/i);
    await expectRejected(
      makeInput({
        members: [
          {
            ...firstMember,
            sourcePath: reboundSecondPath,
            checksum: secondMember.checksum,
            sizeBytes: secondMember.sizeBytes,
          },
          {
            ...secondMember,
            sourcePath: reboundFirstPath,
            checksum: firstMember.checksum,
            sizeBytes: firstMember.sizeBytes,
          },
        ],
      }),
      /does not match membership/i,
    );
    await expectRejected(
      makeInput({ reboundAt: "2026-08-21T14:04:00.000Z" }),
      /must not precede member state/i,
    );

    if (process.platform !== "win32") {
      const candidateRootLink = join(parent, "selected-second-link");
      await symlink(secondDirectory, candidateRootLink, "dir");
      await expectRejected(makeInput({ candidateRootPath: candidateRootLink }), /symbolic link/i);
    }
    await expectRejected(makeInput({ candidateRootPath: root }), /outside its store/i);
    const unstableMembers = baselineMembers.map<RebindMember>((member, index) =>
      index === 0
        ? {
            ...member,
            beforeSourceRecheck: async () => {
              await writeFile(reboundFirstPath, "changed during verification", "utf8");
            },
          }
        : member,
    );
    await expectRejected(
      makeInput({ members: unstableMembers }),
      /changed while it was being verified/i,
    );

    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "rebind-first-source"),
    ).resolves.toMatchObject({ observedVersionId: "rebind-first-version-2" });
    await expect(
      store.getCandidateKnowledgeSourceRetirement("ckb-default", "rebind-first-source"),
    ).resolves.toEqual(before.retirement);
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "rebind-first-source"),
    ).resolves.toEqual(before.observation);
    await expect(store.inspectManagedCandidateKnowledgeFiles()).resolves.toEqual(before.inventory);
    expect(
      queryDatabase(root, "SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_events"),
    ).toEqual(before.journal);
    await store.close();
  });

  it("guards directory-member retirement and preserves immutable evidence", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "first.md");
    const replacementPath = join(parent, "moved-first.md");
    const initialContent = "initial evidence";
    const updatedContent = "updated evidence";
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, initialContent, "utf8");
    await writeFile(replacementPath, updatedContent, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "retire-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "first.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(sourcePath, initialContent, {
        id: "retire-version-first",
      }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "retire-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["retire-source"],
    });
    const expectedRootPath = await realpath(selectedDirectory);
    const expectedRelativePathHash = sha256("first.md");

    const guards: readonly {
      readonly expectedRootPath?: string;
      readonly expectedRootRevision?: number;
      readonly expectedMemberRevision?: number;
      readonly expectedRelativePathHash?: string;
    }[] = [
      { expectedRootPath: join(parent, "different-root") },
      { expectedRootRevision: 2 },
      { expectedMemberRevision: 2 },
      { expectedRelativePathHash: sha256("other.md") },
    ];
    for (const guard of guards) {
      await expect(
        store.retireCandidateKnowledgeDirectoryMember(
          "ckb-default",
          "retire-directory",
          "retire-source",
          {
            retiredAt: "2026-08-21T14:02:30.000Z",
            expectedRootPath: guard.expectedRootPath ?? expectedRootPath,
            expectedRootRevision: guard.expectedRootRevision ?? 1,
            expectedMemberRevision: guard.expectedMemberRevision ?? 1,
            expectedRelativePathHash: guard.expectedRelativePathHash ?? expectedRelativePathHash,
            expectedVersionId: "retire-version-first",
            expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
          },
        ),
      ).rejects.toThrow(/changed during retirement/i);
    }
    await expect(
      store.getCandidateKnowledgeSourceRetirement("ckb-default", "retire-source"),
    ).resolves.toBeUndefined();

    await expect(
      store.retireCandidateKnowledgeDirectoryMember(
        "ckb-default",
        "retire-directory",
        "retire-source",
        {
          retiredAt: "2026-08-21T14:01:30.000Z",
          expectedRootPath,
          expectedRootRevision: 1,
          expectedMemberRevision: 1,
          expectedRelativePathHash,
          expectedVersionId: "retire-version-first",
          expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
        },
      ),
    ).rejects.toThrow(/must not precede directory binding/i);
    await expect(
      store.getCandidateKnowledgeSourceRetirement("ckb-default", "retire-source"),
    ).resolves.toBeUndefined();

    await writeFile(sourcePath, updatedContent, "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "retire-source",
      managedVersion(sourcePath, updatedContent, {
        id: "retire-version-second",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );
    await expect(
      store.retireCandidateKnowledgeDirectoryMember(
        "ckb-default",
        "retire-directory",
        "retire-source",
        {
          retiredAt: "2026-08-21T14:04:00.000Z",
          expectedRootPath,
          expectedRootRevision: 1,
          expectedMemberRevision: 1,
          expectedRelativePathHash,
          expectedVersionId: "retire-version-first",
          expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
        },
      ),
    ).rejects.toThrow(/latest version changed/i);

    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "retire-source", {
      sourcePath: replacementPath,
      mediaType: "text/markdown",
      checksum: sha256(updatedContent),
      sizeBytes: Buffer.byteLength(updatedContent),
      boundAt: "2026-08-21T14:04:30.000Z",
    });
    await expect(
      store.retireCandidateKnowledgeDirectoryMember(
        "ckb-default",
        "retire-directory",
        "retire-source",
        {
          retiredAt: "2026-08-21T14:05:00.000Z",
          expectedRootPath,
          expectedRootRevision: 1,
          expectedMemberRevision: 1,
          expectedRelativePathHash,
          expectedVersionId: "retire-version-second",
          expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
        },
      ),
    ).rejects.toThrow(/origin revision changed/i);

    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "retire-source", {
      sourcePath,
      mediaType: "text/markdown",
      checksum: sha256(updatedContent),
      sizeBytes: Buffer.byteLength(updatedContent),
      boundAt: "2026-08-21T14:05:30.000Z",
    });
    await store.upsertCandidateKnowledgeDirectoryRefreshObservations(
      "ckb-default",
      "retire-directory",
      {
        checkedAt: "2026-08-21T14:07:00.000Z",
        entries: [
          {
            sourceId: "retire-source",
            observedVersionId: "retire-version-second",
            status: "missing",
            expectedOriginBoundAt: "2026-08-21T14:05:30.000Z",
          },
        ],
      },
    );
    const beforeRetirement = {
      source: await store.getCandidateKnowledgeSource("ckb-default", "retire-source"),
      versions: await store.listCandidateKnowledgeSourceVersions("ckb-default", "retire-source"),
      origin: await store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "retire-source"),
      members: await store.listCandidateKnowledgeDirectoryMembers(
        "ckb-default",
        "retire-directory",
      ),
      observation: await store.getCandidateKnowledgeSourceRefreshObservation(
        "ckb-default",
        "retire-source",
      ),
      inventory: await store.inspectManagedCandidateKnowledgeFiles(),
    };

    await expect(
      store.retireCandidateKnowledgeDirectoryMember(
        "ckb-default",
        "retire-directory",
        "retire-source",
        {
          retiredAt: "2026-08-21T14:06:00.000Z",
          expectedRootPath,
          expectedRootRevision: 1,
          expectedMemberRevision: 1,
          expectedRelativePathHash,
          expectedVersionId: "retire-version-second",
          expectedOriginBoundAt: "2026-08-21T14:05:30.000Z",
        },
      ),
    ).rejects.toThrow(/refresh observation/i);
    const retirement = await store.retireCandidateKnowledgeDirectoryMember(
      "ckb-default",
      "retire-directory",
      "retire-source",
      {
        retiredAt: "2026-08-21T14:08:00.000Z",
        expectedRootPath,
        expectedRootRevision: 1,
        expectedMemberRevision: 1,
        expectedRelativePathHash,
        expectedVersionId: "retire-version-second",
        expectedOriginBoundAt: "2026-08-21T14:05:30.000Z",
      },
    );
    expect(retirement).toEqual({
      sourceId: "retire-source",
      retiredAt: "2026-08-21T14:08:00.000Z",
      reason: "user-requested",
    });
    await expect(
      store.retireCandidateKnowledgeDirectoryMember(
        "ckb-default",
        "retire-directory",
        "retire-source",
        {
          retiredAt: "2026-08-21T14:09:00.000Z",
          expectedRootPath,
          expectedRootRevision: 1,
          expectedMemberRevision: 1,
          expectedRelativePathHash,
          expectedVersionId: "stale-version",
          expectedOriginBoundAt: "2026-08-21T14:01:00.000Z",
        },
      ),
    ).resolves.toEqual(retirement);

    expect({
      source: await store.getCandidateKnowledgeSource("ckb-default", "retire-source"),
      versions: await store.listCandidateKnowledgeSourceVersions("ckb-default", "retire-source"),
      origin: await store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "retire-source"),
      members: await store.listCandidateKnowledgeDirectoryMembers(
        "ckb-default",
        "retire-directory",
      ),
      observation: await store.getCandidateKnowledgeSourceRefreshObservation(
        "ckb-default",
        "retire-source",
      ),
      inventory: await store.inspectManagedCandidateKnowledgeFiles(),
    }).toEqual(beforeRetirement);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.getCandidateKnowledgeSourceRetirement("ckb-default", "retire-source"),
    ).resolves.toEqual(retirement);
    await expect(
      reopened.listCandidateKnowledgeDirectoryMembers("ckb-default", "retire-directory"),
    ).resolves.toEqual(beforeRetirement.members);
    await reopened.close();
  });

  it("finds directory members by historical path hash after an origin rebind", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const candidateDirectory = join(parent, "candidate-root");
    const sourcePath = join(selectedDirectory, "first.md");
    const movedPath = join(selectedDirectory, "moved.md");
    const candidatePath = join(candidateDirectory, "first.md");
    const content = "directory evidence";
    await mkdir(selectedDirectory);
    await mkdir(candidateDirectory);
    await writeFile(sourcePath, content, "utf8");
    await writeFile(movedPath, content, "utf8");
    await writeFile(candidatePath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createCandidateKnowledgeBase({
      id: "ckb-other",
      displayName: "Other evidence",
      isDefault: false,
      createdAt: "2026-08-21T14:01:00.000Z",
    });
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "lookup-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "first.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(sourcePath, content, { id: "lookup-version" }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "lookup-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["lookup-source"],
    });

    const originalMember = await store.findCandidateKnowledgeDirectoryMemberByPath(
      "ckb-default",
      "lookup-directory",
      await realpath(sourcePath),
    );
    expect(originalMember).toMatchObject({
      sourceId: "lookup-source",
      relativePathHash: sha256("first.md"),
    });
    expect(originalMember && Object.isFrozen(originalMember)).toBe(true);
    const candidateMember = await store.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
      "ckb-default",
      "lookup-directory",
      await realpath(candidateDirectory),
      await realpath(candidatePath),
    );
    expect(candidateMember).toEqual(originalMember);
    expect(candidateMember && Object.isFrozen(candidateMember)).toBe(true);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        "ckb-other",
        "lookup-directory",
        await realpath(candidateDirectory),
        await realpath(candidatePath),
      ),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        "ckb-default",
        "missing-directory",
        await realpath(candidateDirectory),
        await realpath(candidatePath),
      ),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        "ckb-default",
        "lookup-directory",
        await realpath(candidateDirectory),
        join(candidateDirectory, "unbound.md"),
      ),
    ).resolves.toBeUndefined();
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        "ckb-default",
        "lookup-directory",
        await realpath(candidateDirectory),
        await realpath(root),
      ),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        "ckb-default",
        "lookup-directory",
        await realpath(candidatePath),
        await realpath(candidatePath),
      ),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-default",
        "missing-directory",
        await realpath(sourcePath),
      ),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-other",
        "lookup-directory",
        await realpath(sourcePath),
      ),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-default",
        "lookup-directory",
        await realpath(movedPath),
      ),
    ).resolves.toBeUndefined();
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-default",
        "lookup-directory",
        await realpath(selectedDirectory),
      ),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-default",
        "lookup-directory",
        await realpath(root),
      ),
    ).rejects.toThrow();

    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "lookup-source", {
      sourcePath: movedPath,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      boundAt: "2026-08-21T14:03:00.000Z",
    });
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-default",
        "lookup-directory",
        await realpath(sourcePath),
      ),
    ).resolves.toEqual(originalMember);
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByPath(
        "ckb-default",
        "lookup-directory",
        await realpath(movedPath),
      ),
    ).resolves.toBeUndefined();
    await expect(
      store.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        "ckb-default",
        "lookup-directory",
        await realpath(candidateDirectory),
        await realpath(candidatePath),
      ),
    ).resolves.toEqual(originalMember);
    await store.close();
    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.findCandidateKnowledgeDirectoryMemberByCandidateRootAndPath(
        "ckb-default",
        "lookup-directory",
        await realpath(candidateDirectory),
        await realpath(candidatePath),
      ),
    ).resolves.toEqual(originalMember);
    await reopened.close();
  });

  it("reports path-free origin relations without rewriting historical membership", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const outsideDirectory = join(parent, "outside");
    const content = "shared directory evidence";
    await mkdir(selectedDirectory);
    await mkdir(outsideDirectory);
    const paths = {
      same: join(selectedDirectory, "same.md"),
      other: join(selectedDirectory, "other.md"),
      unmatched: join(selectedDirectory, "unmatched.md"),
      outsideMember: join(selectedDirectory, "outside-member.md"),
      unbound: join(selectedDirectory, "unbound.md"),
      unmatchedReplacement: join(selectedDirectory, "new-unmatched.md"),
      outsideReplacement: join(outsideDirectory, "outside.md"),
    };
    await Promise.all(
      [paths.same, paths.other, paths.unmatched, paths.outsideMember, paths.unbound].map((path) =>
        writeFile(path, content, "utf8"),
      ),
    );
    await writeFile(paths.unmatchedReplacement, content, "utf8");
    await writeFile(paths.outsideReplacement, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const sourceIds = [
      "same-source",
      "other-source",
      "unmatched-source",
      "outside-source",
      "unbound-source",
    ];
    for (const [index, sourceId] of sourceIds.entries()) {
      await store.createManagedCandidateKnowledgeFileSource(
        {
          id: sourceId,
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: `${sourceId}.md`,
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(paths[Object.keys(paths)[index] as keyof typeof paths], content, {
          id: `${sourceId}-version`,
        }),
      );
    }
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "relations-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds,
    });

    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "other-source", {
      sourcePath: paths.same,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      boundAt: "2026-08-21T14:03:00.000Z",
    });
    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "unmatched-source", {
      sourcePath: paths.unmatchedReplacement,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      boundAt: "2026-08-21T14:03:00.000Z",
    });
    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "outside-source", {
      sourcePath: paths.outsideReplacement,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      boundAt: "2026-08-21T14:03:00.000Z",
    });

    await expect(
      store.getCandidateKnowledgeDirectoryMemberOriginRelation(
        "ckb-default",
        "relations-directory",
        "same-source",
      ),
    ).resolves.toEqual({
      directoryId: "relations-directory",
      knowledgeBaseId: "ckb-default",
      sourceId: "same-source",
      relation: "same-member",
      originBoundAt: "2026-08-21T14:01:00.000Z",
    });
    await expect(
      store.getCandidateKnowledgeDirectoryMemberOriginRelation(
        "ckb-default",
        "relations-directory",
        "other-source",
      ),
    ).resolves.toMatchObject({ relation: "other-member", sourceId: "other-source" });
    await expect(
      store.getCandidateKnowledgeDirectoryMemberOriginRelation(
        "ckb-default",
        "relations-directory",
        "unmatched-source",
      ),
    ).resolves.toMatchObject({ relation: "unmatched", sourceId: "unmatched-source" });
    await expect(
      store.getCandidateKnowledgeDirectoryMemberOriginRelation(
        "ckb-default",
        "relations-directory",
        "outside-source",
      ),
    ).resolves.toMatchObject({ relation: "outside-root", sourceId: "outside-source" });

    mutateDatabase(
      root,
      `DROP TRIGGER candidate_knowledge_source_origin_bindings_immutable_delete;
       DELETE FROM candidate_knowledge_source_origin_bindings WHERE source_id = 'unbound-source'`,
    );
    const unbound = await store.getCandidateKnowledgeDirectoryMemberOriginRelation(
      "ckb-default",
      "relations-directory",
      "unbound-source",
    );
    expect(unbound).toEqual({
      directoryId: "relations-directory",
      knowledgeBaseId: "ckb-default",
      sourceId: "unbound-source",
      relation: "unbound",
    });
    expect(Object.isFrozen(unbound)).toBe(true);
    await expect(
      store.getCandidateKnowledgeDirectoryMemberOriginRelation(
        "ckb-default",
        "missing-directory",
        "same-source",
      ),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      store.getCandidateKnowledgeDirectoryMemberOriginRelation(
        "ckb-default",
        "relations-directory",
        "missing-source",
      ),
    ).rejects.toThrow(StorageValidationError);
    await store.close();
  });

  it("rejects invalid directory members before creating a binding", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const outsideDirectory = join(parent, "outside");
    const selectedPath = join(selectedDirectory, "selected.md");
    const duplicatePath = join(selectedDirectory, "duplicate.md");
    const outsidePath = join(outsideDirectory, "outside.md");
    await mkdir(selectedDirectory);
    await mkdir(outsideDirectory);
    await writeFile(selectedPath, "selected", "utf8");
    await writeFile(duplicatePath, "duplicate", "utf8");
    await writeFile(outsidePath, "outside", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createCandidateKnowledgeBase({
      id: "ckb-other",
      displayName: "Other",
      isDefault: false,
      createdAt: "2026-08-21T14:01:00.000Z",
    });
    const managedSource = async (id: string, sourcePath: string, knowledgeBaseId = "ckb-default") =>
      store.createManagedCandidateKnowledgeFileSource(
        {
          id,
          knowledgeBaseId,
          kind: "file",
          displayName: `${id}.md`,
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(sourcePath, await readFile(sourcePath, "utf8"), {
          id: `${id}-version`,
        }),
      );
    await managedSource("selected-source", selectedPath);
    await managedSource("duplicate-source", selectedPath);
    await managedSource("outside-source", outsidePath);
    await managedSource("other-source", selectedPath, "ckb-other");
    await store.createCandidateKnowledgeSource(
      {
        id: "unmanaged-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Unmanaged",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      {
        id: "unmanaged-version",
        mediaType: "text/markdown",
        checksum: sha256("unmanaged"),
        sizeBytes: 9,
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );
    await store.createCandidateKnowledgeSource(
      {
        id: "url-source",
        knowledgeBaseId: "ckb-default",
        kind: "url",
        displayName: "URL",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      {
        id: "url-version",
        mediaType: "text/plain",
        checksum: sha256("url"),
        sizeBytes: 3,
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );
    await managedSource("retired-source", duplicatePath);
    await store.retireCandidateKnowledgeSource("ckb-default", "retired-source", {
      retiredAt: "2026-08-21T14:02:00.000Z",
      reason: "user-requested",
    });
    const selectedRoot = await realpath(selectedDirectory);
    const selectedOrigin = await realpath(selectedPath);
    const expectRejected = (
      input: Parameters<typeof store.createCandidateKnowledgeDirectoryBinding>[0],
    ) => expect(store.createCandidateKnowledgeDirectoryBinding(input)).rejects.toThrow();

    await expectRejected({
      id: "directory-missing",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["missing-source"],
    });
    await expectRejected({
      id: "directory-url",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["url-source"],
    });
    await expectRejected({
      id: "directory-unmanaged",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["unmanaged-source"],
    });
    await expectRejected({
      id: "directory-retired",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["retired-source"],
    });
    await expectRejected({
      id: "directory-outside",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["outside-source"],
    });
    await expectRejected({
      id: "directory-equal",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedOrigin,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["selected-source"],
    });
    await expectRejected({
      id: "directory-cross-ckb",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["other-source"],
    });
    await expectRejected({
      id: "directory-duplicate-source",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["selected-source", "selected-source"],
    });
    await expectRejected({
      id: "directory-duplicate-member",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["selected-source", "duplicate-source"],
    });
    await expectRejected({
      id: "directory-invalid-time",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "not-a-time",
      sourceIds: ["selected-source"],
    });
    await expectRejected({
      id: "directory-before-source",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:00:00.000Z",
      sourceIds: ["selected-source"],
    });
    await expectRejected({
      id: " ",
      knowledgeBaseId: "ckb-default",
      rootPath: selectedRoot,
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: [],
    });
    expect(
      queryDatabase(root, "SELECT COUNT(*) AS count FROM candidate_knowledge_directory_bindings"),
    ).toEqual([{ count: 0 }]);
    await store.close();
  });

  it("rebinds exact bytes without creating a version, blob, or journal entry", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const originalPath = join(parent, "candidate.md");
    const replacementPath = join(parent, "replacement.md");
    const content = "candidate evidence";
    await writeFile(originalPath, content, "utf8");
    await writeFile(replacementPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "bound-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt,
      },
      managedVersion(originalPath, content),
    );
    const beforeVersions = await store.listCandidateKnowledgeSourceVersions(
      "ckb-default",
      "bound-source",
    );
    const beforeSources = await snapshotSourcesTree(root);
    const beforeJournal = queryDatabase(
      root,
      "SELECT operation_id, state FROM candidate_knowledge_managed_write_events ORDER BY operation_id, sequence",
    );

    const rebound = await store.rebindManagedCandidateKnowledgeFileOrigin(
      "ckb-default",
      "bound-source",
      {
        sourcePath: replacementPath,
        mediaType: "text/markdown",
        checksum: sha256(content),
        sizeBytes: Buffer.byteLength(content),
        boundAt: "2026-08-21T14:02:00.000Z",
      },
    );
    expect(rebound).toEqual({
      binding: {
        sourceId: "bound-source",
        originPath: await realpath(replacementPath),
        boundAt: "2026-08-21T14:02:00.000Z",
      },
      rebound: true,
    });
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", "bound-source"),
    ).resolves.toEqual(beforeVersions);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeSources);
    expect(
      queryDatabase(
        root,
        "SELECT operation_id, state FROM candidate_knowledge_managed_write_events ORDER BY operation_id, sequence",
      ),
    ).toEqual(beforeJournal);

    const current = await store.rebindManagedCandidateKnowledgeFileOrigin(
      "ckb-default",
      "bound-source",
      {
        sourcePath: replacementPath,
        mediaType: "text/markdown",
        checksum: sha256(content),
        sizeBytes: Buffer.byteLength(content),
        boundAt: "2026-08-21T14:03:00.000Z",
      },
    );
    expect(current).toEqual({ rebound: false, binding: rebound.binding });
    await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeSources);
    await store.close();
  });

  it("keeps retired sources readable but rejects every mutating source path", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "candidate.md");
    const content = "candidate evidence";
    await writeFile(sourcePath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const created = await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "retired-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt,
      },
      managedVersion(sourcePath, content),
    );
    const originBefore = await store.getCandidateKnowledgeSourceOriginBinding(
      "ckb-default",
      created.source.id,
    );
    const versionsBefore = await store.listCandidateKnowledgeSourceVersions(
      "ckb-default",
      created.source.id,
    );
    const sourcesBefore = await snapshotSourcesTree(root);
    await expect(
      store.getCandidateKnowledgeSourceRetirement("ckb-default", created.source.id),
    ).resolves.toBeUndefined();

    const retirement = await store.retireCandidateKnowledgeSource(
      "ckb-default",
      created.source.id,
      { retiredAt: "2026-08-21T14:02:00.000Z", reason: "user-requested" },
    );
    expect(Object.isFrozen(retirement)).toBe(true);
    await expect(
      store.retireCandidateKnowledgeSource("ckb-default", created.source.id, {
        retiredAt: "2026-08-21T14:03:00.000Z",
        reason: "user-requested",
      }),
    ).rejects.toThrow(/conflicts/i);
    await expect(
      store.appendCandidateKnowledgeSourceVersion("ckb-default", created.source.id, {
        id: "retired-version",
        mediaType: "text/markdown",
        checksum: sha256("new bytes"),
        sizeBytes: 9,
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    ).rejects.toThrow(/retired/i);
    await expect(
      store.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        created.source.id,
        managedVersion(sourcePath, "new bytes", {
          id: "retired-managed-version",
          createdAt: "2026-08-21T14:03:00.000Z",
        }),
      ),
    ).rejects.toThrow(/retired/i);
    await expect(
      store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", created.source.id, {
        ...managedVersion(sourcePath, content),
        boundAt: "2026-08-21T14:03:00.000Z",
      }),
    ).rejects.toThrow(/retired/i);
    await expect(
      store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", created.source.id, {
        observedVersionId: created.version.id,
        status: "current",
        checkedAt: "2026-08-21T14:04:00.000Z",
      }),
    ).rejects.toThrow(/retired/i);
    await expect(
      store.getCandidateKnowledgeSource("ckb-default", created.source.id),
    ).resolves.toEqual(created.source);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", created.source.id),
    ).resolves.toEqual(versionsBefore);
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", created.source.id),
    ).resolves.toEqual(originBefore);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(sourcesBefore);
    await store.close();
  });

  it("rejects changed bytes before changing the binding or sources tree", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const originalPath = join(parent, "candidate.md");
    const replacementPath = join(parent, "replacement.md");
    const content = "candidate evidence";
    await writeFile(originalPath, content, "utf8");
    await writeFile(replacementPath, "different evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "bound-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt,
      },
      managedVersion(originalPath, content),
    );
    const before = await store.getCandidateKnowledgeSourceOriginBinding(
      "ckb-default",
      "bound-source",
    );
    const beforeSources = await snapshotSourcesTree(root);
    await expect(
      store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "bound-source", {
        ...managedVersion(replacementPath, "different evidence"),
        boundAt: "2026-08-21T14:02:00.000Z",
      }),
    ).rejects.toThrow(/latest managed version/i);
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "bound-source"),
    ).resolves.toEqual(before);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(beforeSources);
    await store.close();
  });

  it("persists path-free refresh observations and derives stale after a manual append", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "candidate.md");
    const changedPath = join(parent, "changed.md");
    const initialContent = "candidate evidence";
    const changedContent = "changed candidate evidence";
    await writeFile(sourcePath, initialContent, "utf8");
    await writeFile(changedPath, changedContent, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "observed-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt,
      },
      managedVersion(sourcePath, initialContent, { id: "observed-version-1" }),
    );

    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "observed-source"),
    ).resolves.toBeUndefined();
    const observation = await store.upsertCandidateKnowledgeSourceRefreshObservation(
      "ckb-default",
      "observed-source",
      {
        observedVersionId: "observed-version-1",
        status: "current",
        checkedAt: "2026-08-21T14:02:00.000Z",
      },
    );
    expect(observation).toEqual({
      sourceId: "observed-source",
      observedVersionId: "observed-version-1",
      status: "current",
      checkedAt: "2026-08-21T14:02:00.000Z",
      lastRefreshedVersionId: null,
      lastRefreshedAt: null,
      stale: false,
    });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(JSON.stringify(observation)).not.toContain(root);
    expect(JSON.stringify(observation)).not.toContain(sourcePath);
    expect(JSON.stringify(observation)).not.toContain(initialContent);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    try {
      await expect(
        reopened.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "observed-source"),
      ).resolves.toEqual(observation);
      await reopened.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "observed-source",
        managedVersion(changedPath, changedContent, {
          id: "observed-version-2",
          createdAt: "2026-08-21T14:03:00.000Z",
        }),
      );
      await expect(
        reopened.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "observed-source"),
      ).resolves.toEqual({ ...observation, stale: true });
    } finally {
      await reopened.close();
    }
  });

  it("records a deterministic directory observation batch and preserves prior refresh evidence", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const paths = {
      current: join(selectedDirectory, "current.md"),
      changed: join(selectedDirectory, "changed.md"),
      missing: join(selectedDirectory, "missing.md"),
    };
    await mkdir(selectedDirectory);
    await Promise.all(Object.values(paths).map((path) => writeFile(path, "evidence", "utf8")));
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const sourceIds = ["current-source", "changed-source", "missing-source"];
    for (const [index, sourceId] of sourceIds.entries()) {
      await store.createManagedCandidateKnowledgeFileSource(
        {
          id: sourceId,
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: `${sourceId}.md`,
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(Object.values(paths)[index] as string, "evidence", {
          id: `${sourceId}-version-1`,
        }),
      );
    }
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "observations-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds,
    });
    const origins = await Promise.all(
      sourceIds.map((sourceId) =>
        store.getCandidateKnowledgeSourceOriginBinding("ckb-default", sourceId),
      ),
    );
    const expectedOriginBoundAt = origins.map((origin) => origin?.boundAt);
    expect(expectedOriginBoundAt.every((boundAt) => boundAt !== undefined)).toBe(true);

    await expect(
      store.upsertCandidateKnowledgeDirectoryRefreshObservations(
        "ckb-default",
        "observations-directory",
        {
          checkedAt: "2026-08-21T14:00:00.000Z",
          entries: [
            {
              sourceId: "changed-source",
              observedVersionId: "changed-source-version-1",
              status: "changed",
              expectedOriginBoundAt: expectedOriginBoundAt[1] as string,
            },
          ],
        },
      ),
    ).rejects.toThrow(/must not precede directory binding/i);
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "changed-source"),
    ).resolves.toBeUndefined();

    await store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", "current-source", {
      observedVersionId: "current-source-version-1",
      status: "current",
      checkedAt: "2026-08-21T14:03:00.000Z",
      lastRefreshedVersionId: "current-source-version-1",
      lastRefreshedAt: "2026-08-21T14:03:00.000Z",
    });

    const observations = await store.upsertCandidateKnowledgeDirectoryRefreshObservations(
      "ckb-default",
      "observations-directory",
      {
        checkedAt: "2026-08-21T14:04:00.000Z",
        entries: [
          {
            sourceId: "missing-source",
            observedVersionId: "missing-source-version-1",
            status: "missing",
            expectedOriginBoundAt: expectedOriginBoundAt[2] as string,
          },
          {
            sourceId: "current-source",
            observedVersionId: "current-source-version-1",
            status: "current",
            expectedOriginBoundAt: expectedOriginBoundAt[0] as string,
          },
          {
            sourceId: "changed-source",
            observedVersionId: "changed-source-version-1",
            status: "changed",
            expectedOriginBoundAt: expectedOriginBoundAt[1] as string,
          },
        ],
      },
    );
    expect(observations).toEqual([
      {
        sourceId: "changed-source",
        observedVersionId: "changed-source-version-1",
        status: "changed",
        checkedAt: "2026-08-21T14:04:00.000Z",
        lastRefreshedVersionId: null,
        lastRefreshedAt: null,
        stale: false,
      },
      {
        sourceId: "current-source",
        observedVersionId: "current-source-version-1",
        status: "current",
        checkedAt: "2026-08-21T14:04:00.000Z",
        lastRefreshedVersionId: "current-source-version-1",
        lastRefreshedAt: "2026-08-21T14:03:00.000Z",
        stale: false,
      },
      {
        sourceId: "missing-source",
        observedVersionId: "missing-source-version-1",
        status: "missing",
        checkedAt: "2026-08-21T14:04:00.000Z",
        lastRefreshedVersionId: null,
        lastRefreshedAt: null,
        stale: false,
      },
    ]);
    expect(Object.isFrozen(observations)).toBe(true);
    expect(observations.every((observation) => Object.isFrozen(observation))).toBe(true);
    await expect(
      store.upsertCandidateKnowledgeSourceRefreshObservation("ckb-default", "current-source", {
        observedVersionId: "current-source-version-1",
        status: "current",
        checkedAt: "2026-08-21T14:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      lastRefreshedVersionId: "current-source-version-1",
      lastRefreshedAt: "2026-08-21T14:03:00.000Z",
    });
    await expect(
      store.upsertCandidateKnowledgeDirectoryRefreshObservations(
        "ckb-default",
        "observations-directory",
        { checkedAt: "2026-08-21T14:05:00.000Z", entries: [] },
      ),
    ).resolves.toEqual([]);
    await store.close();
  });

  it("rolls back a directory observation batch when a later entry is stale or rebinding changed", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "source.md");
    const laterSourcePath = join(selectedDirectory, "later.md");
    const replacementPath = join(selectedDirectory, "replacement.md");
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, "evidence", "utf8");
    await writeFile(laterSourcePath, "later evidence", "utf8");
    await writeFile(replacementPath, "evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "atomic-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "atomic.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(sourcePath, "evidence", { id: "atomic-version-1" }),
    );
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "later-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "later.md",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(laterSourcePath, "later evidence", { id: "later-version-1" }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "atomic-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["atomic-source", "later-source"],
    });
    const origin = await store.getCandidateKnowledgeSourceOriginBinding(
      "ckb-default",
      "atomic-source",
    );
    if (origin === undefined) throw new Error("expected origin binding");
    const laterOrigin = await store.getCandidateKnowledgeSourceOriginBinding(
      "ckb-default",
      "later-source",
    );
    if (laterOrigin === undefined) throw new Error("expected later origin binding");
    await writeFile(laterSourcePath, "later evidence v2", "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "later-source",
      managedVersion(laterSourcePath, "later evidence v2", {
        id: "later-version-2",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );

    await expect(
      store.upsertCandidateKnowledgeDirectoryRefreshObservations(
        "ckb-default",
        "atomic-directory",
        {
          checkedAt: "2026-08-21T14:04:00.000Z",
          entries: [
            {
              sourceId: "atomic-source",
              observedVersionId: "atomic-version-1",
              status: "current",
              expectedOriginBoundAt: origin.boundAt,
            },
            {
              sourceId: "later-source",
              observedVersionId: "later-version-1",
              status: "current",
              expectedOriginBoundAt: laterOrigin.boundAt,
            },
          ],
        },
      ),
    ).rejects.toThrow(/not latest/i);
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "atomic-source"),
    ).resolves.toBeUndefined();
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "later-source"),
    ).resolves.toBeUndefined();

    await store.retireCandidateKnowledgeSource("ckb-default", "later-source", {
      retiredAt: "2026-08-21T14:04:00.000Z",
      reason: "user-requested",
    });
    await expect(
      store.upsertCandidateKnowledgeDirectoryRefreshObservations(
        "ckb-default",
        "atomic-directory",
        {
          checkedAt: "2026-08-21T14:05:00.000Z",
          entries: [
            {
              sourceId: "later-source",
              observedVersionId: "later-version-2",
              status: "current",
              expectedOriginBoundAt: laterOrigin.boundAt,
            },
          ],
        },
      ),
    ).rejects.toThrow(/retired/i);
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "later-source"),
    ).resolves.toBeUndefined();

    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "atomic-source", {
      sourcePath: replacementPath,
      mediaType: "text/markdown",
      checksum: sha256("evidence"),
      sizeBytes: Buffer.byteLength("evidence"),
      boundAt: "2026-08-21T14:03:00.000Z",
    });
    const before = await store.getCandidateKnowledgeSourceRefreshObservation(
      "ckb-default",
      "atomic-source",
    );
    await expect(
      store.upsertCandidateKnowledgeDirectoryRefreshObservations(
        "ckb-default",
        "atomic-directory",
        {
          checkedAt: "2026-08-21T14:04:00.000Z",
          entries: [
            {
              sourceId: "atomic-source",
              observedVersionId: "atomic-version-1",
              status: "current",
              expectedOriginBoundAt: origin.boundAt,
            },
          ],
        },
      ),
    ).rejects.toThrow(/origin revision/i);
    await expect(
      store.getCandidateKnowledgeSourceRefreshObservation("ckb-default", "atomic-source"),
    ).resolves.toBe(before);
    await store.close();
  });

  it("keeps the binding and graph unchanged for unsafe or unstable rebind selections", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const originalPath = join(parent, "candidate.md");
    const symlinkPath = join(parent, "candidate-link.md");
    const insideStorePath = join(root, "sources", "selected-from-store.md");
    const content = "candidate evidence";
    await writeFile(originalPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "bound-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt,
      },
      managedVersion(originalPath, content),
    );
    const beforeVersions = await store.listCandidateKnowledgeSourceVersions(
      "ckb-default",
      "bound-source",
    );
    const beforeBinding = await store.getCandidateKnowledgeSourceOriginBinding(
      "ckb-default",
      "bound-source",
    );
    const beforeSources = await snapshotSourcesTree(root);
    const expectUnchanged = async (
      expectedSources: readonly string[] = beforeSources,
    ): Promise<void> => {
      await expect(
        store.listCandidateKnowledgeSourceVersions("ckb-default", "bound-source"),
      ).resolves.toEqual(beforeVersions);
      await expect(
        store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "bound-source"),
      ).resolves.toEqual(beforeBinding);
      await expect(snapshotSourcesTree(root)).resolves.toEqual(expectedSources);
    };
    const rebindInput = (
      sourcePath: string,
      options: { readonly beforeSourceRecheck?: () => Promise<void> } = {},
    ) => ({
      sourcePath,
      mediaType: "text/markdown",
      checksum: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      boundAt: "2026-08-21T14:02:00.000Z",
      ...options,
    });

    if (process.platform !== "win32") {
      await symlink(originalPath, symlinkPath, "file");
      await expect(
        store.rebindManagedCandidateKnowledgeFileOrigin(
          "ckb-default",
          "bound-source",
          rebindInput(symlinkPath),
        ),
      ).rejects.toThrow(/symbolic link/i);
      await expectUnchanged();
    }

    await writeFile(insideStorePath, content, "utf8");
    const insideSources = await snapshotSourcesTree(root);
    await expect(
      store.rebindManagedCandidateKnowledgeFileOrigin(
        "ckb-default",
        "bound-source",
        rebindInput(insideStorePath),
      ),
    ).rejects.toThrow(/outside its store/i);
    await expectUnchanged(insideSources);
    await rm(insideStorePath);

    await expect(
      store.rebindManagedCandidateKnowledgeFileOrigin(
        "ckb-default",
        "bound-source",
        rebindInput(originalPath, {
          beforeSourceRecheck: async () => {
            await writeFile(originalPath, "changed while copying", "utf8");
          },
        }),
      ),
    ).rejects.toThrow(/changed while it was being verified/i);
    await expectUnchanged();
    await writeFile(originalPath, content, "utf8");
    await store.close();
  });

  it("migrates v7 sources as unbound", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createCandidateKnowledgeSource(
      {
        id: "legacy-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Legacy source",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      {
        id: "legacy-version",
        mediaType: "text/markdown",
        checksum: "c".repeat(64),
        sizeBytes: 1,
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );
    await store.close();
    mutateDatabase(
      root,
      "DROP TABLE candidate_knowledge_source_url_provenance; DROP TABLE candidate_knowledge_source_retirements; DROP TABLE candidate_knowledge_source_refresh_observations; DROP TABLE candidate_knowledge_source_origin_bindings; DELETE FROM schema_migrations WHERE version IN (8, 9, 10, 11, 12)",
    );

    const migrated = await openCandidateKnowledgeStore(root);
    await expect(
      migrated.getCandidateKnowledgeSourceOriginBinding("ckb-default", "legacy-source"),
    ).resolves.toBeUndefined();
    expect(queryDatabase(root, "SELECT * FROM candidate_knowledge_source_origin_bindings")).toEqual(
      [],
    );
    await migrated.close();
  });

  it("appends, deduplicates, and materializes managed file versions", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    await writeFile(inputPath, "first", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const first = await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "managed-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "first"),
    );
    await writeFile(inputPath, "second", "utf8");
    const second = await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "managed-source",
      managedVersion(inputPath, "second", {
        id: "managed-version-2",
        createdAt: "2026-08-21T14:02:00.000Z",
      }),
    );
    const duplicate = await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "managed-source",
      managedVersion(inputPath, "second", {
        id: "ignored-duplicate-version",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );
    expect(second).toMatchObject({ created: true, version: { version: 2 } });
    expect(duplicate).toEqual({ ...second, created: false });
    await expect(
      store.getManagedCandidateKnowledgeFilePath(
        "ckb-default",
        "managed-source",
        "ignored-duplicate-version",
      ),
    ).resolves.toBeUndefined();

    await store.createCandidateKnowledgeSource(
      {
        id: "legacy-file-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Legacy metadata",
        createdAt: "2026-08-21T14:03:00.000Z",
      },
      {
        id: "legacy-version",
        mediaType: "text/markdown",
        checksum: sha256("second"),
        sizeBytes: Buffer.byteLength("second"),
        createdAt: "2026-08-21T14:03:00.000Z",
      },
    );
    let observedDurableTargetBeforePublished = false;
    const materialized = await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "legacy-file-source",
      managedVersion(inputPath, "second", {
        id: "ignored-materialized-version",
        createdAt: "2026-08-21T14:04:00.000Z",
        afterTargetPublication: async () => {
          expect(
            queryDatabase(
              root,
              `SELECT event.state, event.target_version_id
               FROM candidate_knowledge_managed_write_operations AS operation
               JOIN candidate_knowledge_managed_write_events AS event
                 ON event.operation_id = operation.operation_id
               WHERE operation.requested_version_id = 'ignored-materialized-version'
               ORDER BY event.sequence`,
            ),
          ).toEqual([{ state: "targeted", target_version_id: "legacy-version" }]);
          await expect(
            readFile(
              join(
                root,
                "sources",
                digestSegment("legacy-file-source"),
                digestSegment("legacy-version"),
              ),
              "utf8",
            ),
          ).resolves.toBe("second");
          observedDurableTargetBeforePublished = true;
        },
      }),
    );
    expect(observedDurableTargetBeforePublished).toBe(true);
    expect(materialized).toMatchObject({ created: false, version: { id: "legacy-version" } });
    await expect(
      store.getManagedCandidateKnowledgeFilePath(
        "ckb-default",
        "legacy-file-source",
        "legacy-version",
      ),
    ).resolves.toBe(
      join(root, "sources", digestSegment("legacy-file-source"), digestSegment("legacy-version")),
    );
    expect(
      queryDatabase(
        root,
        `SELECT event.state, event.target_version_id
         FROM candidate_knowledge_managed_write_operations AS operation
         JOIN candidate_knowledge_managed_write_events AS event
           ON event.operation_id = operation.operation_id
         WHERE operation.requested_version_id = 'ignored-materialized-version'
         ORDER BY event.sequence`,
      ),
    ).toEqual([
      { state: "targeted", target_version_id: "legacy-version" },
      { state: "published", target_version_id: "legacy-version" },
      { state: "committed", target_version_id: "legacy-version" },
      { state: "completed", target_version_id: "legacy-version" },
    ]);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", "managed-source"),
    ).resolves.toEqual([first.version, second.version]);
    await store.close();
  });

  it("enforces guarded managed file appends on changed and no-op database paths", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const inputPath = join(selectedDirectory, "candidate.md");
    const replacementPath = join(selectedDirectory, "replacement.md");
    await mkdir(selectedDirectory);
    await writeFile(inputPath, "first", "utf8");
    await writeFile(replacementPath, "second", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "guarded-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "first", { id: "guarded-version-1" }),
    );
    await store.createCandidateKnowledgeDirectoryBinding({
      id: "guarded-directory",
      knowledgeBaseId: "ckb-default",
      rootPath: await realpath(selectedDirectory),
      boundAt: "2026-08-21T14:02:00.000Z",
      sourceIds: ["guarded-source"],
    });
    const origin = await store.getCandidateKnowledgeSourceOriginBinding(
      "ckb-default",
      "guarded-source",
    );
    if (origin === undefined) throw new Error("expected guarded origin");

    await writeFile(inputPath, "second", "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "guarded-source",
      managedVersion(inputPath, "second", {
        id: "guarded-version-2",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );
    await writeFile(inputPath, "third", "utf8");
    await expect(
      store.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "guarded-source",
        managedVersion(inputPath, "third", {
          id: "guarded-version-stale",
          createdAt: "2026-08-21T14:04:00.000Z",
          expectedCurrentVersionId: "guarded-version-1",
          expectedOriginBoundAt: origin.boundAt,
        }),
      ),
    ).rejects.toThrow(/current version changed/i);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", "guarded-source"),
    ).resolves.toHaveLength(2);

    await writeFile(inputPath, "second", "utf8");
    const sourcesBeforeNoopOriginRace = await snapshotSourcesTree(root);
    await expect(
      store.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "guarded-source",
        managedVersion(inputPath, "second", {
          id: "guarded-version-noop-origin",
          createdAt: "2026-08-21T14:05:30.000Z",
          expectedCurrentVersionId: "guarded-version-2",
          expectedOriginBoundAt: origin.boundAt,
          beforeDatabaseWrite: async () => {
            await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "guarded-source", {
              sourcePath: replacementPath,
              mediaType: "text/markdown",
              checksum: sha256("second"),
              sizeBytes: Buffer.byteLength("second"),
              boundAt: origin.boundAt,
            });
          },
        }),
      ),
    ).rejects.toThrow(/origin binding changed/i);
    await expect(snapshotSourcesTree(root)).resolves.toEqual(sourcesBeforeNoopOriginRace);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", "guarded-source"),
    ).resolves.toHaveLength(2);
    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "guarded-source", {
      sourcePath: inputPath,
      mediaType: "text/markdown",
      checksum: sha256("second"),
      sizeBytes: Buffer.byteLength("second"),
      boundAt: origin.boundAt,
    });

    await expect(
      store.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "guarded-source",
        managedVersion(inputPath, "second", {
          id: "guarded-version-noop-stale",
          createdAt: "2026-08-21T14:05:00.000Z",
          expectedCurrentVersionId: "guarded-version-1",
          expectedOriginBoundAt: origin.boundAt,
        }),
      ),
    ).rejects.toThrow(/current version changed/i);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", "guarded-source"),
    ).resolves.toHaveLength(2);

    await writeFile(inputPath, "third", "utf8");
    await expect(
      store.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "guarded-source",
        managedVersion(inputPath, "third", {
          id: "guarded-version-rebound",
          createdAt: "2026-08-21T14:06:00.000Z",
          expectedCurrentVersionId: "guarded-version-2",
          expectedOriginBoundAt: origin.boundAt,
          beforeDatabaseWrite: async () => {
            await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "guarded-source", {
              sourcePath: replacementPath,
              mediaType: "text/markdown",
              checksum: sha256("second"),
              sizeBytes: Buffer.byteLength("second"),
              boundAt: origin.boundAt,
            });
          },
        }),
      ),
    ).rejects.toThrow(/origin binding changed/i);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", "guarded-source"),
    ).resolves.toHaveLength(2);

    await writeFile(inputPath, "second", "utf8");
    await store.rebindManagedCandidateKnowledgeFileOrigin("ckb-default", "guarded-source", {
      sourcePath: inputPath,
      mediaType: "text/markdown",
      checksum: sha256("second"),
      sizeBytes: Buffer.byteLength("second"),
      boundAt: origin.boundAt,
    });
    await writeFile(inputPath, "fourth", "utf8");
    await expect(
      store.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "guarded-source",
        managedVersion(inputPath, "fourth", {
          id: "guarded-version-retired",
          createdAt: "2026-08-21T14:07:00.000Z",
          expectedCurrentVersionId: "guarded-version-2",
          expectedOriginBoundAt: origin.boundAt,
          beforeDatabaseWrite: async () => {
            await store.retireCandidateKnowledgeSource("ckb-default", "guarded-source", {
              retiredAt: "2026-08-21T14:07:00.000Z",
              reason: "user-requested",
            });
          },
        }),
      ),
    ).rejects.toThrow(/retired/i);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", "guarded-source"),
    ).resolves.toHaveLength(2);
    await store.close();
  });

  it("journals intent before staging and records create, changed append, and managed no-op sequences", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "private-candidate-name.md");
    const sourceId = "opaque-source-id";
    const firstContent = "private first content";
    const secondContent = "private second content";
    await writeFile(inputPath, firstContent, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    let observedIntent = false;
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: sourceId,
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Private source label",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, firstContent, {
        id: "version-one",
        beforeSourceRecheck: async () => {
          const operations = queryDatabase(
            root,
            "SELECT operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at FROM candidate_knowledge_managed_write_operations",
          );
          expect(operations).toHaveLength(1);
          expect(operations[0]).toMatchObject({
            candidate_knowledge_base_id: "ckb-default",
            source_id: sourceId,
            requested_version_id: "version-one",
            kind: "create",
          });
          expect(
            queryDatabase(root, "SELECT state FROM candidate_knowledge_managed_write_events"),
          ).toEqual([]);
          expect(await readdir(join(root, "sources"))).toEqual([
            expect.stringMatching(/^\.intake-[0-9a-f]{64}$/u),
          ]);
          const serialized = JSON.stringify(operations);
          for (const secret of [
            inputPath,
            "private-candidate-name.md",
            "Private source label",
            sha256(firstContent),
            firstContent,
          ]) {
            expect(serialized).not.toContain(secret);
          }
          observedIntent = true;
        },
      }),
    );
    expect(observedIntent).toBe(true);

    await writeFile(inputPath, secondContent, "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      sourceId,
      managedVersion(inputPath, secondContent, {
        id: "version-two",
        createdAt: "2026-08-21T14:02:00.000Z",
      }),
    );
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      sourceId,
      managedVersion(inputPath, secondContent, {
        id: "unused-no-op-version",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );

    const events = queryDatabase(
      root,
      `SELECT operation.requested_version_id, event.sequence, event.state, event.target_version_id
       FROM candidate_knowledge_managed_write_operations AS operation
       JOIN candidate_knowledge_managed_write_events AS event
         ON event.operation_id = operation.operation_id
       ORDER BY operation.rowid, event.sequence`,
    );
    expect(events).toEqual([
      {
        requested_version_id: "version-one",
        sequence: 1,
        state: "targeted",
        target_version_id: "version-one",
      },
      {
        requested_version_id: "version-one",
        sequence: 2,
        state: "published",
        target_version_id: "version-one",
      },
      {
        requested_version_id: "version-one",
        sequence: 3,
        state: "committed",
        target_version_id: "version-one",
      },
      {
        requested_version_id: "version-one",
        sequence: 4,
        state: "completed",
        target_version_id: "version-one",
      },
      {
        requested_version_id: "version-two",
        sequence: 1,
        state: "targeted",
        target_version_id: "version-two",
      },
      {
        requested_version_id: "version-two",
        sequence: 2,
        state: "published",
        target_version_id: "version-two",
      },
      {
        requested_version_id: "version-two",
        sequence: 3,
        state: "committed",
        target_version_id: "version-two",
      },
      {
        requested_version_id: "version-two",
        sequence: 4,
        state: "completed",
        target_version_id: "version-two",
      },
      {
        requested_version_id: "unused-no-op-version",
        sequence: 1,
        state: "noop",
        target_version_id: "version-two",
      },
    ]);
    await expect(
      store.listCandidateKnowledgeSourceVersions("ckb-default", sourceId),
    ).resolves.toHaveLength(2);
    await store.close();
  });

  it("records a migrated v6 same-byte append as a non-owning noop", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "legacy-managed.md");
    const content = "legacy managed bytes";
    await writeFile(inputPath, content, "utf8");
    const initial = await initializeCandidateKnowledgeStore(initialization(root));
    const legacy = await initial.createCandidateKnowledgeSource(
      {
        id: "legacy-managed-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Legacy managed source",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      {
        id: "legacy-managed-version",
        mediaType: "text/markdown",
        checksum: sha256(content),
        sizeBytes: Buffer.byteLength(content),
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );
    await initial.close();
    const managedDirectory = join(root, "sources", digestSegment(legacy.source.id));
    await mkdir(managedDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(managedDirectory, digestSegment(legacy.version.id)), content, {
      mode: 0o600,
    });
    mutateDatabase(
      root,
      `INSERT INTO candidate_knowledge_managed_source_versions(version_id)
       VALUES ('legacy-managed-version');
       DROP TABLE candidate_knowledge_managed_write_events;
       DROP TABLE candidate_knowledge_managed_write_operations;
       DELETE FROM schema_migrations WHERE version >= 7`,
    );

    const migrated = await openCandidateKnowledgeStore(root);
    const result = await migrated.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      legacy.source.id,
      managedVersion(inputPath, content, {
        id: "migrated-noop-request",
        createdAt: "2026-08-21T14:02:00.000Z",
      }),
    );
    expect(result).toEqual({ ...legacy, created: false });
    expect(
      queryDatabase(
        root,
        `SELECT operation.requested_version_id, event.state, event.target_version_id
         FROM candidate_knowledge_managed_write_operations AS operation
         JOIN candidate_knowledge_managed_write_events AS event
           ON event.operation_id = operation.operation_id`,
      ),
    ).toEqual([
      {
        requested_version_id: "migrated-noop-request",
        state: "noop",
        target_version_id: "legacy-managed-version",
      },
    ]);
    await migrated.close();
  });

  it("reopens after a historical noop is followed by a changed managed version", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    const sourceId = "historical-noop-source";
    await writeFile(inputPath, "first version", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: sourceId,
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Historical noop source",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "first version", { id: "historical-version-one" }),
    );
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      sourceId,
      managedVersion(inputPath, "first version", {
        id: "historical-noop-request",
        createdAt: "2026-08-21T14:02:00.000Z",
      }),
    );
    await writeFile(inputPath, "second version", "utf8");
    await store.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      sourceId,
      managedVersion(inputPath, "second version", {
        id: "historical-version-two",
        createdAt: "2026-08-21T14:03:00.000Z",
      }),
    );
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.listCandidateKnowledgeSourceVersions("ckb-default", sourceId),
    ).resolves.toHaveLength(2);
    expect(
      queryDatabase(
        root,
        `SELECT event.state, event.target_version_id
         FROM candidate_knowledge_managed_write_operations AS operation
         JOIN candidate_knowledge_managed_write_events AS event
           ON event.operation_id = operation.operation_id
         WHERE operation.requested_version_id = 'historical-noop-request'`,
      ),
    ).toEqual([{ state: "noop", target_version_id: "historical-version-one" }]);
    await reopened.close();
  });

  it("reports clean and managed inventories with verified marker counts", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    await writeFile(inputPath, "candidate evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));

    await expect(store.inspectManagedCandidateKnowledgeFiles()).resolves.toEqual({
      schemaVersion: 1,
      verifiedManagedFileCount: 0,
      scannedEntryCount: 0,
      unknownEntries: {
        intakeShapedFilesAtSourcesRoot: 0,
        opaqueEntriesAtSourcesRoot: 0,
        entriesInsideManagedSourceDirectories: 0,
        symbolicLinks: 0,
        otherEntries: 0,
      },
      complete: true,
      scanLimitReached: false,
    });

    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "managed-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "candidate evidence"),
    );
    const inventory = await store.inspectManagedCandidateKnowledgeFiles();
    expect(inventory).toEqual({
      schemaVersion: 1,
      verifiedManagedFileCount: 1,
      scannedEntryCount: 2,
      unknownEntries: {
        intakeShapedFilesAtSourcesRoot: 0,
        opaqueEntriesAtSourcesRoot: 0,
        entriesInsideManagedSourceDirectories: 0,
        symbolicLinks: 0,
        otherEntries: 0,
      },
      complete: true,
      scanLimitReached: false,
    });
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(Object.isFrozen(inventory.unknownEntries)).toBe(true);
    await store.close();
  });

  it("classifies unknown entries without reading or mutating them or disclosing identities", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "private-candidate.md");
    const managedContent = "private managed candidate content";
    const unknownContent = "unknown root content must remain untouched";
    const subtreeContent = "opaque subtree content must remain untouched";
    await writeFile(inputPath, managedContent, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const sourceId = "private-managed-source";
    const versionId = "managed-version-1";
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: sourceId,
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Private candidate label",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, managedContent, { id: versionId }),
    );
    const sourcesRoot = join(root, "sources");
    const intakeName = ".intake-12345678-1234-4123-8123-123456789abc";
    const hashedIntakeName = `.intake-${"a".repeat(64)}`;
    const unknownName = "unknown-root-name.txt";
    const opaqueDirectoryName = "opaque-directory-name";
    const nestedUnknownName = "extra-nested-name.txt";
    await writeFile(join(sourcesRoot, intakeName), "staged bytes", "utf8");
    await writeFile(join(sourcesRoot, hashedIntakeName), "hashed staged bytes", "utf8");
    await writeFile(join(sourcesRoot, unknownName), unknownContent, "utf8");
    await mkdir(join(sourcesRoot, opaqueDirectoryName));
    await writeFile(join(sourcesRoot, opaqueDirectoryName, "hidden-child.txt"), subtreeContent);
    const managedSourceDirectory = join(sourcesRoot, digestSegment(sourceId));
    await writeFile(join(managedSourceDirectory, nestedUnknownName), "nested unknown bytes");
    const databasePath = join(root, ".draft-loop", "knowledge.sqlite");
    const databaseBefore = await readFile(databasePath);

    const inventory = await store.inspectManagedCandidateKnowledgeFiles();

    expect(inventory).toEqual({
      schemaVersion: 1,
      verifiedManagedFileCount: 1,
      scannedEntryCount: 7,
      unknownEntries: {
        intakeShapedFilesAtSourcesRoot: 2,
        opaqueEntriesAtSourcesRoot: 2,
        entriesInsideManagedSourceDirectories: 1,
        symbolicLinks: 0,
        otherEntries: 0,
      },
      complete: true,
      scanLimitReached: false,
    });
    expect(await readFile(join(sourcesRoot, intakeName), "utf8")).toBe("staged bytes");
    expect(await readFile(join(sourcesRoot, hashedIntakeName), "utf8")).toBe("hashed staged bytes");
    expect(await readFile(join(sourcesRoot, unknownName), "utf8")).toBe(unknownContent);
    expect(await readFile(join(sourcesRoot, opaqueDirectoryName, "hidden-child.txt"), "utf8")).toBe(
      subtreeContent,
    );
    expect(await readFile(join(managedSourceDirectory, nestedUnknownName), "utf8")).toBe(
      "nested unknown bytes",
    );
    expect(await readFile(databasePath)).toEqual(databaseBefore);
    const serialized = JSON.stringify(inventory);
    for (const secret of [
      root,
      sourceId,
      versionId,
      "Private candidate label",
      sha256(managedContent),
      managedContent,
      intakeName,
      hashedIntakeName,
      unknownName,
      opaqueDirectoryName,
      nestedUnknownName,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    await store.close();
  });

  it("revalidates every marked managed file before inventory", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    await writeFile(inputPath, "candidate evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "managed-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "candidate evidence"),
    );
    const managedPath = await store.getManagedCandidateKnowledgeFilePath(
      "ckb-default",
      "managed-source",
      "managed-version-1",
    );
    await writeFile(managedPath as string, "corrupted evidence", "utf8");
    await expect(store.inspectManagedCandidateKnowledgeFiles()).rejects.toThrow(/checksum|size/i);
    await store.close();
  });

  it.skipIf(process.platform === "win32")(
    "counts unknown symlinks without following them or touching their targets",
    async () => {
      const parent = await temporaryParent();
      const root = join(parent, "candidate-knowledge");
      const inputPath = join(parent, "candidate.md");
      const externalDirectory = join(parent, "external-directory");
      const externalFile = join(externalDirectory, "external-target.txt");
      await mkdir(externalDirectory);
      await writeFile(externalFile, "external target bytes", "utf8");
      await writeFile(inputPath, "candidate evidence", "utf8");
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await store.createManagedCandidateKnowledgeFileSource(
        {
          id: "managed-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Candidate notes",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(inputPath, "candidate evidence"),
      );
      const sourcesRoot = join(root, "sources");
      await symlink(externalDirectory, join(sourcesRoot, "unknown-directory-link"), "dir");
      await symlink(
        externalFile,
        join(sourcesRoot, digestSegment("managed-source"), "unknown-file-link"),
        "file",
      );

      const inventory = await store.inspectManagedCandidateKnowledgeFiles();

      expect(inventory.unknownEntries.symbolicLinks).toBe(2);
      expect(inventory.scannedEntryCount).toBe(4);
      expect(await readFile(externalFile, "utf8")).toBe("external target bytes");
      await store.close();
    },
  );

  it.skipIf(process.platform === "win32")(
    "counts special entries without opening them",
    async () => {
      const parent = await temporaryParent();
      const root = join(parent, "candidate-knowledge");
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await execFileAsync("mkfifo", [join(root, "sources", "unknown.pipe")]);

      const inventory = await store.inspectManagedCandidateKnowledgeFiles();

      expect(inventory).toMatchObject({
        scannedEntryCount: 1,
        complete: true,
        scanLimitReached: false,
        unknownEntries: { otherEntries: 1 },
      });
      await store.close();
    },
  );

  it("distinguishes an exactly complete scan cap from entries beyond the global cap", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const sourcesRoot = join(root, "sources");
    for (let index = 0; index < maximumManagedCandidateKnowledgeInventoryEntries; index += 1) {
      await writeFile(join(sourcesRoot, `unknown-${String(index).padStart(4, "0")}`), "x");
    }

    const exactInventory = await store.inspectManagedCandidateKnowledgeFiles();

    expect(exactInventory).toMatchObject({
      verifiedManagedFileCount: 0,
      scannedEntryCount: maximumManagedCandidateKnowledgeInventoryEntries,
      complete: true,
      scanLimitReached: false,
    });
    expect(exactInventory.unknownEntries.opaqueEntriesAtSourcesRoot).toBe(
      maximumManagedCandidateKnowledgeInventoryEntries,
    );

    await writeFile(
      join(sourcesRoot, `unknown-${maximumManagedCandidateKnowledgeInventoryEntries}`),
      "x",
    );
    const cappedInventory = await store.inspectManagedCandidateKnowledgeFiles();

    expect(cappedInventory).toMatchObject({
      verifiedManagedFileCount: 0,
      scannedEntryCount: maximumManagedCandidateKnowledgeInventoryEntries,
      complete: false,
      scanLimitReached: true,
    });
    expect(cappedInventory.unknownEntries.opaqueEntriesAtSourcesRoot).toBe(
      maximumManagedCandidateKnowledgeInventoryEntries,
    );
    await store.close();
  });

  it("rejects unsafe managed inputs, oversize files, integrity mismatches, and mutations", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const source = {
      id: "managed-source",
      knowledgeBaseId: "ckb-default",
      kind: "file" as const,
      displayName: "Candidate notes",
      createdAt: "2026-08-21T14:01:00.000Z",
    };

    const directoryInput = join(parent, "directory-input");
    await mkdir(directoryInput);
    await expect(
      store.createManagedCandidateKnowledgeFileSource(source, managedVersion(directoryInput, "")),
    ).rejects.toThrow(/regular file/i);

    const realInput = join(parent, "real-input.md");
    await writeFile(realInput, "safe", "utf8");
    if (process.platform !== "win32") {
      const linkedInput = join(parent, "linked-input.md");
      await symlink(realInput, linkedInput, "file");
      await expect(
        store.createManagedCandidateKnowledgeFileSource(
          source,
          managedVersion(linkedInput, "safe"),
        ),
      ).rejects.toThrow(/symbolic link/i);
    }

    const insideStore = join(root, "sources", "selected-from-store.md");
    await writeFile(insideStore, "inside", "utf8");
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        source,
        managedVersion(insideStore, "inside"),
      ),
    ).rejects.toThrow(/outside its store/i);
    await rm(insideStore);

    const oversized = join(parent, "oversized.bin");
    await writeFile(oversized, "x", "utf8");
    await truncate(oversized, maximumManagedCandidateKnowledgeFileBytes + 1);
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        source,
        managedVersion(oversized, Buffer.alloc(0), {
          sizeBytes: maximumManagedCandidateKnowledgeFileBytes + 1,
        }),
      ),
    ).rejects.toThrow(/size limit/i);

    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        source,
        managedVersion(realInput, "safe", { checksum: "0".repeat(64) }),
      ),
    ).rejects.toThrow(/integrity metadata/i);

    await writeFile(realInput, "before", "utf8");
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        source,
        managedVersion(realInput, "before", {
          beforeSourceRecheck: async () => {
            await writeFile(realInput, "changed-after-capture", "utf8");
          },
        }),
      ),
    ).rejects.toThrow(/changed while it was being copied/i);
    await expect(store.listCandidateKnowledgeSources("ckb-default")).resolves.toEqual([]);
    await store.close();
  });

  it.skipIf(process.platform === "win32")(
    "rejects FIFO managed inputs without opening them",
    async () => {
      const parent = await temporaryParent();
      const root = join(parent, "candidate-knowledge");
      const fifoPath = join(parent, "candidate.pipe");
      await execFileAsync("mkfifo", [fifoPath]);
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await expect(
        store.createManagedCandidateKnowledgeFileSource(
          {
            id: "fifo-source",
            knowledgeBaseId: "ckb-default",
            kind: "file",
            displayName: "FIFO",
            createdAt: "2026-08-21T14:01:00.000Z",
          },
          managedVersion(fifoPath, ""),
        ),
      ).rejects.toThrow(/regular file/i);
      await store.close();
    },
  );

  it("publishes without replacement, rejects matching residue, and cleans ordinary failures", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    const content = "candidate evidence";
    await writeFile(inputPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const sourceId = "managed-source";
    const versionId = "managed-version-1";
    const sourceDirectory = join(root, "sources", digestSegment(sourceId));
    const finalPath = join(sourceDirectory, digestSegment(versionId));
    await mkdir(sourceDirectory, { mode: 0o700 });
    await writeFile(finalPath, "different", { mode: 0o600 });
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: sourceId,
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Candidate notes",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(inputPath, content, { id: versionId }),
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    await expect(readFile(finalPath, "utf8")).resolves.toBe("different");
    await rm(finalPath);
    await writeFile(finalPath, content, { mode: 0o600 });
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: sourceId,
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Candidate notes",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(inputPath, content, { id: versionId }),
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    await expect(readFile(finalPath, "utf8")).resolves.toBe(content);
    await rm(finalPath);
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: sourceId,
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Candidate notes",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(inputPath, content, { id: versionId }),
      ),
    ).resolves.toMatchObject({ created: true });

    const failingInput = join(parent, "failing.md");
    await writeFile(failingInput, "failure fixture", "utf8");
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "failing-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Failure fixture",
          createdAt: "2026-08-21T14:02:00.000Z",
        },
        managedVersion(failingInput, "failure fixture", {
          id: "failing-version",
          createdAt: "2026-08-21T14:02:00.000Z",
          beforeDatabaseWrite: async () => {
            throw new Error("simulated database-phase failure");
          },
        }),
      ),
    ).rejects.toThrow(/simulated database-phase failure/i);
    await expect(
      lstat(join(root, "sources", digestSegment("failing-source"))),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(join(root, "sources"))).some((name) => name.startsWith(".intake-"))).toBe(
      false,
    );
    expect(
      queryDatabase(
        root,
        `SELECT event.state
         FROM candidate_knowledge_managed_write_operations AS operation
         JOIN candidate_knowledge_managed_write_events AS event
           ON event.operation_id = operation.operation_id
         WHERE operation.requested_version_id = 'failing-version'
         ORDER BY event.sequence`,
      ),
    ).toEqual([{ state: "targeted" }, { state: "published" }, { state: "aborted" }]);
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "failing-source"),
    ).resolves.toBeUndefined();

    const prePublishedInput = join(parent, "pre-published.md");
    await writeFile(prePublishedInput, "pre-published fixture", "utf8");
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "pre-published-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Pre-published fixture",
          createdAt: "2026-08-21T14:03:00.000Z",
        },
        managedVersion(prePublishedInput, "pre-published fixture", {
          id: "pre-published-version",
          createdAt: "2026-08-21T14:03:00.000Z",
          afterTargetPublication: async () => {
            expect(
              queryDatabase(
                root,
                `SELECT event.state, event.target_version_id
                 FROM candidate_knowledge_managed_write_operations AS operation
                 JOIN candidate_knowledge_managed_write_events AS event
                   ON event.operation_id = operation.operation_id
                 WHERE operation.requested_version_id = 'pre-published-version'
                 ORDER BY event.sequence`,
              ),
            ).toEqual([{ state: "targeted", target_version_id: "pre-published-version" }]);
            throw new Error("simulated pre-published failure");
          },
        }),
      ),
    ).rejects.toThrow(/simulated pre-published failure/i);
    await expect(
      lstat(join(root, "sources", digestSegment("pre-published-source"))),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      queryDatabase(
        root,
        `SELECT event.state
         FROM candidate_knowledge_managed_write_operations AS operation
         JOIN candidate_knowledge_managed_write_events AS event
           ON event.operation_id = operation.operation_id
         WHERE operation.requested_version_id = 'pre-published-version'
         ORDER BY event.sequence`,
      ),
    ).toEqual([{ state: "targeted" }, { state: "aborted" }]);
    await expect(
      store.getCandidateKnowledgeSourceOriginBinding("ckb-default", "pre-published-source"),
    ).resolves.toBeUndefined();
    await store.close();
  });

  it("leaves safely inspectable prepared intent and no residue after capture fails before publication", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    await writeFile(inputPath, "before", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));

    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "capture-failure-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Capture failure",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(inputPath, "before", {
          id: "capture-failure-version",
          beforeSourceRecheck: async () => {
            await writeFile(inputPath, "changed during capture", "utf8");
          },
        }),
      ),
    ).rejects.toThrow(/changed while it was being copied/i);

    expect(await readdir(join(root, "sources"))).toEqual([]);
    expect(
      queryDatabase(
        root,
        "SELECT kind, source_id, requested_version_id FROM candidate_knowledge_managed_write_operations",
      ),
    ).toEqual([
      {
        kind: "create",
        source_id: "capture-failure-source",
        requested_version_id: "capture-failure-version",
      },
    ]);
    expect(
      queryDatabase(root, "SELECT state FROM candidate_knowledge_managed_write_events"),
    ).toEqual([]);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(
      reopened.getCandidateKnowledgeSourceOriginBinding("ckb-default", "capture-failure-source"),
    ).resolves.toBeUndefined();
    await reopened.close();
  });

  it("keeps committed bytes and staging evidence after a post-commit cleanup failure", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    const content = "committed candidate evidence";
    await writeFile(inputPath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));

    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "post-commit-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Post-commit source",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(inputPath, content, {
          id: "post-commit-version",
          beforeStagingCleanup: async () => {
            throw new Error("simulated staging cleanup failure");
          },
        }),
      ),
    ).rejects.toThrow(/simulated staging cleanup failure/i);

    const committedPath = await store.getManagedCandidateKnowledgeFilePath(
      "ckb-default",
      "post-commit-source",
      "post-commit-version",
    );
    await expect(readFile(committedPath ?? "", "utf8")).resolves.toBe(content);
    expect(
      (await readdir(join(root, "sources"))).some((name) => /^\.intake-[0-9a-f]{64}$/u.test(name)),
    ).toBe(true);
    expect(
      queryDatabase(
        root,
        `SELECT event.state
         FROM candidate_knowledge_managed_write_operations AS operation
         JOIN candidate_knowledge_managed_write_events AS event
           ON event.operation_id = operation.operation_id
         WHERE operation.requested_version_id = 'post-commit-version'
         ORDER BY event.sequence`,
      ),
    ).toEqual([{ state: "targeted" }, { state: "published" }, { state: "committed" }]);
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await reopened.close();
  });

  it("enforces journal immutability and fails closed on a malformed transition graph", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    await writeFile(inputPath, "candidate evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "journal-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Journal source",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "candidate evidence", { id: "journal-version" }),
    );
    await store.close();

    expect(() =>
      mutateDatabase(
        root,
        "UPDATE candidate_knowledge_managed_write_operations SET source_id = 'different'",
      ),
    ).toThrow(/immutable/i);
    expect(() =>
      mutateDatabase(root, "DELETE FROM candidate_knowledge_managed_write_events"),
    ).toThrow(/immutable/i);
    expect(() =>
      mutateDatabase(
        root,
        `INSERT INTO candidate_knowledge_managed_write_events
           (operation_id, sequence, state, target_version_id, created_at)
         SELECT operation_id, 5, 'completed', 'journal-version', '2026-08-21T14:01:00.000Z'
         FROM candidate_knowledge_managed_write_operations`,
      ),
    ).toThrow(/transition/i);
    mutateDatabase(
      root,
      `INSERT INTO candidate_knowledge_managed_write_operations
         (operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at)
       VALUES
         ('illegal-first-commit', 'ckb-default', 'journal-source', 'illegal-commit-version', 'append', '2026-08-21T14:01:00.000Z'),
         ('illegal-noop-target', 'ckb-default', 'journal-source', 'illegal-noop-version', 'append', '2026-08-21T14:01:00.000Z'),
         ('illegal-noop-transition', 'ckb-default', 'journal-source', 'illegal-noop-transition-version', 'append', '2026-08-21T14:01:00.000Z')`,
    );
    expect(() =>
      mutateDatabase(
        root,
        `INSERT INTO candidate_knowledge_managed_write_events
           (operation_id, sequence, state, target_version_id, created_at)
         VALUES ('illegal-first-commit', 1, 'committed', 'journal-version', '2026-08-21T14:01:00.000Z')`,
      ),
    ).toThrow(/transition/i);
    expect(() =>
      mutateDatabase(
        root,
        `INSERT INTO candidate_knowledge_managed_write_events
           (operation_id, sequence, state, target_version_id, created_at)
         VALUES ('illegal-noop-target', 1, 'noop', 'missing-version', '2026-08-21T14:01:00.000Z')`,
      ),
    ).toThrow(/noop target/i);
    mutateDatabase(
      root,
      `INSERT INTO candidate_knowledge_managed_write_events
         (operation_id, sequence, state, target_version_id, created_at)
       VALUES ('illegal-noop-transition', 1, 'targeted', 'journal-version', '2026-08-21T14:01:00.000Z')`,
    );
    expect(() =>
      mutateDatabase(
        root,
        `INSERT INTO candidate_knowledge_managed_write_events
           (operation_id, sequence, state, target_version_id, created_at)
         VALUES ('illegal-noop-transition', 2, 'noop', 'journal-version', '2026-08-21T14:01:00.000Z')`,
      ),
    ).toThrow(/transition/i);

    mutateDatabase(
      root,
      `DROP TRIGGER candidate_knowledge_managed_write_events_immutable_delete;
       DELETE FROM candidate_knowledge_managed_write_events WHERE sequence = 2`,
    );
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/contiguous/i);
  });

  it("fails closed when journal triggers are bypassed to persist illegal terminal records", async () => {
    const parent = await temporaryParent();
    const committedRoot = join(parent, "illegal-committed");
    const committedInput = join(parent, "illegal-committed.md");
    await writeFile(committedInput, "committed corruption fixture", "utf8");
    const committedStore = await initializeCandidateKnowledgeStore(initialization(committedRoot));
    await committedStore.createManagedCandidateKnowledgeFileSource(
      {
        id: "committed-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Committed corruption",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(committedInput, "committed corruption fixture", {
        id: "committed-version",
      }),
    );
    await committedStore.close();
    mutateDatabase(
      committedRoot,
      `DROP TRIGGER candidate_knowledge_managed_write_events_immutable_delete;
       DROP TRIGGER candidate_knowledge_managed_write_events_transition_insert;
       DELETE FROM candidate_knowledge_managed_write_events;
       INSERT INTO candidate_knowledge_managed_write_events
         (operation_id, sequence, state, target_version_id, created_at)
       SELECT operation_id, 1, 'committed', 'committed-version', '2026-08-21T14:01:00.000Z'
       FROM candidate_knowledge_managed_write_operations`,
    );
    await expect(openCandidateKnowledgeStore(committedRoot)).rejects.toThrow(/transition/i);

    const noopRoot = join(parent, "illegal-noop");
    const noopInput = join(parent, "illegal-noop.md");
    await writeFile(noopInput, "first noop fixture", "utf8");
    const noopStore = await initializeCandidateKnowledgeStore(initialization(noopRoot));
    await noopStore.createManagedCandidateKnowledgeFileSource(
      {
        id: "noop-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Noop corruption",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(noopInput, "first noop fixture", { id: "old-managed-version" }),
    );
    await writeFile(noopInput, "current noop fixture", "utf8");
    await noopStore.appendManagedCandidateKnowledgeFileVersion(
      "ckb-default",
      "noop-source",
      managedVersion(noopInput, "current noop fixture", {
        id: "current-managed-version",
        createdAt: "2026-08-21T14:02:00.000Z",
      }),
    );
    await noopStore.close();
    mutateDatabase(
      noopRoot,
      `DROP TRIGGER candidate_knowledge_managed_write_events_noop_target_insert;
       INSERT INTO candidate_knowledge_managed_write_operations
         (operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at)
       VALUES ('zz-illegal-noop', 'ckb-default', 'noop-source', 'noop-request', 'append', '2026-08-21T14:03:00.000Z');
       INSERT INTO candidate_knowledge_managed_write_events
         (operation_id, sequence, state, target_version_id, created_at)
       VALUES ('zz-illegal-noop', 1, 'noop', 'noop-request', '2026-08-21T14:03:00.000Z')`,
    );
    await expect(openCandidateKnowledgeStore(noopRoot)).rejects.toThrow(
      /invalid managed write noop/i,
    );
  });

  it("rejects missing or corrupted managed files when reopening", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const inputPath = join(parent, "candidate.md");
    await writeFile(inputPath, "candidate evidence", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "managed-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Candidate notes",
        createdAt: "2026-08-21T14:01:00.000Z",
      },
      managedVersion(inputPath, "candidate evidence"),
    );
    const managedPath = await store.getManagedCandidateKnowledgeFilePath(
      "ckb-default",
      "managed-source",
      "managed-version-1",
    );
    await store.close();
    await rm(managedPath as string);
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/missing/i);
    await writeFile(managedPath as string, "candidate evidence", "utf8");
    await writeFile(managedPath as string, "corrupted evidence", "utf8");
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/checksum|size/i);
    const database = join(root, ".draft-loop", "knowledge.sqlite");
    const moved = join(root, ".draft-loop", "knowledge-moved.sqlite");
    await rename(database, moved);
    await rename(moved, database);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a managed-file symlink when reopening",
    async () => {
      const parent = await temporaryParent();
      const root = join(parent, "candidate-knowledge");
      const inputPath = join(parent, "candidate.md");
      await writeFile(inputPath, "candidate evidence", "utf8");
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await store.createManagedCandidateKnowledgeFileSource(
        {
          id: "managed-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Candidate notes",
          createdAt: "2026-08-21T14:01:00.000Z",
        },
        managedVersion(inputPath, "candidate evidence"),
      );
      const managedPath = await store.getManagedCandidateKnowledgeFilePath(
        "ckb-default",
        "managed-source",
        "managed-version-1",
      );
      await store.close();
      await rm(managedPath as string);
      await symlink(inputPath, managedPath as string, "file");
      await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/symbolic link/i);
    },
  );

  it.skipIf(process.platform === "win32")(
    "creates private directories, manifest, and database with restrictive modes",
    async () => {
      const parent = await temporaryParent();
      const root = join(parent, "candidate-knowledge");
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await store.close();

      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, ".draft-loop"))).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, "sources"))).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, "draft-loop-knowledge.json"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, ".draft-loop", "knowledge.sqlite"))).mode & 0o777).toBe(0o600);
    },
  );

  it("reserves publication without replacing an existing target", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    await mkdir(root);
    const sentinel = join(root, "owned-by-user.txt");
    await writeFile(sentinel, "preserve me", "utf8");

    await expect(initializeCandidateKnowledgeStore(initialization(root))).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    await expect(readFile(sentinel, "utf8")).resolves.toBe("preserve me");
  });

  it("does not clobber a target created after staging but before publication", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const sentinel = join(root, "race-winner.txt");

    await expect(
      initializeCandidateKnowledgeStore({
        ...initialization(root),
        beforePublish: async (target) => {
          await mkdir(target);
          await writeFile(sentinel, "preserve race winner", "utf8");
        },
      }),
    ).rejects.toBeInstanceOf(StorageConflictError);

    await expect(readFile(sentinel, "utf8")).resolves.toBe("preserve race winner");
    expect((await readdir(parent)).some((name) => name.includes("draft-loop-staging"))).toBe(false);
  });

  it("rejects a non-directory store root", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    await writeFile(root, "not a directory", "utf8");

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/real directory/i);
  });

  it("rejects empty roots and malformed or unknown-version manifests", async () => {
    await expect(openCandidateKnowledgeStore("   ")).rejects.toBeInstanceOf(StorageValidationError);
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();

    await writeFile(join(root, "draft-loop-knowledge.json"), "{bad-json", "utf8");
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/not valid JSON/i);

    await writeFile(
      join(root, "draft-loop-knowledge.json"),
      JSON.stringify({ schemaVersion: 2, id: "knowledge-store-1", createdAt }),
      "utf8",
    );
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/invalid or unsupported/i);
  });

  it("rejects a missing database", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    await rm(join(root, ".draft-loop", "knowledge.sqlite"));

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/database is missing/i);
  });

  it("rejects a manifest paired with a different store database", async () => {
    const parent = await temporaryParent();
    const firstRoot = join(parent, "first-store");
    const secondRoot = join(parent, "second-store");
    const first = await initializeCandidateKnowledgeStore(initialization(firstRoot));
    await first.close();
    const second = await initializeCandidateKnowledgeStore({
      ...initialization(secondRoot),
      descriptor: { ...initialization(secondRoot).descriptor, id: "knowledge-store-2" },
    });
    await second.close();

    await copyFile(
      join(secondRoot, ".draft-loop", "knowledge.sqlite"),
      join(firstRoot, ".draft-loop", "knowledge.sqlite"),
    );
    await expect(openCandidateKnowledgeStore(firstRoot)).rejects.toThrow(
      /manifest does not match its database/i,
    );
  });

  it("rejects a store with no active default and releases the failed database handle", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    mutateDatabase(root, "DELETE FROM candidate_knowledge_bases");

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/exactly one active default/i);
    const database = join(root, ".draft-loop", "knowledge.sqlite");
    const moved = join(root, ".draft-loop", "knowledge-moved.sqlite");
    await rename(database, moved);
    await rename(moved, database);
  });

  it("rejects an invalid source-version graph and releases the failed database handle", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    mutateDatabase(
      root,
      "INSERT INTO candidate_knowledge_sources (id, candidate_knowledge_base_id, kind, display_name, created_at) VALUES ('source-without-version', 'ckb-default', 'file', 'Incomplete source', '2026-08-21T14:04:00.000Z')",
    );

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/has no source versions/i);
    const database = join(root, ".draft-loop", "knowledge.sqlite");
    const moved = join(root, ".draft-loop", "knowledge-moved.sqlite");
    await rename(database, moved);
    await rename(moved, database);
  });

  it("rejects source-version foreign-key violations on open", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    mutateDatabase(
      root,
      "PRAGMA foreign_keys = OFF; INSERT INTO candidate_knowledge_source_versions (id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at) VALUES ('orphan-version', 'missing-source', 1, NULL, 'text/plain', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, '2026-08-21T14:04:00.000Z')",
    );

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(
      /invalid source relationships/i,
    );
  });

  it("rejects a non-contiguous source-version parent chain on open", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    mutateDatabase(
      root,
      `
        INSERT INTO candidate_knowledge_sources
          (id, candidate_knowledge_base_id, kind, display_name, created_at)
          VALUES ('source-1', 'ckb-default', 'file', 'Career notes', '2026-08-21T14:04:00.000Z');
        INSERT INTO candidate_knowledge_source_versions
          (id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at)
          VALUES
          ('version-1', 'source-1', 1, NULL, 'text/plain', '${"a".repeat(64)}', 1, '2026-08-21T14:04:00.000Z'),
          ('version-2', 'source-1', 2, 'version-1', 'text/plain', '${"b".repeat(64)}', 2, '2026-08-21T14:05:00.000Z'),
          ('version-3', 'source-1', 3, 'version-1', 'text/plain', '${"c".repeat(64)}', 3, '2026-08-21T14:06:00.000Z');
      `,
    );

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/invalid version chain/i);
  });

  it("rejects a source-version timestamp that precedes its source on open", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    mutateDatabase(
      root,
      `
        INSERT INTO candidate_knowledge_sources
          (id, candidate_knowledge_base_id, kind, display_name, created_at)
          VALUES ('source-1', 'ckb-default', 'file', 'Career notes', '2026-08-21T14:04:00.000Z');
        INSERT INTO candidate_knowledge_source_versions
          (id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at)
          VALUES
          ('version-1', 'source-1', 1, NULL, 'text/plain', '${"a".repeat(64)}', 1, '2026-08-21T14:03:00.000Z');
      `,
    );

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(
      /invalid version timestamp order/i,
    );
  });

  it("rejects a source-version timestamp that precedes its parent on open", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    mutateDatabase(
      root,
      `
        INSERT INTO candidate_knowledge_sources
          (id, candidate_knowledge_base_id, kind, display_name, created_at)
          VALUES ('source-1', 'ckb-default', 'file', 'Career notes', '2026-08-21T14:00:00.000Z');
        INSERT INTO candidate_knowledge_source_versions
          (id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at)
          VALUES
          ('version-1', 'source-1', 1, NULL, 'text/plain', '${"a".repeat(64)}', 1, '2026-08-21T14:02:00.000Z'),
          ('version-2', 'source-1', 2, 'version-1', 'text/plain', '${"b".repeat(64)}', 2, '2026-08-21T14:01:00.000Z');
      `,
    );

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(
      /invalid version timestamp order/i,
    );
  });

  it("rejects unknown future storage migrations", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();
    mutateDatabase(
      root,
      "INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (999, 'future', '2026-08-21T14:05:00.000Z')",
    );

    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/future storage schema/i);
  });

  it("rejects non-regular manifest and database paths", async () => {
    const parent = await temporaryParent();
    const manifestRoot = join(parent, "manifest-directory-store");
    const manifestStore = await initializeCandidateKnowledgeStore(initialization(manifestRoot));
    await manifestStore.close();
    const manifest = join(manifestRoot, "draft-loop-knowledge.json");
    await rm(manifest);
    await mkdir(manifest);
    await expect(openCandidateKnowledgeStore(manifestRoot)).rejects.toThrow(/regular file/i);

    const databaseRoot = join(parent, "database-directory-store");
    const databaseStore = await initializeCandidateKnowledgeStore(initialization(databaseRoot));
    await databaseStore.close();
    const database = join(databaseRoot, ".draft-loop", "knowledge.sqlite");
    await rm(database);
    await mkdir(database);
    await expect(openCandidateKnowledgeStore(databaseRoot)).rejects.toThrow(/regular file/i);
  });

  it("rejects oversized manifest and database files before reading or opening them", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();

    await writeFile(join(root, "draft-loop-knowledge.json"), "x".repeat(64 * 1024 + 1), "utf8");
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/size limit/i);

    await writeFile(
      join(root, "draft-loop-knowledge.json"),
      `${JSON.stringify(initialization(root).descriptor)}\n`,
      "utf8",
    );
    await truncate(join(root, ".draft-loop", "knowledge.sqlite"), 16 * 1024 * 1024 * 1024 + 1);
    await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/size limit/i);
  });

  it.skipIf(process.platform === "win32")(
    "rejects symbolic-link roots, manifests, databases, and managed source roots",
    async () => {
      const parent = await temporaryParent();
      const root = join(parent, "candidate-knowledge");
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await store.close();

      const rootLink = join(parent, "linked-store");
      await symlink(root, rootLink, "dir");
      await expect(openCandidateKnowledgeStore(rootLink)).rejects.toThrow(/symbolic link/i);

      const manifest = join(root, "draft-loop-knowledge.json");
      const externalManifest = join(parent, "external-manifest.json");
      await writeFile(externalManifest, JSON.stringify(initialization(root).descriptor), "utf8");
      await rm(manifest);
      await symlink(externalManifest, manifest, "file");
      await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/symbolic link/i);
      await rm(manifest);
      await writeFile(manifest, JSON.stringify(initialization(root).descriptor), "utf8");

      const database = join(root, ".draft-loop", "knowledge.sqlite");
      const externalDatabase = join(parent, "external.sqlite");
      await writeFile(externalDatabase, "not opened", "utf8");
      await rm(database);
      await symlink(externalDatabase, database, "file");
      await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/symbolic link/i);

      await rm(database);
      await writeFile(database, "not opened", "utf8");
      const managedSources = join(root, "sources");
      const externalSources = join(parent, "external-sources");
      await mkdir(externalSources);
      await rm(managedSources, { recursive: true });
      await symlink(externalSources, managedSources, "dir");
      await expect(openCandidateKnowledgeStore(root)).rejects.toThrow(/symbolic link/i);
    },
  );

  it("cleans only its staging directory when initialization fails", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const sentinel = join(parent, "keep.txt");
    await writeFile(sentinel, "keep", "utf8");

    await expect(
      initializeCandidateKnowledgeStore({
        ...initialization(root),
        defaultKnowledgeBase: {
          ...initialization(root).defaultKnowledgeBase,
          id: " ",
        },
      }),
    ).rejects.toThrow();

    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
    expect((await readdir(parent)).some((name) => name.includes("draft-loop-staging"))).toBe(false);
  });

  it("persists only the logical descriptor, never the physical root", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.close();

    const manifest = await readFile(join(root, "draft-loop-knowledge.json"), "utf8");
    expect(JSON.parse(manifest)).toEqual(initialization(root).descriptor);
    expect(manifest).not.toContain(root);
    expect(Object.keys(JSON.parse(manifest))).toEqual(["schemaVersion", "id", "createdAt"]);
  });

  it("replays every managed file interruption boundary and reports only safe outcomes", async () => {
    const boundaries = [
      "intent",
      "staging",
      "target-intent",
      "target-publication",
      "published-event",
      "commit",
      "staging-cleanup",
      "after-staging-cleanup",
    ] as const;
    const committedBoundaries = new Set(["commit", "staging-cleanup", "after-staging-cleanup"]);

    for (const boundary of boundaries) {
      const parent = await temporaryParent();
      const root = join(parent, `candidate-${boundary}`);
      const sourcePath = join(parent, `${boundary}.md`);
      const sourceId = `interrupted-${boundary}`;
      const versionId = `version-${boundary}`;
      const content = `interrupted content at ${boundary}`;
      const operationCreatedAt = boundary === "intent" ? "2030-08-21T14:01:00.000Z" : createdAt;
      await writeFile(sourcePath, content, "utf8");
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await expect(
        store.createManagedCandidateKnowledgeFileSource(
          {
            id: sourceId,
            knowledgeBaseId: "ckb-default",
            kind: "file",
            displayName: "Interruption fixture",
            createdAt: operationCreatedAt,
          },
          managedVersion(sourcePath, content, {
            id: versionId,
            createdAt: operationCreatedAt,
            interruptAt: boundary,
          }),
        ),
      ).rejects.toThrow(/interruption/i);
      await store.close();

      const reopened = await openCandidateKnowledgeStore(root);
      const expectedPhase =
        boundary === "published-event"
          ? "published"
          : boundary === "target-intent" || boundary === "target-publication"
            ? "targeted"
            : committedBoundaries.has(boundary)
              ? "committed"
              : "prepared";
      const expectedOutcome = committedBoundaries.has(boundary) ? "completed" : "aborted";
      expect(reopened.recoveryReport).toEqual({
        schemaVersion: 1,
        entries: [
          {
            kind: "create",
            phase: expectedPhase,
            outcome: expectedOutcome,
          },
        ],
      });
      expect(Object.isFrozen(reopened.recoveryReport)).toBe(true);
      expect(Object.isFrozen(reopened.recoveryReport.entries)).toBe(true);
      expect(JSON.stringify(reopened.recoveryReport)).not.toContain(sourceId);
      if (committedBoundaries.has(boundary)) {
        await expect(
          reopened.getManagedCandidateKnowledgeFilePath("ckb-default", sourceId, versionId),
        ).resolves.toBeTypeOf("string");
      } else {
        await expect(
          reopened.getCandidateKnowledgeSource("ckb-default", sourceId),
        ).resolves.toBeUndefined();
        await expect(lstat(join(root, "sources", digestSegment(sourceId)))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      await reopened.close();

      const idempotent = await openCandidateKnowledgeStore(root);
      expect(idempotent.recoveryReport.entries).toEqual([]);
      await idempotent.close();
    }
  });

  it("replays URL interruptions and preserves mismatched committed staging", async () => {
    const boundaries = ["target-publication", "commit", "after-staging-cleanup"] as const;
    for (const boundary of boundaries) {
      const parent = await temporaryParent();
      const root = join(parent, `url-${boundary}`);
      const sourceId = `url-interrupted-${boundary}`;
      const versionId = `url-version-${boundary}`;
      const responseBytes = new TextEncoder().encode(`url interruption at ${boundary}`);
      const store = await initializeCandidateKnowledgeStore(initialization(root));
      await expect(
        store.createManagedCandidateKnowledgeUrlSource(
          {
            id: sourceId,
            knowledgeBaseId: "ckb-default",
            kind: "url",
            displayName: "URL interruption fixture",
            createdAt,
          },
          managedUrlVersion(responseBytes, {
            id: versionId,
            interruptAt: boundary,
          }),
        ),
      ).rejects.toThrow(/interruption/i);
      await store.close();

      const [{ operation_id: operationId }] = queryDatabase(
        root,
        "SELECT operation_id FROM candidate_knowledge_managed_write_operations",
      ) as [{ readonly operation_id: string }];
      const stagingPath = join(root, "sources", `.intake-${digestSegment(operationId)}`);
      if (boundary === "commit") {
        await rm(stagingPath);
        await writeFile(stagingPath, "mismatched staging residue", "utf8");
      }
      const reopened = await openCandidateKnowledgeStore(root);
      const committed = boundary !== "target-publication";
      expect(reopened.recoveryReport.entries).toEqual([
        {
          kind: "create",
          phase: committed ? "committed" : "targeted",
          outcome: !committed ? "aborted" : boundary === "commit" ? "preserved" : "completed",
        },
      ]);
      expect(JSON.stringify(reopened.recoveryReport)).not.toContain(sourceId);
      await reopened.close();
      if (boundary === "commit") {
        await expect(lstat(stagingPath)).resolves.toBeDefined();
      }
    }
  });

  it("preserves same-content staging replacements with a different inode", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "same-content-staging");
    const sourcePath = join(parent, "same-content-staging.md");
    const content = "same bytes, different inode";
    await writeFile(sourcePath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "same-content-staging-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Same content staging",
          createdAt,
        },
        managedVersion(sourcePath, content, {
          id: "same-content-staging-version",
          interruptAt: "staging",
        }),
      ),
    ).rejects.toThrow(/interruption/i);
    await store.close();

    const [{ operation_id: operationId }] = queryDatabase(
      root,
      "SELECT operation_id FROM candidate_knowledge_managed_write_operations",
    ) as [{ readonly operation_id: string }];
    const stagingPath = join(root, "sources", `.intake-${digestSegment(operationId)}`);
    const original = await lstat(stagingPath);
    const originalBackupPath = `${stagingPath}.original`;
    await link(stagingPath, originalBackupPath);
    const replacementPath = `${stagingPath}.replacement`;
    await writeFile(replacementPath, content, "utf8");
    const replacement = await lstat(replacementPath);
    expect({ dev: replacement.dev, ino: replacement.ino }).not.toEqual({
      dev: original.dev,
      ino: original.ino,
    });
    await rm(stagingPath);
    await rename(replacementPath, stagingPath);

    const reopened = await openCandidateKnowledgeStore(root);
    expect(reopened.recoveryReport.entries).toEqual([
      { kind: "create", phase: "prepared", outcome: "preserved" },
    ]);
    await expect(readFile(stagingPath, "utf8")).resolves.toBe(content);
    expect(
      queryDatabase(
        root,
        `SELECT phase, claim_generation
         FROM candidate_knowledge_managed_write_recovery_claims
         WHERE operation_id = '${operationId}'`,
      ),
    ).toEqual([{ phase: "prepared", claim_generation: 3 }]);
    await reopened.close();

    await rm(stagingPath);
    await rename(originalBackupPath, stagingPath);
    const retried = await openCandidateKnowledgeStore(root);
    expect(retried.recoveryReport.entries).toEqual([
      { kind: "create", phase: "prepared", outcome: "aborted" },
    ]);
    await expect(lstat(stagingPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      queryDatabase(
        root,
        `SELECT phase, claim_generation
         FROM candidate_knowledge_managed_write_recovery_claims
         WHERE operation_id = '${operationId}'`,
      ),
    ).toEqual([{ phase: "prepared", claim_generation: 4 }]);
    await retried.close();
  });

  it("preserves same-content committed staging residue with a different inode", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "same-content-committed");
    const sourcePath = join(parent, "same-content-committed.md");
    const content = "same committed bytes, different inode";
    await writeFile(sourcePath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "same-content-committed-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Same content committed",
          createdAt,
        },
        managedVersion(sourcePath, content, {
          id: "same-content-committed-version",
          interruptAt: "commit",
        }),
      ),
    ).rejects.toThrow(/interruption/i);
    await store.close();

    const [{ operation_id: operationId }] = queryDatabase(
      root,
      "SELECT operation_id FROM candidate_knowledge_managed_write_operations",
    ) as [{ readonly operation_id: string }];
    const stagingPath = join(root, "sources", `.intake-${digestSegment(operationId)}`);
    const targetPath = join(
      root,
      "sources",
      digestSegment("same-content-committed-source"),
      digestSegment("same-content-committed-version"),
    );
    const original = await lstat(stagingPath);
    const replacementPath = `${stagingPath}.replacement`;
    await writeFile(replacementPath, content, "utf8");
    const replacement = await lstat(replacementPath);
    expect({ dev: replacement.dev, ino: replacement.ino }).not.toEqual({
      dev: original.dev,
      ino: original.ino,
    });
    await rm(stagingPath);
    await rename(replacementPath, stagingPath);

    const reopened = await openCandidateKnowledgeStore(root);
    expect(reopened.recoveryReport.entries).toEqual([
      { kind: "create", phase: "committed", outcome: "preserved" },
    ]);
    await expect(readFile(stagingPath, "utf8")).resolves.toBe(content);
    await reopened.close();

    const originalTarget = await lstat(targetPath);
    const replacementTargetPath = `${targetPath}.replacement`;
    await writeFile(replacementTargetPath, content, "utf8");
    const replacementTarget = await lstat(replacementTargetPath);
    expect({ dev: replacementTarget.dev, ino: replacementTarget.ino }).not.toEqual({
      dev: originalTarget.dev,
      ino: originalTarget.ino,
    });
    await rm(targetPath);
    await rename(replacementTargetPath, targetPath);

    const targetReopened = await openCandidateKnowledgeStore(root);
    expect(targetReopened.recoveryReport.entries).toEqual([
      { kind: "create", phase: "committed", outcome: "preserved" },
    ]);
    await expect(readFile(targetPath, "utf8")).resolves.toBe(content);
    await targetReopened.close();
  });

  it("uses a future latest journal event timestamp for recovery terminalization", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "future-journal-event");
    const sourcePath = join(parent, "future-journal-event.md");
    const content = "future journal event";
    await writeFile(sourcePath, content, "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await expect(
      store.createManagedCandidateKnowledgeFileSource(
        {
          id: "future-journal-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Future journal event",
          createdAt,
        },
        managedVersion(sourcePath, content, {
          id: "future-journal-version",
          interruptAt: "target-publication",
        }),
      ),
    ).rejects.toThrow(/interruption/i);
    await store.close();

    const [{ operation_id: operationId }] = queryDatabase(
      root,
      "SELECT operation_id FROM candidate_knowledge_managed_write_operations",
    ) as [{ readonly operation_id: string }];
    const future = "2099-08-21T14:00:00.000Z";
    mutateDatabase(
      root,
      `DROP TRIGGER candidate_knowledge_managed_write_events_immutable_update;
       UPDATE candidate_knowledge_managed_write_events
       SET created_at = '${future}'
       WHERE operation_id = '${operationId}' AND sequence = 1;`,
    );

    const reopened = await openCandidateKnowledgeStore(root);
    expect(reopened.recoveryReport.entries).toEqual([
      { kind: "create", phase: "targeted", outcome: "aborted" },
    ]);
    expect(
      queryDatabase(
        root,
        `SELECT created_at
         FROM candidate_knowledge_managed_write_events
         WHERE operation_id = '${operationId}'
         ORDER BY sequence DESC
         LIMIT 1`,
      ),
    ).toEqual([{ created_at: future }]);
    await reopened.close();
  });

  it("recovers changed and no-op append interruptions without changing the current version", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "append-recovery");
    const sourcePath = join(parent, "append-recovery.md");
    await writeFile(sourcePath, "first", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "append-recovery-source",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Append recovery",
        createdAt,
      },
      managedVersion(sourcePath, "first", { id: "append-recovery-v1" }),
    );

    await writeFile(sourcePath, "second", "utf8");
    await expect(
      store.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "append-recovery-source",
        managedVersion(sourcePath, "second", {
          id: "append-recovery-v2",
          createdAt: "2026-08-21T14:02:00.000Z",
          interruptAt: "target-publication",
        }),
      ),
    ).rejects.toThrow(/interruption/i);
    await store.close();

    const afterChanged = await openCandidateKnowledgeStore(root);
    expect(afterChanged.recoveryReport.entries).toEqual([
      { kind: "append", phase: "targeted", outcome: "aborted" },
    ]);
    await expect(
      afterChanged.listCandidateKnowledgeSourceVersions("ckb-default", "append-recovery-source"),
    ).resolves.toHaveLength(1);

    await writeFile(sourcePath, "first", "utf8");
    await expect(
      afterChanged.appendManagedCandidateKnowledgeFileVersion(
        "ckb-default",
        "append-recovery-source",
        managedVersion(sourcePath, "first", {
          id: "append-recovery-noop",
          createdAt: "2026-08-21T14:03:00.000Z",
          interruptAt: "after-staging-cleanup",
        }),
      ),
    ).rejects.toThrow(/interruption/i);
    await afterChanged.close();

    const afterNoop = await openCandidateKnowledgeStore(root);
    expect(afterNoop.recoveryReport.entries).toEqual([
      { kind: "append", phase: "prepared", outcome: "aborted" },
    ]);
    await expect(
      afterNoop.listCandidateKnowledgeSourceVersions("ckb-default", "append-recovery-source"),
    ).resolves.toHaveLength(1);
    await expect(
      afterNoop.getManagedCandidateKnowledgeFilePath(
        "ckb-default",
        "append-recovery-source",
        "append-recovery-v1",
      ),
    ).resolves.toBeTypeOf("string");
    await afterNoop.close();
  });

  it("preserves legacy and unsafe recovery artifacts without exposing their identities", async () => {
    const parent = await temporaryParent();
    const legacyRoot = join(parent, "legacy");
    const legacyStore = await initializeCandidateKnowledgeStore(initialization(legacyRoot));
    await legacyStore.close();
    mutateDatabase(
      legacyRoot,
      `INSERT INTO candidate_knowledge_managed_write_operations
         (operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at)
       VALUES ('legacy-operation', 'ckb-default', 'legacy-source', 'legacy-version', 'create', '${createdAt}')`,
    );
    const legacyReopened = await openCandidateKnowledgeStore(legacyRoot);
    expect(legacyReopened.recoveryReport).toEqual({
      schemaVersion: 1,
      entries: [{ kind: "create", phase: "prepared", outcome: "preserved" }],
    });
    expect(JSON.stringify(legacyReopened.recoveryReport)).not.toContain("legacy-operation");
    await legacyReopened.close();

    const artifactRoot = join(parent, "unsafe-artifact");
    const sourcePath = join(parent, "unsafe-artifact.md");
    await writeFile(sourcePath, "unsafe artifact source", "utf8");
    const artifactStore = await initializeCandidateKnowledgeStore(initialization(artifactRoot));
    await expect(
      artifactStore.createManagedCandidateKnowledgeFileSource(
        {
          id: "unsafe-source",
          knowledgeBaseId: "ckb-default",
          kind: "file",
          displayName: "Unsafe artifact",
          createdAt,
        },
        managedVersion(sourcePath, "unsafe artifact source", {
          id: "unsafe-version",
          interruptAt: "staging",
        }),
      ),
    ).rejects.toThrow(/interruption/i);
    await artifactStore.close();
    const [{ operation_id: operationId }] = queryDatabase(
      artifactRoot,
      "SELECT operation_id FROM candidate_knowledge_managed_write_operations",
    ) as [{ readonly operation_id: string }];
    const stagingPath = join(artifactRoot, "sources", `.intake-${digestSegment(operationId)}`);
    const externalPath = join(parent, "external-artifact.md");
    await writeFile(externalPath, "external artifact", "utf8");
    await rm(stagingPath);
    await symlink(externalPath, stagingPath, "file");
    const artifactReopened = await openCandidateKnowledgeStore(artifactRoot);
    expect(artifactReopened.recoveryReport).toEqual({
      schemaVersion: 1,
      entries: [{ kind: "create", phase: "prepared", outcome: "preserved" }],
    });
    expect(JSON.stringify(artifactReopened.recoveryReport)).not.toContain(operationId);
    const preservedStaging = await lstat(stagingPath);
    expect(preservedStaging.isSymbolicLink()).toBe(true);
    await artifactReopened.close();
  });

  it("migrates a populated v15 legacy journal without claiming it for recovery", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "populated-v15");
    const initialized = await initializeCandidateKnowledgeStore(initialization(root));
    await initialized.close();

    mutateDatabase(
      root,
      `INSERT INTO candidate_knowledge_managed_write_operations
         (operation_id, candidate_knowledge_base_id, source_id, requested_version_id, kind, created_at)
       VALUES ('v15-legacy-operation', 'ckb-default', 'v15-legacy-source', 'v15-legacy-version', 'create', '${createdAt}');
       INSERT INTO candidate_knowledge_managed_write_events
         (operation_id, sequence, state, target_version_id, created_at)
       VALUES ('v15-legacy-operation', 1, 'targeted', 'v15-legacy-version', '${createdAt}');
       DROP TRIGGER candidate_knowledge_managed_write_operations_ownership_insert;
       DROP TRIGGER candidate_knowledge_managed_write_recovery_claims_insert;
       DROP TRIGGER candidate_knowledge_managed_write_recovery_claims_immutable_update;
       DROP TRIGGER candidate_knowledge_managed_write_recovery_claims_immutable_delete;
       DROP TABLE candidate_knowledge_managed_write_recovery_claims;
       DROP TABLE candidate_knowledge_managed_write_staging_identities;
       ALTER TABLE candidate_knowledge_managed_write_operations DROP COLUMN owner_kind;
       ALTER TABLE candidate_knowledge_managed_write_operations DROP COLUMN owner_schema_version;
       ALTER TABLE candidate_knowledge_managed_write_operations DROP COLUMN owner_generation;
       ALTER TABLE candidate_knowledge_managed_write_operations DROP COLUMN requested_media_type;
       ALTER TABLE candidate_knowledge_managed_write_operations DROP COLUMN requested_checksum;
       ALTER TABLE candidate_knowledge_managed_write_operations DROP COLUMN requested_size_bytes;
       DELETE FROM schema_migrations WHERE version IN (16, 17);`,
    );

    expect(
      queryDatabase(root, "PRAGMA table_info(candidate_knowledge_managed_write_operations)").map(
        (row) => row.name,
      ),
    ).not.toContain("owner_generation");

    const reopened = await openCandidateKnowledgeStore(root);
    expect(reopened.recoveryReport.entries).toEqual([
      { kind: "create", phase: "targeted", outcome: "preserved" },
    ]);
    expect(
      queryDatabase(
        root,
        `SELECT operation.owner_kind,
                operation.owner_schema_version,
                operation.owner_generation,
                operation.requested_media_type,
                operation.requested_checksum,
                operation.requested_size_bytes,
                staging.operation_id AS staging_operation_id
         FROM candidate_knowledge_managed_write_operations AS operation
         LEFT JOIN candidate_knowledge_managed_write_staging_identities AS staging
           ON staging.operation_id = operation.operation_id
         WHERE operation.operation_id = 'v15-legacy-operation'`,
      ),
    ).toEqual([
      {
        owner_kind: null,
        owner_schema_version: null,
        owner_generation: null,
        requested_media_type: null,
        requested_checksum: null,
        requested_size_bytes: null,
        staging_operation_id: null,
      },
    ]);
    expect(
      queryDatabase(
        root,
        `SELECT sequence, state, target_version_id, created_at
         FROM candidate_knowledge_managed_write_events
         WHERE operation_id = 'v15-legacy-operation'`,
      ),
    ).toEqual([
      {
        sequence: 1,
        state: "targeted",
        target_version_id: "v15-legacy-version",
        created_at: createdAt,
      },
    ]);
    await reopened.close();
  });

  it("plans retention from owned raw versions while preserving unknown and unmaterialized classes", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "retention-plan");
    const sourcePath = join(parent, "managed.md");
    await writeFile(sourcePath, "managed source", "utf8");
    const store = await initializeCandidateKnowledgeStore(initialization(root));
    const policy = await store.setCandidateKnowledgeRetentionPolicy("ckb-default", {
      expectedRevision: 0,
      updatedAt: "2026-08-22T14:00:00.000Z",
      classes: candidateKnowledgeRetentionClasses.map((retentionClass) => ({
        class: retentionClass,
        rule: retentionClass === "raw-sources" ? "expire-after-days" : "retain-until-deletion",
        ...(retentionClass === "raw-sources" ? { expireAfterDays: 1 } : {}),
      })),
    });
    await store.createManagedCandidateKnowledgeFileSource(
      {
        id: "managed-source-1",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Managed source",
        createdAt: "2026-08-21T14:00:00.000Z",
      },
      managedVersion(sourcePath, "managed source", {
        id: "managed-version-1",
        createdAt: "2026-08-21T14:01:00.000Z",
      }),
    );
    await store.createCandidateKnowledgeSource(
      {
        id: "legacy-source-1",
        knowledgeBaseId: "ckb-default",
        kind: "file",
        displayName: "Legacy source",
        createdAt: "2026-08-21T14:00:00.000Z",
      },
      {
        id: "legacy-version-1",
        mediaType: "text/plain",
        checksum: "a".repeat(64),
        sizeBytes: 1,
        createdAt: "2026-08-21T14:01:00.000Z",
      },
    );
    await writeFile(join(root, "sources", "unknown-artifact.bin"), "unknown", "utf8");

    const asOf = "2026-08-24T14:00:00.000Z";
    await expect(
      store.planCandidateKnowledgeRetention("ckb-default", "2099-01-01T00:00:00.000Z"),
    ).rejects.toThrow(StorageValidationError);
    const plan = await store.planCandidateKnowledgeRetention("ckb-default", asOf);
    const raw = plan.classes.find((entry) => entry.class === "raw-sources");
    expect(raw).toMatchObject({
      rule: "expire-after-days",
      ownershipStatus: "owned",
      eligibleCount: 1,
      preservedCount: 0,
      unmanagedCount: 1,
      unknownCount: 1,
    });
    expect(
      plan.classes.filter((entry) => entry.ownershipStatus === "not-materialized"),
    ).toHaveLength(5);
    expect(JSON.stringify(plan)).not.toContain(root);
    expect(JSON.stringify(plan)).not.toContain("managed-source-1");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.classes)).toBe(true);
    expect(Object.isFrozen(plan.classes[0]?.preservationReasons)).toBe(true);
    await writeFile(join(root, "sources", "later-unknown-artifact.bin"), "unknown", "utf8");
    const changedInventoryPlan = await store.planCandidateKnowledgeRetention("ckb-default", asOf);
    expect(changedInventoryPlan).not.toEqual(plan);
    expect(
      changedInventoryPlan.classes.find((entry) => entry.class === "raw-sources"),
    ).toMatchObject({
      unknownCount: 2,
    });

    const held = await store.applyCandidateKnowledgeRetentionOverride("ckb-default", {
      class: "raw-sources",
      kind: "manual-preservation",
      expectedPolicyRevision: policy.revision,
      expectedState: "none",
      changedAt: "2026-08-24T13:59:00.000Z",
    });
    expect(held.activeOverrides).toHaveLength(1);
    const sameAsOfHeldPlan = await store.planCandidateKnowledgeRetention("ckb-default", asOf);
    expect(sameAsOfHeldPlan).not.toEqual(plan);
    expect(sameAsOfHeldPlan.classes.find((entry) => entry.class === "raw-sources")).toMatchObject({
      eligibleCount: 0,
      preservedCount: 1,
    });
    const heldPlan = await store.planCandidateKnowledgeRetention(
      "ckb-default",
      "2026-08-24T15:00:00.000Z",
    );
    expect(heldPlan.classes.find((entry) => entry.class === "raw-sources")).toMatchObject({
      eligibleCount: 0,
      preservedCount: 1,
      preservationReasons: ["retention-rule", "override", "unmanaged", "unknown"],
    });
    await store.releaseCandidateKnowledgeRetentionOverride("ckb-default", {
      class: "raw-sources",
      kind: "manual-preservation",
      expectedPolicyRevision: policy.revision,
      expectedState: "applied",
      changedAt: "2026-08-24T16:01:00.000Z",
    });
    const releasedPlan = await store.planCandidateKnowledgeRetention(
      "ckb-default",
      "2026-08-24T17:00:00.000Z",
    );
    expect(releasedPlan.classes.find((entry) => entry.class === "raw-sources")).toMatchObject({
      eligibleCount: 1,
      preservedCount: 0,
    });
    await store.close();

    const reopened = await openCandidateKnowledgeStore(root);
    await expect(reopened.planCandidateKnowledgeRetention("ckb-default", asOf)).resolves.toEqual(
      sameAsOfHeldPlan,
    );
    await reopened.close();
  });
});
