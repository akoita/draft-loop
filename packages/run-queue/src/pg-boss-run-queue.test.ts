import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  briefExtractionQueueName,
  grantRunQueueAccess,
  migrateRunQueue,
  openRunQueue,
  type RunQueue,
  runQueueName,
} from "./pg-boss-run-queue.js";

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

describe.runIf(connectionString !== undefined)("Postgres run queue", () => {
  const url = connectionString ?? "";
  const schema = `queue_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  let queue: RunQueue;

  const jobs = async () =>
    (
      await admin.query(
        `SELECT state, data, singleton_key, start_after FROM ${schema}.job WHERE name = $1 ORDER BY created_on`,
        [runQueueName],
      )
    ).rows;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migrateRunQueue({ connectionString: url, schema });
    // Migrating again is how a deploy upgrades; it must be harmless on a current schema.
    await migrateRunQueue({ connectionString: url, schema });
    await grantRunQueueAccess({ connectionString: url, schema }, runtimeRole);
    queue = await openRunQueue({ connectionString: runtimeUrl(url), schema });
  });

  afterAll(async () => {
    await queue?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("queues one job per run, carrying only ids", async () => {
    const job = { tenantId: "tenant-a", workspaceId: "workspace-1", runId: "run-1" };

    await queue.enqueue(job);
    await queue.enqueue(job);

    expect(await jobs()).toEqual([
      expect.objectContaining({
        state: "created",
        data: job,
        singleton_key: "tenant-a/workspace-1/run-1",
      }),
    ]);
  });

  it("holds a job until its start time", async () => {
    const startAfter = new Date(Date.now() + 60 * 60 * 1000);

    await queue.enqueue(
      { tenantId: "tenant-a", workspaceId: "workspace-1", runId: "run-2" },
      { startAfter },
    );

    const [job] = (await jobs()).filter((row) => row.data.runId === "run-2");
    expect(new Date(job?.start_after).getTime()).toBeGreaterThanOrEqual(
      startAfter.getTime() - 1_000,
    );
  });

  it("refuses a job that carries more than ids", async () => {
    await expect(
      queue.enqueue({
        tenantId: "tenant-a",
        workspaceId: "workspace-1",
        runId: "run-3",
        content: "candidate material",
      } as never),
    ).rejects.toThrow();
    await expect(
      queue.enqueue({ tenantId: "../x", workspaceId: "workspace-1", runId: "run-3" }),
    ).rejects.toThrow();
  });

  it("queues one brief extraction per brief version, carrying only ids", async () => {
    const job = {
      tenantId: "tenant-a",
      workspaceId: "workspace-1",
      applicationId: "app-1",
      briefId: "brief-1",
      version: 1,
    };

    await queue.enqueueBriefExtraction(job);
    await queue.enqueueBriefExtraction(job);
    await queue.enqueueBriefExtraction({ ...job, version: 2 });

    const extractions = (
      await admin.query(
        `SELECT data, singleton_key FROM ${schema}.job WHERE name = $1 ORDER BY created_on`,
        [briefExtractionQueueName],
      )
    ).rows;
    expect(extractions).toEqual([
      { data: job, singleton_key: "tenant-a/workspace-1/brief-1@1" },
      { data: { ...job, version: 2 }, singleton_key: "tenant-a/workspace-1/brief-1@2" },
    ]);
    await expect(
      queue.enqueueBriefExtraction({ ...job, jobText: "candidate material" } as never),
    ).rejects.toThrow();
  });

  it("does not let the runtime role change the queue's schema", async () => {
    const runtime = new pg.Client({ connectionString: runtimeUrl(url) });
    await runtime.connect();
    try {
      await expect(runtime.query(`CREATE TABLE ${schema}.intruder (id int)`)).rejects.toThrow(
        /permission denied/u,
      );
    } finally {
      await runtime.end();
    }
  });
});
