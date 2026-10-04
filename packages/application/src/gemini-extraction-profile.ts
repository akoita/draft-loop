import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { googleGeminiCompany } from "@draft-loop/providers/model-identities";
import {
  createGoogleGeminiAuthorProfile,
  type GoogleGeminiProfileVersion,
  latestGoogleGeminiProfileVersion,
} from "./gemini-development-profile.js";

export const googleGeminiExtractionProfileId = "dev-google-gemini-extraction" as const;

/** A detached profile for canonical extraction with Gemini thinking disabled. */
export function createGoogleGeminiExtractionProfile(
  version: GoogleGeminiProfileVersion = latestGoogleGeminiProfileVersion,
): ModelProfile {
  const authorProfile = createGoogleGeminiAuthorProfile(version);
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
  const expected =
    profile.version === 1 || profile.version === 2
      ? createGoogleGeminiAuthorProfile(profile.version)
      : undefined;
  return (
    profile.id === googleGeminiExtractionProfileId &&
    expected !== undefined &&
    profile.provider === googleGeminiCompany &&
    profile.modelId === expected.modelId &&
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
