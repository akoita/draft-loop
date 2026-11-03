import { isCandidateEvidenceKind } from "@draft-loop/domain/candidate-evidence-kind";
import type {
  SourceEvidenceKindOverrideInput,
  SourceEvidenceKindOverrideRecord,
  SourceEvidenceKindStoragePort,
} from "@draft-loop/storage";
import { StorageValidationError } from "@draft-loop/storage/errors";
import type { SqlSession } from "./sql-client.js";

function recordOf(row: Record<string, unknown>): SourceEvidenceKindOverrideRecord {
  const kind = row.kind === null ? null : String(row.kind);
  if (kind !== null && !isCandidateEvidenceKind(kind)) {
    throw new StorageValidationError("A stored evidence kind override is invalid.");
  }
  return {
    knowledgeBaseId: String(row.knowledge_base_id),
    sourceId: String(row.source_id),
    sequence: Number(row.sequence),
    kind,
    createdAt: String(row.created_at),
  };
}

/** The tenant's evidence-kind overrides on Postgres: append-only, the latest row per source wins. */
export function createSourceEvidenceKindOverrides(
  client: SqlSession,
): SourceEvidenceKindStoragePort {
  return {
    appendCandidateKnowledgeSourceEvidenceKindOverride: async (
      knowledgeBaseId: string,
      sourceId: string,
      input: SourceEvidenceKindOverrideInput,
    ) => {
      if (input.kind !== null && !isCandidateEvidenceKind(input.kind)) {
        throw new StorageValidationError("candidate knowledge source evidence kind is unknown");
      }
      if (Number.isNaN(Date.parse(input.createdAt))) {
        throw new StorageValidationError("evidence kind override createdAt must be a timestamp");
      }
      return client.transaction(async (executor) => {
        const [source] = await executor.query(
          "SELECT 1 FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = $1 AND id = $2",
          [knowledgeBaseId, sourceId],
        );
        if (source === undefined) {
          throw new StorageValidationError("candidate knowledge source does not exist");
        }
        const [row] = await executor.query(
          `INSERT INTO candidate_knowledge_source_evidence_kind_overrides
             (knowledge_base_id, source_id, sequence, kind, created_at)
           SELECT $1, $2, coalesce(max(sequence), 0) + 1, $3, $4
             FROM candidate_knowledge_source_evidence_kind_overrides
            WHERE knowledge_base_id = $1 AND source_id = $2
           RETURNING knowledge_base_id, source_id, sequence, kind, created_at`,
          [knowledgeBaseId, sourceId, input.kind, input.createdAt],
        );
        if (row === undefined) throw new Error("The evidence kind override was not recorded.");
        return recordOf(row);
      });
    },
    listCandidateKnowledgeSourceEvidenceKindOverrides: async (knowledgeBaseId: string) => {
      const rows = await client.query(
        `SELECT DISTINCT ON (source_id) knowledge_base_id, source_id, sequence, kind, created_at
           FROM candidate_knowledge_source_evidence_kind_overrides
          WHERE knowledge_base_id = $1
          ORDER BY source_id, sequence DESC`,
        [knowledgeBaseId],
      );
      return rows.map(recordOf).filter((record) => record.kind !== null);
    },
  };
}
