import { runUsage } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { RunJob } from "@draft-loop/run-queue";

import type { QuarantinedRunInput, RunJobOutcome } from "./run-job-handler.js";

/**
 * The worker's logs, as Cloud Logging reads them: one JSON object a line with a `severity` and a
 * `message`. They stay content-free (ADR 0011, D16): ids, states, routes, models, token counts
 * and costs, never candidate text, prompts, findings, file names or error messages, which may
 * quote any of those.
 */
export type Severity = "INFO" | "WARNING" | "ERROR";

export function logLine(
  severity: Severity,
  message: string,
  fields: Record<string, unknown> = {},
): string {
  return JSON.stringify({ severity, message, ...fields });
}

/** An error's type, code and stack frames; its message is left out. */
export function errorFields(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return { type: typeof error };
  const { name, code, stack } = error as { name?: unknown; code?: unknown; stack?: unknown };
  return {
    type: typeof name === "string" ? name : "Error",
    ...(typeof code === "string" ? { code } : {}),
    frames:
      typeof stack === "string"
        ? stack
            .split("\n")
            .filter((line) => line.startsWith("    at "))
            .map((line) => line.trim())
        : [],
  };
}

/**
 * One line per job, for the log-based metrics: what the job did, the run's state, and the run's
 * usage so far by company, model and route.
 */
export function runOutcomeFields(
  job: RunJob,
  outcome: RunJobOutcome,
  run?: Pick<RunSnapshot, "state" | "executionHistory" | "applicationPlan">,
): Record<string, unknown> {
  const fields = {
    tenantId: job.tenantId,
    workspaceId: job.workspaceId,
    runId: job.runId,
    outcome,
  };
  if (run === undefined) return fields;
  const usage = runUsage(run);
  return {
    ...fields,
    state: run.state,
    usage: {
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedUsd: usage.estimatedUsd,
      unpricedCalls: usage.unpricedCalls,
      lines: usage.lines.map((line) => ({
        company: line.company,
        model: line.model,
        route: line.route,
        calls: line.calls,
        inputTokens: line.inputTokens,
        outputTokens: line.outputTokens,
        estimatedUsd: line.estimatedUsd,
      })),
    },
  };
}

/**
 * The line for a run paused over quarantined material: the job's ids and, for each piece, its kind,
 * the result id a release names and the closed signal codes. Never the text or a source name.
 */
export function quarantineFields(
  job: RunJob,
  quarantined: readonly QuarantinedRunInput[],
): Record<string, unknown> {
  return {
    tenantId: job.tenantId,
    workspaceId: job.workspaceId,
    runId: job.runId,
    quarantined: quarantined.map(({ kind, resultId, signals }) => ({ kind, resultId, signals })),
    // The same shape as the API's quarantine lines, for the alert: every result id and signal code.
    screening: {
      tenantId: job.tenantId,
      resultIds: quarantined.map(({ resultId }) => resultId),
      signals: [...new Set(quarantined.flatMap(({ signals }) => signals))].sort(),
    },
  };
}
