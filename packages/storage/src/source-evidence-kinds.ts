import {
  type CandidateEvidenceKind,
  candidateEvidenceKinds,
  isCandidateEvidenceKind,
} from "@draft-loop/domain/candidate-evidence-kind";
import { StorageValidationError } from "./storage-errors.js";

/**
 * One append-only decision about a source's evidence kind. A `null` kind means
 * the user cleared the override, so the detected kind applies again. Only the
 * decision is stored; detection is deterministic and recomputed on demand.
 */
export interface SourceEvidenceKindOverrideRecord {
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly sequence: number;
  readonly kind: CandidateEvidenceKind | null;
  readonly createdAt: string;
}

export interface SourceEvidenceKindOverrideInput {
  /** A taxonomy kind to pin, or `null` to clear the override. */
  readonly kind: string | null;
  readonly createdAt: string;
}

/**
 * Overrides are keyed by the logical source, so they survive source refreshes
 * that add new versions.
 */
export interface SourceEvidenceKindStoragePort {
  readonly appendCandidateKnowledgeSourceEvidenceKindOverride: (
    knowledgeBaseId: string,
    sourceId: string,
    input: SourceEvidenceKindOverrideInput,
  ) => Promise<SourceEvidenceKindOverrideRecord>;
  /** The current override per source (latest row wins); cleared sources are absent. */
  readonly listCandidateKnowledgeSourceEvidenceKindOverrides: (
    knowledgeBaseId: string,
  ) => Promise<readonly SourceEvidenceKindOverrideRecord[]>;
}

interface OverrideStatement {
  readonly run: (...parameters: readonly unknown[]) => unknown;
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

export interface SourceEvidenceKindOverrideDatabase {
  readonly prepare: (sql: string) => OverrideStatement;
  readonly transaction: <Result>(operation: () => Result) => () => Result;
}

const table = "candidate_knowledge_source_evidence_kind_overrides";

// Migration SQL is fixed once released: widening the taxonomy needs a new migration.
export const sourceEvidenceKindOverridesMigration = {
  version: 33,
  sql: `
    CREATE TABLE IF NOT EXISTS ${table} (
      knowledge_base_id TEXT NOT NULL REFERENCES candidate_knowledge_bases(id),
      source_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      kind TEXT CHECK (kind IS NULL OR kind IN ('cv', 'linkedin-export', 'performance-review', 'notes', 'transcript', 'other')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (knowledge_base_id, source_id, sequence)
    );
    CREATE TRIGGER IF NOT EXISTS ${table}_immutable_update
      BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source evidence kind overrides are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS ${table}_immutable_delete
      BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'candidate knowledge source evidence kind overrides are immutable'); END;
  `.trim(),
} as const;

/** Registered with the knowledge-base deletion trigger list, which lifts the delete guard while a base is erased. */
export const sourceEvidenceKindOverridesImmutableDeleteTrigger = {
  name: `${table}_immutable_delete`,
  table,
  message: "candidate knowledge source evidence kind overrides are immutable",
} as const;

const corruptMessage = "The stored candidate knowledge source evidence kind overrides are invalid.";

function requireId(value: string, label: string): string {
  const id = value.trim();
  if (id.length === 0) throw new StorageValidationError(`${label} must not be empty`);
  return id;
}

function requireTimestamp(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new StorageValidationError(
      "candidate knowledge source evidence kind override createdAt must be a valid ISO timestamp",
    );
  }
  return value;
}

function recordFromRow(row: Record<string, unknown>): SourceEvidenceKindOverrideRecord {
  const { knowledge_base_id: knowledgeBaseId, source_id: sourceId, sequence, kind } = row;
  const { created_at: createdAt } = row;
  if (
    typeof knowledgeBaseId !== "string" ||
    typeof sourceId !== "string" ||
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    typeof createdAt !== "string" ||
    (kind !== null && !isCandidateEvidenceKind(kind))
  ) {
    throw new StorageValidationError(corruptMessage);
  }
  return Object.freeze({ knowledgeBaseId, sourceId, sequence, kind, createdAt });
}

const columns = "knowledge_base_id, source_id, sequence, kind, created_at";

