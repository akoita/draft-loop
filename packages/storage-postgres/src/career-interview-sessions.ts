import type { CareerInterviewSession } from "@draft-loop/schemas/career-interview";
import {
  type CareerInterviewSessionStore,
  CareerInterviewStoreError,
  requireCareerInterviewSession,
} from "@draft-loop/storage/career-interview-sessions";
import type { SqlSession } from "./sql-client.js";

function sessionOf(row: Record<string, unknown>): CareerInterviewSession {
  const value = typeof row.session === "string" ? JSON.parse(row.session) : row.session;
  return requireCareerInterviewSession(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

/** One tenant's interview sessions on Postgres; row-level security confines them to the tenant. */
export function createCareerInterviewSessionStore(client: SqlSession): CareerInterviewSessionStore {
  return {
    insert: async (input) => {
      const session = requireCareerInterviewSession(input);
      try {
        await client.query(
          `INSERT INTO career_interview_sessions
             (id, workspace_id, status, session, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [
            session.id,
            session.workspace_id,
            session.status,
            JSON.stringify(session),
            session.created_at,
            session.updated_at,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new CareerInterviewStoreError("duplicate_session", "The session already exists.");
        }
        throw error;
      }
    },
    replace: async (input) => {
      const session = requireCareerInterviewSession(input);
      const rows = await client.query(
        `UPDATE career_interview_sessions
           SET status = $3,
               session = jsonb_set($4::jsonb, '{created_at}', to_jsonb(created_at)),
               updated_at = $5
         WHERE workspace_id = $1 AND id = $2
         RETURNING id`,
        [
          session.workspace_id,
          session.id,
          session.status,
          JSON.stringify(session),
          session.updated_at,
        ],
      );
      if (rows.length === 0) {
        throw new CareerInterviewStoreError("session_not_found", "No such interview session.");
      }
    },
    get: async (workspaceId, id) => {
      const [row] = await client.query(
        "SELECT session FROM career_interview_sessions WHERE workspace_id = $1 AND id = $2",
        [workspaceId, id],
      );
      return row === undefined ? undefined : sessionOf(row);
    },
    list: async (workspaceId, limit) => {
      const rows = await client.query(
        `SELECT session FROM career_interview_sessions WHERE workspace_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2`,
        [workspaceId, limit],
      );
      return rows.map(sessionOf);
    },
    latestUnfinished: async (workspaceId) => {
      const [row] = await client.query(
        `SELECT session FROM career_interview_sessions
         WHERE workspace_id = $1 AND status <> 'closed'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [workspaceId],
      );
      return row === undefined ? undefined : sessionOf(row);
    },
    declinedTopicKeys: async (workspaceId) => {
      const rows = await client.query(
        `SELECT DISTINCT topic ->> 'key' AS key
         FROM career_interview_sessions, jsonb_array_elements(session -> 'topics') AS topic
         WHERE workspace_id = $1 AND topic ->> 'status' = 'declined'`,
        [workspaceId],
      );
      return new Set(rows.map((row) => String(row.key)));
    },
  };
}
