import type { ModelProfile, ModelProfileThinking } from "@draft-loop/domain/model-profile";
import { describe, expect, it } from "vitest";
import { modelProfileSchema } from "./model-profile.js";

function fictionalProfile(
  thinking: ModelProfileThinking = { mode: "provider-default" },
): ModelProfile {
  return {
    id: "fictional-author-profile",
    version: 2,
    provider: "fictional-labs",
    modelId: "fictional-model-r7",
    tier: "standard",
    roles: ["author", "critic"],
    runtime: {
      effort: "medium",
      maxOutputTokens: 8_000,
      thinking,
    },
    knownLimits: {
      maxOutputTokens: 12_000,
      contextWindowTokens: 24_000,
    },
  };
}

describe("model profile schema", () => {
  it("round-trips the versioned framework-free contract and accepts each thinking mode", () => {
    const profiles = [
      fictionalProfile({ mode: "provider-default" }),
      fictionalProfile({ mode: "disabled" }),
      fictionalProfile({ mode: "budgeted", maxTokens: 2_000 }),
    ];

    for (const profile of profiles) {
      const parsed = modelProfileSchema.parse(profile);
      expect(parsed).toEqual(profile);
      expect(modelProfileSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    }
  });

  it("trims identity strings and permits context and output limits to remain independent", () => {
    const input = {
      ...fictionalProfile(),
      id: "  fictional-profile  ",
      provider: "  fictional-labs  ",
      modelId: "  fictional-model-r8  ",
      knownLimits: { maxOutputTokens: 12_000, contextWindowTokens: 1_000 },
    };

    expect(modelProfileSchema.parse(input)).toMatchObject({
      id: "fictional-profile",
      provider: "fictional-labs",
      modelId: "fictional-model-r8",
      runtime: { maxOutputTokens: 8_000 },
      knownLimits: { maxOutputTokens: 12_000, contextWindowTokens: 1_000 },
    });
  });

  it("rejects empty, duplicate, or unsupported roles and unknown enum values", () => {
    const profile = fictionalProfile();
    expect(modelProfileSchema.safeParse({ ...profile, roles: [] }).success).toBe(false);
    expect(modelProfileSchema.safeParse({ ...profile, roles: ["author", "author"] }).success).toBe(
      false,
    );
    expect(modelProfileSchema.safeParse({ ...profile, roles: ["reviewer"] }).success).toBe(false);
    expect(modelProfileSchema.safeParse({ ...profile, tier: "reference" }).success).toBe(false);
    expect(
      modelProfileSchema.safeParse({
        ...profile,
        runtime: { ...profile.runtime, effort: "extreme" },
      }).success,
    ).toBe(false);
    expect(
      modelProfileSchema.safeParse({
        ...profile,
        runtime: { ...profile.runtime, thinking: { mode: "automatic" } },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown properties at every object level", () => {
    const profile = fictionalProfile();
    expect(modelProfileSchema.safeParse({ ...profile, surprise: true }).success).toBe(false);
    expect(
      modelProfileSchema.safeParse({
        ...profile,
        runtime: { ...profile.runtime, surprise: true },
      }).success,
    ).toBe(false);
    expect(
      modelProfileSchema.safeParse({
        ...profile,
        runtime: { ...profile.runtime, thinking: { mode: "disabled", surprise: true } },
      }).success,
    ).toBe(false);
    expect(
      modelProfileSchema.safeParse({
        ...profile,
        knownLimits: { ...profile.knownLimits, surprise: true },
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe and nonpositive integers for version and token limits", () => {
    const profile = fictionalProfile();
    const invalidIntegers = [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
    for (const value of invalidIntegers) {
      expect(modelProfileSchema.safeParse({ ...profile, version: value }).success).toBe(false);
      expect(
        modelProfileSchema.safeParse({
          ...profile,
          runtime: { ...profile.runtime, maxOutputTokens: value },
        }).success,
      ).toBe(false);
      expect(
        modelProfileSchema.safeParse({
          ...profile,
          knownLimits: { ...profile.knownLimits, maxOutputTokens: value },
        }).success,
      ).toBe(false);
      expect(
        modelProfileSchema.safeParse({
          ...profile,
          knownLimits: { ...profile.knownLimits, contextWindowTokens: value },
        }).success,
      ).toBe(false);
      expect(
        modelProfileSchema.safeParse({
          ...profile,
          runtime: { ...profile.runtime, thinking: { mode: "budgeted", maxTokens: value } },
        }).success,
      ).toBe(false);
    }
    expect(modelProfileSchema.safeParse({ ...profile, id: "  " }).success).toBe(false);
    expect(modelProfileSchema.safeParse({ ...profile, provider: "  " }).success).toBe(false);
    expect(modelProfileSchema.safeParse({ ...profile, modelId: "  " }).success).toBe(false);
  });

  it("enforces output and thinking budgets against their declared runtime bounds", () => {
    const profile = fictionalProfile();
    expect(
      modelProfileSchema.safeParse({
        ...profile,
        runtime: { ...profile.runtime, maxOutputTokens: 12_001 },
      }).success,
    ).toBe(false);
    expect(
      modelProfileSchema.safeParse({
        ...profile,
        runtime: {
          ...profile.runtime,
          thinking: { mode: "budgeted", maxTokens: 8_001 },
        },
      }).success,
    ).toBe(false);
  });
});
