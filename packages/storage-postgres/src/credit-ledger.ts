import type { Entitlements } from "@draft-loop/domain/entitlements";
import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import {
  addUtcMonths,
  type CreditPeriod,
  creditPeriodAt,
  startOfUtcDay,
} from "./credit-periods.js";
import { createOrganisationPlans, type PlanAssignment } from "./organisation-plans.js";
import type { SqlExecutor, SqlRow, SqlSession } from "./sql-client.js";

/** The moment an operation acts at: an ISO 8601 timestamp or a date. */
export type CreditClock = string | Date;

/**
 * What an organisation may spend, from the ledger at one moment. Every credit figure is a whole
 * number of credits. Credits that expired, or that belong to a period that ended, appear nowhere.
 */
export interface CreditBalance {
  /** The UTC date, `YYYY-MM-DD`, the current credit period began; null without a current period. */
  readonly periodStart: string | null;
  /** The UTC date, `YYYY-MM-DD`, the current period ends (exclusive); null without a period. */
  readonly periodEnd: string | null;
  /** Credits the plan grants for the current period; 0 for an unlimited plan or no plan. */
  readonly allowance: number;
  /** Credits of the current period's allowance that runs have settled. */
  readonly allowanceUsed: number;
  /** Credits held by open reservations, from the allowance and from operator grants. */
  readonly reserved: number;
  /** Credits left in unexpired operator grants. */
  readonly grantsRemaining: number;
  /** Credits a new reservation can still draw on: the allowance left plus `grantsRemaining`. */
  readonly remaining: number;
  /** An unlimited plan (the internal plan): reservations always succeed, `remaining` is not a limit. */
  readonly unlimited: boolean;
}

export type CreditReservationState = "open" | "settled" | "refunded";

/** One run's reservation: ids, numbers and dates only. */
export interface CreditReservation {
  readonly runId: string;
  /** Credits held, from both buckets. */
  readonly credits: number;
  /** The version of the credit estimate rule that priced the reservation. */
  readonly estimateVersion: number;
  readonly state: CreditReservationState;
  /** Credits drawn from the period allowance. */
  readonly fromAllowance: number;
  /** Credits drawn from operator grants. */
  readonly fromGrants: number;
  readonly reservedAt: string;
  /** When the reservation was settled or refunded; null while it is open. */
  readonly closedAt: string | null;
}

/** Run caps checked under the same lock as the reservation; omitted or null means no cap. */
export interface CreditRunCaps {
  /** Most runs in flight (open reservations) at once. */
  readonly maxConcurrent?: number | null | undefined;
  /** Most runs started (reservations created) in the UTC day of `now`. */
  readonly maxPerDay?: number | null | undefined;
}

export interface ReserveCreditsInput {
  readonly runId: string;
  /** Credits to hold: a positive whole number. */
  readonly credits: number;
  /** The version of the credit estimate rule that priced `credits`. */
  readonly estimateVersion: number;
  readonly now: CreditClock;
  readonly caps?: CreditRunCaps | undefined;
}

export type ReserveCreditsResult =
  | {
      readonly refused: null;
      readonly reservation: CreditReservation;
      /** False when the run already had a reservation, which is returned unchanged. */
      readonly created: boolean;
    }
  | { readonly refused: "insufficient"; readonly balance: CreditBalance }
  | {
      readonly refused: "run_cap";
      readonly cap: "concurrent" | "per_day";
      /** The cap that was reached and the runs counted against it. */
      readonly limit: number;
      readonly count: number;
      readonly balance: CreditBalance;
    };

/** The outcome of a settle or refund: the reservation after the call, undefined for an unknown run. */
export interface CloseCreditReservationResult {
  /** False when the reservation was already closed or the run has none: nothing was written. */
  readonly changed: boolean;
  readonly reservation: CreditReservation | undefined;
}

export interface GrantCreditsInput {
  /** Credits to add: a positive whole number. */
  readonly credits: number;
  /**
   * A short content-free code, 1 to 64 characters of `a-z`, `0-9`, `.`, `_` and `-` starting
   * with a letter or digit, such as `goodwill` or `support.2026-10`. Never free text.
   */
  readonly reason: string;
  readonly now: CreditClock;
}

/** An operator grant as recorded. */
export interface CreditGrant {
  readonly sequence: number;
  readonly credits: number;
  readonly reason: string;
  /** When the grant stops being spendable: 12 calendar months after `now`. */
  readonly expiresAt: string;
}

