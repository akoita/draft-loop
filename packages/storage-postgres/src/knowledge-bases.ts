import type {
  CandidateKnowledgeBaseRecord,
  CandidateKnowledgeBaseStoragePort,
  CandidateKnowledgeSourceRecord,
  CandidateKnowledgeSourceVersionRecord,
} from "@draft-loop/storage";
import {
  candidateKnowledgeBaseColumns,
  candidateKnowledgeBaseFromRow,
  candidateKnowledgeSourceColumns,
  candidateKnowledgeSourceFromRow,
  candidateKnowledgeSourceVersionColumns,
  candidateKnowledgeSourceVersionFromRow,
  initialCandidateKnowledgeSourceVersion,
  nextCandidateKnowledgeSourceVersion,
  normalizeCandidateKnowledgeBaseInput,
  normalizeCandidateKnowledgeSourceInput,
  normalizeCandidateKnowledgeSourceVersionInput,
  requireActiveCandidateKnowledgeBaseRecord,
} from "@draft-loop/storage/candidate-knowledge";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import { requireNonEmpty } from "@draft-loop/storage/history-records";
import type { SqlExecutor, SqlSession } from "./sql-client.js";

/** The knowledge-base methods this store implements so far; lifecycle and directories come later. */
export type CandidateKnowledgeBaseRecords = Pick<
  CandidateKnowledgeBaseStoragePort,
  | "ensureDefaultCandidateKnowledgeBase"
  | "createCandidateKnowledgeBase"
  | "getCandidateKnowledgeBase"
  | "listCandidateKnowledgeBases"
  | "createCandidateKnowledgeSource"
  | "appendCandidateKnowledgeSourceVersion"
  | "getCandidateKnowledgeSource"
  | "listCandidateKnowledgeSources"
  | "listCandidateKnowledgeSourceVersions"
>;

/** Serializes knowledge-base creation, so two writers never both create the default. */
const knowledgeBaseLockKey = 0x636b6273;

const baseSelect = `SELECT ${candidateKnowledgeBaseColumns} FROM candidate_knowledge_bases`;
const sourceSelect = `SELECT ${candidateKnowledgeSourceColumns} FROM candidate_knowledge_sources`;

function requireId(value: string, field: string): string {
  return requireNonEmpty(value, field).trim();
}

/** Reads a knowledge base, locking its row against archiving until the transaction ends. */
async function requireKnowledgeBase(
  executor: SqlExecutor,
  id: string,
  lock = "",
): Promise<CandidateKnowledgeBaseRecord> {
  const [row] = await executor.query(`${baseSelect} WHERE id = $1 ${lock}`, [id]);
  if (row === undefined) {
    throw new StorageValidationError(`candidate knowledge base ${id} was not found`);
  }
  return candidateKnowledgeBaseFromRow(row);
}

async function requireSource(
  executor: SqlExecutor,
  knowledgeBaseId: string,
  sourceId: string,
  lock = "",
): Promise<CandidateKnowledgeSourceRecord> {
  const [row] = await executor.query(
    `${sourceSelect} WHERE candidate_knowledge_base_id = $1 AND id = $2 ${lock}`,
    [knowledgeBaseId, sourceId],
  );
  if (row === undefined) {
    throw new StorageValidationError(
      `candidate knowledge source ${sourceId} was not found in candidate knowledge base ${knowledgeBaseId}`,
    );
  }
  return candidateKnowledgeSourceFromRow(row);
}

