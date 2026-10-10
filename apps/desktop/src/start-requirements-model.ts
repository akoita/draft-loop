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

/** What an extraction that found nothing says, so a person is never offered an empty brief to review. */
export const noRequirementsFoundTitle = "No requirements were found in this job text";
export const noRequirementsFoundNote =
  "Nothing was found to review. Extract again, or paste the job text into the application instead.";

/** A draft that holds no requirements: there is nothing to review, only a retry or a paste. */
export function isEmptyDraftBrief(latest: OpportunityLatestBrief): boolean {
  return latest.status === "draft" && latest.requirementCount === 0;
}

/** Whether setup card 01 offers extraction: no brief yet, or only an empty draft to replace. */
export function offersRequirementsExtraction(
  latest: OpportunityLatestBrief | null | undefined,
): boolean {
  return latest === null || latest === undefined || isEmptyDraftBrief(latest);
}

/** What the start blocker offers next to the parser's refusal of the raw job description. */
export type RequirementRefusalAction =
  | "use-reviewed"
  | "review-draft"
  | "extract"
  | "extract-again"
  | null;

export function requirementRefusalAction(
  latest: OpportunityLatestBrief | null | undefined,
  reviewed: ReviewedRequirementsSelection | null,
  canExtract: boolean,
): RequirementRefusalAction {
  if (reviewed !== null) return "use-reviewed";
  const emptyDraft = latest !== null && latest !== undefined && isEmptyDraftBrief(latest);
  if (latest?.status === "draft" && !emptyDraft) return "review-draft";
  if (!canExtract) return null;
  return emptyDraft ? "extract-again" : "extract";
}

/** "Requirements brief v2 (draft)" for the setup card. */
export function latestBriefTitle(latest: OpportunityLatestBrief): string {
  return `Requirements brief v${latest.version} (${latest.status})`;
}

/** What the person can do with the latest brief, stated for the setup card. */
export function latestBriefNote(latest: OpportunityLatestBrief): string {
  if (isEmptyDraftBrief(latest)) return `${noRequirementsFoundTitle}. ${noRequirementsFoundNote}`;
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
