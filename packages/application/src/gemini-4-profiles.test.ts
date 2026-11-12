import { describe, expect, it } from "vitest";
import { canonicalExtractionProfileFor } from "./canonical-extraction-profile.js";
import { canonicalProfileRequest } from "./canonical-profile-provider-request.js";
import {
  createGoogleGemini4AuthorProfiles,
  createGoogleGemini4ExtractionProfile,
  isGoogleGemini4AuthorProfile,
  isGoogleGemini4ExtractionProfile,
} from "./gemini-4-profiles.js";
import { getModelProfilePreset, listModelProfileCatalog } from "./model-profile-catalog.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import { catalogModelPricing } from "./provider-model-pricing.js";
import { validateProfileRoute } from "./run-model-profiles.js";

const authModes = { anthropic: "api-key", openai: "api-key" } as const;

describe("Gemini 4 author profiles", () => {
  it.each([
    ["balanced-google-author", "gemini-4-hydrogen", "high"],
    ["standard-google-author", "gemini-4-carbon", "medium"],
    ["standard-google-argon-author", "gemini-4-argon", "medium"],
  ] as const)("registers %s for %s at its default level", (id, modelId, effort) => {
    const profile = defaultModelProfileRegistry.resolve(id, 1, "author");

    expect(profile).toMatchObject({
      provider: "google",
      modelId,
      tier: "standard",
      roles: ["author"],
      runtime: { effort, maxOutputTokens: 65536, thinking: { mode: "provider-default" } },
      knownLimits: { maxOutputTokens: 65536, contextWindowTokens: 1048576 },
    });
    expect(isGoogleGemini4AuthorProfile(profile)).toBe(true);
    expect(() => validateProfileRoute(profile, authModes)).not.toThrow();
  });

  it("refuses a Gemini 4 profile that was altered", () => {
    const [hydrogen] = createGoogleGemini4AuthorProfiles();
    if (hydrogen === undefined) throw new Error("missing profile");

    for (const altered of [
      { ...hydrogen, modelId: "gemini-4-carbon" },
      { ...hydrogen, runtime: { ...hydrogen.runtime, effort: "low" as const } },
      { ...hydrogen, runtime: { ...hydrogen.runtime, thinking: { mode: "disabled" as const } } },
      { ...hydrogen, roles: ["critic" as const] },
    ]) {
      expect(isGoogleGemini4AuthorProfile(altered)).toBe(false);
      expect(() => validateProfileRoute(altered, authModes)).toThrow();
    }
  });

  it("pairs Hydrogen with the Balanced reviewer and Carbon with the Standard reviewer", () => {
    expect(getModelProfilePreset("balanced-google")).toMatchObject({
      author: { id: "balanced-google-author", version: 1 },
      critic: { id: "balanced-openai-critic", version: 1 },
    });
    expect(getModelProfilePreset("standard-google")).toMatchObject({
      author: { id: "standard-google-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 2 },
    });
  });

  it("lists Argon for a custom pair without a preset", () => {
    const argon = listModelProfileCatalog().find(
      ({ profile }) => profile.id === "standard-google-argon-author",
    );

    expect(argon?.profile.modelId).toBe("gemini-4-argon");
    expect(argon?.apiPricing).toMatchObject({
      inputUsdPerMillion: 4,
      outputUsdPerMillion: 20,
      cacheReadUsdPerMillion: 0.2,
    });
  });

  it("prices a Hydrogen call from the catalog", () => {
    const profile = defaultModelProfileRegistry.resolve("balanced-google-author", 1, "author");

    expect(
      catalogModelPricing({
        company: "google",
        modelId: "gemini-4-hydrogen",
        role: "author",
        promptTemplateVersion: "author-v1",
        profile,
      }),
    ).toMatchObject({
      inputUsdPerMillionTokens: 1.5,
      outputUsdPerMillionTokens: 7.5,
      cachedInputUsdPerMillionTokens: 0.075,
      maxInputTokens: 1000000,
    });
  });

  it("extracts at the lowest thinking level, never with thinking disabled", () => {
    const extraction = canonicalExtractionProfileFor("google", "gemini-4-carbon");

    expect(extraction).toMatchObject({
      id: "google-gemini-4-extraction",
      modelId: "gemini-4-carbon",
      runtime: { effort: "low", thinking: { mode: "provider-default" } },
    });
    if (extraction === undefined) throw new Error("missing extraction profile");
    expect(isGoogleGemini4ExtractionProfile(extraction)).toBe(true);
    expect(createGoogleGemini4ExtractionProfile("gemini-3.8-flash")).toBeUndefined();
    expect(
      canonicalProfileRequest(
        { company: "google", modelId: "gemini-4-carbon", profile: extraction },
        "api-key",
      ).maxOutputTokens,
    ).toBe(65536);
  });
});
