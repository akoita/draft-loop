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

function sources(count: number): string {
  return count === 1 ? "source" : "sources";
}

/** "2 new, 1 updated source": each kind of change in the order a person scans for it. */
export function profileFreshnessChangeText(
  result: Pick<
    ProfileFreshnessResult,
    "newSourceCount" | "changedSourceCount" | "removedSourceCount"
  >,
): string {
  const parts = [
    { count: result.newSourceCount, label: "new" },
    { count: result.changedSourceCount, label: "updated" },
    { count: result.removedSourceCount, label: "retired" },
  ].filter((part) => part.count > 0);
  const last = parts[parts.length - 1];
  if (last === undefined) return "";
  return `${parts.map((part) => `${part.count} ${part.label}`).join(", ")} ${sources(last.count)}`;
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
      return { tone: "attention", text: "Not generated yet" };
    case "draft":
      return { tone: "attention", text: `Draft version ${profile.version} awaiting your review` };
    case "reviewed":
      break;
    default:
      return undefined;
  }
  if (freshness === undefined) return undefined;
  switch (freshness.state) {
    case "up-to-date":
      return { tone: "ready", text: "Up to date with your career evidence" };
    case "update-available":
      return {
        tone: "attention",
        text: `Career evidence changed: ${profileFreshnessChangeText(freshness)}`,
        action: "Update profile",
      };
    case "review-pending":
      return {
        tone: "attention",
        text: `Draft version ${freshness.version ?? profile.version} awaiting your review`,
        action: "Review",
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