/** One tenant's credit ledger: reservations and grants, serialised per organisation. */
export interface CreditLedger {
  /** The balance at `now`, rolling the credit period first when it changed. */
  readonly balance: (now: CreditClock) => Promise<CreditBalance>;
  /** Holds credits for a run once; the same run id again returns its reservation. */
  readonly reserve: (input: ReserveCreditsInput) => Promise<ReserveCreditsResult>;
  /** Spends an open reservation. A second call, or one after a refund, writes nothing. */
  readonly settle: (input: {
    readonly runId: string;
    readonly now: CreditClock;
  }) => Promise<CloseCreditReservationResult>;
  /** Returns an open reservation's credits. A second call, or one after a settle, writes nothing. */
  readonly refund: (input: {
    readonly runId: string;
    readonly now: CreditClock;
  }) => Promise<CloseCreditReservationResult>;
  /** Adds an operator grant that expires 12 months after `now`. */
  readonly grant: (input: GrantCreditsInput) => Promise<CreditGrant>;
  /** The run's reservation, or undefined; reads without locking or rolling. */
  readonly reservationFor: (runId: string) => Promise<CreditReservation | undefined>;
  /**
   * Open reservations made before `reservedBefore`, oldest first, at most `limit` (1 to 500):
   * the ones a reconciliation sweep checks against the runs they are for.
   */
  readonly openReservationsBefore: (input: {
    readonly reservedBefore: CreditClock;
    readonly limit: number;
  }) => Promise<readonly CreditReservation[]>;
  /** Runs in flight: reservations neither settled nor refunded. */
  readonly openReservationCount: () => Promise<number>;
  /** Reservations created at or after `since` (an ISO timestamp, a UTC day start), in any state. */
  readonly reservationsSince: (since: CreditClock) => Promise<number>;
}

export type CreditLedgerErrorCode =
  | "invalid_credit_request"
  | "organisation_not_found"
  | "stored_credit_invalid";

/** A refused request or unreadable stored ledger row. Messages never carry the rejected values. */
export class CreditLedgerError extends Error {
  readonly code: CreditLedgerErrorCode;

  constructor(code: CreditLedgerErrorCode, message: string) {
    super(message);
    this.name = "CreditLedgerError";
    this.code = code;
  }
}

/** The ledger holds amounts up to this many credits per row (the table's check). */
const maximumCredits = 1_000_000_000_000;
/** How long an operator grant lasts, in calendar months. */
const operatorGrantMonths = 12;

const reasonPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function invalid(message: string): CreditLedgerError {
  return new CreditLedgerError("invalid_credit_request", message);
}

function requireCredits(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumCredits) {
    throw invalid("Credits must be a positive whole number.");
  }
  return value;
}

function requireRunId(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw invalid("The run id must be 1 to 256 characters.");
  }
  return value;
}

function requireClock(value: CreditClock): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid("The time must be an ISO 8601 timestamp.");
  return date;
}

function requireCap(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalid("A run cap must be a non-negative whole number.");
  }
  return value;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function sessionOver(executor: SqlExecutor): SqlSession {
  return { query: executor.query, transaction: (work) => work(executor) };
}

function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23503";
}

/** One grant row with what has happened to its credits. */
interface GrantState {
  readonly sequence: number;
  readonly bucket: "allowance" | "grant";
  readonly expiresAt: Date;
  readonly periodStart: string | null;
  readonly amount: number;
  /** Credits a reservation can still draw on. */
  available: number;
  /** Credits reserved and neither settled nor refunded. */
  readonly held: number;
  /** Credits settled. */
  readonly spent: number;
}

function grantState(row: SqlRow): GrantState {
  const bucket = row.bucket === "allowance" || row.bucket === "grant" ? row.bucket : undefined;
  const amount = Number(row.amount);
  const reserved = Number(row.reserved);
  const refunded = Number(row.refunded);
  const expired = Number(row.expired);
  const settled = Number(row.settled);
  if (bucket === undefined || [amount, reserved, refunded, expired, settled].some(Number.isNaN)) {
    throw new CreditLedgerError("stored_credit_invalid", "A stored credit grant is not valid.");
  }
  return {
    sequence: Number(row.sequence),
    bucket,
    expiresAt: toDate(row.expires_at),
    periodStart: row.period === null || row.period === undefined ? null : String(row.period),
    amount,
    available: amount - reserved + refunded - expired,
    held: reserved - settled - refunded,
    spent: settled,
  };
}

