import type { SqlSession } from "./sql-client.js";

/**
 * The outcome of taking one Prepare call for an application (#2680). An application is credited
 * when one of its runs holds or spent a credit; a refunded run does not count.
 */
export type PrepareCallTake =
  | { readonly credited: false }
  | { readonly credited: true; readonly allowed: boolean; readonly used: number };

export interface PrepareCallAddress {
  readonly workspaceId: string;
  readonly applicationId: string;
}

/** One tenant's count of Prepare model calls per credited application. */
export interface PrepareCallMeter {
  /**
   * Counts one call for a credited application unless `limit` calls are already counted, and
   * counts nothing for an application without a credit. Concurrent takes cannot pass the limit:
   * the increment and the check are one statement.
   */
  readonly take: (
    input: PrepareCallAddress & { readonly limit: number },
  ) => Promise<PrepareCallTake>;
  readonly used: (address: PrepareCallAddress) => Promise<number>;
}

export class PrepareCallMeterError extends Error {
  override readonly name = "PrepareCallMeterError";
}

function requireId(value: string, field: string): string {
  if (value.length < 1 || value.length > 256) {
    throw new PrepareCallMeterError(`A ${field} must have 1 to 256 characters.`);
  }
  return value;
}

export function createPrepareCallMeter(client: SqlSession): PrepareCallMeter {
  const used = async ({ workspaceId, applicationId }: PrepareCallAddress): Promise<number> => {
    const [row] = await client.query(
      "SELECT calls FROM prepare_call_counts WHERE workspace_id = $1 AND application_id = $2",
      [workspaceId, applicationId],
    );
    return Number(row?.calls ?? 0);
  };
  return {
    take: async ({ workspaceId, applicationId, limit }) => {
      if (!Number.isInteger(limit) || limit < 0) {
        throw new PrepareCallMeterError(
          "A Prepare call limit must be a whole number of 0 or more.",
        );
      }
      const address = {
        workspaceId: requireId(workspaceId, "workspace id"),
        applicationId: requireId(applicationId, "application id"),
      };
      const [credit] = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM application_run_bindings b
           JOIN credit_ledger r ON r.run_id = b.run_id AND r.kind = 'reserve'
           WHERE b.workspace_id = $1 AND b.application_id = $2
             AND NOT EXISTS (
               SELECT 1 FROM credit_ledger f WHERE f.run_id = r.run_id AND f.kind = 'refund'
             )
         ) AS credited`,
        [workspaceId, applicationId],
      );
      if (credit?.credited !== true) return { credited: false };
      if (limit === 0) return { credited: true, allowed: false, used: await used(address) };
      const [row] = await client.query(
        `INSERT INTO prepare_call_counts (workspace_id, application_id, calls) VALUES ($1, $2, 1)
         ON CONFLICT (tenant_id, workspace_id, application_id)
           DO UPDATE SET calls = prepare_call_counts.calls + 1
           WHERE prepare_call_counts.calls < $3
         RETURNING calls`,
        [workspaceId, applicationId, limit],
      );
      if (row === undefined) return { credited: true, allowed: false, used: await used(address) };
      return { credited: true, allowed: true, used: Number(row.calls) };
    },
    used,
  };
}