async function insertKnowledgeBase(
  executor: SqlExecutor,
  record: CandidateKnowledgeBaseRecord,
): Promise<void> {
  await executor.query(
    `INSERT INTO candidate_knowledge_bases (${candidateKnowledgeBaseColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.displayName,
      record.description,
      record.state,
      record.isDefault ? 1 : 0,
      record.createdAt,
      record.updatedAt,
      record.archivedAt,
    ],
  );
}

/**
 * Candidate knowledge bases, their sources and the sources' immutable versions on Postgres, with
 * the shared rules from `@draft-loop/storage/candidate-knowledge`. Appending to a source locks
 * its row, so concurrent appends number their versions one after another.
 */
export function createKnowledgeBaseRecords(client: SqlSession): CandidateKnowledgeBaseRecords {
  return {
    ensureDefaultCandidateKnowledgeBase: async (input) => {
      const normalized = normalizeCandidateKnowledgeBaseInput({ ...input, isDefault: true });
      return client.transaction(async (executor) => {
        await executor.query("SELECT pg_advisory_xact_lock($1)", [knowledgeBaseLockKey]);
        const [existingDefault] = await executor.query(`${baseSelect} WHERE is_default = 1`);
        if (existingDefault !== undefined) return candidateKnowledgeBaseFromRow(existingDefault);
        const [conflicting] = await executor.query(
          "SELECT id FROM candidate_knowledge_bases WHERE id = $1",
          [normalized.id],
        );
        if (conflicting !== undefined) {
          throw new StorageConflictError(
            `candidate knowledge base ${normalized.id} already exists and is not the default`,
          );
        }
        await insertKnowledgeBase(executor, normalized);
        return normalized;
      });
    },
    createCandidateKnowledgeBase: async (input) => {
      const normalized = normalizeCandidateKnowledgeBaseInput(input);
      return client.transaction(async (executor) => {
        await executor.query("SELECT pg_advisory_xact_lock($1)", [knowledgeBaseLockKey]);
        const [existing] = await executor.query(
          "SELECT id FROM candidate_knowledge_bases WHERE id = $1",
          [normalized.id],
        );
        if (existing !== undefined) {
          throw new StorageConflictError(
            `candidate knowledge base ${normalized.id} already exists`,
          );
        }
        if (normalized.isDefault) {
          const [existingDefault] = await executor.query(
            "SELECT id FROM candidate_knowledge_bases WHERE is_default = 1",
          );
          if (existingDefault !== undefined) {
            throw new StorageConflictError("a default candidate knowledge base already exists");
          }
        }
        await insertKnowledgeBase(executor, normalized);
        return normalized;
      });
    },
    getCandidateKnowledgeBase: async (id) => {
      const [row] = await client.query(`${baseSelect} WHERE id = $1`, [
        requireId(id, "candidate knowledge base id"),
      ]);
      return row === undefined ? undefined : candidateKnowledgeBaseFromRow(row);
    },
    listCandidateKnowledgeBases: async () =>
      (
        await client.query(
          `${baseSelect} ORDER BY is_default DESC, created_at COLLATE "C", id COLLATE "C"`,
        )
      ).map(candidateKnowledgeBaseFromRow),
    createCandidateKnowledgeSource: async (sourceInput, initialVersionInput) => {
      const source = normalizeCandidateKnowledgeSourceInput(sourceInput);
      const version = initialCandidateKnowledgeSourceVersion(
        source,
        normalizeCandidateKnowledgeSourceVersionInput(initialVersionInput),
      );
      await client.transaction(async (executor) => {
        requireActiveCandidateKnowledgeBaseRecord(
          await requireKnowledgeBase(executor, source.knowledgeBaseId, "FOR SHARE"),
        );
        const inserted = await executor.query(
          `INSERT INTO candidate_knowledge_sources (${candidateKnowledgeSourceColumns}) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, id) DO NOTHING RETURNING id`,
          [source.id, source.knowledgeBaseId, source.kind, source.displayName, source.createdAt],
        );
        if (inserted.length === 0) {
          throw new StorageConflictError(`candidate knowledge source ${source.id} already exists`);
        }
        await insertVersion(executor, version);
      });
      return { source, version, created: true };
    },
    appendCandidateKnowledgeSourceVersion: async (knowledgeBaseId, sourceId, versionInput) => {
      const normalizedKnowledgeBaseId = requireId(knowledgeBaseId, "candidate knowledge base id");
      const normalizedSourceId = requireId(sourceId, "candidate knowledge source id");
      const normalizedVersion = normalizeCandidateKnowledgeSourceVersionInput(versionInput);
      return client.transaction(async (executor) => {
        requireActiveCandidateKnowledgeBaseRecord(
          await requireKnowledgeBase(executor, normalizedKnowledgeBaseId, "FOR SHARE"),
        );
        const source = await requireSource(
          executor,
          normalizedKnowledgeBaseId,
          normalizedSourceId,
          "FOR UPDATE",
        );
        const [currentRow] = await executor.query(
          `SELECT ${candidateKnowledgeSourceVersionColumns} FROM candidate_knowledge_source_versions
           WHERE source_id = $1 ORDER BY version DESC LIMIT 1`,
          [normalizedSourceId],
        );
        if (currentRow === undefined) {
          throw new StorageValidationError(
            `candidate knowledge source ${normalizedSourceId} has no versions`,
          );
        }
        const next = nextCandidateKnowledgeSourceVersion(
          candidateKnowledgeSourceVersionFromRow(currentRow),
          normalizedVersion,
        );
        if (next.created) await insertVersion(executor, next.version);
        return { source, ...next };
      });
    },
    getCandidateKnowledgeSource: async (knowledgeBaseId, sourceId) => {
      const normalizedKnowledgeBaseId = requireId(knowledgeBaseId, "candidate knowledge base id");
      const normalizedSourceId = requireId(sourceId, "candidate knowledge source id");
      await requireKnowledgeBase(client, normalizedKnowledgeBaseId);
      const [row] = await client.query(
        `${sourceSelect} WHERE candidate_knowledge_base_id = $1 AND id = $2`,
        [normalizedKnowledgeBaseId, normalizedSourceId],
      );
      return row === undefined ? undefined : candidateKnowledgeSourceFromRow(row);
    },
    listCandidateKnowledgeSources: async (knowledgeBaseId) => {
      const normalizedKnowledgeBaseId = requireId(knowledgeBaseId, "candidate knowledge base id");
      await requireKnowledgeBase(client, normalizedKnowledgeBaseId);
      return (
        await client.query(
          `${sourceSelect} WHERE candidate_knowledge_base_id = $1
           ORDER BY created_at COLLATE "C", id COLLATE "C"`,
          [normalizedKnowledgeBaseId],
        )
      ).map(candidateKnowledgeSourceFromRow);
    },
    listCandidateKnowledgeSourceVersions: async (knowledgeBaseId, sourceId) => {
      const normalizedKnowledgeBaseId = requireId(knowledgeBaseId, "candidate knowledge base id");
      const normalizedSourceId = requireId(sourceId, "candidate knowledge source id");
      await requireKnowledgeBase(client, normalizedKnowledgeBaseId);
      await requireSource(client, normalizedKnowledgeBaseId, normalizedSourceId);
      return (
        await client.query(
          `SELECT v.id, v.source_id, v.version, v.parent_version_id, v.media_type, v.checksum,
             v.size_bytes, v.created_at FROM candidate_knowledge_source_versions v
           JOIN candidate_knowledge_sources s ON s.id = v.source_id
           WHERE s.candidate_knowledge_base_id = $1 AND v.source_id = $2
           ORDER BY v.version, v.id COLLATE "C"`,
          [normalizedKnowledgeBaseId, normalizedSourceId],
        )
      ).map(candidateKnowledgeSourceVersionFromRow);
    },
  };
}

async function insertVersion(
  executor: SqlExecutor,
  record: CandidateKnowledgeSourceVersionRecord,
): Promise<void> {
  await executor.query(
    `INSERT INTO candidate_knowledge_source_versions (${candidateKnowledgeSourceVersionColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.sourceId,
      record.version,
      record.parentVersionId,
      record.mediaType,
      record.checksum,
      record.sizeBytes,
      record.createdAt,
    ],
  );
}
