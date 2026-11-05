import { describe, expect, it } from "vitest";

import { mapWithBoundedConcurrency } from "./bounded-concurrency.js";

/** A task whose calls stay open until released, recording how many run at once. */
function gatedTask() {
  const releases: (() => void)[] = [];
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  const task = async (item: number) => {
    started.push(item);
    running += 1;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1;
    if (item < 0) throw new Error(`failed ${item}`);
    return item * 10;
  };
  const drain = async () => {
    while (releases.length > 0 || running > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { task, drain, started, peak: () => peak };
}

describe("mapWithBoundedConcurrency (#2233)", () => {
  it("keeps at most the limit in flight and returns results in item order", async () => {
    const gate = gatedTask();
    const result = mapWithBoundedConcurrency([1, 2, 3, 4, 5, 6], 4, gate.task);
    await gate.drain();
    await expect(result).resolves.toEqual([10, 20, 30, 40, 50, 60]);
    expect(gate.peak()).toBe(4);
  });

  it("starts nothing new after a failure, lets the calls in flight finish, then throws it", async () => {
    const gate = gatedTask();
    let finished = 0;
    const result = mapWithBoundedConcurrency([-1, 2, 3, 4], 2, async (item) => {
      const value = await gate.task(item);
      finished += 1;
      return value;
    });
    const outcome = result.catch((error: unknown) => error);
    await gate.drain();
    expect(await outcome).toMatchObject({ message: "failed -1" });
    expect(gate.started).toEqual([-1, 2]);
    expect(finished).toBe(1);
  });

  it("returns an empty list for no items and refuses a limit below one", async () => {
    await expect(mapWithBoundedConcurrency([], 4, async () => 1)).resolves.toEqual([]);
    await expect(mapWithBoundedConcurrency([1], 0, async () => 1)).rejects.toThrow(
      "positive integer",
    );
  });
});
