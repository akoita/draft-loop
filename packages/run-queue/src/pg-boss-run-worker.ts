import { PgBoss } from "pg-boss";

import { type BriefExtractionJob, briefExtractionJobSchema } from "./brief-extraction-job.js";
import {
  bossOptions,
  briefExtractionQueueName,
  queueSchema,
  type RunQueueOptions,
  runQueueName,
  sendRunJob,
} from "./pg-boss-run-queue.js";
import {
  type ProfileDerivationJob,
  type ProfileDerivationOutcome,
  type ProfileDerivationProgress,
  profileDerivationJobSchema,
} from "./profile-derivation-job.js";
import {
  clearProfileDerivationProgress,
  profileDerivationHeartbeatRefreshSeconds,
  profileDerivationQueueName,
  writeProfileDerivationProgress,
} from "./profile-derivation-queue.js";
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

export interface ProfileDerivationJobControl {
  /** Aborted once the derivation is cancelled, or this worker lost its claim on it. */
  readonly signal: AbortSignal;
  /** Records content-free progress for the screen; a failed write never stops the derivation. */
  readonly reportProgress: (progress: ProfileDerivationProgress) => void;
}

/**
 * Derives one claimed career profile and says how it ended; the queue keeps that as the job's
 * output. A throw fails the attempt, and the queue retries it once.
 */
export type ProfileDerivationJobHandler = (
  job: ProfileDerivationJob,
  control: ProfileDerivationJobControl,
) => Promise<ProfileDerivationOutcome>;

/** The queues besides runs a worker takes, each when given its handler. */
export interface RunWorkerHandlers {
  readonly briefExtraction?: BriefExtractionJobHandler;
  readonly profileDerivation?: ProfileDerivationJobHandler;
}

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
 * Starts taking run jobs, and brief extractions and profile derivations when given their handlers,
 * as the restricted runtime role. It never migrates. It also supervises the queues, which is what retries the job of
 * a worker that stopped sending heartbeats.
 */
export async function startRunWorker(
  options: RunWorkerOptions,
  handle: RunJobHandler,
  handlers: RunWorkerHandlers = {},
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
    const { briefExtraction, profileDerivation } = handlers;
    if (briefExtraction !== undefined) {
      await boss.work<BriefExtractionJob>(briefExtractionQueueName, claim, async (jobs) => {
        for (const claimed of jobs) {
          await briefExtraction(briefExtractionJobSchema.parse(claimed.data));
        }
      });
    }
    if (profileDerivation !== undefined) {
      const schema = queueSchema(options);
      await boss.work<ProfileDerivationJob>(
        profileDerivationQueueName,
        { ...claim, heartbeatRefreshSeconds: profileDerivationHeartbeatRefreshSeconds },
        async ([claimed]) => {
          if (claimed === undefined) return undefined;
          try {
            return await profileDerivation(profileDerivationJobSchema.parse(claimed.data), {
              signal: claimed.signal,
              reportProgress: (progress) => {
                writeProfileDerivationProgress(boss, schema, claimed.id, progress).catch(
                  (error: unknown) => options.onError?.(asError(error)),
                );
              },
            });
          } finally {
            await clearProfileDerivationProgress(boss, schema, claimed.id).catch((error: unknown) =>
              options.onError?.(asError(error)),
            );
          }
        },
      );
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
