import {
  type AgentConnectionCap,
  type AgentConnectionCapStore,
  requireAgentConnectionCap,
} from "@draft-loop/storage/agent-connection-caps";
import type { SqlSession } from "./sql-client.js";

function capOf(row: Record<string, unknown>): AgentConnectionCap {
  return {
    workspaceId: String(row.workspace_id),
    clientId: String(row.client_id),
    monthlyCapCents: Number(row.monthly_cap_cents),
    updatedAt: String(row.updated_at),
    ...(row.spend_month === null || row.spend_month === undefined
      ? {}
      : { spend: { month: String(row.spend_month), cents: Number(row.spent_cents) } }),
  };
}

const columns = "workspace_id, client_id, monthly_cap_cents, updated_at, spend_month, spent_cents";

/** This month's spend: the row's, or nothing when it holds another month. */
const spentThisMonth = "(CASE WHEN spend_month = $3::text THEN spent_cents ELSE 0 END)";
const keysThisMonth = "(CASE WHEN spend_month = $3::text THEN spend_keys ELSE '{}'::jsonb END)";

/** One tenant's connection caps on Postgres; row-level security confines them to the tenant. */
export function createAgentConnectionCapStore(client: SqlSession): AgentConnectionCapStore {
  return {
    set: async (input) => {
      const cap = requireAgentConnectionCap(input);
      const [row] = await client.query(
        `INSERT INTO agent_connection_caps (workspace_id, client_id, monthly_cap_cents, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, workspace_id, client_id)
           DO UPDATE SET monthly_cap_cents = EXCLUDED.monthly_cap_cents,
                         updated_at = EXCLUDED.updated_at
         RETURNING ${columns}`,
        [cap.workspaceId, cap.clientId, cap.monthlyCapCents, cap.updatedAt],
      );
      if (row === undefined) throw new Error("The connection cap was not stored.");
      return capOf(row);
    },
    get: async (workspaceId, clientId) => {
      const [row] = await client.query(
        `SELECT ${columns} FROM agent_connection_caps WHERE workspace_id = $1 AND client_id = $2`,
        [workspaceId, clientId],
      );
      return row === undefined ? undefined : capOf(row);
    },
    list: async (workspaceId) => {
      const rows = await client.query(
        `SELECT ${columns} FROM agent_connection_caps WHERE workspace_id = $1
          ORDER BY client_id COLLATE "C"`,
        [workspaceId],
      );
      return rows.map(capOf);
    },
    remove: async (workspaceId, clientId) => {
      const rows = await client.query(
        `DELETE FROM agent_connection_caps WHERE workspace_id = $1 AND client_id = $2 RETURNING 1`,
        [workspaceId, clientId],
      );
      return rows.length > 0;
    },
    reserveSpend: async ({ workspaceId, clientId, month, key, cents }) => {
      // One statement: the row lock makes a concurrent start re-check the cap after this one.
      const [reserved] = await client.query(
        `UPDATE agent_connection_caps
            SET spend_keys = ${keysThisMonth} || jsonb_build_object($4::text, $5::integer),
                spent_cents = ${spentThisMonth} + $5,
                spend_month = $3
          WHERE workspace_id = $1 AND client_id = $2
            AND NOT (${keysThisMonth} ? $4::text)
            AND ${spentThisMonth} + $5 <= monthly_cap_cents
          RETURNING spent_cents`,
        [workspaceId, clientId, month, key, cents],
      );
      if (reserved !== undefined) {
        return { outcome: "reserved", spentCents: Number(reserved.spent_cents) };
      }
      const [row] = await client.query(
        `SELECT monthly_cap_cents, ${spentThisMonth} AS spent, (${keysThisMonth} ? $4::text) AS replayed
           FROM agent_connection_caps WHERE workspace_id = $1 AND client_id = $2`,
        [workspaceId, clientId, month, key],
      );
      if (row === undefined) return { outcome: "no_cap" };
      if (row.replayed === true) return { outcome: "replayed", spentCents: Number(row.spent) };
      return {
        outcome: "cap_reached",
        spentCents: Number(row.spent),
        capCents: Number(row.monthly_cap_cents),
      };
    },
    releaseSpend: async ({ workspaceId, clientId, month, key }) => {
      await client.query(
        `UPDATE agent_connection_caps
            SET spent_cents = GREATEST(0, spent_cents - (spend_keys ->> $4::text)::integer),
                spend_keys = spend_keys - $4::text
          WHERE workspace_id = $1 AND client_id = $2 AND spend_month = $3 AND spend_keys ? $4::text`,
        [workspaceId, clientId, month, key],
      );
    },
  };
}
