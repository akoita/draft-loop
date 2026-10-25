import type { OpportunityLatestBrief } from "@draft-loop/ui/bridge";

/**
 * The host's refusal to start while the application's requirements brief is still a draft. The
 * raw job description is used only when the person chose it explicitly, never as a fallback.
 */
export const draftBriefStartRefusal =
  "This application's requirements brief is still a draft. Review the requirements before starting, or choose to start from the raw job description under Advanced.";

export interface StartRequirementsGuardInput {
  /** The start explicitly asked for the raw job description. */
  readonly fromJobDescription: boolean;
  /** Whether the start binds a reviewed brief. */
  readonly bindsReviewedBrief: boolean;
  /** The application's latest brief, or `null` when it has none. */
  readonly latest: () => Promise<OpportunityLatestBrief | null>;
}

/** The refusal message for a start that would silently skip a draft brief, or `null`. */
export async function draftBriefStartRefusalFor(
  input: StartRequirementsGuardInput,
): Promise<string | null> {
  if (input.fromJobDescription || input.bindsReviewedBrief) return null;
  const latest = await input.latest();
  return latest?.status === "draft" ? draftBriefStartRefusal : null;
}
