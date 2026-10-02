import { describe, expect, it } from "vitest";

import { accountOpenAIUsage } from "./openai-usage.js";

const standardPricing = {
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 10,
};

describe("OpenAI cache-aware usage accounting", () => {
  it("prices standard, cached, cache-write, and reasoning usage without double-counting output", () => {
    expect(
      accountOpenAIUsage(
        {
          input_tokens: 100,
          output_tokens: 40,
          input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
          output_tokens_details: { reasoning_tokens: 15 },
        },
        {
          ...standardPricing,
          cachedInputUsdPerMillionTokens: 1,
          cacheWriteInputUsdPerMillionTokens: 4,
        },
      ),
    ).toEqual({
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        cachedInputTokens: 20,
        cacheWriteInputTokens: 10,
        reasoningOutputTokens: 15,
      },
      cost: { estimatedUsd: 0.0006 },
    });
  });

  it("preserves legacy estimates without details and reports unknown cost for missing cache rates", () => {
    expect(accountOpenAIUsage({ input_tokens: 13, output_tokens: 5 }, standardPricing)).toEqual({
      usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 },
      cost: { estimatedUsd: 0.000076 },
    });
    expect(
      accountOpenAIUsage(
        { input_tokens: 13, output_tokens: 5, input_tokens_details: { cached_tokens: 3 } },
        standardPricing,
      ),
    ).toEqual({
      usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18, cachedInputTokens: 3 },
      cost: { estimatedUsd: null },
    });
  });

  it("keeps valid totals and omits malformed details without invalidating output", () => {
    expect(
      accountOpenAIUsage(
        {
          input_tokens: 13,
          output_tokens: 5,
          input_tokens_details: { cached_tokens: 14, cache_write_tokens: 2 },
          output_tokens_details: { reasoning_tokens: 6 },
        },
        standardPricing,
      ),
    ).toEqual({
      usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 },
      cost: { estimatedUsd: null },
    });
  });

  it("retains independently valid subdivisions but makes cost unknown when another is malformed", () => {
    expect(
      accountOpenAIUsage(
        {
          input_tokens: 10,
          output_tokens: 4,
          input_tokens_details: { cached_tokens: 2, cache_write_tokens: -1 },
          output_tokens_details: { reasoning_tokens: 1 },
        },
        standardPricing,
      ),
    ).toEqual({
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cachedInputTokens: 2,
        reasoningOutputTokens: 1,
      },
      cost: { estimatedUsd: null },
    });
  });

  it("does not overflow totals or accept unsafe and non-finite counts", () => {
    expect(
      accountOpenAIUsage(
        { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 },
        standardPricing,
      ),
    ).toEqual({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { estimatedUsd: null },
    });
    expect(
      accountOpenAIUsage(
        { input_tokens: 1.5, output_tokens: Number.POSITIVE_INFINITY },
        standardPricing,
      ),
    ).toEqual({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { estimatedUsd: null },
    });
  });

  it("keeps computed totals but leaves cost unknown when the reported aggregate disagrees", () => {
    expect(
      accountOpenAIUsage({ input_tokens: 9, output_tokens: 4, total_tokens: 12 }, standardPricing),
    ).toEqual({
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
      cost: { estimatedUsd: null },
    });
  });

  it("keeps missing usage compatible but leaves its cost unknown", () => {
    expect(accountOpenAIUsage(undefined, standardPricing)).toEqual({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { estimatedUsd: null },
    });
  });

  it("leaves estimates unknown when supplied rates overflow arithmetic", () => {
    expect(
      accountOpenAIUsage(
        { input_tokens: Number.MAX_SAFE_INTEGER - 1, output_tokens: 0 },
        { inputUsdPerMillionTokens: 1e308, outputUsdPerMillionTokens: 0 },
      ),
    ).toEqual({
      usage: {
        inputTokens: Number.MAX_SAFE_INTEGER - 1,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER - 1,
      },
      cost: { estimatedUsd: null },
    });
  });
});
