import { plural, t } from "@lingui/core/macro";

/**
 * What a career profile derivation's model calls used (#2815): content-free totals, failed calls
 * included. `estimatedUsd` is null when a model has no price.
 */
export interface ProfileDerivationUsage {
  readonly calls: number;
  readonly failedCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedUsd: number | null;
}

const usageKeys = new Set(["calls", "failedCalls", "inputTokens", "outputTokens", "estimatedUsd"]);
const maximumCount = 1_000_000_000;

function count(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumCount
    ? value
    : undefined;
}

/** Reads a host's usage; undefined when absent, and a throw from `invalid` when malformed. */
export function normalizeProfileDerivationUsage(
  value: unknown,
  invalid: () => never,
): ProfileDerivationUsage | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => usageKeys.has(key))) return invalid();
  const calls = count(record.calls);
  const failedCalls = count(record.failedCalls);
  const inputTokens = count(record.inputTokens);
  const outputTokens = count(record.outputTokens);
  const estimatedUsd =
    record.estimatedUsd === null
      ? null
      : typeof record.estimatedUsd === "number" &&
          Number.isFinite(record.estimatedUsd) &&
          record.estimatedUsd >= 0
        ? record.estimatedUsd
        : undefined;
  if (
    calls === undefined ||
    failedCalls === undefined ||
    failedCalls > calls ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    estimatedUsd === undefined
  ) {
    return invalid();
  }
  return { calls, failedCalls, inputTokens, outputTokens, estimatedUsd };
}

function formatUsd(usd: number): string {
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

/** One line for the profile page, such as "3 model calls, 52,400 tokens, about $0.08." */
export function profileDerivationUsageSummary(usage: ProfileDerivationUsage): string {
  const tokens = (usage.inputTokens + usage.outputTokens).toLocaleString();
  const calls = plural(usage.calls, { one: "# model call", other: "# model calls" });
  const failed =
    usage.failedCalls === 0
      ? ""
      : ` ${plural(usage.failedCalls, { one: "(# failed)", other: "(# failed)" })}`;
  return usage.estimatedUsd === null
    ? t`${calls}${failed}, ${tokens} tokens; the cost is unknown for this model.`
    : t`${calls}${failed}, ${tokens} tokens, about ${formatUsd(usage.estimatedUsd)}.`;
}
