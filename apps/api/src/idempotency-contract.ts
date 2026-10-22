import { afterEach, describe, expect, it, vi } from "vitest";

import { IdempotencyConflictError, type IdempotencyStore } from "./idempotency.js";

export interface IdempotencyStoreUnderTest {
  readonly store: IdempotencyStore;
  readonly close: () => Promise<void>;
}

/** Opens an empty store with a lifetime of `ttlMs` on the given clock. */
export type IdempotencyStoreFactory = (options: {
  readonly ttlMs: number;
  readonly now: () => number;
}) => Promise<IdempotencyStoreUnderTest>;

/** The behaviour every idempotency store keeps, so the memory and Postgres stores agree. */
export function describeIdempotencyStoreContract(name: string, open: IdempotencyStoreFactory) {
  describe(`${name} idempotency store contract`, () => {
    let opened: IdempotencyStoreUnderTest | undefined;
    let now = Date.parse("2026-10-22T10:00:00.000Z");
    const start = async (ttlMs = 60_000) => {
      opened = await open({ ttlMs, now: () => now });
      return opened.store;
    };

    afterEach(async () => {
      await opened?.close();
      opened = undefined;
    });

    it("runs a command once per key and replays its result", async () => {
      const store = await start();
      const produce = vi.fn(async () => ({ runId: "run-1" }));

      const first = await store.once("runs:w", "key-1", { a: 1 }, produce);
      const retry = await store.once("runs:w", "key-1", { a: 1 }, produce);

      expect(first).toEqual({ runId: "run-1" });
      expect(retry).toEqual(first);
      expect(produce).toHaveBeenCalledTimes(1);
    });

    it("keeps scopes apart and refuses a key reused for another request", async () => {
      const store = await start();

      await store.once("runs:a", "key-1", { a: 1 }, async () => 1);
      await expect(store.once("runs:b", "key-1", { a: 2 }, async () => 2)).resolves.toBe(2);
      await expect(store.once("runs:a", "key-1", { a: 2 }, async () => 3)).rejects.toBeInstanceOf(
        IdempotencyConflictError,
      );
    });

    it("lets a failed command be retried with the same key", async () => {
      const store = await start();

      await expect(
        store.once("s", "key-1", {}, async () => {
          throw new Error("failed");
        }),
      ).rejects.toThrow("failed");
      await expect(store.once("s", "key-1", {}, async () => "retried")).resolves.toBe("retried");
    });

    it("forgets a key after its lifetime", async () => {
      const store = await start(1_000);

      await store.once("s", "key-1", {}, async () => "first");
      now += 1_000;

      await expect(store.once("s", "key-1", { other: true }, async () => "fresh")).resolves.toBe(
        "fresh",
      );
    });
  });
}
