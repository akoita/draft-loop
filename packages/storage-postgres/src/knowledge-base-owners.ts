import {
  type KnowledgeBaseOwners,
  KnowledgeBaseOwnersError,
  type KnowledgeBaseOwnership,
  requireOwnedKnowledgeBaseId,
  requireOwningRecordId,
} from "@draft-loop/storage/knowledge-base-owners";
import type { SqlRow, SqlSession } from "./sql-client.js";

const ownershipColumns = "knowledge_base_id, workspace_id, created_at";

function ownership(row: SqlRow): KnowledgeBaseOwnership {
  const createdAt =
    row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
  return {
    knowledgeBaseId: String(row.knowledge_base_id),
    workspaceId: String(row.workspace_id),
    recordedAt: createdAt.toISOString(),
  };
}

/** Maps the base foreign key the insert failed onto the port's refusal. */
function foreignKeyRefusal(error: unknown): KnowledgeBaseOwnersError | undefined {
  const failure = error as { code?: unknown; constraint?: unknown } | null;
  if (failure?.code !== "23503" || failure.constraint !== "knowledge_base_owners_base") {
    return undefined;
  }
  return new KnowledgeBaseOwnersError("knowledge_base_not_found", "No such knowledge base.");
}

/**
 * One tenant's knowledge base owners on Postgres (ADR 0011, D6). Every transaction sets the
 * tenant, so row-level security confines bases and their owners to it.
 */
export function createKnowledgeBaseOwners(client: SqlSession): KnowledgeBaseOwners {
  return {
    setOwner: async (input) => {
      const knowledgeBaseId = requireOwnedKnowledgeBaseId(input.knowledgeBaseId);
      const workspaceId = requireOwningRecordId(input.workspaceId);
      try {
        const row = await client.transaction(async (executor) => {
          const [inserted] = await executor.query(
            `INSERT INTO knowledge_base_owners (knowledge_base_id, workspace_id) VALUES ($1, $2)
             ON CONFLICT (tenant_id, knowledge_base_id) DO NOTHING
             RETURNING ${ownershipColumns}`,
            [knowledgeBaseId, workspaceId],
          );
          if (inserted !== undefined) return inserted;
          const [existing] = await executor.query(
            `SELECT ${ownershipColumns} FROM knowledge_base_owners WHERE knowledge_base_id = $1`,
            [knowledgeBaseId],
          );
          return existing;
        });
        if (row === undefined) throw new Error("The knowledge base's owner was not recorded");
        const recorded = ownership(row);
        if (recorded.workspaceId !== workspaceId) {
          throw new KnowledgeBaseOwnersError(
            "owner_exists",
            "The knowledge base already belongs to another candidate record.",
          );
        }
        return recorded;
      } catch (error) {
        throw foreignKeyRefusal(error) ?? error;
      }
    },

    ownerOf: async (knowledgeBaseId) => {
      const id = requireOwnedKnowledgeBaseId(knowledgeBaseId);
      const [row] = await client.query(
        "SELECT workspace_id FROM knowledge_base_owners WHERE knowledge_base_id = $1",
        [id],
      );
      return row === undefined ? undefined : String(row.workspace_id);
    },

    basesOwnedBy: async (workspaceIds) => {
      const ids = workspaceIds.map(requireOwningRecordId);
      if (ids.length === 0) return [];
      const rows = await client.query(
        `SELECT knowledge_base_id FROM knowledge_base_owners WHERE workspace_id = ANY($1::text[])
         ORDER BY knowledge_base_id COLLATE "C"`,
        [ids],
      );
      return rows.map((row) => String(row.knowledge_base_id));
    },

    removeUnowned: async (knowledgeBaseId) => {
      const id = requireOwnedKnowledgeBaseId(knowledgeBaseId);
      const rows = await client.query(
        `DELETE FROM candidate_knowledge_bases AS base
         WHERE base.id = $1 AND base.is_default = 0
           AND NOT EXISTS (SELECT 1 FROM knowledge_base_owners WHERE knowledge_base_id = base.id)
           AND NOT EXISTS (
             SELECT 1 FROM candidate_knowledge_sources WHERE candidate_knowledge_base_id = base.id)
         RETURNING base.id`,
        [id],
      );
      return rows.length > 0;
    },
  };
}
