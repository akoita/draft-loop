import type { SqlSession } from "./sql-client.js";

/**
 * How many letters Check my letter checked per UTC day, across the deployment (#3282). It holds
 * a date and a number only: the check keeps no letter, and the count names no one.
 */
export interface CoverLetterCheckCounts {
  /** Counts one check in `now`'s UTC day. */
  readonly count: (now: Date) => Promise<void>;
}

export class CoverLetterCheckCountError extends Error {
  override readonly name = "CoverLetterCheckCountError";
}

export function createCoverLetterCheckCounts(client: SqlSession): CoverLetterCheckCounts {
  return {
    count: async (now) => {
      if (Number.isNaN(now.getTime())) {
        throw new CoverLetterCheckCountError("A clock must be a valid date.");
      }
      await client.query(
        `INSERT INTO cover_letter_check_counts (day, checks) VALUES ($1, 1)
         ON CONFLICT (day) DO UPDATE SET checks = cover_letter_check_counts.checks + 1`,
        [now.toISOString().slice(0, 10)],
      );
    },
  };
}
