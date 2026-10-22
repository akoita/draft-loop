import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stopWhenIdle, type Worker } from "./worker.js";

function fakeWorker() {
  let idle: number | undefined = 0;
  const stop = vi.fn<Worker["stop"]>(async () => undefined);
  const worker: Worker = { stop, idleMs: () => idle };
  return {
    worker,
    stop,
    setIdle: (value: number | undefined) => {
      idle = value;
    },
  };
}

describe("stopWhenIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops once the worker has had no job for the idle time, with the grace period given", async () => {
    const fake = fakeWorker();
    const onStopped = vi.fn();
    stopWhenIdle(fake.worker, { idleMs: 5_000, graceMs: 1_800_000, onStopped });

    fake.setIdle(4_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fake.stop).not.toHaveBeenCalled();

    fake.setIdle(5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.stop).toHaveBeenCalledExactlyOnceWith({ graceMs: 1_800_000 });
    expect(onStopped).toHaveBeenCalledExactlyOnceWith();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it("never stops while a job is running, however long it takes", async () => {
    const fake = fakeWorker();
    const onStopped = vi.fn();
    stopWhenIdle(fake.worker, { idleMs: 5_000, onStopped });

    fake.setIdle(undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.stop).not.toHaveBeenCalled();
  });

  it("reports a failed stop, and can be cancelled", async () => {
    const fake = fakeWorker();
    const failure = new Error("connection lost");
    fake.stop.mockRejectedValueOnce(failure);
    const onStopped = vi.fn();
    stopWhenIdle(fake.worker, { idleMs: 1_000, onStopped });
    fake.setIdle(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onStopped).toHaveBeenCalledExactlyOnceWith(failure);

    const other = fakeWorker();
    const cancel = stopWhenIdle(other.worker, { idleMs: 1_000, onStopped: vi.fn() });
    cancel();
    other.setIdle(10_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(other.stop).not.toHaveBeenCalled();
  });
});
