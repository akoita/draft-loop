import { describe, expect, it } from "vitest";
import type { ModelProfileReferences } from "./index.js";
import {
  estimateModelProfileApiScenario,
  type ModelProfileApiScenarioInput,
} from "./model-profile-budget.js";

const apiKeyModes = { anthropic: "api-key", openai: "api-key" } as const;
const standard: ModelProfileReferences = {
  author: { id: "standard-anthropic-author", version: 1 },
  critic: { id: "standard-openai-critic", version: 2 },
};
const economy: ModelProfileReferences = {
  author: { id: "economy-anthropic-author", version: 2 },
  critic: { id: "economy-openai-critic", version: 1 },
};
const development: ModelProfileReferences = {
  author: { id: "dev-deepinfra-glm-author", version: 1 },
  critic: { id: "economy-openai-critic", version: 1 },
};

const geminiDevelopment: ModelProfileReferences = {
  author: { id: "dev-google-gemini-author", version: 2 },
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

  it("uses the active economy catalog rates and permits zero calls", () => {
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
      authorUsd: 0.003,
      criticUsd: 0.0015,
      totalUsd: expect.closeTo(0.0045, 10),
    });
  });

  it("accepts the active input-pricing boundary and rejects unsupported limits", () => {
    const boundary = scenario(standard);
    expect(
      estimateModelProfileApiScenario({
        ...boundary,
        author: { inputTokens: 200_000, outputTokens: 32_768, calls: 1 },
      }),
    ).toMatchObject({ status: "available" });
    for (const author of [
      { inputTokens: 200_001, outputTokens: 0, calls: 1 },
      { inputTokens: 0, outputTokens: 32_769, calls: 1 },
    ]) {
      expect(estimateModelProfileApiScenario({ ...boundary, author })).toEqual({
        status: "unavailable",
        reason: "unsupported-pricing-limit",
      });
    }
  });

  it("keeps Haiku 5.5 estimates known up to 100K input tokens and unknown beyond", () => {
    const haiku = scenario(economy);
    expect(
      estimateModelProfileApiScenario({
        ...haiku,
        author: { inputTokens: 100_000, outputTokens: 32_768, calls: 1 },
      }),
    ).toMatchObject({ status: "available" });
    expect(
      estimateModelProfileApiScenario({
        ...haiku,
        author: { inputTokens: 100_001, outputTokens: 0, calls: 1 },
      }),
    ).toEqual({ status: "unavailable", reason: "unsupported-pricing-limit" });
  });

  it("does not price the superseded Sonnet 5.5 economy author version", () => {
    expect(
      estimateModelProfileApiScenario(
        scenario({
          author: { id: "economy-anthropic-author", version: 1 },
          critic: standard.critic,
        }),
      ),
    ).toMatchObject({ status: "unavailable" });
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

  it("checks subscription billing only for providers in the selected profile pair", () => {
    const deepInfraAndOpenAi = {
      ...scenario(development),
      authModes: { anthropic: "user-session", openai: "api-key" } as const,
    };
    expect(estimateModelProfileApiScenario(deepInfraAndOpenAi).status).toBe("available");
    expect(
      estimateModelProfileApiScenario({
        ...deepInfraAndOpenAi,
        authModes: { anthropic: "api-key", openai: "user-session" },
      }),
    ).toEqual({ status: "unavailable", reason: "subscription-billing" });

    expect(
      estimateModelProfileApiScenario({
        ...scenario(standard),
        authModes: { anthropic: "api-key", openai: "user-session" },
      }),
    ).toEqual({ status: "unavailable", reason: "subscription-billing" });
  });

  it("estimates the opt-in Gemini pair and checks subscription billing only for OpenAI", () => {
    const geminiAndOpenAi = {
      ...scenario(geminiDevelopment),
      authModes: { anthropic: "user-session", openai: "api-key" } as const,
    };
    expect(estimateModelProfileApiScenario(geminiAndOpenAi)).toEqual({
      status: "available",
      authorUsd: 0.0225,
      criticUsd: 0.0015,
      totalUsd: 0.024,
    });
    expect(
      estimateModelProfileApiScenario({
        ...geminiAndOpenAi,
        authModes: { anthropic: "api-key", openai: "user-session" },
      }),
    ).toEqual({ status: "unavailable", reason: "subscription-billing" });
  });

  it("does not estimate retired historical profile versions", () => {
    expect(
      estimateModelProfileApiScenario({
        ...scenario(),
        profiles: {
          author: { id: "legacy-anthropic-author", version: 1 },
          critic: standard.critic,
        },
      }),
    ).toEqual({ status: "unavailable", reason: "unknown-profile" });
  });
});
