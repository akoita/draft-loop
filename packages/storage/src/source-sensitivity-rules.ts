import { createHash } from "node:crypto";
import type { SourceSensitivityRule } from "@draft-loop/domain/source-sensitivity";
import { sourceSensitivityRuleListSchema } from "@draft-loop/schemas/source-sensitivity";
import { StorageValidationError } from "./storage-errors.js";

/** One immutable version of a knowledge base's sensitivity rule list. */
export interface SourceSensitivityRuleVersionRecord {
  readonly knowledgeBaseId: string;
  readonly version: number;
  readonly rules: readonly SourceSensitivityRule[];
  readonly checksum: string;
  readonly createdAt: string;
}

export type SourceSensitivityRuleVersionSummary = Omit<SourceSensitivityRuleVersionRecord, "rules">;

export interface SourceSensitivityRuleAppendInput {
  /** Validated with the shared rule-list schema; an empty list is a valid explicit "no rules" version. */
  readonly rules: unknown;
  readonly createdAt: string;
}

/**
 * A knowledge base with no stored version has no rules, so every section is
 * `normal`. Versions are contiguous from 1 and never rewritten.
 */
export interface SourceSensitivityRuleStoragePort {
  readonly appendCandidateKnowledgeSourceSensitivityRules: (
    knowledgeBaseId: string,
    input: SourceSensitivityRuleAppendInput,
  ) => Promise<SourceSensitivityRuleVersionRecord>;
  /** The latest version, or `undefined` when the knowledge base has none. */
  readonly getCandidateKnowledgeSourceSensitivityRules: (
    knowledgeBaseId: string,
  ) => Promise<SourceSensitivityRuleVersionRecord | undefined>;
  readonly getCandidateKnowledgeSourceSensitivityRulesVersion: (
    knowledgeBaseId: string,
    version: number,
  ) => Promise<SourceSensitivityRuleVersionRecord | undefined>;
  /** Version metadata in ascending order, without the rule bodies. */
  readonly listCandidateKnowledgeSourceSensitivityRuleVersions: (
    knowledgeBaseId: string,
  ) => Promise<readonly SourceSensitivityRuleVersionSummary[]>;
}

interface RuleStatement {
  readonly run: (...parameters: readonly unknown[]) => unknown;
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

export interface SourceSensitivityRuleDatabase {
  readonly prepare: (sql: string) => RuleStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
}

export const sourceSensitivityRulesMigration = {
  version: 27,
  sql: `
    CREATE TABLE IF NOT EXISTS candidate_knowledge_source_sensitivity_rule_versions (
      knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases(id),
      version INTEGER NOT NULL CHECK (version >= 1),
      rules_json TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (knowledge_base_id, version)
    );
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_sensitivity_rule_versions_immutable_update
      BEFORE UPDATE ON candidate_knowledge_source_sensitivity_rule_versions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source sensitivity rule versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS candidate_knowledge_source_sensitivity_rule_versions_immutable_delete
      BEFORE DELETE ON candidate_knowledge_source_sensitivity_rule_versions
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source sensitivity rule versions are immutable'); END;
  `.trim(),
} as const;

const table = "candidate_knowledge_source_sensitivity_rule_versions";

/** Registered with the knowledge-base deletion trigger list, which lifts the delete guard while a base is erased. */
export const sourceSensitivityRulesImmutableDeleteTrigger = {
  name: `${table}_immutable_delete`,
  table,
  message: "candidate knowledge source sensitivity rule versions are immutable",
} as const;

const corruptMessage = "The stored candidate knowledge source sensitivity rules are invalid.";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function checksumOf(rulesJson: string): string {
  return createHash("sha256").update(rulesJson, "utf8").digest("hex");
}

function requireKnowledgeBaseId(value: string): string {
  const id = value.trim();
  if (id.length === 0) {
    throw new StorageValidationError("candidate knowledge base id must not be empty");
  }
  return id;
}

function requireTimestamp(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new StorageValidationError(
      "candidate knowledge source sensitivity rules createdAt must be a valid ISO timestamp",
    );
  }
  return value;
}

function recordFromRow(row: Record<string, unknown>): SourceSensitivityRuleVersionRecord {
  const { knowledge_base_id: knowledgeBaseId, version, created_at: createdAt } = row;
  const { rules_json: rulesJson, checksum } = row;
  if (
    typeof knowledgeBaseId !== "string" ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1 ||
    typeof createdAt !== "string" ||
    typeof rulesJson !== "string" ||
    typeof checksum !== "string" ||
    checksum !== checksumOf(rulesJson)
  ) {
    throw new StorageValidationError(corruptMessage);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rulesJson);
  } catch {
    throw new StorageValidationError(corruptMessage);
  }
  const parsed = sourceSensitivityRuleListSchema.safeParse(parsedJson);
  if (!parsed.success || JSON.stringify(canonicalize(parsed.data)) !== rulesJson) {
    throw new StorageValidationError(corruptMessage);
  }
  return Object.freeze({
    knowledgeBaseId,
    version,
    rules: Object.freeze(parsed.data.rules),
    checksum,
    createdAt,
  });
}

