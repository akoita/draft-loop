import type { PgBoss, Queue } from "pg-boss";

import {
  type ProfileDerivationJob,
  type ProfileDerivationKey,
  type ProfileDerivationProgress,
  type ProfileDerivationState,
  profileDerivationJobKey,
  profileDerivationJobSchema,
  profileDerivationStateOf,
} from "./profile-derivation-job.js";

export const profileDerivationQueueName = "draft-loop-profile-derivations";

/**
 * How career profile derivations run. A derivation makes many provider calls, so a crash retries
 * it once rather than repeating the spend; a short heartbeat lets a cancel reach the worker within
 * seconds, since the worker's next heartbeat finds the job no longer active and aborts it.
 */
export const profileDerivationQueueSettings: Omit<Queue, "name"> = {
  // One waiting or running derivation per profile.
  policy: "exclusive",
  retryLimit: 1,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 300,
  heartbeatSeconds: 30,
  expireInSeconds: 60 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};

/** How often the worker refreshes a derivation's heartbeat, and so how soon it sees a cancel. */
export const profileDerivationHeartbeatRefreshSeconds = 2;

/**
 * The content-free progress of running derivations, by job id: two counts and a time. pg-boss
 * cannot change an active job's row, so the worker writes progress here and the API reads it.
 */
export function profileDerivationProgressTableSql(schema: string): string {
  return `CREATE TABLE IF NOT EXISTS ${schema}.job_progress (
    job_id uuid PRIMARY KEY,
    completed_calls integer NOT NULL CHECK (completed_calls >= 0),
    planned_calls integer NOT NULL CHECK (planned_calls >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
}

/** The producer side of profile derivations, as the API uses it. */
export interface ProfileDerivationQueue {
  /** Queues the derivation; false when one for the same profile already waits or runs. */
  readonly enqueueProfileDerivation: (job: ProfileDerivationJob) => Promise<boolean>;
  /** Where the profile's newest derivation stands; undefined when none was ever queued. */
  readonly profileDerivationState: (
    key: ProfileDerivationKey,
  ) => Promise<ProfileDerivationState | undefined>;
  /**
   * Cancels the profile's waiting or running derivation; false when none was. A running one stops
   * before its next provider call and saves no profile version.
   */
  readonly cancelProfileDerivation: (key: ProfileDerivationKey) => Promise<boolean>;
}

const outstanding: ReadonlySet<string> = new Set(["created", "retry", "active"]);

/** @internal Shared with the run queue; not part of the package's exports. */
export function profileDerivationQueue(boss: PgBoss, schema: string): ProfileDerivationQueue {
  const newest = async (key: ProfileDerivationKey) =>
    (await boss.findJobs(profileDerivationQueueName, { key: profileDerivationJobKey(key) })).sort(
      (a, b) => b.createdOn.getTime() - a.createdOn.getTime(),
    )[0];
  return {
    enqueueProfileDerivation: async (job) => {
      const data = profileDerivationJobSchema.parse(job);
      const id = await boss.send(profileDerivationQueueName, data, {
        singletonKey: profileDerivationJobKey(data),
      });
      return id !== null;
    },
    profileDerivationState: async (key) => {
      const job = await newest(key);
      if (job === undefined) return undefined;
      if (outstanding.has(job.state)) {
        const progress = await readProgress(boss, schema, job.id);
        return { status: "pending", ...progress };
      }
      if (job.state === "cancelled") return { status: "cancelled" };
      // A job that failed its retries, as after crashes, says nothing a person can act on.
      if (job.state === "failed") return { status: "failed", reason: "failed" };
      return profileDerivationStateOf(job.output);
    },
    cancelProfileDerivation: async (key) => {
      const job = await newest(key);
      if (job === undefined || !outstanding.has(job.state)) return false;
      await boss.cancel(profileDerivationQueueName, job.id);
      return true;
    },
  };
}

async function readProgress(
  boss: PgBoss,
  schema: string,
  jobId: string,
): Promise<ProfileDerivationProgress | Record<string, never>> {
  const { rows } = await boss
    .getDb()
    .executeSql(
      `SELECT completed_calls, planned_calls FROM ${schema}.job_progress WHERE job_id = $1`,
      [jobId],
    );
  const [row] = rows as { completed_calls: number; planned_calls: number }[];
  return row === undefined
    ? {}
    : { completedCalls: row.completed_calls, plannedCalls: row.planned_calls };
}

/** @internal The worker's progress writes; not part of the package's exports. */
export async function writeProfileDerivationProgress(
  boss: PgBoss,
  schema: string,
  jobId: string,
  progress: ProfileDerivationProgress,
): Promise<void> {
  await boss.getDb().executeSql(
    `INSERT INTO ${schema}.job_progress (job_id, completed_calls, planned_calls)
       VALUES ($1, $2, $3)
       ON CONFLICT (job_id) DO UPDATE
         SET completed_calls = EXCLUDED.completed_calls,
             planned_calls = EXCLUDED.planned_calls,
             updated_at = now()`,
    [jobId, progress.completedCalls, progress.plannedCalls],
  );
}

/** @internal Clears a finished job's progress, and any a crashed worker left behind. */
export async function clearProfileDerivationProgress(
  boss: PgBoss,
  schema: string,
  jobId: string,
): Promise<void> {
  await boss
    .getDb()
    .executeSql(
      `DELETE FROM ${schema}.job_progress WHERE job_id = $1 OR updated_at < now() - interval '1 day'`,
      [jobId],
    );
}
