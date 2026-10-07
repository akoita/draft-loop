import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { mistralCompany, mistralLarge4ModelId } from "@draft-loop/providers/model-identities";
import { createMistralAuthorProfile } from "./mistral-development-profile.js";

export const mistralExtractionProfileId = "dev-mistral-extraction" as const;

/**
 * A detached profile for canonical extraction. Mistral Large 4 exposes no thinking or effort
 * control, so it differs from the author profile only by identity.
 */
export function createMistralExtractionProfile(): ModelProfile {
  return { ...createMistralAuthorProfile(), id: mistralExtractionProfileId };
}

export function isMistralExtractionProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  return (
    profile.id === mistralExtractionProfileId &&
    profile.version === 1 &&
    profile.provider === mistralCompany &&
    profile.modelId === mistralLarge4ModelId &&
    profile.tier === "economy" &&
    profile.roles.length === 1 &&
    profile.roles[0] === "author" &&
    profile.runtime.effort === "provider-default" &&
    profile.runtime.maxOutputTokens === 32768 &&
    profile.runtime.thinking.mode === "provider-default" &&
    profile.knownLimits.maxOutputTokens === 65536 &&
    profile.knownLimits.contextWindowTokens === 1000000
  );
}
