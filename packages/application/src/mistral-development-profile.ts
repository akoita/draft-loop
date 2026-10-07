import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { mistralCompany, mistralLarge4ModelId } from "@draft-loop/providers/model-identities";

export const mistralAuthorProfileId = "dev-mistral-author" as const;

export function isMistralModel(company: string, modelId: string): boolean {
  return company === mistralCompany && modelId === mistralLarge4ModelId;
}

/** A detached, opt-in development profile for the Mistral Large 4 author. */
export function createMistralAuthorProfile(): ModelProfile {
  return {
    id: mistralAuthorProfileId,
    version: 1,
    provider: mistralCompany,
    modelId: mistralLarge4ModelId,
    tier: "economy",
    roles: ["author"],
    runtime: {
      // The adapter rejects any other thinking or effort control for this model.
      effort: "provider-default",
      maxOutputTokens: 32768,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 65536, contextWindowTokens: 1000000 },
  };
}

export function isMistralAuthorProfile(profile: ModelProfile | undefined): profile is ModelProfile {
  if (profile === undefined) return false;
  return (
    profile.id === mistralAuthorProfileId &&
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
