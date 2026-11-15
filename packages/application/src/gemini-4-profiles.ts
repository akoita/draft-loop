import type { ModelProfile } from "@draft-loop/domain/model-profile";
import {
  googleGemini4ArgonModelId,
  googleGemini4CarbonModelId,
  googleGemini4HydrogenModelId,
  googleGeminiCompany,
} from "@draft-loop/providers/model-identities";

export const googleGemini4HydrogenAuthorProfileId = "balanced-google-author" as const;
export const googleGemini4CarbonAuthorProfileId = "standard-google-author" as const;
export const googleGemini4ArgonAuthorProfileId = "standard-google-argon-author" as const;
export const googleGemini4ExtractionProfileId = "google-gemini-4-extraction" as const;

/**
 * Each profile keeps its model's own default thinking level: high for Hydrogen, medium for Carbon
 * and Argon. The output cap is the models' synchronous maximum because thinking and the answer
 * share it.
 */
const authorProfiles: readonly ModelProfile[] = [
  gemini4AuthorProfile(googleGemini4HydrogenAuthorProfileId, googleGemini4HydrogenModelId, "high"),
  gemini4AuthorProfile(googleGemini4CarbonAuthorProfileId, googleGemini4CarbonModelId, "medium"),
  gemini4AuthorProfile(googleGemini4ArgonAuthorProfileId, googleGemini4ArgonModelId, "medium"),
];

function gemini4AuthorProfile(
  id: string,
  modelId: string,
  effort: "medium" | "high",
): ModelProfile {
  return {
    id,
    version: 1,
    provider: googleGeminiCompany,
    modelId,
    tier: "standard",
    roles: ["author"],
    runtime: {
      effort,
      maxOutputTokens: 65536,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 65536, contextWindowTokens: 1048576 },
  };
}

function detached(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    roles: [...profile.roles],
    runtime: { ...profile.runtime, thinking: { ...profile.runtime.thinking } },
    knownLimits: { ...profile.knownLimits },
  };
}

function sameProfile(profile: ModelProfile, expected: ModelProfile): boolean {
  return (
    profile.id === expected.id &&
    profile.version === expected.version &&
    profile.provider === expected.provider &&
    profile.modelId === expected.modelId &&
    profile.tier === expected.tier &&
    profile.roles.length === 1 &&
    profile.roles[0] === "author" &&
    profile.runtime.effort === expected.runtime.effort &&
    profile.runtime.maxOutputTokens === expected.runtime.maxOutputTokens &&
    profile.runtime.thinking.mode === expected.runtime.thinking.mode &&
    profile.knownLimits.maxOutputTokens === expected.knownLimits.maxOutputTokens &&
    profile.knownLimits.contextWindowTokens === expected.knownLimits.contextWindowTokens
  );
}

/** The opt-in Gemini 4 author profiles: Hydrogen, Carbon and Argon. */
export function createGoogleGemini4AuthorProfiles(): ModelProfile[] {
  return authorProfiles.map(detached);
}

export function isGoogleGemini4AuthorProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  return authorProfiles.some((expected) => sameProfile(profile, expected));
}

/**
 * Canonical extraction for a Gemini 4 author. These models cannot disable thinking, so extraction
 * asks for the lowest level instead.
 */
export function createGoogleGemini4ExtractionProfile(modelId: string): ModelProfile | undefined {
  const author = authorProfiles.find((profile) => profile.modelId === modelId);
  if (author === undefined) return undefined;
  return {
    ...detached(author),
    id: googleGemini4ExtractionProfileId,
    runtime: { ...author.runtime, effort: "low", thinking: { mode: "provider-default" } },
  };
}

export function isGoogleGemini4ExtractionProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  const expected = createGoogleGemini4ExtractionProfile(profile.modelId);
  return expected !== undefined && sameProfile(profile, expected);
}