const columns = "knowledge_base_id, version, rules_json, checksum, created_at";

export function appendSourceSensitivityRules(
  database: SourceSensitivityRuleDatabase,
  knowledgeBaseIdInput: string,
  input: SourceSensitivityRuleAppendInput,
): SourceSensitivityRuleVersionRecord {
  const knowledgeBaseId = requireKnowledgeBaseId(knowledgeBaseIdInput);
  const parsed = sourceSensitivityRuleListSchema.safeParse(input.rules);
  if (!parsed.success) {
    throw new StorageValidationError("candidate knowledge source sensitivity rules are invalid");
  }
  const createdAt = requireTimestamp(input.createdAt);
  const rulesJson = JSON.stringify(canonicalize(parsed.data));
  return database.transaction(() => {
    if (
      database
        .prepare("SELECT id FROM candidate_knowledge_bases WHERE id = ?")
        .get(knowledgeBaseId) === undefined
    ) {
      throw new StorageValidationError(`candidate knowledge base ${knowledgeBaseId} was not found`);
    }
    const latest = database
      .prepare(
        `SELECT version, created_at FROM ${table} WHERE knowledge_base_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(knowledgeBaseId);
    if (latest !== undefined && Date.parse(createdAt) < Date.parse(String(latest.created_at))) {
      throw new StorageValidationError(
        "candidate knowledge source sensitivity rules createdAt must not move backwards",
      );
    }
    const version = latest === undefined ? 1 : Number(latest.version) + 1;
    database
      .prepare(`INSERT INTO ${table} (${columns}) VALUES (?, ?, ?, ?, ?)`)
      .run(knowledgeBaseId, version, rulesJson, checksumOf(rulesJson), createdAt);
    return recordFromRow(
      database
        .prepare(`SELECT ${columns} FROM ${table} WHERE knowledge_base_id = ? AND version = ?`)
        .get(knowledgeBaseId, version) ?? {},
    );
  })();
}

export function readCurrentSourceSensitivityRules(
  database: SourceSensitivityRuleDatabase,
  knowledgeBaseIdInput: string,
): SourceSensitivityRuleVersionRecord | undefined {
  const row = database
    .prepare(
      `SELECT ${columns} FROM ${table} WHERE knowledge_base_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(requireKnowledgeBaseId(knowledgeBaseIdInput));
  return row === undefined ? undefined : recordFromRow(row);
}

export function readSourceSensitivityRulesVersion(
  database: SourceSensitivityRuleDatabase,
  knowledgeBaseIdInput: string,
  version: number,
): SourceSensitivityRuleVersionRecord | undefined {
  if (!Number.isInteger(version) || version < 1) {
    throw new StorageValidationError(
      "candidate knowledge source sensitivity rules version must be a positive integer",
    );
  }
  const row = database
    .prepare(`SELECT ${columns} FROM ${table} WHERE knowledge_base_id = ? AND version = ?`)
    .get(requireKnowledgeBaseId(knowledgeBaseIdInput), version);
  return row === undefined ? undefined : recordFromRow(row);
}

export function listSourceSensitivityRuleVersions(
  database: SourceSensitivityRuleDatabase,
  knowledgeBaseIdInput: string,
): readonly SourceSensitivityRuleVersionSummary[] {
  const rows = database
    .prepare(`SELECT ${columns} FROM ${table} WHERE knowledge_base_id = ? ORDER BY version`)
    .all(requireKnowledgeBaseId(knowledgeBaseIdInput));
  return Object.freeze(
    rows.map((row) => {
      const { rules: _rules, ...summary } = recordFromRow(row);
      return Object.freeze(summary);
    }),
  );
}

/** Removes every version for a knowledge base; only valid while the delete guard is lifted. */
export function deleteSourceSensitivityRules(
  database: SourceSensitivityRuleDatabase,
  knowledgeBaseId: string,
): void {
  database.prepare(`DELETE FROM ${table} WHERE knowledge_base_id = ?`).run(knowledgeBaseId);
}

/** Wraps the write operation of a storage port so it runs under the caller's write coordination. */
export function coordinateSourceSensitivityRulesPort(
  port: SourceSensitivityRuleStoragePort,
  coordinateWrite: <T>(operation: string, callback: () => Promise<T>) => Promise<T>,
): SourceSensitivityRuleStoragePort {
  return {
    appendCandidateKnowledgeSourceSensitivityRules: (knowledgeBaseId, input) =>
      coordinateWrite("ckb-sensitivity-rules", () =>
        port.appendCandidateKnowledgeSourceSensitivityRules(knowledgeBaseId, input),
      ),
    getCandidateKnowledgeSourceSensitivityRules: (knowledgeBaseId) =>
      port.getCandidateKnowledgeSourceSensitivityRules(knowledgeBaseId),
    getCandidateKnowledgeSourceSensitivityRulesVersion: (knowledgeBaseId, version) =>
      port.getCandidateKnowledgeSourceSensitivityRulesVersion(knowledgeBaseId, version),
    listCandidateKnowledgeSourceSensitivityRuleVersions: (knowledgeBaseId) =>
      port.listCandidateKnowledgeSourceSensitivityRuleVersions(knowledgeBaseId),
  };
}
