import {
  type RunWorker,
  type RunWorkerOptions,
  type StopRunWorkerOptions,
  startRunWorker,
} from "@draft-loop/run-queue";

import { createRunJobHandler, type RunJobHandlerOptions } from "./run-job-handler.js";

export interface WorkerOptions {
  readonly queue: RunWorkerOptions;
  readonly runs: RunJobHandlerOptions;
}

/** Starts executing queued runs through the application service the composition root built. */
export function startWorker(options: WorkerOptions): Promise<RunWorker> {
  return startRunWorker(options.queue, createRunJobHandler(options.runs));
}

export interface ShutdownOptions extends StopRunWorkerOptions {
  readonly signals?: readonly NodeJS.Signals[];
  /** Called once the worker has stopped, or failed to; the entry point exits there. */
  readonly onStopped: (error?: unknown) => void;
}

/**
 * Stops the worker on SIGTERM, as Cloud Run sends before it stops an instance, or SIGINT. The
 * worker stops claiming at once and gives the job in flight the grace period.
 */
export function stopOnSignals(worker: RunWorker, options: ShutdownOptions): () => void {
  const signals = options.signals ?? ["SIGTERM", "SIGINT"];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    worker.stop(options.graceMs === undefined ? {} : { graceMs: options.graceMs }).then(
      () => options.onStopped(),
      (error: unknown) => options.onStopped(error),
    );
  };
  for (const signal of signals) process.once(signal, stop);
  return () => {
    for (const signal of signals) process.off(signal, stop);
  };
}