async function loadGrantStates(executor: SqlExecutor): Promise<GrantState[]> {
  const rows = await executor.query(
    `SELECT g.sequence, g.bucket, g.amount, g.expires_at,
            to_char(g.period_start, 'YYYY-MM-DD') AS period,
            COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'reserve'), 0) AS reserved,
            COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'settle'), 0) AS settled,
            COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'refund'), 0) AS refunded,
            COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'expire'), 0) AS expired
       FROM credit_ledger g
       LEFT JOIN credit_ledger l ON l.tenant_id = g.tenant_id AND l.grant_sequence = g.sequence
      WHERE g.kind = 'grant'
      GROUP BY g.tenant_id, g.sequence
      ORDER BY g.sequence`,
  );
  return rows.map(grantState);
}

interface NewRow {
  readonly kind: "grant" | "reserve" | "settle" | "refund" | "expire";
  readonly amount: number;
  readonly bucket: "allowance" | "grant";
  readonly at: Date;
  readonly runId?: string | undefined;
  readonly grantSequence?: number | null | undefined;
  readonly estimateVersion?: number | undefined;
  readonly expiresAt?: Date | undefined;
  readonly periodStart?: string | null | undefined;
  readonly reason?: string | undefined;
}

async function appendRow(executor: SqlExecutor, row: NewRow): Promise<number> {
  const [stored] = await executor.query(
    `INSERT INTO credit_ledger
       (kind, amount, bucket, run_id, grant_sequence, estimate_version, expires_at,
        period_start, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10)
     RETURNING sequence`,
    [
      row.kind,
      row.amount,
      row.bucket,
      row.runId ?? null,
      row.grantSequence ?? null,
      row.estimateVersion ?? null,
      row.expiresAt?.toISOString() ?? null,
      row.periodStart ?? null,
      row.reason ?? null,
      row.at.toISOString(),
    ],
  );
  return Number(stored?.sequence);
}

/** What the lock holder knows about the organisation's plan and period at `now`. */
interface RolledLedger {
  readonly now: Date;
  readonly entitlements: Entitlements | undefined;
  readonly period: CreditPeriod | undefined;
  readonly states: GrantState[];
}

/**
 * Forfeits what remains of every grant that has expired, and of every allowance that is not the
 * plan's current period's (a reassigned plan starts a new period early, or not yet). A refund
 * into such a grant is forfeited the same way, so expired credits never come back.
 */
async function expireStale(
  executor: SqlExecutor,
  now: Date,
  period: CreditPeriod | undefined,
  states: GrantState[],
): Promise<void> {
  for (const state of states) {
    const pastExpiry = state.expiresAt.getTime() <= now.getTime();
    const otherPeriod = state.bucket === "allowance" && state.periodStart !== period?.start;
    if (state.available > 0 && (pastExpiry || otherPeriod)) {
      await appendRow(executor, {
        kind: "expire",
        amount: state.available,
        bucket: state.bucket,
        grantSequence: state.sequence,
        periodStart: state.periodStart,
        at: now,
      });
      state.available = 0;
    }
  }
}

/**
 * Brings the ledger to `now`: forfeits what has expired and, when the plan's current period has
 * no allowance grant yet, grants it. Idempotent for one organisation and period start (a unique
 * index backs it), so any number of calls and any number of skipped periods write each row once.
 * Periods nobody touched are never granted. Run it only while holding the balance lock.
 */
async function rollLedger(executor: SqlExecutor, now: Date): Promise<RolledLedger> {
  const assignment: PlanAssignment | undefined = await createOrganisationPlans(
    sessionOver(executor),
  ).currentPlanAssignment();
  const entitlements =
    assignment === undefined
      ? undefined
      : resolveEntitlements(assignment.planId, assignment.overrides, {
          seats: assignment.seats ?? undefined,
        });
  const period =
    assignment === undefined || entitlements === undefined
      ? undefined
      : creditPeriodAt(assignment.periodStart, entitlements.creditPeriodMonths, now);

  const states = await loadGrantStates(executor);
  await expireStale(executor, now, period, states);

  const allowance = entitlements?.creditsPerPeriod ?? 0;
  if (
    period !== undefined &&
    allowance > 0 &&
    !states.some((state) => state.bucket === "allowance" && state.periodStart === period.start)
  ) {
    const credits = Math.min(allowance, maximumCredits);
    const expiresAt = new Date(`${period.end}T00:00:00.000Z`);
    const sequence = await appendRow(executor, {
      kind: "grant",
      amount: credits,
      bucket: "allowance",
      periodStart: period.start,
      expiresAt,
      at: now,
    });
    states.push({
      sequence,
      bucket: "allowance",
      expiresAt,
      periodStart: period.start,
      amount: credits,
      available: credits,
      held: 0,
      spent: 0,
    });
  }
  return { now, entitlements, period, states };
}

