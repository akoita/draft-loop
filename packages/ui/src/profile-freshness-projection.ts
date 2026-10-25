import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";

/**
 * The service's freshness, as the desktop's application service and the hosted API's freshness
 * view both state it.
 */
export type ServiceProfileFreshness =
  | { readonly state: "not-generated" }
  | { readonly state: "up-to-date"; readonly version: number }
  | {
      readonly state: "update-available";
      readonly version: number;
      readonly newSourceCount: number;
      readonly changedSourceCount: number;
      readonly removedSourceCount: number;
    }
  | {
      readonly state: "review-pending";
      readonly version: number;
      readonly reviewedVersion?: number;
    }
  | { readonly state: "unavailable"; readonly version: number };

/**
 * Host-side projection of the profile freshness: a state and counts, never source names or paths.
 * A host that cannot compare answers `unavailable` rather than failing the whole Home page.
 */
export function projectProfileFreshness(
  workspaceId: string,
  profileId: string,
  freshness: ServiceProfileFreshness | undefined,
): ProfileFreshnessResult {
  const base = {
    workspaceId,
    profileId,
    reviewedVersion: null,
    newSourceCount: 0,
    changedSourceCount: 0,
    removedSourceCount: 0,
  } as const;
  switch (freshness?.state) {
    case undefined:
      return { ...base, state: "unavailable", version: null };
    case "not-generated":
      return { ...base, state: "not-generated", version: null };
    case "up-to-date":
      return { ...base, state: "up-to-date", version: freshness.version };
    case "unavailable":
      return { ...base, state: "unavailable", version: freshness.version };
    case "review-pending":
      return {
        ...base,
        state: "review-pending",
        version: freshness.version,
        reviewedVersion: freshness.reviewedVersion ?? null,
      };
    case "update-available":
      return {
        ...base,
        state: "update-available",
        version: freshness.version,
        newSourceCount: freshness.newSourceCount,
        changedSourceCount: freshness.changedSourceCount,
        removedSourceCount: freshness.removedSourceCount,
      };
  }
}
