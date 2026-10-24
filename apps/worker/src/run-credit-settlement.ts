import { runUsage } from "@draft-loop/application";
import { createStorageRunStore, type RunSnapshot, type RunState } from "@draft-loop/orchestrator";
import type { RunJob } from "@draft-loop/run-queue";
import type { CreditLedger, PostgresTenancy } from "@draft-loop/storage-postgres";

import type { RunJobOutcome } from "./run-job-handler.js";

/** What happens to a run's credit reservation once a job has left the run as it is. */
export type RunCreditAction =
  /** The run has a draft: spend the reserved credits. */
  | "settle"
  /** The run ended without a draft: return the reserved credits. */
  | "refund"
  /** The run can still continue: the reservation stays open. */
  | "keep";

/**
 * States a run does not leave without the person or an operator. Everything else, such as a pause,
 * a step in flight or a rate limit waiting for its retry, can still continue and keeps its
 * reservation. A `budget-exhausted` snapshot is read the same way, though the orchestrator moves
 * straight on to `awaiting-approval`.
 */
const finalStates: ReadonlySet<RunState> = new Set([
  "awaiting-approval",
  "approved",
  "exported",
  "stopped",
  "budget-exhausted",
  "provider-error",
]);

/**
 * What a run's state asks of its reservation: a draft past drafting settles it, a final state
 * without a draft refunds it, and a run that can still continue keeps it. A `provider-error` is
 * final unless the worker queued the run again after a rate limit, since no hosted route retries
 * it. A run that does not exist is kept: this is the question for a run that was read.
 */
export function creditActionForRun(run: RunSnapshot | undefined): RunCreditAction {
  if (run === undefined || !finalStates.has(run.state)) return "keep";
  if (
    run.state === "provider-error" &&
    run.lastError?.code === "rate-limit" &&
    run.lastError.retryable
  ) {
    return "keep";
  }
  return run.artifact ? "settle" : "refund";
}

/**
 * What a finished job asks of its run's reservation. A job dropped for an erased record or a
 * missing run leaves no run to deliver, so it refunds. A job that left the run alone, or paused or
 * queued it again, keeps the reservation; one that ran or found the run finished reads the run.
 */
export function creditActionForJob(outcome: RunJobOutcome, run?: RunSnapshot): RunCreditAction {
  switch (outcome) {
    case "record-erased":
    case "missing":
      return "refund";
    case "settled":
    case "advanced":
      return creditActionForRun(run);
    default:
      return "keep";
  }
}

/**
 * A reservation the worker closed, content-free: ids, numbers and a closed word. The log line the
 * margin alert reads carries these fields.
 */
export interface RunCreditsClosed {
  readonly organisationId: string;
  readonly runId: string;
  /** Credits the reservation held. */
  readonly credits: number;
  /** The version of the estimate rule that priced the reservation. */
  readonly estimateVersion: number;
  readonly outcome: "settled" | "refunded";
  /** The run's estimated US dollar cost from its usage, as the job log line reports it; null without a run. */
  readonly estimatedUsd: number | null;
}

/** The run credit calls the run job handler makes. */
export interface RunCredits {
  /**
   * Whether the job's run has a refunded reservation, checked as each job is claimed. A refunded
   * run ended without a draft and is not executed again, so a replayed job (a repeated begin
   * request queues the run once more) cannot turn it into a free run.
   */
  readonly refunded: (job: RunJob) => Promise<boolean>;
  /** Settles or refunds the job's run as its outcome asks, then reconciles the tenant's stale reservations. */
  readonly afterJob: (job: RunJob, outcome: RunJobOutcome, run?: RunSnapshot) => Promise<void>;
}

export interface TenantRunCreditsOptions {
  readonly tenancy: Pick<PostgresTenancy, "forTenant">;
  /** Called once for each reservation this worker settles or refunds. */
  readonly onClosed: (closed: RunCreditsClosed) => void;
  /** Called when the reconciliation of a tenant's stale reservations failed; the job is unaffected. */
  readonly onSweepError?: (tenantId: string, error: unknown) => void;
  /**
   * How old an open reservation must be before the reconciliation looks at it, so a run that is
   * just being started is never touched. Defaults to one hour.
   */
  readonly staleAfterMs?: number;
  /** The most stale reservations one reconciliation reads. Defaults to 50. */
  readonly sweepLimit?: number;
  readonly now?: () => Date;
}

const defaultStaleAfterMs = 60 * 60 * 1000;
const defaultSweepLimit = 50;

/**
 * Settles or refunds each run's credit reservation when a job leaves the run in a final state
 * (ADR 0011, D13). The ledger acts once per reservation, so a retried job, a replayed job and the
 * reconciliation below all converge on one settlement. A run with no reservation, as in owner-token
 * mode or a run started before credits existed, is left alone.
 *
 * After each job it also reconciles that tenant's open reservations older than `staleAfterMs`
 * against their runs: a reservation whose run was never saved (the API stopped between the
 * reservation and the save) or was erased is refunded, and one whose run reached a final state
 * without a job to say so, as when the person stops a paused run, is settled or refunded the same
 * way. It is per tenant because the ledger is: a tenant's orphans are found when the tenant next
 * has a job.
 */
export function tenantRunCredits(options: TenantRunCreditsOptions): RunCredits {
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? defaultStaleAfterMs;
  const sweepLimit = options.sweepLimit ?? defaultSweepLimit;

  const close = async (
    ledger: Pick<CreditLedger, "reservationFor" | "settle" | "refund">,
    tenantId: string,
    runId: string,
    action: Exclude<RunCreditAction, "keep">,
    run: RunSnapshot | undefined,
  ): Promise<void> => {
    // Reading first keeps a job without a reservation, or after a settlement, off the ledger lock.
    const held = await ledger.reservationFor(runId);
    if (held?.state !== "open") return;
    const at = now();
    const result =
      action === "settle"
        ? await ledger.settle({ runId, now: at })
        : await ledger.refund({ runId, now: at });
    if (!result.changed) return;
    const reservation = result.reservation ?? held;
    options.onClosed({
      organisationId: tenantId,
      runId,
      credits: reservation.credits,
      estimateVersion: reservation.estimateVersion,
      outcome: action === "settle" ? "settled" : "refunded",
      estimatedUsd: run === undefined ? null : runUsage(run).estimatedUsd,
    });
  };

  const reconcile = async (tenantId: string): Promise<void> => {
    const storage = options.tenancy.forTenant(tenantId);
    const stale = await storage.creditLedger.openReservationsBefore({
      reservedBefore: new Date(now().getTime() - staleAfterMs),
      limit: sweepLimit,
    });
    if (stale.length === 0) return;
    const runs = createStorageRunStore(storage);
    for (const { runId } of stale) {
      const run = await runs.loadRun(runId);
      // No saved run: it was never begun, or was erased with its record.
      const action = run === undefined ? "refund" : creditActionForRun(run);
      if (action !== "keep") await close(storage.creditLedger, tenantId, runId, action, run);
    }
  };

  return {
    refunded: async (job) => {
      const reservation = await options.tenancy
        .forTenant(job.tenantId)
        .creditLedger.reservationFor(job.runId);
      return reservation?.state === "refunded";
    },
    afterJob: async (job, outcome, run) => {
      const action = creditActionForJob(outcome, run);
      if (action !== "keep") {
        const { creditLedger } = options.tenancy.forTenant(job.tenantId);
        await close(creditLedger, job.tenantId, job.runId, action, run);
      }
      try {
        await reconcile(job.tenantId);
      } catch (error) {
        options.onSweepError?.(job.tenantId, error);
      }
    },
  };
}
