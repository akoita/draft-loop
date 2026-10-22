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
  /** A usage limit stopped the run; it is queued again for the reset time. */
  | "rescheduled"
  /** The run's saved budget is above the deployment's ceiling, so it is not executed. */
  | "over-ceiling"
  /** The run advanced as far as it could without the person. */
  | "advanced";

export interface RunJobHandlerOptions {
  readonly service: Pick<ApplicationService, "status" | "resume">;
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
  /** How long to wait when a usage limit names no reset time. Defaults to 15 minutes. */
  readonly usageLimitRetryMs?: number;
  readonly now?: () => Date;
  readonly onOutcome?: (job: RunJob, outcome: RunJobOutcome) => void;
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

function pausedForUsageLimit(snapshot: RunSnapshot): boolean {
  return snapshot.state === "paused" && snapshot.lastError?.code === "usage-limit";
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

  /** When the limit resets, or a fixed wait when it names no time or a time already past. */
  const resumeTime = (snapshot: RunSnapshot): Date => {
    const resetsAt = Date.parse(snapshot.lastError?.usageLimitResetsAt ?? "");
    const current = now().getTime();
    return new Date(Number.isNaN(resetsAt) || resetsAt <= current ? current + retryMs : resetsAt);
  };

  const run = async (
    job: RunJob,
    requeue: (startAfter: Date) => Promise<void>,
  ): Promise<RunJobOutcome> => {
    const root = options.workspaceRoot(job);
    const snapshot = await options.service.status({ root, runId: job.runId });
    if (snapshot === undefined) return "missing";
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
    const advanced = await options.service.resume({
      root,
      runId: job.runId,
      allowProviderData: options.allowProviderData,
    });
    if (pausedForUsageLimit(advanced)) {
      await requeue(resumeTime(advanced));
      return "rescheduled";
    }
    return "advanced";
  };

  return async (job, control) => {
    const outcome = await run(job, control.requeue);
    options.onOutcome?.(job, outcome);
  };
}
