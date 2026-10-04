import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { googleGeminiCompany, googleGeminiModelId } from "@draft-loop/providers/model-identities";
import { createGoogleGeminiAuthorProfile } from "./gemini-development-profile.js";

export const googleGeminiExtractionProfileId = "dev-google-gemini-extraction" as const;

/** A detached profile for canonical extraction with Gemini thinking disabled. */
export function createGoogleGeminiExtractionProfile(): ModelProfile {
  const authorProfile = createGoogleGeminiAuthorProfile();
  return {
    ...authorProfile,
    id: googleGeminiExtractionProfileId,
    runtime: {
      ...authorProfile.runtime,
      effort: "provider-default",
      thinking: { mode: "disabled" },
    },
  };
}

export function isGoogleGeminiExtractionProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  return (
    profile.id === googleGeminiExtractionProfileId &&
    profile.version === 1 &&
    profile.provider === googleGeminiCompany &&
    profile.modelId === googleGeminiModelId &&
    profile.tier === "economy" &&
    profile.roles.length === 1 &&
    profile.roles[0] === "author" &&
    profile.runtime.effort === "provider-default" &&
    profile.runtime.maxOutputTokens === 32768 &&
    profile.runtime.thinking.mode === "disabled" &&
    profile.knownLimits.maxOutputTokens === 65536 &&
    profile.knownLimits.contextWindowTokens === 1048576
  );
}
