import { addBilledUsage } from "./billed-usage.js";
import type { BilledUsage } from "./index.js";

/** A keep-alive running beside a request: `stop` ends it and returns what the keep-alives cost. */
export interface CacheKeepAlive {
  readonly stop: () => Promise<BilledUsage | undefined>;
}

export interface CacheKeepAliveOptions {
  /** How long after the request's start, and then between keep-alives, one is sent. */
  readonly intervalMs?: number;
}

/**
 * Three and a half minutes: inside Claude's five-minute cache lifetime, counted from the start of
 * the last request that touched the prefix, with margin for the keep-alive's own latency.
 */
export const defaultCacheKeepAliveIntervalMs = 210_000;

/** The keep-alive of a request that needs none. */
export const noCacheKeepAlive: CacheKeepAlive = { stop: async () => undefined };

/**
 * Sends `send` every interval until stopped, and sums what the sends were billed. A send that
 * fails is ignored: the prefix may then be written again by the next call, which costs money but
 * nothing else, and the request the keep-alive serves is not the one that failed. `stop` waits
 * for a send already in flight, so its usage is not lost, and later calls of `stop` return nothing.
 */
export function keepCacheAlive(
  send: () => Promise<BilledUsage | undefined>,
  options: CacheKeepAliveOptions = {},
): CacheKeepAlive {
  const intervalMs = options.intervalMs ?? defaultCacheKeepAliveIntervalMs;
  let billed: BilledUsage | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    timer = undefined;
    if (stopped) return;
    inFlight = send()
      .then((usage) => {
        if (usage !== undefined) billed = addBilledUsage(billed, usage);
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined;
        if (!stopped) schedule();
      });
  };
  const schedule = () => {
    timer = setTimeout(tick, intervalMs);
    timer.unref?.();
  };
  schedule();

  return {
    stop: async () => {
      if (stopped) return undefined;
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (inFlight !== undefined) await inFlight;
      return billed;
    },
  };
}
