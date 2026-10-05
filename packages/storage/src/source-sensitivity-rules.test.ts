import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openSqliteStorage,
  openSqliteStorageReadOnly,
  SqliteStorage,
  StorageValidationError,
} from "./index.js";
import { initializeCandidateKnowledgeStore } from "./knowledge-store.js";

interface RawDatabase {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => {
    readonly all: () => readonly Record<string, unknown>[];
    readonly run: (...parameters: readonly unknown[]) => unknown;
  };
  readonly close: () => void;
}

function openRaw(filename: string): RawDatabase {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as { readonly default?: unknown };
  const Constructor = (loaded.default ?? loaded) as new (filename: string) => RawDatabase;
  return new Constructor(filename);
}

const createdAt = "2026-10-01T10:00:00.000Z";
const later = "2026-10-01T11:00:00.000Z";
const knowledgeBase = { id: "ckb-sensitivity", displayName: "Synthetic", createdAt };
const salaryRule = {
  id: "salary",
  tier: "never-share",
  match: { kind: "heading-contains", text: "Compensation" },
} as const;
const privateRule = {
  id: "private-path",
  tier: "sensitive",
  match: { kind: "heading-path", path: ["Personal", "Health"] },
} as const;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "draft-loop-sensitivity-rules-"));
  roots.push(path);
  return path;
}

