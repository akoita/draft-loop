import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import {
  type ResearchBriefStore,
  ResearchBriefStoreError,
  requireResearchBrief,
  researchBriefListLimit,
} from "@draft-loop/storage/research-briefs";
import type { SqlSession } from "./sql-client.js";

function briefOf(row: Record<string, unknown>): ResearchBrief {
  const value = typeof row.brief === "string" ? JSON.parse(row.brief) : row.brief;
  return requireResearchBrief(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

/** One tenant's research briefs on Postgres; row-level security confines them. */
export function createResearchBriefStore(client: SqlSession): ResearchBriefStore {
  return {
    insert: async (input) => {
      const brief = requireResearchBrief(input);
      try {
        await client.query(
          `INSERT INTO application_research_briefs
             (id, workspace_id, application_id, brief, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [
            brief.id,
            brief.workspace_id,
            brief.application_id,
            JSON.stringify(brief),
            brief.created_at,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ResearchBriefStoreError(
            "duplicate_brief",
            "The research brief already exists.",
          );
        }
        throw error;
      }
    },
    get: async (workspaceId, id) => {
      const [row] = await client.query(
        "SELECT brief FROM application_research_briefs WHERE workspace_id = $1 AND id = $2",
        [workspaceId, id],
      );
      return row === undefined ? undefined : briefOf(row);
    },
    list: async (workspaceId, applicationId, options = {}) => {
      const rows = await client.query(
        `SELECT brief FROM application_research_briefs
         WHERE workspace_id = $1 AND application_id = $2
         ORDER BY created_at DESC, id DESC LIMIT $3`,
        [workspaceId, applicationId, options.limit ?? researchBriefListLimit],
      );
      return rows.map(briefOf);
    },
    delete: async (workspaceId, id) => {
      const rows = await client.query(
        "DELETE FROM application_research_briefs WHERE workspace_id = $1 AND id = $2 RETURNING id",
        [workspaceId, id],
      );
      return rows.length > 0;
    },
  };
}
