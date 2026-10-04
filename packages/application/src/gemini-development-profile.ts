import type { ModelProfile } from "@draft-loop/domain/model-profile";
import {
  googleGemini37FlashModelId,
  googleGemini38FlashModelId,
  googleGeminiCompany,
  isGoogleGeminiSupportedModelId,
} from "@draft-loop/providers/model-identities";

export const googleGeminiAuthorProfileId = "dev-google-gemini-author" as const;

/**
 * Immutable profile versions: v1 pins Gemini 3.7 Flash so existing runs resume; v2 pins
 * Gemini 3.8 Flash and is the development preset's author.
 */
export type GoogleGeminiProfileVersion = 1 | 2;
export const latestGoogleGeminiProfileVersion: GoogleGeminiProfileVersion = 2;

const geminiModelIdByProfileVersion: Readonly<Record<GoogleGeminiProfileVersion, string>> = {
  1: googleGemini37FlashModelId,
  2: googleGemini38FlashModelId,
};

export function googleGeminiProfileVersionFor(
  modelId: string,
): GoogleGeminiProfileVersion | undefined {
  if (modelId === googleGemini37FlashModelId) return 1;
  if (modelId === googleGemini38FlashModelId) return 2;
  return undefined;
}

export function isGoogleGeminiModel(company: string, modelId: string): boolean {
  return company === googleGeminiCompany && isGoogleGeminiSupportedModelId(modelId);
}

/** A detached, opt-in development profile for the Gemini Flash author. */
export function createGoogleGeminiAuthorProfile(
  version: GoogleGeminiProfileVersion = latestGoogleGeminiProfileVersion,
): ModelProfile {
  return {
    id: googleGeminiAuthorProfileId,
    version,
    provider: googleGeminiCompany,
    modelId: geminiModelIdByProfileVersion[version],
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
  const expectedModelId =
    profile.version === 1 || profile.version === 2
      ? geminiModelIdByProfileVersion[profile.version]
      : undefined;
  return (
    profile.id === googleGeminiAuthorProfileId &&
    expectedModelId !== undefined &&
    profile.provider === googleGeminiCompany &&
    profile.modelId === expectedModelId &&
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
