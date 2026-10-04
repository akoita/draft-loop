import type { RetryOptions } from "@draft-loop/providers";

/** Hosted development models return transient overload errors; retry after ~2.5 s, then ~5 s, plus jitter. */
export const developmentProviderRetry: RetryOptions = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 2500,
  maxDelayMs: 8000,
});
