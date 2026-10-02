import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { deepInfraGLMCompany, deepInfraGLMModelId } from "@draft-loop/providers";

export const deepInfraGLMAuthorProfileId = "dev-deepinfra-glm-author" as const;

export function isDeepInfraGLMModel(company: string, modelId: string): boolean {
  return company === deepInfraGLMCompany && modelId === deepInfraGLMModelId;
}

/** A detached explicit development profile; it is not an active catalog preset. */
export function createDeepInfraGLMAuthorProfile(): ModelProfile {
  return {
    id: deepInfraGLMAuthorProfileId,
    version: 1,
    provider: deepInfraGLMCompany,
    modelId: deepInfraGLMModelId,
    tier: "economy",
    roles: ["author"],
    runtime: {
      effort: "low",
      maxOutputTokens: 32768,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 131072, contextWindowTokens: 1048576 },
  };
}

export function isDeepInfraGLMAuthorProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  return (
    profile.id === deepInfraGLMAuthorProfileId &&
    profile.version === 1 &&
    profile.provider === deepInfraGLMCompany &&
    profile.modelId === deepInfraGLMModelId &&
    profile.tier === "economy" &&
    profile.roles.length === 1 &&
    profile.roles[0] === "author" &&
    profile.runtime.effort === "low" &&
    profile.runtime.maxOutputTokens === 32768 &&
    profile.runtime.thinking.mode === "provider-default" &&
    profile.knownLimits.maxOutputTokens === 131072 &&
    profile.knownLimits.contextWindowTokens === 1048576
  );
}
