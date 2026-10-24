import {
  type ApplicationService,
  type RunBudgetCeiling,
  runBudgetCeilingViolation,
} from "@draft-loop/application";
import type { RunSnapshot, RunState } from "@draft-loop/orchestrator";
import type { RunJob, RunJobHandler } from "@draft-loop/run-queue";

/** What one job did with its run; ids and this word are all the worker logs. */
export type RunJobOutcome =
  /** No such run in the workspace, as after a deletion. */
  | "missing"
  /** The person paused the run; their resume queues it again. */
  | "held"
  /** Nothing to execute: the run awaits the person, or is finished. */
  | "settled"
  /** A usage or rate limit stopped the run; it is queued again for when the limit allows. */
  | "rescheduled"
  /** The run's saved budget is above the deployment's ceiling, so it is not executed. */
  | "over-ceiling"
  /**
   * The record's current provider transmission consent does not cover the run's providers, as
   * after a withdrawal: the run is paused without a provider call, and a resume after a new grant
   * queues it again.
   */
  | "consent-required"
  /** The run advanced as far as it could without the person. */
  | "advanced";

/** The application calls a job needs; `lifecycle` pauses a run held for consent. */
export type RunJobService = Pick<ApplicationService, "status" | "resume"> &
  Partial<Pick<ApplicationService, "lifecycle">>;

export interface RunJobHandlerOptions {
  /** The application over the job's tenant: each job names its own (ADR 0011, D3). */
  readonly serviceFor: (job: RunJob) => RunJobService;
  /** The driver's reference for the job's workspace, as the API resolves it. */
  readonly workspaceRoot: (job: RunJob) => string;
  /**
   * Whether the run may send its approved material to the providers. The composition root decides
   * it from the deployment's consent policy; the worker never assumes it.
   */
  readonly allowProviderData: boolean;
  /**
   * The deployment's limit per run. A run saved before the ceiling was lowered keeps its budget,
   * so the worker checks it again before executing.
   */
  readonly budgetCeiling: RunBudgetCeiling;
  /**
   * In sign-in deployments, whether the job's candidate record's current provider transmission
   * consent covers its workspace's providers, checked again as each job is claimed so that a
   * withdrawal stops queued work. Unset in owner-token deployments, where `allowProviderData`
   * alone decides; it stays a ceiling above consent either way.
   */
  readonly consentFor?: (job: RunJob) => Promise<boolean>;
  /** How long to wait when a usage limit names no reset time. Defaults to 15 minutes. */
  readonly usageLimitRetryMs?: number;
  /** The least wait after a rate limit, which can outlast the provider's hint. Defaults to 1 minute. */
  readonly rateLimitRetryMs?: number;
  readonly now?: () => Date;
  /** Called after each job with what it did and the run as it last and first read it, if it exists. */
  readonly onOutcome?: (
    job: RunJob,
    outcome: RunJobOutcome,
    run?: RunSnapshot,
    before?: RunSnapshot,
  ) => void;
}

/** States a resume can move forward without the person. */
const executableStates: ReadonlySet<RunState> = new Set([
  "collecting",
  "ingesting",
  "drafting",
  "reviewing",
  "revising",
  "provider-error",
]);

const defaultUsageLimitRetryMs = 15 * 60 * 1000;
const defaultRateLimitRetryMs = 60 * 1000;

function pausedForUsageLimit(snapshot: RunSnapshot): boolean {
  return snapshot.state === "paused" && snapshot.lastError?.code === "usage-limit";
}

/** The orchestrator marks a rate limit retryable only while the step has attempts left. */
function stoppedByRateLimit(snapshot: RunSnapshot): boolean {
  return (
    snapshot.state === "provider-error" &&
    snapshot.lastError?.code === "rate-limit" &&
    snapshot.lastError.retryable
  );
}

/**
 * Drives one queued run through `ApplicationService`, as the desktop's background resume does. A
 * job can arrive twice or after the run moved on, so it reads the run first and does only what its
 * state allows. The run resumes from its last saved step, so a retry after a crash repeats at most
 * the step that was interrupted.
 */
export function createRunJobHandler(options: RunJobHandlerOptions): RunJobHandler {
  const now = options.now ?? (() => new Date());
  const retryMs = options.usageLimitRetryMs ?? defaultUsageLimitRetryMs;
  const rateLimitRetryMs = options.rateLimitRetryMs ?? defaultRateLimitRetryMs;

  /** When the limit resets, or a fixed wait when it names no time or a time already past. */
  const resumeTime = (snapshot: RunSnapshot): Date => {
    const resetsAt = Date.parse(snapshot.lastError?.usageLimitResetsAt ?? "");
    const current = now().getTime();
    return new Date(Number.isNaN(resetsAt) || resetsAt <= current ? current + retryMs : resetsAt);
  };

  /**
   * The later of the provider's retry time and a fixed wait: a per-minute token limit can refuse a
   * retry the provider's short hint allows, and resume does nothing before the retry time.
   */
  const rateLimitResumeTime = (snapshot: RunSnapshot): Date => {
    const notBefore = Date.parse(snapshot.lastError?.retryNotBefore ?? "");
    const fixed = now().getTime() + rateLimitRetryMs;
    return new Date(Number.isNaN(notBefore) ? fixed : Math.max(notBefore, fixed));
  };

  const run = async (
    job: RunJob,
    requeue: (startAfter: Date) => Promise<void>,
    seen: (snapshot: RunSnapshot) => void,
  ): Promise<RunJobOutcome> => {
    const service = options.serviceFor(job);
    const root = options.workspaceRoot(job);
    const snapshot = await service.status({ root, runId: job.runId });
    if (snapshot === undefined) return "missing";
    seen(snapshot);
    if (snapshot.state === "paused") {
      if (!pausedForUsageLimit(snapshot)) return "held";
      // A queued resumption arrives at the reset time; an earlier job waits for it.
      const resetsAt = Date.parse(snapshot.lastError?.usageLimitResetsAt ?? "");
      if (resetsAt > now().getTime()) {
        await requeue(new Date(resetsAt));
        return "rescheduled";
      }
    } else if (!executableStates.has(snapshot.state)) {
      return "settled";
    }
    if (runBudgetCeilingViolation(snapshot.budget, options.budgetCeiling) !== undefined) {
      return "over-ceiling";
    }
    if (options.consentFor !== undefined && !(await options.consentFor(job))) {
      // An already paused run, or one awaiting a retry the person decides, stays as it is.
      if (snapshot.state !== "paused" && snapshot.state !== "provider-error") {
        if (service.lifecycle === undefined) {
          throw new Error("Holding a run for consent needs the lifecycle call.");
        }
        seen(await service.lifecycle({ root, runId: job.runId, action: "pause" }));
      }
      return "consent-required";
    }
    const advanced = await service.resume({
      root,
      runId: job.runId,
      allowProviderData: options.allowProviderData,
    });
    seen(advanced);
    if (pausedForUsageLimit(advanced)) {
      await requeue(resumeTime(advanced));
      return "rescheduled";
    }
    if (stoppedByRateLimit(advanced)) {
      await requeue(rateLimitResumeTime(advanced));
      return "rescheduled";
    }
    return "advanced";
  };

  return async (job, control) => {
    let first: RunSnapshot | undefined;
    let last: RunSnapshot | undefined;
    const outcome = await run(job, control.requeue, (snapshot) => {
      first ??= snapshot;
      last = snapshot;
    });
    options.onOutcome?.(job, outcome, last, first);
  };
}
