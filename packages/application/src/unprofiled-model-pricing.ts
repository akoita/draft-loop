import type { ModelPricing } from "@draft-loop/providers";

import type { ModelProfileCatalogPricing } from "./model-profile-catalog.js";

interface UnprofiledModelRates {
  readonly provider: string;
  readonly modelId: string;
  readonly sources: readonly string[];
  readonly reviewedAt: string;
  readonly apiPricing: Omit<ModelProfileCatalogPricing, "scope">;
}

const anthropicPricing = "https://platform.claude.com/docs/en/about-claude/pricing";
const anthropicModelsOverview = "https://platform.claude.com/docs/en/about-claude/models/overview";

/**
 * API rates for models no profile offers, so a server-side retry on one is still priced. No run
 * can choose these models: they are not in the model profile catalog or any preset.
 */
const unprofiledModelRates: readonly UnprofiledModelRates[] = [
  {
    // Claude's refusal fallback for claude-sonnet-5-5 (#3275). Sonnet 5 keeps the 0.1x cache-read
    // multiplier Sonnet 5.5 lowered; a retried author request writes a five-minute cache, 1.25x.
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    sources: [anthropicModelsOverview, anthropicPricing],
    reviewedAt: "2026-11-23",
    apiPricing: {
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10,
      cacheReadUsdPerMillion: 0.2,
      cacheWriteUsdPerMillion: 2.5,
      // Claude 4.6 and later (except Haiku 5.5) bill the whole 1M-token window at standard rates.
      maxInputTokens: 1000000,
    },
  },
];

/** The rates of a model no profile offers, in the adapter's shape, or undefined when unlisted. */
export function unprofiledModelPricing(
  provider: string,
  modelId: string,
): ModelPricing | undefined {
  const entry = unprofiledModelRates.find(
    (rates) => rates.provider === provider && rates.modelId === modelId,
  );
  if (entry === undefined) return undefined;
  const { apiPricing } = entry;
  return {
    inputUsdPerMillionTokens: apiPricing.inputUsdPerMillion,
    outputUsdPerMillionTokens: apiPricing.outputUsdPerMillion,
    cachedInputUsdPerMillionTokens:
      apiPricing.cacheReadUsdPerMillion ?? apiPricing.inputUsdPerMillion,
    ...(apiPricing.cacheWriteUsdPerMillion === undefined
      ? {}
      : { cacheWriteInputUsdPerMillionTokens: apiPricing.cacheWriteUsdPerMillion }),
    maxInputTokens: apiPricing.maxInputTokens,
  };
}
