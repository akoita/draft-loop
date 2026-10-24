import type { CreditBalance } from "@draft-loop/storage-postgres";
import type { FastifyBaseLogger } from "fastify";

/** The share of a period's allowance whose use warns the organisation, in percent. */
export const creditWarningPercent = 80;

/**
 * How much of the period's allowance is committed.
 *
 * `used` is the credits of the current period's allowance that runs have settled plus the part of
 * `reserved` taken from that allowance, because a reservation is what the next run cannot spend.
 * Credits drawn from operator grants are not counted: they are not the allowance. It is derived
 * from the balance as `allowance - (remaining - grantsRemaining)`, so it never disagrees with
 * `remaining`. An unlimited plan has no allowance to use up, so its `used` is only what the period's
 * runs settled or hold, for metering.
 */
export function creditUsage(balance: CreditBalance): {
  readonly used: number;
  readonly warning: boolean;
} {
  if (balance.unlimited) return { used: balance.allowanceUsed + balance.reserved, warning: false };
  const allowanceLeft = balance.remaining - balance.grantsRemaining;
  const used = Math.min(balance.allowance, Math.max(0, balance.allowance - allowanceLeft));
  return { used, warning: reachesWarning(used, balance.allowance) };
}

/** Whether `used` is at least 80% of the allowance; whole numbers only, a zero allowance never warns. */
function reachesWarning(used: number, allowance: number): boolean {
  return allowance > 0 && used * 100 >= allowance * creditWarningPercent;
}

/** The thresholds a reservation crossed, from the balance before it and the balance after. */
export interface CreditCrossings {
  readonly warning: boolean;
  readonly exhausted: boolean;
}

/**
 * Compares the balances around one new reservation. The warning is the allowance's use crossing
 * from below 80% to at least 80%; exhaustion is `remaining` falling from a positive number to 0.
 * An unlimited plan crosses neither. A refund can bring the balance back under a threshold, so a
 * later reservation can cross it again.
 */
export function creditCrossings(before: CreditBalance, after: CreditBalance): CreditCrossings {
  if (after.unlimited || before.unlimited) return { warning: false, exhausted: false };
  return {
    warning: !creditUsage(before).warning && creditUsage(after).warning,
    exhausted: before.remaining > 0 && after.remaining <= 0,
  };
}

/**
 * Logs each threshold the reservation crossed, as a content-free `WARNING` line whose message the
 * infrastructure alerts on: `credit allowance 80% used` and `credit balance exhausted`. The fields
 * are the organisation id, the period's end and numbers.
 */
export function logCreditCrossings(
  log: FastifyBaseLogger,
  organisationId: string,
  before: CreditBalance,
  after: CreditBalance,
): void {
  const crossings = creditCrossings(before, after);
  if (!crossings.warning && !crossings.exhausted) return;
  const fields = {
    organisationId,
    periodEnd: after.periodEnd,
    allowance: after.allowance,
    used: creditUsage(after).used,
    remaining: after.remaining,
  };
  if (crossings.warning) log.warn(fields, "credit allowance 80% used");
  if (crossings.exhausted) log.warn(fields, "credit balance exhausted");
}
