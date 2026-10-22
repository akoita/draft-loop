import type { ModelPricing } from "@draft-loop/providers";

/**
 * Vertex AI prices for a location: the first-party rates times the location's factor, such as the
 * regional premium Google publishes for multi-region and regional endpoints. The deployment gives
 * the factor from Google's price list, so the estimate stays honest when that list changes.
 */
export function vertexPricing(pricing: ModelPricing, locationPriceFactor: number): ModelPricing {
  assertLocationPriceFactor(locationPriceFactor);
  const scale = (rate: number) => rate * locationPriceFactor;
  return {
    inputUsdPerMillionTokens: scale(pricing.inputUsdPerMillionTokens),
    outputUsdPerMillionTokens: scale(pricing.outputUsdPerMillionTokens),
    ...(pricing.cachedInputUsdPerMillionTokens === undefined
      ? {}
      : { cachedInputUsdPerMillionTokens: scale(pricing.cachedInputUsdPerMillionTokens) }),
    ...(pricing.cacheWriteInputUsdPerMillionTokens === undefined
      ? {}
      : { cacheWriteInputUsdPerMillionTokens: scale(pricing.cacheWriteInputUsdPerMillionTokens) }),
    ...(pricing.maxInputTokens === undefined ? {} : { maxInputTokens: pricing.maxInputTokens }),
  };
}

export function assertLocationPriceFactor(locationPriceFactor: number): void {
  if (!Number.isFinite(locationPriceFactor) || locationPriceFactor < 1) {
    throw new RangeError("The Vertex AI location price factor must be a number of at least 1.");
  }
}
