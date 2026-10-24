/**
 * Credit period arithmetic (ADR 0011, D13): calendar months in UTC, counted from the plan
 * assignment's period start. Pure functions, so the ledger's period roll is testable without a
 * database.
 */

/** One credit period: `start` and `end` are UTC dates, `YYYY-MM-DD`; `end` is exclusive. */
export interface CreditPeriod {
  readonly start: string;
  readonly end: string;
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Adds calendar months in UTC and keeps the time of day. A day that the target month lacks moves
 * to the month's last day, so adding one month to 31 January gives 28 or 29 February.
 */
export function addUtcMonths(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));
  const moved = new Date(date.getTime());
  moved.setUTCFullYear(year, month, day);
  return moved;
}

function utcDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The instant a UTC date, `YYYY-MM-DD`, begins. */
export function utcDateStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** The first instant of the UTC day that `now` falls in, as an ISO 8601 timestamp. */
export function startOfUtcDay(now: Date): string {
  return utcDateStart(utcDateOf(now)).toISOString();
}

/**
 * The credit period `now` falls in. Periods are `months` calendar months long and counted from
 * `anchor`, always measured from the anchor itself so a clamped short month does not move later
 * periods: an anchor on the 31st gives periods starting on 31 January, 28 February, 31 March.
 * Returns undefined while `now` is before the anchor, since no period has begun.
 */
export function creditPeriodAt(
  anchor: string,
  months: number,
  now: Date,
): CreditPeriod | undefined {
  const origin = utcDateStart(anchor);
  if (now.getTime() < origin.getTime()) return undefined;
  const elapsedMonths =
    (now.getUTCFullYear() - origin.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - origin.getUTCMonth());
  // The period count is at most the elapsed months divided by the length, plus one for the
  // current month's clamping; step down until the period has begun.
  for (let index = Math.floor(elapsedMonths / months) + 1; index >= 0; index -= 1) {
    const start = addUtcMonths(origin, index * months);
    if (start.getTime() <= now.getTime()) {
      return {
        start: utcDateOf(start),
        end: utcDateOf(addUtcMonths(origin, (index + 1) * months)),
      };
    }
  }
  return undefined;
}
