import { describe, expect, it } from "vitest";

import { listModelProfileCatalog } from "./model-profile-catalog.js";
import { unprofiledModelPricing } from "./unprofiled-model-pricing.js";

describe("rates for models no profile offers", () => {
  it("prices the refusal fallback claude-sonnet-5", () => {
    expect(unprofiledModelPricing("anthropic", "claude-sonnet-5")).toEqual({
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 10,
      cachedInputUsdPerMillionTokens: 0.2,
      cacheWriteInputUsdPerMillionTokens: 2.5,
      maxInputTokens: 1000000,
    });
    expect(unprofiledModelPricing("openai", "claude-sonnet-5")).toBeUndefined();
    expect(unprofiledModelPricing("anthropic", "claude-sonnet-5-5")).toBeUndefined();
  });

  it("offers no profile a run could choose for those models", () => {
    const offered = listModelProfileCatalog().map((entry) => entry.profile.modelId);
    expect(offered).not.toContain("claude-sonnet-5");
  });
});
