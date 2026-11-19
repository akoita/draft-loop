import type { FactSuggestion } from "@draft-loop/domain/fact-suggestion";
import {
  decidedFactSuggestion,
  type FactSuggestionStore,
  FactSuggestionStoreError,
  requireFactSuggestion,
  requirePending,
} from "@draft-loop/storage/fact-suggestions";
import type { SqlSession } from "./sql-client.js";

function suggestionOf(row: Record<string, unknown>): FactSuggestion {
  const value = typeof row.suggestion === "string" ? JSON.parse(row.suggestion) : row.suggestion;
  return requireFactSuggestion(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

const duplicate = () =>
  new FactSuggestionStoreError(
    "duplicate_suggestion",
    "A fact suggestion already holds this id or key.",
  );

/** One tenant's fact suggestions on Postgres; row-level security confines them to the tenant. */
export function createFactSuggestionStore(client: SqlSession): FactSuggestionStore {
  return {
    insert: async (workspaceId, input) => {
      const suggestion = requireFactSuggestion(input);
      requirePending(suggestion);
      try {
        await client.query(
          `INSERT INTO fact_suggestions
             (id, workspace_id, profile_id, status, dedupe_key, suggestion, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            suggestion.id,
            workspaceId,
            suggestion.profileId,
            suggestion.status,
            suggestion.dedupeKey,
            JSON.stringify(suggestion),
            suggestion.createdAt,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicate();
        throw error;
      }
    },
    decide: async (workspaceId, input) => {
      const next = requireFactSuggestion(input);
      try {
        await client.transaction(async (executor) => {
          const [row] = await executor.query(
            "SELECT suggestion FROM fact_suggestions WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
            [workspaceId, next.id],
          );
          if (row === undefined) {
            throw new FactSuggestionStoreError("suggestion_not_found", "No such fact suggestion.");
          }
          const decided = decidedFactSuggestion(suggestionOf(row), next);
          await executor.query(
            `UPDATE fact_suggestions SET status = $3, suggestion = $4::jsonb, updated_at = now()
             WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, next.id, decided.status, JSON.stringify(decided)],
          );
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicate();
        throw error;
      }
    },
    get: async (workspaceId, id) => {
      const [row] = await client.query(
        "SELECT suggestion FROM fact_suggestions WHERE workspace_id = $1 AND id = $2",
        [workspaceId, id],
      );
      return row === undefined ? undefined : suggestionOf(row);
    },
    list: async (workspaceId, { profileId, status, limit }) => {
      const rows = await client.query(
        `SELECT suggestion FROM fact_suggestions
         WHERE workspace_id = $1
           AND ($2::text IS NULL OR profile_id = $2)
           AND ($3::text IS NULL OR status = $3)
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [workspaceId, profileId ?? null, status ?? null, limit],
      );
      return rows.map(suggestionOf);
    },
    holderOfKey: async (workspaceId, profileId, dedupeKey) => {
      const [row] = await client.query(
        `SELECT suggestion FROM fact_suggestions
         WHERE workspace_id = $1 AND profile_id = $2 AND dedupe_key = $3 AND status <> 'stale'`,
        [workspaceId, profileId, dedupeKey],
      );
      return row === undefined ? undefined : suggestionOf(row);
    },
    countPending: async (workspaceId, profileId) => {
      const [row] = await client.query(
        `SELECT count(*) AS count FROM fact_suggestions
         WHERE workspace_id = $1 AND status = 'pending' AND ($2::text IS NULL OR profile_id = $2)`,
        [workspaceId, profileId ?? null],
      );
      return Number(row?.count ?? 0);
    },
  };
}
