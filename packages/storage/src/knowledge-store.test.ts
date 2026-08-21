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
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StorageConflictError, StorageValidationError } from "./index.js";
import {
  initializeCandidateKnowledgeStore,
  openCandidateKnowledgeStore,
} from "./knowledge-store.js";

const createdAt = "2026-08-21T14:00:00.000Z";
const cleanupRoots: string[] = [];
const require = createRequire(import.meta.url);

interface MutableSqliteDatabase {
  readonly exec: (sql: string) => void;
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
