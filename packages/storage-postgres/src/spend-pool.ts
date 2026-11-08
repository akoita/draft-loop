import type { SqlSession } from "./sql-client.js";

/** Serialises reservations on the pool across every tenant session; any shared constant works. */
const spendPoolLockKey = 0x73706e64;

export interface ReserveSpendInput {
  readonly runId: string;
  /** The most the run may cost: its own cost limit. */
  readonly usd: number;
  /** The month's ceiling in US dollars. */
  readonly limitUsd: number;
  readonly now: Date;
}

export type ReserveSpendResult =
  | { readonly refused: false; readonly committedUsd: number }
  | { readonly refused: true; readonly committedUsd: number };

/** The deployment's monthly spend pool (#2459): content-free amounts, shared by every tenant. */
export interface SpendPool {
  /**
   * Reserves `usd` for the run in `now`'s UTC month unless that would take the month's committed
   * amount (closed costs plus open reservations) above `limitUsd`. A second call for the same
   * run reserves nothing and is not refused.
   */
  readonly reserve: (input: ReserveSpendInput) => Promise<ReserveSpendResult>;
  /** Replaces the run's reservation with what it cost. Unknown or closed runs write nothing. */
  readonly close: (input: {
    readonly runId: string;
    readonly usd: number;
    readonly now: Date;
  }) => Promise<boolean>;
  /** The month's committed amount in US dollars. */
  readonly committed: (now: Date) => Promise<number>;
}

export class SpendPoolError extends Error {
  override readonly name = "SpendPoolError";
}

/** The UTC month of a date, as `YYYY-MM`. */
export function spendPoolMonth(now: Date): string {
  if (Number.isNaN(now.getTime()))
    throw new SpendPoolError("A spend pool clock must be a valid date.");
  return now.toISOString().slice(0, 7);
}

function requireRunId(runId: string): void {
  if (runId.length === 0 || runId.length > 256) {
    throw new SpendPoolError("A spend pool run id must have 1 to 256 characters.");
  }
}

function requireAmount(name: string, value: number, allowZero: boolean): void {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new SpendPoolError(
      `${name} must be a ${allowZero ? "non-negative" : "positive"} number.`,
    );
  }
}

const committedSql =
  "SELECT coalesce(sum(coalesce(spent_usd, reserved_usd)), 0) AS committed FROM spend_pool_entries WHERE month = $1";

export function createSpendPool(client: SqlSession): SpendPool {
  return {
    reserve: async ({ runId, usd, limitUsd, now }) => {
      requireRunId(runId);
      requireAmount("A reservation", usd, false);
      requireAmount("A spend pool limit", limitUsd, false);
      const month = spendPoolMonth(now);
      return client.transaction(async (executor) => {
        await executor.query("SELECT pg_advisory_xact_lock($1)", [spendPoolLockKey]);
        const [row] = await executor.query(committedSql, [month]);
        const committedUsd = Number(row?.committed ?? 0);
        const existing = await executor.query(
          "SELECT 1 FROM spend_pool_entries WHERE run_id = $1",
          [runId],
        );
        if (existing.length > 0) return { refused: false, committedUsd };
        if (committedUsd + usd > limitUsd) return { refused: true, committedUsd };
        await executor.query(
          "INSERT INTO spend_pool_entries (run_id, month, reserved_usd, reserved_at) VALUES ($1, $2, $3, $4)",
          [runId, month, usd, now.toISOString()],
        );
        return { refused: false, committedUsd: committedUsd + usd };
      });
    },
    close: async ({ runId, usd, now }) => {
      requireRunId(runId);
      requireAmount("A run's cost", usd, true);
      const rows = await client.query(
        `UPDATE spend_pool_entries SET spent_usd = $2, closed_at = $3
          WHERE run_id = $1 AND closed_at IS NULL RETURNING run_id`,
        [runId, usd, spendPoolClock(now)],
      );
      return rows.length > 0;
    },
    committed: async (now) => {
      const [row] = await client.query(committedSql, [spendPoolMonth(now)]);
      return Number(row?.committed ?? 0);
    },
  };
}

function spendPoolClock(now: Date): string {
  spendPoolMonth(now);
  return now.toISOString();
}

/** The most a pool ceiling may be, in US dollars; anything above it is a typo, not a budget. */
const maximumSpendPoolUsd = 1_000_000;

/**
 * Reads `DRAFT_LOOP_SPEND_POOL_USD`, the deployment's monthly ceiling on model spend across every
 * organisation. Unset means no pool, as on a self-hosted server; the API and the worker read the
 * same variable, so a run reserved by one is closed by the other.
 */
export function readSpendPoolLimitUsd(env: NodeJS.ProcessEnv): number | undefined {
  const text = env.DRAFT_LOOP_SPEND_POOL_USD ?? "";
  if (text.trim() === "") return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > maximumSpendPoolUsd) {
    throw new SpendPoolError(
      `DRAFT_LOOP_SPEND_POOL_USD must be a positive number of US dollars up to ${maximumSpendPoolUsd}.`,
    );
  }
  return value;
}
