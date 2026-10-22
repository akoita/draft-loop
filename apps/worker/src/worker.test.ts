import { randomUUID } from "node:crypto";
import type { ApplicationService } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import {
  grantRunQueueAccess,
  migrateRunQueue,
  openRunQueue,
  type RunQueue,
  type RunWorker,
  runQueueName,
} from "@draft-loop/run-queue";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { startWorker, stopOnSignals } from "./worker.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const runtimePassword = "draft_loop_test_app";

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimePassword;
  return parsed.toString();
}

function snapshot(runId: string, state: string, lastError: object | null = null): RunSnapshot {
  const budget = { maxRounds: 3, maxCostUsd: 2, maxDurationMs: 600_000 };
  return { runId, workspaceId: "workspace-1", state, lastError, budget } as RunSnapshot;
}

/** Resolves once `check` passes, polling the way a person would refresh a page. */
async function eventually(check: () => Promise<void> | void, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

type Service = Pick<ApplicationService, "status" | "resume">;

describe.runIf(connectionString !== undefined)("worker on the Postgres run queue", () => {
  const url = connectionString ?? "";
  const schema = `queue_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  const errors: Error[] = [];
  let queue: RunQueue;
  let worker: RunWorker | undefined;

  const jobsFor = async (runId: string) =>
    (
      await admin.query(
        `SELECT state, start_after, retry_count FROM ${schema}.job
         WHERE name = $1 AND data->>'runId' = $2 ORDER BY created_on`,
        [runQueueName, runId],
      )
    ).rows as { state: string; start_after: Date; retry_count: number }[];

  const start = async (service: Service) => {
    worker = await startWorker({
      queue: {
        connectionString: runtimeUrl(url),
        schema,
        pollingIntervalSeconds: 0.5,
        onError: (error) => errors.push(error),
      },
      runs: {
        service,
        workspaceRoot: (job) => `/tenants/${job.tenantId}/workspaces/${job.workspaceId}`,
        allowProviderData: true,
        budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      },
    });
  };

  const enqueue = (runId: string) =>
    queue.enqueue({ tenantId: "tenant-a", workspaceId: "workspace-1", runId });

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migrateRunQueue({ connectionString: url, schema });
    await grantRunQueueAccess({ connectionString: url, schema }, runtimeRole);
    queue = await openRunQueue({ connectionString: runtimeUrl(url), schema });
  });

  afterEach(async () => {
    await worker?.stop({ graceMs: 1_000 });
    worker = undefined;
    // The worker supervises the queue as the runtime role; that must not fail for want of rights.
    expect(errors).toEqual([]);
  });

  afterAll(async () => {
    await queue?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("drives a queued run until it awaits the person, then completes the job", async () => {
    const resume = vi.fn<Service["resume"]>(async () => snapshot("run-1", "awaiting-approval"));
    await start({ status: async () => snapshot("run-1", "drafting"), resume });

    await enqueue("run-1");

    await eventually(async () => {
      expect(await jobsFor("run-1")).toEqual([expect.objectContaining({ state: "completed" })]);
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith({
      root: "/tenants/tenant-a/workspaces/workspace-1",
      runId: "run-1",
      allowProviderData: true,
    });
  });

  it("pauses on a usage limit and resumes the run at the reset time", async () => {
    const resetsAt = new Date(Date.now() + 1_500);
    let state = snapshot("run-2", "reviewing");
    const resume = vi.fn<Service["resume"]>(async () => {
      state =
        resume.mock.calls.length === 1
          ? snapshot("run-2", "paused", {
              code: "usage-limit",
              retryable: true,
              usageLimitResetsAt: resetsAt.toISOString(),
            })
          : snapshot("run-2", "awaiting-approval");
      return state;
    });
    await start({ status: async () => state, resume });

    await enqueue("run-2");

    // The resumption is queued while the paused attempt is still active, and waits for the reset.
    await eventually(async () => {
      expect(await jobsFor("run-2")).toEqual([
        expect.objectContaining({ state: "completed" }),
        expect.objectContaining({ state: "completed" }),
      ]);
    });
    const [, resumption] = await jobsFor("run-2");
    expect(resumption?.start_after.getTime()).toBe(resetsAt.getTime());
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("retries a job whose step was interrupted, and the retry resumes the run", async () => {
    const resume = vi
      .fn<Service["resume"]>()
      .mockRejectedValueOnce(new Error("interrupted step"))
      .mockResolvedValue(snapshot("run-3", "awaiting-approval"));
    await start({ status: async () => snapshot("run-3", "drafting"), resume });

    await enqueue("run-3");

    await eventually(async () => {
      expect(await jobsFor("run-3")).toEqual([expect.objectContaining({ state: "retry" })]);
    });
    // The queue waits 30 seconds before a retry; bring it forward rather than wait.
    await admin.query(
      `UPDATE ${schema}.job SET start_after = now() WHERE name = $1 AND data->>'runId' = 'run-3'`,
      [runQueueName],
    );
    await eventually(async () => {
      expect(await jobsFor("run-3")).toEqual([
        expect.objectContaining({ state: "completed", retry_count: 1 }),
      ]);
    });
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("stops claiming on SIGTERM and lets the job in flight finish", async () => {
    let release: () => void = () => undefined;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resume = vi.fn<Service["resume"]>(async ({ runId = "" }) => {
      await inFlight;
      return snapshot(runId, "awaiting-approval");
    });
    await start({ status: async ({ runId = "" }) => snapshot(runId, "drafting"), resume });
    const running = worker as RunWorker;
    const stopped = new Promise<unknown>((resolve) => {
      stopOnSignals(running, { graceMs: 10_000, signals: ["SIGUSR2"], onStopped: resolve });
    });

    await enqueue("run-4");
    await eventually(() => expect(resume).toHaveBeenCalledTimes(1));
    process.emit("SIGUSR2");
    await enqueue("run-5");
    release();

    expect(await stopped).toBeUndefined();
    worker = undefined;
    expect(await jobsFor("run-4")).toEqual([expect.objectContaining({ state: "completed" })]);
    expect(await jobsFor("run-5")).toEqual([expect.objectContaining({ state: "created" })]);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
