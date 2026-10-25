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
