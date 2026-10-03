import type { ModelProfile } from "@draft-loop/domain/model-profile";

import { deepInfraGLMCompany, deepInfraGLMModelId } from "@draft-loop/providers";
import { createDeepInfraGLMAuthorProfile, isDeepInfraGLMModel } from "./glm-development-profile.js";

export { isDeepInfraGLMModel };

export const deepInfraGLMExtractionProfileId = "dev-deepinfra-glm-extraction" as const;

/** A detached profile for canonical extraction with provider reasoning disabled. */
export function createDeepInfraGLMExtractionProfile(): ModelProfile {
  const authorProfile = createDeepInfraGLMAuthorProfile();
  return {
    ...authorProfile,
    id: deepInfraGLMExtractionProfileId,
    runtime: {
      ...authorProfile.runtime,
      effort: "provider-default",
      thinking: { mode: "disabled" },
    },
  };
}

export { createDeepInfraGLMExtractionProfile as createGLMExtractionProfile };

export function isDeepInfraGLMExtractionProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  return (
    profile.id === deepInfraGLMExtractionProfileId &&
    profile.version === 1 &&
    profile.provider === deepInfraGLMCompany &&
    profile.modelId === deepInfraGLMModelId &&
    profile.tier === "economy" &&
    profile.roles.length === 1 &&
    profile.roles[0] === "author" &&
    profile.runtime.effort === "provider-default" &&
    profile.runtime.maxOutputTokens === 32768 &&
    profile.runtime.thinking.mode === "disabled" &&
    profile.knownLimits.maxOutputTokens === 131072 &&
    profile.knownLimits.contextWindowTokens === 1048576
  );
}
