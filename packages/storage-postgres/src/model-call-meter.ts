import type { SqlSession } from "./sql-client.js";

/** The outcome of taking one model call from the day's allowance. */
export type ModelCallTake =
  | { readonly allowed: true; readonly used: number }
  | { readonly allowed: false; readonly used: number };

/** One tenant's daily count of model calls outside runs (#2487). */
export interface ModelCallMeter {
  /**
   * Counts one call in `now`'s UTC day unless `limit` calls are already counted. Concurrent takes
   * cannot pass the limit: the increment and the check are one statement.
   */
  readonly take: (input: { readonly limit: number; readonly now: Date }) => Promise<ModelCallTake>;
  readonly used: (now: Date) => Promise<number>;
}

export class ModelCallMeterError extends Error {
  override readonly name = "ModelCallMeterError";
}

function utcDay(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new ModelCallMeterError("A clock must be a valid date.");
  return now.toISOString().slice(0, 10);
}

export function createModelCallMeter(client: SqlSession): ModelCallMeter {
  const used = async (now: Date): Promise<number> => {
    const [row] = await client.query("SELECT calls FROM model_call_counts WHERE day = $1", [
      utcDay(now),
    ]);
    return Number(row?.calls ?? 0);
  };
  return {
    take: async ({ limit, now }) => {
      if (!Number.isInteger(limit) || limit < 0) {
        throw new ModelCallMeterError("A model call limit must be a whole number of 0 or more.");
      }
      const day = utcDay(now);
      if (limit === 0) return { allowed: false, used: await used(now) };
      const [row] = await client.query(
        `INSERT INTO model_call_counts (day, calls) VALUES ($1, 1)
         ON CONFLICT (tenant_id, day) DO UPDATE SET calls = model_call_counts.calls + 1
           WHERE model_call_counts.calls < $2
         RETURNING calls`,
        [day, limit],
      );
      if (row === undefined) return { allowed: false, used: await used(now) };
      return { allowed: true, used: Number(row.calls) };
    },
    used,
  };
}
