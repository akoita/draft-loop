import type { ModelCost, ModelPricing, ModelUsage } from "./index.js";

export interface OpenAIUsageAccounting {
  readonly usage: ModelUsage;
  readonly cost: ModelCost;
}

interface DetailCount {
  readonly present: boolean;
  readonly valid: boolean;
  readonly value?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function count(source: Record<string, unknown>, key: string): DetailCount {
  if (!Object.hasOwn(source, key)) return { present: false, valid: true };
  const value = source[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { present: true, valid: false };
  }
  return { present: true, valid: true, value };
}

function details(value: unknown): {
  readonly values?: Record<string, unknown>;
  readonly valid: boolean;
} {
  if (value === undefined) return { valid: true };
  const values = record(value);
  return values === undefined ? { valid: false } : { values, valid: true };
}

function validRate(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function usageCost(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  cacheWriteInputTokens: number,
  pricing: ModelPricing | undefined,
): number | null {
  if (
    pricing === undefined ||
    !validRate(pricing.inputUsdPerMillionTokens) ||
    !validRate(pricing.outputUsdPerMillionTokens) ||
    (cachedInputTokens > 0 && !validRate(pricing.cachedInputUsdPerMillionTokens)) ||
    (cacheWriteInputTokens > 0 && !validRate(pricing.cacheWriteInputUsdPerMillionTokens))
  ) {
    return null;
  }
  const standardInput = inputTokens - cachedInputTokens - cacheWriteInputTokens;
  const inputCost =
    standardInput * pricing.inputUsdPerMillionTokens +
    cachedInputTokens * (pricing.cachedInputUsdPerMillionTokens ?? 0) +
    cacheWriteInputTokens * (pricing.cacheWriteInputUsdPerMillionTokens ?? 0);
  const estimated = (inputCost + outputTokens * pricing.outputUsdPerMillionTokens) / 1_000_000;
  return Number.isFinite(estimated) ? estimated : null;
}

/** Account for OpenAI's reported token details without making valid output depend on billing metadata. */
export function accountOpenAIUsage(
  value: unknown,
  pricing: ModelPricing | undefined,
): OpenAIUsageAccounting {
  const usageValue = record(value);
  if (usageValue === undefined) {
    return {
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { estimatedUsd: null },
    };
  }

  const rawInput = count(usageValue, "input_tokens");
  const rawOutput = count(usageValue, "output_tokens");
  const rawTotal = count(usageValue, "total_tokens");
  const inputTokens = rawInput.valid ? (rawInput.value ?? 0) : 0;
  const outputTokens = rawOutput.valid ? (rawOutput.value ?? 0) : 0;
  const totalTokens = inputTokens + outputTokens;
  if (!Number.isSafeInteger(totalTokens)) {
    return {
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { estimatedUsd: null },
    };
  }

  const inputDetails = details(usageValue.input_tokens_details);
  const outputDetails = details(usageValue.output_tokens_details);
  const cached =
    inputDetails.values === undefined
      ? ({ present: false, valid: inputDetails.valid } satisfies DetailCount)
      : count(inputDetails.values, "cached_tokens");
  const cacheWrite =
    inputDetails.values === undefined
      ? ({ present: false, valid: inputDetails.valid } satisfies DetailCount)
      : count(inputDetails.values, "cache_write_tokens");
  const reasoning =
    outputDetails.values === undefined
      ? ({ present: false, valid: outputDetails.valid } satisfies DetailCount)
      : count(outputDetails.values, "reasoning_tokens");

  let cachedInputTokens = cached.valid ? (cached.value ?? 0) : 0;
  let cacheWriteInputTokens = cacheWrite.valid ? (cacheWrite.value ?? 0) : 0;
  let reasoningOutputTokens = reasoning.valid ? (reasoning.value ?? 0) : 0;
  let accountingValid =
    rawInput.present &&
    rawInput.valid &&
    rawOutput.present &&
    rawOutput.valid &&
    (!rawTotal.present || (rawTotal.valid && rawTotal.value === totalTokens)) &&
    inputDetails.valid &&
    outputDetails.valid &&
    (!cached.present || cached.valid) &&
    (!cacheWrite.present || cacheWrite.valid) &&
    (!reasoning.present || reasoning.valid);

  let includeCached = cached.present && cached.valid && cachedInputTokens <= inputTokens;
  let includeCacheWrite =
    cacheWrite.present && cacheWrite.valid && cacheWriteInputTokens <= inputTokens;
  if (
    cachedInputTokens > inputTokens ||
    cacheWriteInputTokens > inputTokens ||
    cachedInputTokens + cacheWriteInputTokens > inputTokens
  ) {
    cachedInputTokens = 0;
    cacheWriteInputTokens = 0;
    includeCached = false;
    includeCacheWrite = false;
    accountingValid = false;
  }
  const includeReasoning =
    reasoning.present && reasoning.valid && reasoningOutputTokens <= outputTokens;
  if (reasoningOutputTokens > outputTokens) {
    reasoningOutputTokens = 0;
    accountingValid = false;
  }

  const resultUsage: ModelUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(includeCached ? { cachedInputTokens } : {}),
    ...(includeCacheWrite ? { cacheWriteInputTokens } : {}),
    ...(includeReasoning ? { reasoningOutputTokens } : {}),
  };
  const estimate = accountingValid
    ? usageCost(inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens, pricing)
    : null;
  return { usage: resultUsage, cost: { estimatedUsd: estimate } };
}
