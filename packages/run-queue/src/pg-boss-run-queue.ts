import pg from "pg";
import { type ConstructorOptions, PgBoss, type Queue } from "pg-boss";

import {
  type BriefExtractionJob,
  briefExtractionJobKey,
  briefExtractionJobSchema,
} from "./brief-extraction-job.js";
import { type RunJob, runJobKey, runJobSchema } from "./run-job.js";

export const runQueueName = "draft-loop-runs";
export const briefExtractionQueueName = "draft-loop-brief-extractions";

export interface RunQueueOptions {
  readonly connectionString: string;
  /** The schema the queue's tables live in, apart from storage. Defaults to `draft_loop_queue`. */
  readonly schema?: string;
}

export interface EnqueueRunOptions {
  /** Not before this time, as after a provider usage limit. */
  readonly startAfter?: Date;
}

/** The producer side of the run queue, as the API uses it. */
export interface RunQueue {
  /**
   * Queues the run unless a job for it is already waiting. Safe to repeat: a retried request
   * queues nothing new while the first job waits, and a worker skips a run that is already done.
   */
  readonly enqueue: (job: RunJob, options?: EnqueueRunOptions) => Promise<void>;
  /**
   * Queues a brief's extraction unless one for the same brief version waits or runs. Safe to
   * repeat, and the worker skips a brief that moved past the queued version.
   */
  readonly enqueueBriefExtraction: (job: BriefExtractionJob) => Promise<void>;
  readonly close: () => Promise<void>;
}

/**
 * How runs are retried. A worker's heartbeats mark a job alive; a job without one for a minute, as
 * after a crash, is retried and the run resumes from its last saved step.
 */
export const runQueueSettings: Omit<Queue, "name"> = {
  // At most one waiting and one active job per run: a pause can queue the resumption while the
  // paused attempt is still finishing, and duplicate requests collapse.
  policy: "stately",
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 600,
  heartbeatSeconds: 60,
  // A whole author-critic round can take many minutes; the heartbeat catches crashes sooner.
  expireInSeconds: 2 * 60 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};

/**
 * How brief extractions are retried: one provider call each, so a short expiry and a few retries.
 * A failed extraction becomes an issue on the brief rather than a throw, so retries cover crashes
 * and lost connections.
 */
export const briefExtractionQueueSettings: Omit<Queue, "name"> = {
  // One waiting or running job per brief version.
  policy: "exclusive",
  retryLimit: 3,
  retryDelay: 15,
  retryBackoff: true,
  retryDelayMax: 300,
  heartbeatSeconds: 60,
  expireInSeconds: 10 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};

const schemaPattern = /^[a-z_][a-z0-9_]{0,62}$/u;
const rolePattern = /^[a-z_][a-z0-9_]{0,62}$/u;

function queueSchema(options: RunQueueOptions): string {
  const schema = options.schema ?? "draft_loop_queue";
  if (!schemaPattern.test(schema)) throw new Error(`Invalid queue schema name: ${schema}`);
  return schema;
}

/** @internal Shared with the worker side; not part of the package's exports. */
export function bossOptions(
  options: RunQueueOptions,
  overrides: ConstructorOptions,
): ConstructorOptions {
  return {
    connectionString: options.connectionString,
    schema: queueSchema(options),
    schedule: false,
    registerInstance: false,
    ...overrides,
  };
}

/**
 * Creates or upgrades the queue's schema, the run queue and the brief extraction queue, as the
 * role that owns the database objects. Like storage migrations, it runs at deploy time, never from
 * the running service.
 */
export async function migrateRunQueue(options: RunQueueOptions): Promise<void> {
  const boss = new PgBoss(
    bossOptions(options, { migrate: true, createSchema: true, supervise: false }),
  );
  await boss.start();
  try {
    for (const [name, settings] of [
      [runQueueName, runQueueSettings],
      [briefExtractionQueueName, briefExtractionQueueSettings],
    ] as const) {
      if ((await boss.getQueue(name)) === null) {
        await boss.createQueue(name, settings);
        continue;
      }
      // A queue's policy and heartbeat are fixed at creation; the rest can change.
      const {
        policy: _policy,
        retryDelayMax: _max,
        heartbeatSeconds: _heartbeat,
        ...mutable
      } = settings;
      await boss.updateQueue(name, mutable);
    }
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
}

/** Lets the service's runtime role use the queue's tables and functions, and nothing more. */
export async function grantRunQueueAccess(options: RunQueueOptions, role: string): Promise<void> {
  if (!rolePattern.test(role)) throw new Error(`Invalid Postgres role name: ${role}`);
  const schema = queueSchema(options);
  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${role}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Opens the run queue for a service that only queues runs. It never migrates, so it runs as the
 * restricted runtime role and fails to start when the schema is missing or out of date.
 */
export async function openRunQueue(options: RunQueueOptions): Promise<RunQueue> {
  const boss = new PgBoss(
    bossOptions(options, { migrate: false, createSchema: false, supervise: false }),
  );
  // pg-boss reports background failures as events; without a listener Node would throw them.
  boss.on("error", () => undefined);
  await boss.start();
  return {
    enqueue: (job, enqueueOptions) => sendRunJob(boss, job, enqueueOptions),
    enqueueBriefExtraction: async (job) => {
      const data = briefExtractionJobSchema.parse(job);
      await boss.send(briefExtractionQueueName, data, {
        singletonKey: briefExtractionJobKey(data),
      });
    },
    close: () => boss.stop({ graceful: false, close: true }),
  };
}

/** @internal Shared with the worker side; not part of the package's exports. */
export async function sendRunJob(
  boss: PgBoss,
  job: RunJob,
  options: EnqueueRunOptions = {},
): Promise<void> {
  const data = runJobSchema.parse(job);
  await boss.send(runQueueName, data, {
    singletonKey: runJobKey(data),
    ...(options.startAfter === undefined ? {} : { startAfter: options.startAfter }),
  });
}
