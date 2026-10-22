import type { PostgresIdempotencyKeys } from "@draft-loop/storage-postgres";

import {
  fingerprintOf,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  type IdempotencyStore,
} from "./idempotency.js";

export interface PostgresIdempotencyStoreOptions {
  readonly keys: PostgresIdempotencyKeys;
  readonly ttlMs?: number;
  /** How long a command may run before another instance may take its key over. */
  readonly leaseMs?: number;
  /** How long a retry waits for a running command's result before answering 409. */
  readonly waitMs?: number;
  readonly pollMs?: number;
  /** Expired keys removed per new claim, so the table stays small without a separate job. */
  readonly sweepLimit?: number;
  readonly now?: () => number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Idempotency keys shared by every API instance through Postgres (ADR 0011, D10), with the
 * memory store's scope, fingerprint and conflict rules and its 24-hour lifetime. Results are
 * kept as JSON, so a replay returns an equal value rather than the same object.
 */
export function createPostgresIdempotencyStore(
  options: PostgresIdempotencyStoreOptions,
): IdempotencyStore {
  const { keys } = options;
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const leaseMs = options.leaseMs ?? 2 * 60 * 1000;
  const waitMs = options.waitMs ?? 5_000;
  const pollMs = options.pollMs ?? 100;
  const sweepLimit = options.sweepLimit ?? 100;
  const now = options.now ?? Date.now;

  return {
    once: async (scope, key, request, produce) => {
      const ref = { scope, key, fingerprint: fingerprintOf(request) };
      const deadline = now() + waitMs;
      for (;;) {
        const at = new Date(now());
        const claim = await keys.claim({ ...ref, at, leaseMs, ttlMs });
        if (claim.state === "conflict") {
          throw new IdempotencyConflictError("The idempotency key was used for another request.");
        }
        if (claim.state === "completed") {
          return JSON.parse(claim.resultJson) as Awaited<ReturnType<typeof produce>>;
        }
        if (claim.state === "claimed") {
          await keys.sweep(at, sweepLimit);
          let result: Awaited<ReturnType<typeof produce>>;
          try {
            result = await produce();
          } catch (error) {
            // Failures are not replayed, so the client can retry with the same key.
            await keys.release(ref);
            throw error;
          }
          await keys.complete(ref, JSON.stringify(result));
          return result;
        }
        if (now() >= deadline) throw new IdempotencyInProgressError();
        await sleep(pollMs);
      }
    },
  };
}
