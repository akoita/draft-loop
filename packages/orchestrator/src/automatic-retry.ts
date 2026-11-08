import type { RunSnapshot } from "./index.js";

/**
 * Failures a later attempt can pass without the person: a rate limit, a timeout, a provider fault
 * and an output DraftLoop rejected. An authentication failure is retryable by the person once they
 * fix the credential, so it is left to them.
 */
const automaticRetryCodes: ReadonlySet<string> = new Set([
  "rate-limit",
  "timeout",
  "transient",
  "invalid-response",
]);

/**
 * A failed run a host retries without the person, as the hosted worker does (#1763). A failure is
 * retryable only while its step has attempts left, so the retries stop at the step's budget.
 */
export function retriesAutomatically(snapshot: RunSnapshot): boolean {
  return (
    snapshot.state === "provider-error" &&
    snapshot.lastError !== null &&
    automaticRetryCodes.has(snapshot.lastError.code) &&
    snapshot.lastError.retryable
  );
}

/** How long a host waits before it retries a failed step without the person. */
export interface AutomaticRetryDelays {
  /** The least wait after a rate limit, which can outlast the provider's hint. */
  readonly rateLimitMs: number;
  /** The least wait after any other retryable failure. */
  readonly failureMs: number;
}

export const defaultAutomaticRetryDelays: AutomaticRetryDelays = Object.freeze({
  rateLimitMs: 60 * 1000,
  failureMs: 10 * 1000,
});

/**
 * When a host's automatic retry of the failed step starts: the later of the provider's retry time
 * and a fixed wait after `from`. The worker counts from when its job ends; a screen counts from
 * when the run failed, which is the same moment, so both name the same time.
 */
export function automaticRetryTime(
  snapshot: RunSnapshot,
  from: Date,
  delays: AutomaticRetryDelays = defaultAutomaticRetryDelays,
): Date {
  const notBefore = Date.parse(snapshot.lastError?.retryNotBefore ?? "");
  const wait = snapshot.lastError?.code === "rate-limit" ? delays.rateLimitMs : delays.failureMs;
  const fixed = from.getTime() + wait;
  return new Date(Number.isNaN(notBefore) ? fixed : Math.max(notBefore, fixed));
}
