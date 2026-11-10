import {
  type AgentTokenRecord,
  type AgentTokenStore,
  AgentTokenStoreError,
  defaultAgentTokenScopes,
  isAgentTokenScope,
  legacyAgentTokenExpiry,
  normalizeAgentTokenScopes,
  requireAgentTokenInsert,
} from "@draft-loop/storage/agent-tokens";
import type { SqlSession } from "./sql-client.js";

/** A row's scopes; a token stored before scopes (a null column) holds the journal only. */
function scopesOf(value: unknown): AgentTokenRecord["scopes"] {
  if (value === null || value === undefined) return defaultAgentTokenScopes;
  // An unknown scope in the column fails closed: the token keeps only what is recognised.
  return normalizeAgentTokenScopes(String(value).split(",").filter(isAgentTokenScope)) ?? [];
}

function recordOf(row: Record<string, unknown>): AgentTokenRecord {
  const cap = row.monthly_cap_cents;
  return {
    ...(cap === null || cap === undefined ? {} : { monthlyCapCents: Number(cap) }),
    ...(row.spend_month === null || row.spend_month === undefined
      ? {}
      : { spend: { month: String(row.spend_month), cents: Number(row.spent_cents) } }),
    scopes: scopesOf(row.scopes),
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    label: String(row.label),
    createdAt: String(row.created_at),
    // A token stored before tokens expired lives the default lifetime from its issue.
    expiresAt:
      row.expires_at === null || row.expires_at === undefined
        ? legacyAgentTokenExpiry(String(row.created_at))
        : String(row.expires_at),
    ...(row.revoked_at === null || row.revoked_at === undefined
      ? {}
      : { revokedAt: String(row.revoked_at) }),
  };
}

const columns =
  "id, workspace_id, label, created_at, expires_at, revoked_at, scopes, monthly_cap_cents, spend_month, spent_cents";

/** This month's spend: the row's, or nothing when it holds another month. */
const spentThisMonth = "(CASE WHEN spend_month = $3::text THEN spent_cents ELSE 0 END)";
const keysThisMonth = "(CASE WHEN spend_month = $3::text THEN spend_keys ELSE '{}'::jsonb END)";

/** One tenant's agent tokens on Postgres; row-level security confines them to the tenant. */
export function createAgentTokenStore(client: SqlSession): AgentTokenStore {
  return {
    insert: async (input) => {
      const token = requireAgentTokenInsert(input);
      try {
        await client.query(
          `INSERT INTO agent_tokens
             (id, workspace_id, label, secret_hash, created_at, expires_at, scopes, monthly_cap_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            token.id,
            token.workspaceId,
            token.label,
            token.secretHash,
            token.createdAt,
            token.expiresAt,
            token.scopes.join(","),
            token.monthlyCapCents ?? null,
          ],
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
    reserveSpend: async ({ workspaceId, id, month, key, cents }) => {
      // One statement: the row lock makes a concurrent start re-check the cap after this one.
      const [reserved] = await client.query(
        `UPDATE agent_tokens
            SET spend_keys = ${keysThisMonth} || jsonb_build_object($4::text, $5::integer),
                spent_cents = ${spentThisMonth} + $5,
                spend_month = $3
          WHERE workspace_id = $1 AND id = $2 AND monthly_cap_cents IS NOT NULL
            AND NOT (${keysThisMonth} ? $4::text)
            AND ${spentThisMonth} + $5 <= monthly_cap_cents
          RETURNING spent_cents`,
        [workspaceId, id, month, key, cents],
      );
      if (reserved !== undefined) {
        return { outcome: "reserved", spentCents: Number(reserved.spent_cents) };
      }
      const [row] = await client.query(
        `SELECT monthly_cap_cents, ${spentThisMonth} AS spent, (${keysThisMonth} ? $4::text) AS replayed
           FROM agent_tokens WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id, month, key],
      );
      if (row === undefined || row.monthly_cap_cents === null) return { outcome: "no_cap" };
      if (row.replayed === true) return { outcome: "replayed", spentCents: Number(row.spent) };
      return {
        outcome: "cap_reached",
        spentCents: Number(row.spent),
        capCents: Number(row.monthly_cap_cents),
      };
    },
    releaseSpend: async ({ workspaceId, id, month, key }) => {
      await client.query(
        `UPDATE agent_tokens
            SET spent_cents = GREATEST(0, spent_cents - (spend_keys ->> $4::text)::integer),
                spend_keys = spend_keys - $4::text
          WHERE workspace_id = $1 AND id = $2 AND spend_month = $3 AND spend_keys ? $4::text`,
        [workspaceId, id, month, key],
      );
    },
  };
}
