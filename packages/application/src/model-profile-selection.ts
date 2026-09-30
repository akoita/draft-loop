import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import {
  type ResolvedRunModelProfiles,
  type RunProviderAuthModeConfiguration,
  resolveRunModelProfiles,
  validateProfileRoute,
} from "./run-model-profiles.js";

export type { ModelProfileReferences } from "./index.js";
export type {
  RunProviderAuthMode,
  RunProviderAuthModeConfiguration,
} from "./run-model-profiles.js";

export interface ModelProfileRouteSupport {
  readonly id: string;
  readonly version: number;
  readonly supported: boolean;
}

/** Resolves a strict exact pair and validates that its configured routes can honor it. */
export function resolveModelProfilePair(
  references: unknown,
  authModes: RunProviderAuthModeConfiguration,
): ResolvedRunModelProfiles {
  return resolveRunModelProfiles(references, defaultModelProfileRegistry, authModes);
}

/** Reports route support using the same guard that rejects profile-backed runs. */
export function listModelProfileRouteSupport(
  authModes: RunProviderAuthModeConfiguration,
): ModelProfileRouteSupport[] {
  return defaultModelProfileRegistry.list().map((profile: ModelProfile) => {
    let supported = true;
    try {
      validateProfileRoute(profile, authModes);
    } catch {
      supported = false;
    }
    return { id: profile.id, version: profile.version, supported };
  });
}
