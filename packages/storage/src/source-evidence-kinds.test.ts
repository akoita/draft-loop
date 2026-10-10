import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateEvidenceKinds } from "@draft-loop/domain/candidate-evidence-kind";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteStorage, openSqliteStorageReadOnly, StorageValidationError } from "./index.js";
import { initializeCandidateKnowledgeStore } from "./knowledge-store.js";
import { sourceEvidenceKindOverridesMigration } from "./source-evidence-kinds.js";

interface RawDatabase {
  readonly exec: (sql: string) => void;
  readonly close: () => void;
}

function openRaw(filename: string): RawDatabase {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as { readonly default?: unknown };
  const Constructor = (loaded.default ?? loaded) as new (filename: string) => RawDatabase;
  return new Constructor(filename);
}

const createdAt = "2026-10-01T10:00:00.000Z";
const later = "2026-10-01T11:00:00.000Z";
const latest = "2026-10-01T12:00:00.000Z";
const knowledgeBase = { id: "ckb-kinds", displayName: "Synthetic", createdAt };

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "draft-loop-evidence-kinds-"));
  roots.push(path);
  return path;
}

const sourceVersion = {
  id: "version-1",
  mediaType: "text/markdown",
  checksum: "a".repeat(64),
  sizeBytes: 10,
  createdAt,
} as const;

function sourceInput(knowledgeBaseId: string, id: string) {
  return { id, knowledgeBaseId, kind: "file", displayName: `${id}.md`, createdAt } as const;
}

async function seededStorage(filename = ":memory:") {
  const storage = openSqliteStorage(filename);
  await storage.createCandidateKnowledgeBase({ ...knowledgeBase, isDefault: true });
  for (const id of ["source-a", "source-b"]) {
    await storage.createCandidateKnowledgeSource(sourceInput(knowledgeBase.id, id), {
      ...sourceVersion,
      id: `${id}-v1`,
    });
  }
  return storage;
}

