import { describe, expect, it, vi } from "vitest";

import { createMemoryIdempotencyStore, IdempotencyConflictError } from "./idempotency.js";

describe("memory idempotency store", () => {
  it("runs a command once per key and replays its result", async () => {
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

  it("keeps scopes apart and refuses a key reused for another request", async () => {
    const store = createMemoryIdempotencyStore();

    await store.once("runs:a", "key", { a: 1 }, async () => 1);
    await expect(store.once("runs:b", "key", { a: 2 }, async () => 2)).resolves.toBe(2);
    await expect(store.once("runs:a", "key", { a: 2 }, async () => 3)).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  it("lets a failed command be retried, and forgets keys after their lifetime", async () => {
    let now = 0;
    const store = createMemoryIdempotencyStore({ ttlMs: 1_000, now: () => now });

    await expect(
      store.once("s", "key", {}, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(store.once("s", "key", {}, async () => "retried")).resolves.toBe("retried");

    now = 1_000;
    await expect(store.once("s", "key", { other: true }, async () => "fresh")).resolves.toBe(
      "fresh",
    );
  });

  it("drops the oldest keys beyond its capacity", async () => {
    const store = createMemoryIdempotencyStore({ maxEntries: 2 });

    await store.once("s", "a", {}, async () => "a");
    await store.once("s", "b", {}, async () => "b");
    await store.once("s", "c", {}, async () => "c");

    await expect(store.once("s", "a", { changed: true }, async () => "a2")).resolves.toBe("a2");
  });
});
