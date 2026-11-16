import { AsyncLocalStorage } from "node:async_hooks";

import type { MeteredModelCall, ModelCallMeter } from "@draft-loop/application/model-call-meter";

import { logLine } from "./logging.js";

/** The ids of the job whose work is running, so each call's line names its job. */
const currentJob = new AsyncLocalStorage<Readonly<Record<string, unknown>>>();

/** Runs a job's work with its ids attached to every model call it makes. */
export function withJobIds<Result>(
  ids: Readonly<Record<string, unknown>>,
  work: () => Promise<Result>,
): Promise<Result> {
  return currentJob.run(ids, work);
}

/** The fields of one call's line: the job's ids, then the call's content-free usage. */
export function modelCallFields(call: MeteredModelCall): Record<string, unknown> {
  return { ...currentJob.getStore(), ...call };
}

/**
 * One content-free line per extraction call (#2806): the job's ids, the purpose, model, route,
 * tokens and estimated cost. A failed call is a warning and keeps what the provider billed.
 */
export function modelCallLog(write: (line: string) => void = console.info): ModelCallMeter {
  return (call) =>
    write(logLine(call.failed ? "WARNING" : "INFO", "model call", modelCallFields(call)));
}
