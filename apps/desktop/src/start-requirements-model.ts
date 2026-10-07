import type { OpportunityLatestBrief } from "./bridge.js";

/** The reviewed brief a run would start from: the latest version, reviewed and selected. */
export interface ReviewedRequirementsSelection {
  readonly briefId: string;
  readonly version: number;
  readonly requirementCount: number;
  readonly criticalCount: number;
}

/** DOM id of the extraction control on setup card 01, so the start blocker can scroll to it. */
export const jobRequirementsExtractionId = "job-requirements-extraction";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The reviewed brief the host will bind when a run starts, or `null`. It must be the workspace's
 * latest version, reviewed, and the version the host holds as the reviewed selection; anything
 * else (a newer draft, an unselected review) would not be used by the run.
 */
export function reviewedRequirementsSelection(
  latest: OpportunityLatestBrief | null | undefined,
  reviewed: { readonly briefId: string; readonly version: number } | null | undefined,
): ReviewedRequirementsSelection | null {
  if (latest === null || latest === undefined || reviewed === null || reviewed === undefined) {
    return null;
  }
  if (
    latest.status !== "reviewed" ||
    latest.briefId !== reviewed.briefId ||
    latest.version !== reviewed.version
  ) {
    return null;
  }
  return {
    briefId: latest.briefId,
    version: latest.version,
    requirementCount: latest.requirementCount,
    criticalCount: latest.criticalCount,
  };
}

/** "Using reviewed requirements: brief v3 · 18 requirements · 4 critical" */
export function reviewedRequirementsLabel(selection: ReviewedRequirementsSelection): string {
  return `Using reviewed requirements: brief v${selection.version} · ${plural(selection.requirementCount, "requirement")} · ${selection.criticalCount} critical`;
}

export const rawJobDescriptionLabel =
  "Using the raw job description (unreviewed source units), not the reviewed requirements.";

/** "Requirements brief v2 (draft)" for the setup card. */
export function latestBriefTitle(latest: OpportunityLatestBrief): string {
  return `Requirements brief v${latest.version} (${latest.status})`;
}

/** What the person can do with the latest brief, stated for the setup card. */
export function latestBriefNote(latest: OpportunityLatestBrief): string {
  const counts = `${plural(latest.requirementCount, "requirement")}, ${latest.criticalCount} critical.`;
  return latest.status === "draft"
    ? `${counts} A draft cannot start a run until you review it.`
    : `${counts} Runs start from these requirements.`;
}

/**
 * Whether a start blocker is the local parser's refusal of the raw job description, so the
 * blocker can offer to extract the requirements into a brief instead of asking for hand edits.
 */
export function isJobRequirementRefusal(
  blocker: string,
  jobRequirementProblem: string | null | undefined,
): boolean {
  return (
    jobRequirementProblem !== null &&
    jobRequirementProblem !== undefined &&
    blocker === jobRequirementProblem
  );
}
