import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
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

import { StorageConflictError, StorageValidationError } from "./index.js";
import {
  initializeCandidateKnowledgeStore,
  type ManagedCandidateKnowledgeFileVersionInput,
  type ManagedCandidateKnowledgeUrlVersionInput,
  maximumManagedCandidateKnowledgeFileBytes,
  maximumManagedCandidateKnowledgeInventoryEntries,
  openCandidateKnowledgeStore,
} from "./knowledge-store.js";

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

  it("finds directory members by historical path hash after an origin rebind", async () => {
    const parent = await temporaryParent();
    const root = join(parent, "candidate-knowledge");
    const selectedDirectory = join(parent, "selected");
    const sourcePath = join(selectedDirectory, "first.md");
    const movedPath = join(selectedDirectory, "moved.md");
    const content = "directory evidence";
    await mkdir(selectedDirectory);
    await writeFile(sourcePath, content, "utf8");
    await writeFile(movedPath, content, "utf8");
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
    await store.close();
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
       DELETE FROM schema_migrations WHERE version = 7`,
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
});