/** Grants that count toward the balance now: unexpired, and for an allowance the plan's current period's. */
function inForce(rolled: RolledLedger, state: GrantState): boolean {
  if (state.expiresAt.getTime() <= rolled.now.getTime()) return false;
  return state.bucket === "grant" || state.periodStart === rolled.period?.start;
}

async function computeBalance(executor: SqlExecutor, rolled: RolledLedger): Promise<CreditBalance> {
  const unlimited = rolled.entitlements?.creditsPerPeriod === null;
  let allowance = 0;
  let allowanceUsed = 0;
  let allowanceRemaining = 0;
  let reserved = 0;
  let grantsRemaining = 0;
  for (const state of rolled.states.filter((candidate) => inForce(rolled, candidate))) {
    reserved += state.held;
    if (state.bucket === "allowance") {
      allowance += state.amount;
      allowanceUsed += state.spent;
      allowanceRemaining += state.available;
    } else {
      grantsRemaining += state.available;
    }
  }
  if (unlimited) {
    // The internal plan has no allowance grant; its reservations carry no grant and are
    // counted for the current period.
    const [row] = await executor.query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'reserve'), 0) AS reserved,
              COALESCE(sum(amount) FILTER (WHERE kind = 'settle'), 0) AS settled,
              COALESCE(sum(amount) FILTER (WHERE kind = 'refund'), 0) AS refunded
         FROM credit_ledger
        WHERE grant_sequence IS NULL AND kind IN ('reserve', 'settle', 'refund')
          AND period_start IS NOT DISTINCT FROM $1::date`,
      [rolled.period?.start ?? null],
    );
    const settled = Number(row?.settled ?? 0);
    allowanceUsed += settled;
    reserved += Number(row?.reserved ?? 0) - settled - Number(row?.refunded ?? 0);
  }
  return {
    periodStart: rolled.period?.start ?? null,
    periodEnd: rolled.period?.end ?? null,
    allowance,
    allowanceUsed,
    reserved,
    grantsRemaining,
    remaining: allowanceRemaining + grantsRemaining,
    unlimited,
  };
}

/** The run's ledger rows folded into a reservation, or undefined without a reserve row. */
async function loadReservation(
  executor: SqlExecutor,
  runId: string,
): Promise<{
  readonly reservation: CreditReservation;
  readonly rows: readonly {
    readonly amount: number;
    readonly bucket: "allowance" | "grant";
    readonly grantSequence: number | null;
    readonly periodStart: string | null;
  }[];
} | null> {
  const rows = await executor.query(
    `SELECT kind, bucket, amount, grant_sequence, estimate_version,
            to_char(period_start, 'YYYY-MM-DD') AS period, created_at
       FROM credit_ledger
      WHERE run_id = $1 AND kind IN ('reserve', 'settle', 'refund')
      ORDER BY sequence`,
    [runId],
  );
  const reserves = rows.filter((row) => row.kind === "reserve");
  const first = reserves[0];
  if (first === undefined) return null;
  const closing = rows.find((row) => row.kind === "settle" || row.kind === "refund");
  const sum = (selected: readonly SqlRow[]): number =>
    selected.reduce((total, row) => total + Number(row.amount), 0);
  return {
    reservation: {
      runId,
      credits: sum(reserves),
      estimateVersion: Number(first.estimate_version),
      state: closing === undefined ? "open" : closing.kind === "settle" ? "settled" : "refunded",
      fromAllowance: sum(reserves.filter((row) => row.bucket === "allowance")),
      fromGrants: sum(reserves.filter((row) => row.bucket === "grant")),
      reservedAt: toDate(first.created_at).toISOString(),
      closedAt: closing === undefined ? null : toDate(closing.created_at).toISOString(),
    },
    rows: reserves.map((row) => ({
      amount: Number(row.amount),
      bucket: row.bucket === "grant" ? "grant" : "allowance",
      grantSequence:
        row.grant_sequence === null || row.grant_sequence === undefined
          ? null
          : Number(row.grant_sequence),
      periodStart: row.period === null || row.period === undefined ? null : String(row.period),
    })),
  };
}

const openReservations = `
  SELECT count(DISTINCT r.run_id) AS runs FROM credit_ledger r
   WHERE r.kind = 'reserve'
     AND NOT EXISTS (SELECT 1 FROM credit_ledger c
                      WHERE c.tenant_id = r.tenant_id AND c.run_id = r.run_id
                        AND c.kind IN ('settle', 'refund'))`;

async function countOpen(executor: SqlExecutor): Promise<number> {
  const [row] = await executor.query(openReservations);
  return Number(row?.runs ?? 0);
}

async function listOpenBefore(
  executor: SqlExecutor,
  reservedBefore: Date,
  limit: number,
): Promise<readonly CreditReservation[]> {
  const runs = await executor.query(
    `SELECT r.run_id FROM credit_ledger r
      WHERE r.kind = 'reserve'
        AND NOT EXISTS (SELECT 1 FROM credit_ledger c
                         WHERE c.tenant_id = r.tenant_id AND c.run_id = r.run_id
                           AND c.kind IN ('settle', 'refund'))
      GROUP BY r.run_id
     HAVING min(r.created_at) < $1
      ORDER BY min(r.created_at), r.run_id
      LIMIT $2`,
    [reservedBefore.toISOString(), limit],
  );
  const reservations: CreditReservation[] = [];
  for (const row of runs) {
    const found = await loadReservation(executor, String(row.run_id));
    if (found !== null) reservations.push(found.reservation);
  }
  return reservations;
}

async function countSince(executor: SqlExecutor, since: Date): Promise<number> {
  const [row] = await executor.query(
    `SELECT count(DISTINCT run_id) AS runs FROM credit_ledger
      WHERE kind = 'reserve' AND created_at >= $1`,
    [since.toISOString()],
  );
  return Number(row?.runs ?? 0);
}

/** Draws `credits` from the buckets in spending order: allowance, then earliest expiry first. */
function spendingPlan(
  rolled: RolledLedger,
  credits: number,
): { readonly state: GrantState; readonly take: number }[] | undefined {
  const spendable = rolled.states
    .filter((state) => state.available > 0 && inForce(rolled, state))
    .sort(
      (a, b) =>
        (a.bucket === b.bucket ? 0 : a.bucket === "allowance" ? -1 : 1) ||
        a.expiresAt.getTime() - b.expiresAt.getTime() ||
        a.sequence - b.sequence,
    );
  const plan: { state: GrantState; take: number }[] = [];
  let needed = credits;
  for (const state of spendable) {
    if (needed === 0) break;
    const take = Math.min(state.available, needed);
    plan.push({ state, take });
    needed -= take;
  }
  return needed === 0 ? plan : undefined;
}

/**
 * The tenant's credit ledger on Postgres. Every mutating operation, and the balance read, takes
 * one transaction that locks the organisation's `credit_balances` row first, so concurrent
 * operations of one organisation run one after another and cannot overspend; different
 * organisations never wait on each other. The ledger is the source of truth and the balance is
 * summed from it, so nothing cached can drift. Reading every grant row of the organisation
 * costs time linear in its history; a summary row would be the next step if that grows.
 */
export function createCreditLedger(client: SqlSession): CreditLedger {
  /** Runs `work` holding the organisation's lock, after the ledger has rolled to `now`. */
  const locked = async <Result>(
    clock: CreditClock,
    work: (executor: SqlExecutor, rolled: RolledLedger) => Promise<Result>,
  ): Promise<Result> => {
    const now = requireClock(clock);
    try {
      return await client.transaction(async (executor) => {
        await executor.query("INSERT INTO credit_balances DEFAULT VALUES ON CONFLICT DO NOTHING");
        await executor.query("SELECT tenant_id FROM credit_balances FOR UPDATE");
        return work(executor, await rollLedger(executor, now));
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new CreditLedgerError("organisation_not_found", "No such organisation.");
      }
      throw error;
    }
  };

  const close = async (
    kind: "settle" | "refund",
    runId: string,
    clock: CreditClock,
  ): Promise<CloseCreditReservationResult> => {
    requireRunId(runId);
    return locked(clock, async (executor, rolled) => {
      const found = await loadReservation(executor, runId);
      if (found === null) return { changed: false, reservation: undefined };
      if (found.reservation.state !== "open") {
        return { changed: false, reservation: found.reservation };
      }
      for (const row of found.rows) {
        await appendRow(executor, {
          kind,
          amount: row.amount,
          bucket: row.bucket,
          runId,
          grantSequence: row.grantSequence,
          periodStart: row.periodStart,
          at: rolled.now,
        });
      }
      if (kind === "refund") {
        await expireStale(executor, rolled.now, rolled.period, await loadGrantStates(executor));
      }
      return { changed: true, reservation: (await loadReservation(executor, runId))?.reservation };
    });
  };

  return {
    balance: (now) => locked(now, (executor, rolled) => computeBalance(executor, rolled)),

    reserve: async (input) => {
      const runId = requireRunId(input.runId);
      const credits = requireCredits(input.credits);
      const estimateVersion = input.estimateVersion;
      if (
        !Number.isSafeInteger(estimateVersion) ||
        estimateVersion < 1 ||
        estimateVersion > 2 ** 31 - 1
      ) {
        throw invalid("The estimate version must be a positive whole number.");
      }
      const maxConcurrent = requireCap(input.caps?.maxConcurrent);
      const maxPerDay = requireCap(input.caps?.maxPerDay);
      return locked(input.now, async (executor, rolled): Promise<ReserveCreditsResult> => {
        const existing = await loadReservation(executor, runId);
        if (existing !== null) {
          return { refused: null, reservation: existing.reservation, created: false };
        }
        if (maxConcurrent !== null) {
          const count = await countOpen(executor);
          if (count >= maxConcurrent) {
            const balance = await computeBalance(executor, rolled);
            return { refused: "run_cap", cap: "concurrent", limit: maxConcurrent, count, balance };
          }
        }
        if (maxPerDay !== null) {
          const count = await countSince(executor, new Date(startOfUtcDay(rolled.now)));
          if (count >= maxPerDay) {
            const balance = await computeBalance(executor, rolled);
            return { refused: "run_cap", cap: "per_day", limit: maxPerDay, count, balance };
          }
        }
        if (rolled.entitlements?.creditsPerPeriod === null) {
          // Unlimited: always reserved and recorded, without a grant to draw on.
          await appendRow(executor, {
            kind: "reserve",
            amount: credits,
            bucket: "allowance",
            runId,
            estimateVersion,
            periodStart: rolled.period?.start ?? null,
            at: rolled.now,
          });
        } else {
          const plan = spendingPlan(rolled, credits);
          if (plan === undefined) {
            return { refused: "insufficient", balance: await computeBalance(executor, rolled) };
          }
          for (const { state, take } of plan) {
            await appendRow(executor, {
              kind: "reserve",
              amount: take,
              bucket: state.bucket,
              runId,
              grantSequence: state.sequence,
              estimateVersion,
              periodStart: state.periodStart,
              at: rolled.now,
            });
          }
        }
        const stored = await loadReservation(executor, runId);
        if (stored === null) throw new Error("The credit reservation was not stored.");
        return { refused: null, reservation: stored.reservation, created: true };
      });
    },

    settle: ({ runId, now }) => close("settle", runId, now),

    refund: ({ runId, now }) => close("refund", runId, now),

    grant: async (input) => {
      const credits = requireCredits(input.credits);
      if (typeof input.reason !== "string" || !reasonPattern.test(input.reason)) {
        throw invalid("The reason must be a short code of a-z, 0-9, dot, underscore and hyphen.");
      }
      return locked(input.now, async (executor, rolled) => {
        const expiresAt = addUtcMonths(rolled.now, operatorGrantMonths);
        const sequence = await appendRow(executor, {
          kind: "grant",
          amount: credits,
          bucket: "grant",
          reason: input.reason,
          expiresAt,
          at: rolled.now,
        });
        return { sequence, credits, reason: input.reason, expiresAt: expiresAt.toISOString() };
      });
    },

    reservationFor: async (runId) => {
      requireRunId(runId);
      return client.transaction(
        async (executor) => (await loadReservation(executor, runId))?.reservation,
        { readOnlySnapshot: true },
      );
    },

    openReservationsBefore: async ({ reservedBefore, limit }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw invalid("The limit must be a whole number from 1 to 500.");
      }
      return client.transaction(
        (executor) => listOpenBefore(executor, requireClock(reservedBefore), limit),
        { readOnlySnapshot: true },
      );
    },

    openReservationCount: () => client.transaction((executor) => countOpen(executor)),

    reservationsSince: (since) =>
      client.transaction((executor) => countSince(executor, requireClock(since))),
  };
}