describe("knowledge-base sensitivity rule storage", () => {
  it("migrates a fresh and an existing store to no rules and leaves existing data untouched", async () => {
    const directory = await temporaryDirectory();
    const filename = join(directory, "knowledge.sqlite");
    const fresh = openSqliteStorage(filename);
    await fresh.createCandidateKnowledgeBase({ ...knowledgeBase, isDefault: true });
    await fresh.set("note", "kept");
    await fresh.close();

    const legacy = openRaw(filename);
    legacy.exec(
      "DROP TABLE candidate_knowledge_source_sensitivity_rule_versions; DELETE FROM schema_migrations WHERE version = 27;",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions().at(-1)).toBe(27);
    expect(await upgraded.get("note")).toBe("kept");
    expect(await upgraded.getCandidateKnowledgeBase(knowledgeBase.id)).toMatchObject({
      id: knowledgeBase.id,
    });
    expect(await upgraded.getCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id)).toBe(
      undefined,
    );
    expect(
      await upgraded.listCandidateKnowledgeSourceSensitivityRuleVersions(knowledgeBase.id),
    ).toEqual([]);
    await upgraded.close();
  });

  it("appends contiguous immutable versions and reads them back exactly", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.createCandidateKnowledgeBase({ ...knowledgeBase, isDefault: true });

    const first = await storage.appendCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id, {
      rules: { rules: [salaryRule, privateRule] },
      createdAt,
    });
    const second = await storage.appendCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id, {
      rules: { rules: [privateRule] },
      createdAt: later,
    });
    const cleared = await storage.appendCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id, {
      rules: { rules: [] },
      createdAt: later,
    });

    expect([first.version, second.version, cleared.version]).toEqual([1, 2, 3]);
    expect(first.rules).toEqual([salaryRule, privateRule]);
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(second.checksum).not.toBe(first.checksum);
    expect(await storage.getCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id)).toEqual(
      cleared,
    );
    expect(
      await storage.getCandidateKnowledgeSourceSensitivityRulesVersion(knowledgeBase.id, 1),
    ).toEqual(first);
    expect(
      await storage.getCandidateKnowledgeSourceSensitivityRulesVersion(knowledgeBase.id, 2),
    ).toEqual(second);
    expect(
      await storage.getCandidateKnowledgeSourceSensitivityRulesVersion(knowledgeBase.id, 4),
    ).toBeUndefined();
    const summaries = await storage.listCandidateKnowledgeSourceSensitivityRuleVersions(
      knowledgeBase.id,
    );
    expect(summaries.map((entry) => entry.version)).toEqual([1, 2, 3]);
    expect(summaries[0]).not.toHaveProperty("rules");
    expect(summaries[0]).toMatchObject({ checksum: first.checksum, createdAt });
    await storage.close();
  });

  it("rejects invalid lists, unknown knowledge bases and backwards timestamps", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.createCandidateKnowledgeBase({ ...knowledgeBase, isDefault: true });
    const append = (id: string, rules: unknown, at = createdAt) =>
      storage.appendCandidateKnowledgeSourceSensitivityRules(id, { rules, createdAt: at });

    await expect(
      append(knowledgeBase.id, { rules: [{ ...salaryRule, tier: "secret" }] }),
    ).rejects.toThrow(StorageValidationError);
    await expect(append(knowledgeBase.id, { rules: [salaryRule, salaryRule] })).rejects.toThrow(
      StorageValidationError,
    );
    await expect(append(knowledgeBase.id, { rules: [], extra: true })).rejects.toThrow(
      StorageValidationError,
    );
    await expect(append("missing", { rules: [] })).rejects.toThrow(StorageValidationError);
    await expect(append(knowledgeBase.id, { rules: [] }, "yesterday")).rejects.toThrow(
      StorageValidationError,
    );
    expect(
      await storage.listCandidateKnowledgeSourceSensitivityRuleVersions(knowledgeBase.id),
    ).toEqual([]);
    await append(knowledgeBase.id, { rules: [] }, later);
    await expect(append(knowledgeBase.id, { rules: [] }, createdAt)).rejects.toThrow(
      StorageValidationError,
    );
    await storage.close();
  });

  it("enforces immutability and raises a validation error for corrupt rows", async () => {
    const directory = await temporaryDirectory();
    const filename = join(directory, "knowledge.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.createCandidateKnowledgeBase({ ...knowledgeBase, isDefault: true });
    await storage.appendCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id, {
      rules: { rules: [salaryRule] },
      createdAt,
    });
    await storage.close();

    const raw = openRaw(filename);
    expect(() =>
      raw.exec("UPDATE candidate_knowledge_source_sensitivity_rule_versions SET rules_json = '{}'"),
    ).toThrow(/immutable/);
    expect(() =>
      raw.exec("DELETE FROM candidate_knowledge_source_sensitivity_rule_versions"),
    ).toThrow(/immutable/);
    expect(() =>
      raw.exec(
        "INSERT INTO candidate_knowledge_source_sensitivity_rule_versions VALUES ('unknown', 1, '{\"rules\":[]}', 'x', '2026-10-01T10:00:00.000Z')",
      ),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      raw.exec(
        `INSERT INTO candidate_knowledge_source_sensitivity_rule_versions VALUES ('${knowledgeBase.id}', 0, '{"rules":[]}', 'x', '2026-10-01T10:00:00.000Z')`,
      ),
    ).toThrow(/CHECK/);

    // Tamper with the stored row by recreating the table without its triggers.
    raw.exec("DROP TRIGGER candidate_knowledge_source_sensitivity_rule_versions_immutable_update");
    raw.exec(
      `UPDATE candidate_knowledge_source_sensitivity_rule_versions SET rules_json = '{"rules":[{"id":"x","tier":"nope","match":{"kind":"heading-contains","text":"a"}}]}'`,
    );
    raw.close();

    const reopened = openSqliteStorageReadOnly(filename);
    await expect(
      reopened.getCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      reopened.listCandidateKnowledgeSourceSensitivityRuleVersions(knowledgeBase.id),
    ).rejects.toThrow(StorageValidationError);
    await reopened.close();
  });

  it("is carried by a database backup and restore", async () => {
    const directory = await temporaryDirectory();
    const storage = openSqliteStorage(join(directory, "knowledge.sqlite"));
    await storage.createCandidateKnowledgeBase({ ...knowledgeBase, isDefault: true });
    const stored = await storage.appendCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id, {
      rules: { rules: [salaryRule, privateRule] },
      createdAt,
    });
    const backupPath = join(directory, "backup.sqlite");
    await storage.createBackup(backupPath);
    await storage.close();

    const restoredPath = join(directory, "restored.sqlite");
    const restored = await SqliteStorage.restore(backupPath, restoredPath);
    expect(await restored.getCandidateKnowledgeSourceSensitivityRules(knowledgeBase.id)).toEqual(
      stored,
    );
    await restored.close();
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
    const stored = await store.appendCandidateKnowledgeSourceSensitivityRules("ckb-doomed", {
      rules: { rules: [salaryRule] },
      createdAt,
    });
    await store.appendCandidateKnowledgeSourceSensitivityRules("ckb-default", {
      rules: { rules: [privateRule] },
      createdAt,
    });
    expect(await store.getCandidateKnowledgeSourceSensitivityRules("ckb-doomed")).toEqual(stored);

    await store.archiveCandidateKnowledgeBase("ckb-doomed", later);
    const plan = await store.planCandidateKnowledgeBaseDeletion("ckb-doomed");
    await store.deleteCandidateKnowledgeBase("ckb-doomed", plan.confirmationToken);
    expect(await store.getCandidateKnowledgeBase("ckb-doomed")).toBeUndefined();
    expect(await store.getCandidateKnowledgeSourceSensitivityRules("ckb-default")).toMatchObject({
      version: 1,
    });
    await store.close();
  });
});
