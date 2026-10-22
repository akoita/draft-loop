import type { SqlClient } from "./sql-client.js";

/** One company, model and route's completed calls in a month: counts and amounts only. */
export interface MonthUsageRow {
  readonly company: string;
  readonly model: string;
  readonly route: string | null;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedUsd: number;
  readonly unpricedCalls: number;
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/u;

/**
 * Reads the tenant's usage per month from its execution records. Row-level security confines the
 * sums to the tenant the storage was opened for (ADR 0011, D3).
 */
export function createUsageReads(client: SqlClient) {
  return {
    /** `month` is `YYYY-MM`; calls count in the UTC month they completed in. */
    monthUsage: async (month: string): Promise<readonly MonthUsageRow[]> => {
      if (!monthPattern.test(month)) throw new Error("Usage month must be YYYY-MM");
      const rows = await client.query(
        `SELECT provider, model_id, (payload_json::jsonb)->>'route' AS route,
                count(*) AS calls,
                coalesce(sum(input_tokens), 0) AS input_tokens,
                coalesce(sum(output_tokens), 0) AS output_tokens,
                coalesce(sum(estimated_usd), 0) AS estimated_usd,
                count(*) FILTER (WHERE estimated_usd IS NULL) AS unpriced_calls
           FROM executions
          WHERE status = 'completed' AND left(completed_at, 7) = $1
          GROUP BY provider, model_id, route
          ORDER BY provider, model_id, route NULLS FIRST`,
        [month],
      );
      return rows.map((row) => ({
        company: String(row.provider),
        model: String(row.model_id),
        route: row.route === null ? null : String(row.route),
        calls: Number(row.calls),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        estimatedUsd: Number(row.estimated_usd),
        unpricedCalls: Number(row.unpriced_calls),
      }));
    },
  };
}