export function appendSourceEvidenceKindOverride(
  database: SourceEvidenceKindOverrideDatabase,
  knowledgeBaseIdInput: string,
  sourceIdInput: string,
  input: SourceEvidenceKindOverrideInput,
): SourceEvidenceKindOverrideRecord {
  const knowledgeBaseId = requireId(knowledgeBaseIdInput, "candidate knowledge base id");
  const sourceId = requireId(sourceIdInput, "candidate knowledge source id");
  if (input.kind !== null && !isCandidateEvidenceKind(input.kind)) {
    throw new StorageValidationError(
      `candidate knowledge source evidence kind must be one of: ${candidateEvidenceKinds.join(", ")}`,
    );
  }
  const createdAt = requireTimestamp(input.createdAt);
  return database.transaction(() => {
    if (
      database
        .prepare(
          "SELECT id FROM candidate_knowledge_sources WHERE id = ? AND candidate_knowledge_base_id = ?",
        )
        .get(sourceId, knowledgeBaseId) === undefined
    ) {
      throw new StorageValidationError(
        `candidate knowledge source ${sourceId} was not found in knowledge base ${knowledgeBaseId}`,
      );
    }
    const latest = database
      .prepare(
        `SELECT sequence, created_at FROM ${table}
         WHERE knowledge_base_id = ? AND source_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(knowledgeBaseId, sourceId);
    if (latest !== undefined && Date.parse(createdAt) < Date.parse(String(latest.created_at))) {
      throw new StorageValidationError(
        "candidate knowledge source evidence kind override createdAt must not move backwards",
      );
    }
    const sequence = latest === undefined ? 1 : Number(latest.sequence) + 1;
    database
      .prepare(`INSERT INTO ${table} (${columns}) VALUES (?, ?, ?, ?, ?)`)
      .run(knowledgeBaseId, sourceId, sequence, input.kind, createdAt);
    return recordFromRow(
      database
        .prepare(
          `SELECT ${columns} FROM ${table}
           WHERE knowledge_base_id = ? AND source_id = ? AND sequence = ?`,
        )
        .get(knowledgeBaseId, sourceId, sequence) ?? {},
    );
  })();
}

export function listCurrentSourceEvidenceKindOverrides(
  database: SourceEvidenceKindOverrideDatabase,
  knowledgeBaseIdInput: string,
): readonly SourceEvidenceKindOverrideRecord[] {
  const rows = database
    .prepare(
      `SELECT ${columns} FROM ${table} AS override
       WHERE knowledge_base_id = ?
         AND sequence = (
           SELECT MAX(sequence) FROM ${table}
           WHERE knowledge_base_id = override.knowledge_base_id
             AND source_id = override.source_id
         )
         AND kind IS NOT NULL
       ORDER BY source_id`,
    )
    .all(requireId(knowledgeBaseIdInput, "candidate knowledge base id"));
  return Object.freeze(rows.map(recordFromRow));
}

/** Removes every override for a knowledge base; only valid while the delete guard is lifted. */
export function deleteSourceEvidenceKindOverrides(
  database: SourceEvidenceKindOverrideDatabase,
  knowledgeBaseId: string,
): void {
  database.prepare(`DELETE FROM ${table} WHERE knowledge_base_id = ?`).run(knowledgeBaseId);
}

/** Wraps the write operation of a storage port so it runs under the caller's write coordination. */
export function coordinateSourceEvidenceKindsPort(
  port: SourceEvidenceKindStoragePort,
  coordinateWrite: <T>(operation: string, callback: () => Promise<T>) => Promise<T>,
): SourceEvidenceKindStoragePort {
  return {
    appendCandidateKnowledgeSourceEvidenceKindOverride: (knowledgeBaseId, sourceId, input) =>
      coordinateWrite("ckb-evidence-kind-override", () =>
        port.appendCandidateKnowledgeSourceEvidenceKindOverride(knowledgeBaseId, sourceId, input),
      ),
    listCandidateKnowledgeSourceEvidenceKindOverrides: (knowledgeBaseId) =>
      port.listCandidateKnowledgeSourceEvidenceKindOverrides(knowledgeBaseId),
  };
}
