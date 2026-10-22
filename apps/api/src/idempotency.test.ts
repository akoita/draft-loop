import { describe, expect, it, vi } from "vitest";

import { createMemoryIdempotencyStore } from "./idempotency.js";
import { describeIdempotencyStoreContract } from "./idempotency-contract.js";

describeIdempotencyStoreContract("memory", async (options) => ({
  store: createMemoryIdempotencyStore(options),
  close: async () => undefined,
}));

describe("memory idempotency store", () => {
  it("shares one in-flight command between concurrent callers", async () => {
    const store = createMemoryIdempotencyStore();
    const produce = vi.fn(async () => ({ runId: "run-1" }));

    const [first, concurrent] = await Promise.all([
      store.once("runs:w", "key", { a: 1 }, produce),
      store.once("runs:w", "key", { a: 1 }, produce),
    ]);

    expect(first).toEqual({ runId: "run-1" });
    expect(concurrent).toBe(first);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("drops the oldest keys beyond its capacity", async () => {
    const store = createMemoryIdempotencyStore({ maxEntries: 2 });

    await store.once("s", "a", {}, async () => "a");
    await store.once("s", "b", {}, async () => "b");
    await store.once("s", "c", {}, async () => "c");

    await expect(store.once("s", "a", { changed: true }, async () => "a2")).resolves.toBe("a2");
  });
});
