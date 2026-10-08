import { describe, expect, it } from "vitest";

import { mapWithConcurrency, normalizeConcurrency } from "./map-with-concurrency.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("normalizeConcurrency", () => {
  it.each([
    [undefined, 4, 4],
    [Number.NaN, 4, 4],
    [Number.POSITIVE_INFINITY, 4, 4],
    [0, 4, 1],
    [-3, 4, 1],
    [2.9, 4, 2],
    [8, 4, 8],
  ])("maps %s with fallback %s to %s", (value, fallback, expected) => {
    expect(normalizeConcurrency(value, fallback)).toBe(expected);
  });
});

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once and returns results in item order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 9 }, (_, index) => index);
    const settled = await mapWithConcurrency(items, 3, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10 - item);
      inFlight -= 1;
      return item * 2;
    });
    expect(maxInFlight).toBe(3);
    expect(settled).toEqual(items.map((item) => ({ status: "fulfilled", value: item * 2 })));
  });

  it("settles every item even when some reject", async () => {
    const settled = await mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    });
    expect(settled.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
  });

  it("returns an empty result for no items", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("starts nothing new after the signal aborts and rejects unstarted items with its reason", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const settled = await mapWithConcurrency(
      [0, 1, 2, 3, 4],
      2,
      async (item) => {
        started.push(item);
        if (item === 1) controller.abort(new Error("stop"));
        await sleep(5);
        return item;
      },
      controller.signal,
    );
    expect(started).toEqual([0, 1]);
    expect(settled.every((outcome) => outcome.status === "rejected")).toBe(true);
    expect((settled[4] as PromiseRejectedResult).reason).toEqual(new Error("stop"));
  });

  it("settles an in-flight item on abort without waiting for a worker that ignores it", async () => {
    const controller = new AbortController();
    const pending = mapWithConcurrency(
      [0],
      1,
      () => new Promise<never>(() => undefined),
      controller.signal,
    );
    controller.abort(new Error("stop"));
    const [outcome] = await pending;
    expect(outcome).toMatchObject({ status: "rejected" });
  });
});
