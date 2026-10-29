/** What a failed step's provider call was billed: its tokens and, when known, its cost. */
export interface FailedAttemptCost {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedUsd: number | null;
}

const unbilled: FailedAttemptCost = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedUsd: null,
};

function count(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The billed usage a provider failure carries (#1967): a response the adapter or the application
 * rejected, such as an Opus draft stopped at its output cap, still cost money. Anything malformed
 * reads as unbilled, so a bad value never inflates or corrupts the run's total.
 */
export function failedAttemptCost(error: unknown): FailedAttemptCost {
  const billed = record(record(error)?.billed);
  const usage = record(billed?.usage);
  const cost = record(billed?.cost);
  const inputTokens = count(usage?.inputTokens);
  const outputTokens = count(usage?.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) return unbilled;
  const totalTokens = inputTokens + outputTokens;
  if (!Number.isSafeInteger(totalTokens)) return unbilled;
  const usd = cost?.estimatedUsd;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedUsd: typeof usd === "number" && Number.isFinite(usd) && usd >= 0 ? usd : null,
  };
}
