import { describe, expect, it } from "vitest";

import { modelConfigurationSchema, modelSelectionSchema } from "./index.js";

const authorProfile = {
  id: "author-profile-v2",
  version: 2,
  provider: "anthropic",
  modelId: "claude-exact",
  tier: "standard",
  roles: ["author"],
  runtime: {
    effort: "high",
    maxOutputTokens: 4_000,
    thinking: { mode: "budgeted", maxTokens: 1_000 },
  },
  knownLimits: { maxOutputTokens: 8_000, contextWindowTokens: 32_000 },
};

const authorSelection = {
  company: "anthropic",
  modelId: "claude-exact",
  role: "author",
  promptTemplateVersion: "author-v3",
  profile: authorProfile,
};

describe("model selection profile schema", () => {
  it("round-trips the complete profile beside the prompt version in model configuration JSON", () => {
    const parsed = modelConfigurationSchema.parse({
      author: authorSelection,
      critic: {
        company: "openai",
        modelId: "gpt-exact",
        role: "critic",
        promptTemplateVersion: "critic-v2",
      },
      requireProviderDiversity: true,
    });
    const restored = modelConfigurationSchema.parse(JSON.parse(JSON.stringify(parsed)));

    expect(restored).toEqual(parsed);
    expect(restored.author.promptTemplateVersion).toBe("author-v3");
    expect(restored.author.profile).toEqual(authorProfile);
  });

  it.each([
    ["unknown profile keys", { ...authorProfile, extra: true }],
    [
      "invalid runtime budgets",
      {
        ...authorProfile,
        runtime: { ...authorProfile.runtime, maxOutputTokens: 0 },
      },
    ],
    [
      "thinking budgets above the output ceiling",
      {
        ...authorProfile,
        runtime: {
          ...authorProfile.runtime,
          maxOutputTokens: 1_000,
          thinking: { mode: "budgeted", maxTokens: 1_001 },
        },
        knownLimits: { maxOutputTokens: 2_000 },
      },
    ],
  ])("rejects %s", (_case, profile) => {
    expect(modelSelectionSchema.safeParse({ ...authorSelection, profile }).success).toBe(false);
  });

  it.each([
    ["provider", { provider: "openai" }],
    ["exact model id", { modelId: "claude-other" }],
    ["role", { roles: ["critic"] }],
  ])("rejects a profile whose %s disagrees with its selection", (_case, override) => {
    const profile = { ...authorProfile, ...override };

    expect(modelSelectionSchema.safeParse({ ...authorSelection, profile }).success).toBe(false);
  });
});
