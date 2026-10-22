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

export interface Worker extends RunWorker {
  /** How long no job has been running, in milliseconds; undefined while one is. */
  readonly idleMs: () => number | undefined;
}

/** Starts executing queued runs through the application service the composition root built. */
export async function startWorker(
  options: WorkerOptions,
  now: () => number = Date.now,
): Promise<Worker> {
  const handle = createRunJobHandler(options.runs);
  let running = 0;
  let lastActiveAt = now();
  const worker = await startRunWorker(options.queue, async (job, control) => {
    running += 1;
    try {
      await handle(job, control);
    } finally {
      running -= 1;
      lastActiveAt = now();
    }
  });
  return {
    stop: (stopOptions) => worker.stop(stopOptions),
    idleMs: () => (running > 0 ? undefined : now() - lastActiveAt),
  };
}

export interface DrainOptions extends StopRunWorkerOptions {
  /** How long the worker may find no job before it stops, in milliseconds. */
  readonly idleMs: number;
  /** How often it checks, in milliseconds. Defaults to 1,000. */
  readonly checkEveryMs?: number;
  /** Called once the worker has stopped, or failed to; the entry point exits there. */
  readonly onStopped: (error?: unknown) => void;
}

/**
 * Drain mode, for a worker that runs as a Cloud Run job: once no job has run for `idleMs`, the
 * worker stops and the job execution ends. Jobs queued for later stay queued for the next
 * execution. A job claimed just as it stops gets the whole grace period, so give it the run's
 * longest duration: the step is never cut short.
 */
export function stopWhenIdle(worker: Worker, options: DrainOptions): () => void {
  const timer = setInterval(() => {
    const idle = worker.idleMs();
    if (idle === undefined || idle < options.idleMs) return;
    clearInterval(timer);
    worker.stop(options.graceMs === undefined ? {} : { graceMs: options.graceMs }).then(
      () => options.onStopped(),
      (error: unknown) => options.onStopped(error),
    );
  }, options.checkEveryMs ?? 1_000);
  return () => clearInterval(timer);
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