describe("candidate knowledge source evidence kind override storage", () => {
  it("migrates an existing store to no overrides and leaves existing data untouched", async () => {
    const directory = await temporaryDirectory();
    const filename = join(directory, "knowledge.sqlite");
    const fresh = openSqliteStorage(filename);
    await fresh.createCandidateKnowledgeBase({ ...knowledgeBase, isDefault: true });
    await fresh.set("note", "kept");
    await fresh.close();

    const legacy = openRaw(filename);
    legacy.exec(
      "DROP TABLE candidate_knowledge_source_evidence_kind_overrides; DELETE FROM schema_migrations WHERE version = 33;",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions().at(-1)).toBe(34);
    expect(await upgraded.get("note")).toBe("kept");
    expect(
      await upgraded.listCandidateKnowledgeSourceEvidenceKindOverrides(knowledgeBase.id),
    ).toEqual([]);
    await upgraded.close();
  });

  it("appends per-source rows where the latest wins and a cleared row means no override", async () => {
    const storage = await seededStorage();
    const first = await storage.appendCandidateKnowledgeSourceEvidenceKindOverride(
      knowledgeBase.id,
      "source-a",
      { kind: "notes", createdAt },
    );
    const second = await storage.appendCandidateKnowledgeSourceEvidenceKindOverride(
      knowledgeBase.id,
      "source-a",
      { kind: "cv", createdAt: later },
    );
    const other = await storage.appendCandidateKnowledgeSourceEvidenceKindOverride(
      knowledgeBase.id,
      "source-b",
      { kind: "transcript", createdAt: later },
    );
    expect([first.sequence, second.sequence, other.sequence]).toEqual([1, 2, 1]);
    expect(
      await storage.listCandidateKnowledgeSourceEvidenceKindOverrides(knowledgeBase.id),
    ).toEqual([second, other]);

    const cleared = await storage.appendCandidateKnowledgeSourceEvidenceKindOverride(
      knowledgeBase.id,
      "source-a",
      { kind: null, createdAt: latest },
    );
    expect(cleared).toMatchObject({ sequence: 3, kind: null });
    expect(
      await storage.listCandidateKnowledgeSourceEvidenceKindOverrides(knowledgeBase.id),
    ).toEqual([other]);
    await storage.close();
  });

  it("rejects unknown kinds, sources, knowledge bases and backwards timestamps", async () => {
    const storage = await seededStorage();
    const append = (id: string, sourceId: string, kind: string | null, at = createdAt) =>
      storage.appendCandidateKnowledgeSourceEvidenceKindOverride(id, sourceId, {
        kind,
        createdAt: at,
      });
    await expect(append(knowledgeBase.id, "source-a", "resume")).rejects.toThrow(
      StorageValidationError,
    );
    await expect(append(knowledgeBase.id, "missing", "cv")).rejects.toThrow(StorageValidationError);
    await expect(append("missing", "source-a", "cv")).rejects.toThrow(StorageValidationError);
    await expect(append(knowledgeBase.id, "source-a", "cv", "yesterday")).rejects.toThrow(
      StorageValidationError,
    );
    await append(knowledgeBase.id, "source-a", "cv", later);
    await expect(append(knowledgeBase.id, "source-a", "notes", createdAt)).rejects.toThrow(
      StorageValidationError,
    );
    await storage.close();
  });

  it("enforces immutability and the kind constraint, and flags corrupt rows", async () => {
    const directory = await temporaryDirectory();
    const filename = join(directory, "knowledge.sqlite");
    const storage = await seededStorage(filename);
    await storage.appendCandidateKnowledgeSourceEvidenceKindOverride(knowledgeBase.id, "source-a", {
      kind: "cv",
      createdAt,
    });
    await storage.close();

    const raw = openRaw(filename);
    const table = "candidate_knowledge_source_evidence_kind_overrides";
    expect(() => raw.exec(`UPDATE ${table} SET kind = 'notes'`)).toThrow(/immutable/);
    expect(() => raw.exec(`DELETE FROM ${table}`)).toThrow(/immutable/);
    expect(() =>
      raw.exec(
        `INSERT INTO ${table} VALUES ('${knowledgeBase.id}', 'source-a', 2, 'resume', '${createdAt}')`,
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      raw.exec(`INSERT INTO ${table} VALUES ('unknown', 'source-a', 1, 'cv', '${createdAt}')`),
    ).toThrow(/FOREIGN KEY/);
    raw.exec(`DROP TRIGGER ${table}_immutable_update; DROP TABLE ${table};`);
    raw.exec(
      `CREATE TABLE ${table} (knowledge_base_id TEXT, source_id TEXT, sequence INTEGER, kind TEXT, created_at TEXT);
       INSERT INTO ${table} VALUES ('${knowledgeBase.id}', 'source-a', 1, 'bogus', '${createdAt}');`,
    );
    raw.close();

    const reopened = openSqliteStorageReadOnly(filename);
    await expect(
      reopened.listCandidateKnowledgeSourceEvidenceKindOverrides(knowledgeBase.id),
    ).rejects.toThrow(StorageValidationError);
    await reopened.close();
  });

  it("is exposed on the knowledge-store handle and removed with a deleted knowledge base", async () => {
    const directory = await temporaryDirectory();
    const root = join(directory, "candidate-knowledge");
    const store = await initializeCandidateKnowledgeStore({
      root,
      descriptor: { schemaVersion: 1, id: "knowledge-store-1", createdAt },
      defaultKnowledgeBase: { id: "ckb-default", displayName: "Default", createdAt },
    });
    await store.createCandidateKnowledgeBase({
      id: "ckb-doomed",
      displayName: "Doomed",
      isDefault: false,
      createdAt,
    });
    const sourcePath = join(directory, "evidence.md");
    const content = Buffer.from("Synthetic evidence");
    await writeFile(sourcePath, content);
    for (const knowledgeBaseId of ["ckb-default", "ckb-doomed"]) {
      await store.createManagedCandidateKnowledgeFileSource(
        sourceInput(knowledgeBaseId, `source-${knowledgeBaseId}`),
        {
          sourcePath,
          id: `version-${knowledgeBaseId}`,
          mediaType: "text/markdown",
          checksum: createHash("sha256").update(content).digest("hex"),
          sizeBytes: content.byteLength,
          createdAt,
        },
      );
      await store.appendCandidateKnowledgeSourceEvidenceKindOverride(
        knowledgeBaseId,
        `source-${knowledgeBaseId}`,
        { kind: "cv", createdAt },
      );
    }
    expect(
      await store.listCandidateKnowledgeSourceEvidenceKindOverrides("ckb-doomed"),
    ).toHaveLength(1);

    await store.archiveCandidateKnowledgeBase("ckb-doomed", later);
    const plan = await store.planCandidateKnowledgeBaseDeletion("ckb-doomed");
    await store.deleteCandidateKnowledgeBase("ckb-doomed", plan.confirmationToken);
    expect(await store.getCandidateKnowledgeBase("ckb-doomed")).toBeUndefined();
    expect(
      await store.listCandidateKnowledgeSourceEvidenceKindOverrides("ckb-default"),
    ).toHaveLength(1);
    await store.close();
  });
});

describe("source evidence kind override migration", () => {
  it("accepts exactly the current taxonomy in its fixed CHECK list", () => {
    const listed = /kind IN \(([^)]*)\)/u.exec(sourceEvidenceKindOverridesMigration.sql)?.[1];
    expect(listed?.split(",").map((kind) => kind.trim().replace(/'/gu, ""))).toEqual([
      ...candidateEvidenceKinds,
    ]);
  });
});
