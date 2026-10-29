import type { BilledUsage, ModelUsage } from "./index.js";

function addOptional(
  key: "cachedInputTokens" | "cacheWriteInputTokens" | "reasoningOutputTokens",
  first: ModelUsage,
  second: ModelUsage,
): Partial<ModelUsage> {
  if (first[key] === undefined && second[key] === undefined) return {};
  return { [key]: (first[key] ?? 0) + (second[key] ?? 0) };
}

/**
 * The usage of two billed calls together. The cost stays unknown when either one's is, so a run
 * never shows a partial sum as its cost.
 */
export function addBilledUsage(first: BilledUsage | undefined, second: BilledUsage): BilledUsage;
export function addBilledUsage(
  first: BilledUsage | undefined,
  second: BilledUsage | undefined,
): BilledUsage | undefined;
export function addBilledUsage(
  first: BilledUsage | undefined,
  second: BilledUsage | undefined,
): BilledUsage | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  const a = first.usage;
  const b = second.usage;
  return {
    usage: {
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      totalTokens: a.totalTokens + b.totalTokens,
      ...addOptional("cachedInputTokens", a, b),
      ...addOptional("cacheWriteInputTokens", a, b),
      ...addOptional("reasoningOutputTokens", a, b),
    },
    cost: {
      estimatedUsd:
        first.cost.estimatedUsd === null || second.cost.estimatedUsd === null
          ? null
          : first.cost.estimatedUsd + second.cost.estimatedUsd,
    },
  };
}
