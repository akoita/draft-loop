import type { SqlSession } from "./sql-client.js";

/** How long the day's spend rows stay, for the operator's reports. */
export const supportSpendKeepDays = 90;

/**
 * The support assistant's daily use across the deployment: questions per member and the
 * estimated model cost of all members, per UTC day. Every API instance reads the same counts.
 */
export interface SupportUsage {
  readonly questionsToday: (memberId: string, now: Date) => Promise<number>;
  /** Counts one question; the first count of a day also sweeps rows that are no longer needed. */
  readonly countQuestion: (memberId: string, now: Date) => Promise<void>;
  readonly costTodayUsd: (now: Date) => Promise<number>;
  readonly addCost: (estimatedUsd: number, now: Date) => Promise<void>;
}

export class SupportUsageError extends Error {
  override readonly name = "SupportUsageError";
}

function utcDay(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new SupportUsageError("A clock must be a valid date.");
  return now.toISOString().slice(0, 10);
}

function memberKey(memberId: string): string {
  if (memberId.length < 1 || memberId.length > 128) {
    throw new SupportUsageError("A member id must be 1 to 128 characters.");
  }
  return memberId;
}

export function createSupportUsage(client: SqlSession): SupportUsage {
  let sweptDay = "";
  return {
    questionsToday: async (memberId, now) => {
      const [row] = await client.query(
        "SELECT questions FROM support_question_counts WHERE day = $1 AND member_id = $2",
        [utcDay(now), memberKey(memberId)],
      );
      return Number(row?.questions ?? 0);
    },
    countQuestion: async (memberId, now) => {
      const day = utcDay(now);
      await client.query(
        `INSERT INTO support_question_counts (day, member_id, questions) VALUES ($1, $2, 1)
         ON CONFLICT (day, member_id) DO UPDATE
           SET questions = support_question_counts.questions + 1`,
        [day, memberKey(memberId)],
      );
      if (sweptDay === day) return;
      sweptDay = day;
      await client.query("DELETE FROM support_question_counts WHERE day < $1::date - 1", [day]);
      await client.query("DELETE FROM support_daily_spend WHERE day < $1::date - $2::int", [
        day,
        supportSpendKeepDays,
      ]);
    },
    costTodayUsd: async (now) => {
      const [row] = await client.query(
        "SELECT estimated_usd FROM support_daily_spend WHERE day = $1",
        [utcDay(now)],
      );
      return Number(row?.estimated_usd ?? 0);
    },
    addCost: async (estimatedUsd, now) => {
      if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) {
        throw new SupportUsageError("A cost must be a finite number of 0 or more.");
      }
      if (estimatedUsd === 0) return;
      await client.query(
        `INSERT INTO support_daily_spend (day, estimated_usd) VALUES ($1, $2)
         ON CONFLICT (day) DO UPDATE
           SET estimated_usd = support_daily_spend.estimated_usd + EXCLUDED.estimated_usd`,
        [utcDay(now), estimatedUsd],
      );
    },
  };
}
