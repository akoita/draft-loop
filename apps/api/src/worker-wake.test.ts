import { describe, expect, it, vi } from "vitest";

import {
  cloudRunJobWake,
  enqueueThenWake,
  isCloudRunJobName,
  WorkerWakeError,
} from "./worker-wake.js";

const jobName = "projects/example-proj/locations/europe-west1/jobs/draft-loop-worker";

describe("enqueueThenWake", () => {
  it("wakes the worker once after each queued run", async () => {
    const enqueue = vi.fn(async () => undefined);
    const wake = vi.fn(async () => undefined);
    const enqueueRun = enqueueThenWake(enqueue, wake, () => undefined);

    await enqueueRun("workspace-1", "run-1");
    await enqueueRun("workspace-1", "run-2");

    expect(enqueue).toHaveBeenNthCalledWith(1, "workspace-1", "run-1");
    expect(enqueue).toHaveBeenNthCalledWith(2, "workspace-1", "run-2");
    expect(wake).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(wake.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not wake when the run could not be queued", async () => {
    const wake = vi.fn(async () => undefined);
    const enqueueRun = enqueueThenWake(
      async () => {
        throw new Error("queue unavailable");
      },
      wake,
      () => undefined,
    );

    await expect(enqueueRun("workspace-1", "run-1")).rejects.toThrow("queue unavailable");
    expect(wake).not.toHaveBeenCalled();
  });

  it("reports a failed wake without failing the request that queued the run", async () => {
    const failure = new Error("Cloud Run unavailable");
    const onWakeError = vi.fn();
    const enqueueRun = enqueueThenWake(
      async () => undefined,
      async () => {
        throw failure;
      },
      onWakeError,
    );

    await expect(enqueueRun("workspace-1", "run-1")).resolves.toBeUndefined();
    expect(onWakeError).toHaveBeenCalledExactlyOnceWith(failure);
  });
});

describe("cloudRunJobWake", () => {
  it("starts one job execution with the service identity's token from the metadata server", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).startsWith("http://metadata.google.internal/")
        ? Response.json({ access_token: "synthetic-token", expires_in: 3599 })
        : Response.json({ name: "operation" }),
    );

    await cloudRunJobWake({ jobName, fetch })();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toEqual({ headers: { "Metadata-Flavor": "Google" } });
    expect(fetch.mock.calls[1]).toEqual([
      `https://run.googleapis.com/v2/${jobName}:run`,
      {
        method: "POST",
        headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
        body: "{}",
      },
    ]);
  });

  it("fails when either call is refused", async () => {
    const noToken = vi.fn<typeof globalThis.fetch>(async () => new Response("", { status: 404 }));
    await expect(cloudRunJobWake({ jobName, fetch: noToken })()).rejects.toThrow(WorkerWakeError);

    const refused = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).startsWith("http://metadata.google.internal/")
        ? Response.json({ access_token: "synthetic-token" })
        : new Response("", { status: 403 }),
    );
    await expect(cloudRunJobWake({ jobName, fetch: refused })()).rejects.toThrow(
      "Cloud Run refused to start the worker job: 403",
    );
  });

  it("accepts only a full Cloud Run job name", () => {
    expect(isCloudRunJobName(jobName)).toBe(true);
    for (const name of ["draft-loop-worker", "projects/x/jobs/y", `${jobName}/executions/e`]) {
      expect(isCloudRunJobName(name)).toBe(false);
      expect(() => cloudRunJobWake({ jobName: name })).toThrow(WorkerWakeError);
    }
  });
});
