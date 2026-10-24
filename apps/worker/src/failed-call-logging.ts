import type { ExecutionRecord, RunSnapshot } from "@draft-loop/orchestrator";
import type { RunJob } from "@draft-loop/run-queue";

import { logLine, type Severity } from "./logging.js";

/**
 * The provider calls that failed during one job: the run's failed executions that its first read
 * did not hold yet. A job delivered twice therefore logs a failure once.
 */
function failedDuringJob(run: RunSnapshot, before?: RunSnapshot): readonly ExecutionRecord[] {
  const known = new Set(before?.executionHistory.map(({ id }) => id) ?? []);
  return run.executionHistory.filter(
    (execution) => execution.status === "failed" && !known.has(execution.id),
  );
}

/**
 * One content-free line per failed provider call (#1568): which call failed, by role, company,
 * model and route, with the HTTP status, the normalized code, the provider's own `type` and `code`
 * tokens, and for a rate limit the limit that ran out and the Retry-After seconds. Never the
 * provider's message or a body, which can quote the prompt.
 */
export function failedCallFields(job: RunJob, execution: ExecutionRecord): Record<string, unknown> {
  const call = execution.failedCall;
  return {
    runId: job.runId,
    step: execution.step,
    role: call?.role ?? (execution.step === "critic" ? "critic" : "author"),
    attempt: execution.attempt ?? null,
    company: call?.company ?? execution.provider,
    model: call?.model ?? execution.modelId,
    ...(call?.route === undefined ? {} : { route: call.route }),
    ...(call?.status === undefined ? {} : { status: call.status }),
    code: execution.errorCode ?? "provider-error",
    ...(call?.providerErrorType === undefined ? {} : { providerErrorType: call.providerErrorType }),
    ...(call?.providerErrorCode === undefined ? {} : { providerErrorCode: call.providerErrorCode }),
    ...(call?.rateLimit === undefined ? {} : { rateLimit: call.rateLimit }),
    ...(call?.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: call.retryAfterSeconds }),
  };
}

/** The job's failed-call lines; a call the run will retry is a warning, any other an error. */
export function failedCallLines(job: RunJob, run?: RunSnapshot, before?: RunSnapshot): string[] {
  if (run === undefined) return [];
  return failedDuringJob(run, before).map((execution) => {
    const severity: Severity = execution.retryable === true ? "WARNING" : "ERROR";
    return logLine(severity, "provider call failed", failedCallFields(job, execution));
  });
}
