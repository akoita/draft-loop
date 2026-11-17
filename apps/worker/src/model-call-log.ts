import { AsyncLocalStorage } from "node:async_hooks";

import type { MeteredModelCall, ModelCallMeter } from "@draft-loop/application/model-call-meter";

import type { ProfileDerivationUsage } from "@draft-loop/run-queue";

import { logLine } from "./logging.js";

interface JobContext {
  readonly ids: Readonly<Record<string, unknown>>;
  /** Every metered call the job made so far, answered or failed. */
  readonly calls: MeteredModelCall[];
}

/** The ids of the job whose work is running, so each call's line names its job. */
const currentJob = new AsyncLocalStorage<JobContext>();

/** Runs a job's work with its ids attached to every model call it makes. */
export function withJobIds<Result>(
  ids: Readonly<Record<string, unknown>>,
  work: () => Promise<Result>,
): Promise<Result> {
  return currentJob.run({ ids, calls: [] }, work);
}

/** The fields of one call's line: the job's ids, then the call's content-free usage. */
export function modelCallFields(call: MeteredModelCall): Record<string, unknown> {
  return { ...currentJob.getStore()?.ids, ...call };
}

/** Sums metered calls; the cost is unknown when any call's model has no price. */
export function totalUsage(calls: readonly MeteredModelCall[]): ProfileDerivationUsage {
  let estimatedUsd: number | null = 0;
  for (const call of calls) {
    estimatedUsd =
      estimatedUsd === null || call.estimatedUsd === null ? null : estimatedUsd + call.estimatedUsd;
  }
  return {
    calls: calls.length,
    failedCalls: calls.filter((call) => call.failed).length,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    estimatedUsd: estimatedUsd === null ? null : Math.round(estimatedUsd * 1_000_000) / 1_000_000,
  };
}

/**
 * What the running job's model calls used so far (#2815); undefined outside a job or before its
 * first call, so a job that called no model records no usage.
 */
export function currentJobUsage(): ProfileDerivationUsage | undefined {
  const calls = currentJob.getStore()?.calls;
  return calls === undefined || calls.length === 0 ? undefined : totalUsage(calls);
}

/**
 * One content-free line per extraction call (#2806): the job's ids, the purpose, model, route,
 * tokens and estimated cost. A failed call is a warning and keeps what the provider billed. The
 * call also joins its job's total, which a profile derivation keeps with its outcome.
 */
export function modelCallLog(write: (line: string) => void = console.info): ModelCallMeter {
  return (call) => {
    currentJob.getStore()?.calls.push(call);
    write(logLine(call.failed ? "WARNING" : "INFO", "model call", modelCallFields(call)));
  };
}
