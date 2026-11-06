import { plural, t } from "@lingui/core/macro";
/**
 * Pure model for the profile freshness line on the Home Career profile card (ADR 0010).
 *
 * Freshness answers "is the reviewed profile current with my career evidence?". Home already knows
 * when no profile exists and when the newest one is an unreviewed draft, so it asks the host only
 * when the newest version is reviewed. The action always opens the Career profile page; Home never
 * starts generation.
 */

import type { HomeProfileStatus, HomeTone } from "./home-model.js";
import type { DesktopProfileCapabilities } from "./native.js";
import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";

export interface ProfileFreshnessPresentation {
  readonly tone: HomeTone;
  /** The sentence shown on the card. */
  readonly text: string;
  /** The label of the action that opens the Career profile page; absent when nothing is to do. */
  readonly action?: string;
}

/** "2 new, 1 updated source": each kind of change in the order a person scans for it. */
export function profileFreshnessChangeText(
  result: Pick<
    ProfileFreshnessResult,
    "newSourceCount" | "changedSourceCount" | "removedSourceCount"
  >,
): string {
  // The last part carries the noun: "2 new, 1 updated source".
  const parts = [
    {
      count: result.newSourceCount,
      short: (count: number) => t`${count} new`,
      full: (count: number) => plural(count, { one: "# new source", other: "# new sources" }),
    },
    {
      count: result.changedSourceCount,
      short: (count: number) => t`${count} updated`,
      full: (count: number) =>
        plural(count, { one: "# updated source", other: "# updated sources" }),
    },
    {
      count: result.removedSourceCount,
      short: (count: number) => t`${count} retired`,
      full: (count: number) =>
        plural(count, { one: "# retired source", other: "# retired sources" }),
    },
  ].filter((part) => part.count > 0);
  return parts
    .map((part, index) => (index === parts.length - 1 ? part.full : part.short)(part.count))
    .join(", ");
}

/**
 * What the freshness line says for the saved profile, or `undefined` when there is nothing useful
 * to say: still loading, unreadable, unsupported, a failed generation, or no answer yet.
 */
export function profileFreshnessPresentation(
  profile: HomeProfileStatus,
  freshness: ProfileFreshnessResult | undefined,
): ProfileFreshnessPresentation | undefined {
  switch (profile.kind) {
    // The card's own button already says Generate or Review here, so no inline action.
    case "none":
      return { tone: "attention", text: t`Not generated yet` };
    case "draft":
      return { tone: "attention", text: t`Draft version ${profile.version} awaiting your review` };
    case "reviewed":
      break;
    default:
      return undefined;
  }
  if (freshness === undefined) return undefined;
  switch (freshness.state) {
    case "up-to-date":
      return { tone: "ready", text: t`Up to date with your career evidence` };
    case "update-available":
      return {
        tone: "attention",
        text: t`Career evidence changed: ${profileFreshnessChangeText(freshness)}`,
        action: t`Update profile`,
      };
    case "review-pending":
      return {
        tone: "attention",
        text: t`Draft version ${freshness.version ?? profile.version} awaiting your review`,
        action: t`Review`,
      };
    default:
      return undefined;
  }
}

/** Asks the host whether the reviewed profile is current; `undefined` when it cannot say. */
export async function loadProfileFreshness(
  capabilities: DesktopProfileCapabilities,
  workspaceId: string,
  profileId: string,
): Promise<ProfileFreshnessResult | undefined> {
  const read = capabilities.getCandidateProfileFreshness;
  if (read === undefined) return undefined;
  try {
    return await read(workspaceId, profileId);
  } catch {
    return undefined;
  }
}
