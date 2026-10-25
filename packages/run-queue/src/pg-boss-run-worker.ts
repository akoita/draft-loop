import { PgBoss } from "pg-boss";

import { type BriefExtractionJob, briefExtractionJobSchema } from "./brief-extraction-job.js";
import {
  bossOptions,
  briefExtractionQueueName,
  type RunQueueOptions,
  runQueueName,
  sendRunJob,
} from "./pg-boss-run-queue.js";
import { type RunJob, runJobSchema } from "./run-job.js";

export interface RunWorkerOptions extends RunQueueOptions {
  /** How many runs this process executes at once. Defaults to 1. */
  readonly concurrency?: number;
  /** How often an idle worker looks for a job, in seconds. Defaults to pg-boss's 2. */
  readonly pollingIntervalSeconds?: number;
  /** Background failures pg-boss reports, such as a lost connection. They never carry job data. */
  readonly onError?: (error: Error) => void;
}

export interface RunJobControl {
  /**
   * Queues the same run to start no earlier than `startAfter`, as after a usage limit. The queue
   * accepts it while this job is still active, then this job completes.
   */
  readonly requeue: (startAfter: Date) => Promise<void>;
}

/** Executes one claimed run job. A throw fails the attempt, and the queue retries it with backoff. */
export type RunJobHandler = (job: RunJob, control: RunJobControl) => Promise<void>;

/** Extracts one claimed brief. A throw fails the attempt, and the queue retries it with backoff. */
export type BriefExtractionJobHandler = (job: BriefExtractionJob) => Promise<void>;

export interface StopRunWorkerOptions {
  /**
   * How long a job in flight may keep running, in milliseconds. A job still running then is failed
   * so another worker retries it, and the run resumes from its last saved step. Defaults to 8,000,
   * inside Cloud Run's ten-second notice.
   */
  readonly graceMs?: number;
}

export interface RunWorker {
  /**
   * Stops claiming jobs, waits for the job in flight up to the grace period, then disconnects. A
   * step still running is not interrupted, since cancelling it would record the run as cancelled;
   * the process exits instead, and the retry repeats the step.
   */
  readonly stop: (options?: StopRunWorkerOptions) => Promise<void>;
}

/**
 * Starts taking run jobs, and brief extractions when given their handler, as the restricted
 * runtime role. It never migrates. It also supervises the queues, which is what retries the job of
 * a worker that stopped sending heartbeats.
 */
export async function startRunWorker(
  options: RunWorkerOptions,
  handle: RunJobHandler,
  handleBriefExtraction?: BriefExtractionJobHandler,
): Promise<RunWorker> {
  const boss = new PgBoss(
    bossOptions(options, { migrate: false, createSchema: false, supervise: true }),
  );
  boss.on("error", (error) => options.onError?.(error));
  const claim = {
    batchSize: 1,
    localConcurrency: options.concurrency ?? 1,
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  };
  await boss.start();
  try {
    await boss.work<RunJob>(runQueueName, claim, async (jobs) => {
      for (const claimed of jobs) {
        const job = runJobSchema.parse(claimed.data);
        await handle(job, {
          requeue: (startAfter) => sendRunJob(boss, job, { startAfter }),
        });
      }
    });
    if (handleBriefExtraction !== undefined) {
      await boss.work<BriefExtractionJob>(briefExtractionQueueName, claim, async (jobs) => {
        for (const claimed of jobs) {
          await handleBriefExtraction(briefExtractionJobSchema.parse(claimed.data));
        }
      });
    }
  } catch (error) {
    await boss.stop({ graceful: false, close: true });
    throw error;
  }
  return {
    stop: async (stopOptions = {}) => {
      await boss.stop({ graceful: true, timeout: stopOptions.graceMs ?? 8_000, close: true });
    },
  };
}
