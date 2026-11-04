import {
  type AgentTokenRecord,
  type AgentTokenStore,
  AgentTokenStoreError,
  requireAgentTokenInsert,
} from "@draft-loop/storage/agent-tokens";
import type { SqlSession } from "./sql-client.js";

function recordOf(row: Record<string, unknown>): AgentTokenRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    label: String(row.label),
    createdAt: String(row.created_at),
    ...(row.revoked_at === null || row.revoked_at === undefined
      ? {}
      : { revokedAt: String(row.revoked_at) }),
  };
}

const columns = "id, workspace_id, label, created_at, revoked_at";

/** One tenant's agent tokens on Postgres; row-level security confines them to the tenant. */
export function createAgentTokenStore(client: SqlSession): AgentTokenStore {
  return {
    insert: async (input) => {
      const token = requireAgentTokenInsert(input);
      try {
        await client.query(
          `INSERT INTO agent_tokens (id, workspace_id, label, secret_hash, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [token.id, token.workspaceId, token.label, token.secretHash, token.createdAt],
        );
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "23505") {
          throw new AgentTokenStoreError("duplicate_token", "The agent token is already stored.");
        }
        throw error;
      }
    },
    findByHash: async (secretHash) => {
      const [row] = await client.query(
        `SELECT ${columns} FROM agent_tokens WHERE secret_hash = $1`,
        [secretHash],
      );
      return row === undefined ? undefined : recordOf(row);
    },
    list: async (workspaceId) =>
      (
        await client.query(
          `SELECT ${columns} FROM agent_tokens WHERE workspace_id = $1
           ORDER BY created_at DESC, id DESC`,
          [workspaceId],
        )
      ).map(recordOf),
    revoke: async (workspaceId, id, at) => {
      const rows = await client.query(
        `UPDATE agent_tokens SET revoked_at = $3
          WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL
          RETURNING 1`,
        [workspaceId, id, at],
      );
      return rows.length > 0;
    },
  };
}
