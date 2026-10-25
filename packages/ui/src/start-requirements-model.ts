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

/** The Advanced choice to start without reviewing a draft brief, and what it costs. */
export const rawJobDescriptionChoiceLabel = "Start from the raw job description instead";
export const rawJobDescriptionChoiceNote =
  "Coverage scoring is less reliable without reviewed requirements.";
export const rawJobDescriptionOverDraftLabel =
  "Using the raw job description (unreviewed source units), not the draft requirements.";

/** Where a run's requirements may come from before the person chooses, for the start panel. */
export interface StartRequirementsChoice {
  /** The latest brief is a draft and no reviewed brief would bind: the start waits for review. */
  readonly draftBrief: boolean;
  /**
   * The key of the brief a raw-job-description choice applies to, or `null` when the panel
   * offers no such choice. A new brief version resets the choice.
   */
  readonly rawJobKey: string | null;
}

/**
 * Whether the start waits for a draft's review, and which brief the raw-job-description choice
 * belongs to. With a reviewed brief, the raw text is an alternative to it; with a draft, it is
 * the Advanced choice, offered once the job text is there; with no brief, the run reads the job
 * text and there is nothing to choose.
 */
export function startRequirementsChoice(
  workspaceId: string,
  latest: OpportunityLatestBrief | null | undefined,
  reviewed: ReviewedRequirementsSelection | null,
  setup: { readonly reviewedOpportunity?: unknown; readonly jobDescriptionReady: boolean },
): StartRequirementsChoice {
  if (reviewed !== null) {
    return {
      draftBrief: false,
      rawJobKey: `${workspaceId}:${reviewed.briefId}:${reviewed.version}`,
    };
  }
  const draftBrief =
    latest !== null &&
    latest !== undefined &&
    latest.status === "draft" &&
    (setup.reviewedOpportunity === null || setup.reviewedOpportunity === undefined);
  return {
    draftBrief,
    rawJobKey:
      draftBrief && setup.jobDescriptionReady
        ? `${workspaceId}:${latest.briefId}:${latest.version}:draft`
        : null,
  };
}

/** What an extraction that found nothing says, so a person is never offered an empty brief to review. */
export const noRequirementsFoundTitle = "No requirements were found in this job text";
export const noRequirementsFoundNote =
  "Nothing was found to review. Extract again, or paste the job text into the application instead.";

/** What the setup card says while the service extracts a just-saved brief, as the hosted worker does. */
export const pendingExtractionNote =
  "Reading this job's requirements. This takes about a minute; the page updates when they are ready.";
/** What it says when that extraction failed after its retries. */
export const failedExtractionNote =
  "The requirements could not be extracted. Extract them again, or paste the job text into the application instead.";

/** Whether the service is still extracting the latest brief: nothing to review or extract yet. */
export function extractionPending(latest: OpportunityLatestBrief | null | undefined): boolean {
  return latest?.extraction === "pending";
}

/** A draft that holds no requirements: there is nothing to review, only a retry or a paste. */
export function isEmptyDraftBrief(latest: OpportunityLatestBrief): boolean {
  return latest.status === "draft" && latest.requirementCount === 0;
}

/**
 * The React key for a brief's review action. It names the brief, not its version, so the
 * refresh after Save changes or Mark reviewed keeps the open dialog instead of remounting it.
 */
export function briefReviewActionKey(workspaceId: string, briefId: string): string {
  return `${workspaceId}:${briefId}`;
}

/**
 * Whether setup card 01 offers extraction: no brief yet, or only an empty draft to replace, and
 * not while the service is still extracting one.
 */
export function offersRequirementsExtraction(
  latest: OpportunityLatestBrief | null | undefined,
): boolean {
  if (extractionPending(latest)) return false;
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
  // The service is still reading the job: there is nothing to review or extract yet.
  if (extractionPending(latest)) return null;
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
  if (extractionPending(latest)) return pendingExtractionNote;
  if (isEmptyDraftBrief(latest) && latest.extraction === "failed") return failedExtractionNote;
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
