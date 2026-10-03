import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { deepInfraGLMCompany, deepInfraGLMModelId } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { createDeepInfraGLMAuthorProfile } from "./glm-development-profile.js";
import {
  createDeepInfraGLMExtractionProfile,
  deepInfraGLMExtractionProfileId,
  isDeepInfraGLMExtractionProfile,
} from "./glm-extraction-profile.js";

describe("DeepInfra GLM extraction profile", () => {
  it("creates detached disabled-reasoning controls without changing the author profile", () => {
    const authorProfile = createDeepInfraGLMAuthorProfile();
    const authorSnapshot = structuredClone(authorProfile);
    const extractionProfile = createDeepInfraGLMExtractionProfile();

    expect(extractionProfile).toEqual({
      id: deepInfraGLMExtractionProfileId,
      version: 1,
      provider: deepInfraGLMCompany,
      modelId: deepInfraGLMModelId,
      tier: "economy",
      roles: ["author"],
      runtime: {
        effort: "provider-default",
        maxOutputTokens: 32768,
        thinking: { mode: "disabled" },
      },
      knownLimits: { maxOutputTokens: 131072, contextWindowTokens: 1048576 },
    });
    expect(extractionProfile).not.toBe(authorProfile);
    expect(extractionProfile.runtime).not.toBe(authorProfile.runtime);
    expect(authorProfile).toEqual(authorSnapshot);
    expect(isDeepInfraGLMExtractionProfile(extractionProfile)).toBe(true);
  });

  it("rejects changes to any pinned profile identity or control", () => {
    const profile = createDeepInfraGLMExtractionProfile();
    const mutations: readonly ModelProfile[] = [
      { ...profile, id: "other-profile" },
      { ...profile, version: 2 },
      { ...profile, provider: "anthropic" },
      { ...profile, modelId: "other-model" },
      { ...profile, tier: "standard" },
      { ...profile, roles: ["author", "critic"] },
      { ...profile, runtime: { ...profile.runtime, effort: "low" } },
      { ...profile, runtime: { ...profile.runtime, maxOutputTokens: 8192 } },
      {
        ...profile,
        runtime: { ...profile.runtime, thinking: { mode: "provider-default" } },
      },
      { ...profile, knownLimits: { ...profile.knownLimits, maxOutputTokens: 65536 } },
      { ...profile, knownLimits: { ...profile.knownLimits, contextWindowTokens: 200000 } },
    ];

    expect(isDeepInfraGLMExtractionProfile(undefined)).toBe(false);
    for (const mutation of mutations) {
      expect(isDeepInfraGLMExtractionProfile(mutation)).toBe(false);
    }
  });
});
