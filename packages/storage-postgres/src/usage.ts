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

/** The audit event the plan step appends after each call, holding all its calls so far. */
const applicationPlanEventType = "run.application-plan";

/**
 * Reads the tenant's usage per month from its execution records and, for the application plan
 * step whose calls are not executions, from each run's latest plan event. Row-level security confines the
 * sums to the tenant the storage was opened for (ADR 0011, D3).
 */
export function createUsageReads(client: SqlClient) {
  return {
    /** `month` is `YYYY-MM`; calls count in the UTC month they completed in. */
    monthUsage: async (month: string): Promise<readonly MonthUsageRow[]> => {
      if (!monthPattern.test(month)) throw new Error("Usage month must be YYYY-MM");
      const rows = await client.query(
        `WITH calls AS (
           SELECT provider, model_id, (payload_json::jsonb)->>'route' AS route,
                  input_tokens::bigint AS input_tokens, output_tokens::bigint AS output_tokens,
                  estimated_usd
             FROM executions
            WHERE status = 'completed' AND left(completed_at, 7) = $1
           UNION ALL
           SELECT step->>'provider', step->>'modelId', step->>'route',
                  (step->>'inputTokens')::bigint, (step->>'outputTokens')::bigint,
                  (step->>'estimatedUsd')::double precision
             FROM (SELECT DISTINCT ON (workspace_id, entity_id) payload_json
                     FROM audit_events
                    WHERE event_type = $2
                    ORDER BY workspace_id, entity_id, sequence DESC) AS latest,
                  jsonb_array_elements((latest.payload_json::jsonb)->'steps') AS step
            WHERE left(step->>'completedAt', 7) = $1
         )
         SELECT provider, model_id, route,
                count(*) AS calls,
                coalesce(sum(input_tokens), 0) AS input_tokens,
                coalesce(sum(output_tokens), 0) AS output_tokens,
                coalesce(sum(estimated_usd), 0) AS estimated_usd,
                count(*) FILTER (WHERE estimated_usd IS NULL) AS unpriced_calls
           FROM calls
          GROUP BY provider, model_id, route
          ORDER BY provider, model_id, route NULLS FIRST`,
        [month, applicationPlanEventType],
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
