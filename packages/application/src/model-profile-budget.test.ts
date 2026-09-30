import { describe, expect, it } from "vitest";
import type { ModelProfileReferences } from "./index.js";
import {
  estimateModelProfileApiScenario,
  type ModelProfileApiScenarioInput,
} from "./model-profile-budget.js";

const apiKeyModes = { anthropic: "api-key", openai: "api-key" } as const;
const standard: ModelProfileReferences = {
  author: { id: "standard-anthropic-author", version: 1 },
  critic: { id: "standard-openai-critic", version: 1 },
};
const premium: ModelProfileReferences = {
  author: { id: "premium-anthropic-author", version: 1 },
  critic: { id: "premium-openai-critic", version: 1 },
};
const economy: ModelProfileReferences = {
  author: { id: "legacy-anthropic-author", version: 1 },
  critic: { id: "economy-openai-critic", version: 1 },
};

function scenario(profiles = standard): ModelProfileApiScenarioInput {
  return {
    profiles,
    authModes: apiKeyModes,
    author: { inputTokens: 10_000, outputTokens: 1_000, calls: 2 },
    critic: { inputTokens: 10_000, outputTokens: 1_000, calls: 1 },
  };
}

describe("model profile public API scenario estimates", () => {
  it("uses exact standard rates and reports each role and total", () => {
    expect(estimateModelProfileApiScenario(scenario())).toEqual({
      status: "available",
      authorUsd: 0.12,
      criticUsd: 0.03,
      totalUsd: 0.15,
    });
  });

  it("uses the selected premium and economy catalog rates and permits zero calls", () => {
    expect(estimateModelProfileApiScenario(scenario(premium))).toMatchObject({
      status: "available",
      authorUsd: expect.closeTo(0.3, 8),
      criticUsd: expect.closeTo(0.15, 8),
      totalUsd: expect.closeTo(0.45, 8),
    });
    const zero = scenario(economy);
    expect(
      estimateModelProfileApiScenario({
        ...zero,
        author: { inputTokens: 0, outputTokens: 0, calls: 0 },
        critic: { inputTokens: 0, outputTokens: 0, calls: 0 },
      }),
    ).toEqual({ status: "available", authorUsd: 0, criticUsd: 0, totalUsd: 0 });
    expect(estimateModelProfileApiScenario(scenario(economy))).toMatchObject({
      status: "available",
      authorUsd: 0.09,
      criticUsd: 0.0015,
      totalUsd: 0.0915,
    });
  });

  it("accepts the registered combined context boundary and rejects unsupported limits", () => {
    const sonnet: ModelProfileReferences = {
      author: { id: "legacy-anthropic-author", version: 1 },
      critic: standard.critic,
    };
    const boundary = scenario(sonnet);
    expect(
      estimateModelProfileApiScenario({
        ...boundary,
        author: { inputTokens: 167_232, outputTokens: 32_768, calls: 1 },
      }),
    ).toMatchObject({ status: "available" });
    for (const author of [
      { inputTokens: 200_001, outputTokens: 0, calls: 1 },
      { inputTokens: 0, outputTokens: 32_769, calls: 1 },
      { inputTokens: 200_000, outputTokens: 1, calls: 1 },
    ]) {
      expect(estimateModelProfileApiScenario({ ...boundary, author })).toEqual({
        status: "unavailable",
        reason: "unsupported-pricing-limit",
      });
    }
  });

  it("rejects malformed token counts, empty fields, and excessive planned calls", () => {
    const invalidScenarios: readonly Record<string, unknown>[] = [
      { inputTokens: -1, outputTokens: 0, calls: 1 },
      { inputTokens: 1.5, outputTokens: 0, calls: 1 },
      { inputTokens: Number.NaN, outputTokens: 0, calls: 1 },
      { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 0, calls: 1 },
      { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0, calls: 1 },
      { inputTokens: 0, outputTokens: 0, calls: 1_001 },
      { inputTokens: "", outputTokens: 0, calls: 1 },
      { inputTokens: 0, outputTokens: 0, calls: 1, unexpected: true },
    ];
    for (const author of invalidScenarios) {
      expect(
        estimateModelProfileApiScenario({
          ...scenario(),
          author,
        } as unknown as ModelProfileApiScenarioInput),
      ).toEqual({ status: "unavailable", reason: "invalid-scenario" });
    }
    expect(
      estimateModelProfileApiScenario({
        ...scenario(),
        critic: { inputTokens: 0, outputTokens: Number.NEGATIVE_INFINITY, calls: 1 },
      }),
    ).toEqual({ status: "unavailable", reason: "invalid-scenario" });
  });

  it("fails closed for unknown or wrong-role profiles and unavailable authentication routes", () => {
    expect(
      estimateModelProfileApiScenario({
        ...scenario(),
        profiles: {
          author: { id: "missing", version: 1 },
          critic: standard.critic,
        },
      }),
    ).toEqual({ status: "unavailable", reason: "unknown-profile" });
    expect(
      estimateModelProfileApiScenario({
        ...scenario(),
        profiles: { author: standard.critic, critic: standard.critic },
      }),
    ).toEqual({ status: "unavailable", reason: "unknown-profile" });
    expect(
      estimateModelProfileApiScenario({
        profiles: standard,
        author: { inputTokens: 10_000, outputTokens: 1_000, calls: 2 },
        critic: { inputTokens: 10_000, outputTokens: 1_000, calls: 1 },
      }),
    ).toEqual({ status: "unavailable", reason: "authentication-unavailable" });
    expect(
      estimateModelProfileApiScenario({
        ...scenario(),
        authModes: { anthropic: "api-key", openai: "user-session" },
      }),
    ).toEqual({ status: "unavailable", reason: "subscription-billing" });
    expect(estimateModelProfileApiScenario({ ...scenario(), authModes: null as never })).toEqual({
      status: "unavailable",
      reason: "authentication-unavailable",
    });
    expect(
      estimateModelProfileApiScenario({
        ...scenario(),
        authModes: { anthropic: "oauth", openai: "api-key" } as never,
      }),
    ).toEqual({ status: "unavailable", reason: "authentication-unavailable" });
  });
});
