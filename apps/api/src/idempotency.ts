import { createHash } from "node:crypto";

/**
 * Remembers what a command produced under a client's `Idempotency-Key`, so a retried request
 * returns the first result instead of acting twice (ADR 0011, D10). A key reused with a different
 * request is a conflict, not a replay.
 */
export interface IdempotencyStore {
  readonly once: <Result>(
    scope: string,
    key: string,
    request: unknown,
    produce: () => Promise<Result>,
  ) => Promise<Result>;
}

export class IdempotencyConflictError extends Error {
  override readonly name = "IdempotencyConflictError";
}

/** The key's first request is still running elsewhere; the client retries the same request. */
export class IdempotencyInProgressError extends Error {
  override readonly name = "IdempotencyInProgressError";
  constructor() {
    super("A request with this idempotency key is still running. Retry it shortly.");
  }
}

interface Entry {
  readonly fingerprint: string;
  readonly expiresAt: number;
  readonly result: Promise<unknown>;
}

export function fingerprintOf(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

/**
 * Keys live in this process for a day: for tests and a single process. A deployment with a
 * database shares its keys through `createPostgresIdempotencyStore`.
 */
export function createMemoryIdempotencyStore(
  options: {
    readonly ttlMs?: number;
    readonly maxEntries?: number;
    readonly now?: () => number;
  } = {},
): IdempotencyStore {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  function prune(at: number): void {
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(id);
    }
    // Map order is insertion order, so the oldest keys go first.
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    once: async (scope, key, request, produce) => {
      const at = now();
      const id = `${scope}\u0000${key}`;
      const fingerprint = fingerprintOf(request);
      const existing = entries.get(id);
      if (existing !== undefined && existing.expiresAt > at) {
        if (existing.fingerprint !== fingerprint) {
          throw new IdempotencyConflictError("The idempotency key was used for another request.");
        }
        return (await existing.result) as Awaited<ReturnType<typeof produce>>;
      }
      prune(at);
      const result = produce();
      entries.set(id, { fingerprint, expiresAt: at + ttlMs, result });
      try {
        return await result;
      } catch (error) {
        // Failures are not replayed, so the client can retry with the same key.
        entries.delete(id);
        throw error;
      }
    },
  };
}
