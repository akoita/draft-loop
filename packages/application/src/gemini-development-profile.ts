import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { googleGeminiCompany, googleGeminiModelId } from "@draft-loop/providers";

export const googleGeminiAuthorProfileId = "dev-google-gemini-author" as const;

export function isGoogleGeminiModel(company: string, modelId: string): boolean {
  return company === googleGeminiCompany && modelId === googleGeminiModelId;
}

/** A detached, opt-in development profile for the Gemini 3.7 Flash author. */
export function createGoogleGeminiAuthorProfile(): ModelProfile {
  return {
    id: googleGeminiAuthorProfileId,
    version: 1,
    provider: googleGeminiCompany,
    modelId: googleGeminiModelId,
    tier: "economy",
    roles: ["author"],
    runtime: {
      effort: "low",
      maxOutputTokens: 32768,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 65536, contextWindowTokens: 1048576 },
  };
}

export function isGoogleGeminiAuthorProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  return (
    profile.id === googleGeminiAuthorProfileId &&
    profile.version === 1 &&
    profile.provider === googleGeminiCompany &&
    profile.modelId === googleGeminiModelId &&
    profile.tier === "economy" &&
    profile.roles.length === 1 &&
    profile.roles[0] === "author" &&
    profile.runtime.effort === "low" &&
    profile.runtime.maxOutputTokens === 32768 &&
    profile.runtime.thinking.mode === "provider-default" &&
    profile.knownLimits.maxOutputTokens === 65536 &&
    profile.knownLimits.contextWindowTokens === 1048576
  );
}
