import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { mistralCompany, mistralLarge4ModelId } from "@draft-loop/providers/model-identities";
import { createMistralAuthorProfile } from "./mistral-development-profile.js";

export const mistralExtractionProfileId = "dev-mistral-extraction" as const;

/**
 * A detached profile for canonical extraction with reasoning disabled. The adapter maps disabled
 * thinking to `reasoningEffort: "none"`, because default high-effort reasoning spends minutes and
 * most of the output budget on discarded reasoning. Version 2 separates these outputs from the
 * version 1 provider-default profile for incremental reuse.
 */
export function createMistralExtractionProfile(): ModelProfile {
  const authorProfile = createMistralAuthorProfile();
  return {
    ...authorProfile,
    id: mistralExtractionProfileId,
    version: 2,
    runtime: {
      ...authorProfile.runtime,
      effort: "provider-default",
      thinking: { mode: "disabled" },
    },
  };
}

export function isMistralExtractionProfile(
  profile: ModelProfile | undefined,
): profile is ModelProfile {
  if (profile === undefined) return false;
  return (
    profile.id === mistralExtractionProfileId &&
    profile.version === 2 &&
    profile.provider === mistralCompany &&
    profile.modelId === mistralLarge4ModelId &&
    profile.tier === "economy" &&
    profile.roles.length === 1 &&
    profile.roles[0] === "author" &&
    profile.runtime.effort === "provider-default" &&
    profile.runtime.maxOutputTokens === 32768 &&
    profile.runtime.thinking.mode === "disabled" &&
    profile.knownLimits.maxOutputTokens === 65536 &&
    profile.knownLimits.contextWindowTokens === 1000000
  );
}
