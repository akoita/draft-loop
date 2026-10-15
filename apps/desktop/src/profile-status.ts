/**
 * Pure model for the status that leads the Career profile page (issue #1090).
 *
 * The page answers three questions first: is my profile ready, what needs my attention, and how do
 * I update it. This module turns the state the page already holds (the loaded version's outcome,
 * its draft issues and the freshness answer) into one status, spelled out in words, and one
 * primary action.
 */
import type { CanonicalCandidateProfileIssueResult } from "./bridge.js";
import { profileFreshnessChangeText } from "./profile-freshness.js";
import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";
import type { CanonicalCandidateProfileOutcome } from "./profile-outcome.js";

export type ProfileStatusKind = "ready" | "needs-review" | "out-of-date" | "none";

/** `review` opens the facts and issues below; `generate` and `update` send career evidence. */
export type ProfilePrimaryAction = "review" | "update" | "generate";

export interface ProfileStatus {
  readonly kind: ProfileStatusKind;
  /** Open issues in the loaded draft; zero for every other status. */
  readonly issueCount: number;
  readonly primaryAction: ProfilePrimaryAction | null;
  /** The status in words, so it never depends on colour. */
  readonly label: string;
  /** One sentence saying what the status means and what to do next. */
  readonly detail: string;
}

/** The name a first profile gets when the person has not chosen one under Details. */
export const defaultCareerProfileName = "career-profile";

export interface ProfileStatusInput {
  readonly outcome: CanonicalCandidateProfileOutcome;
  readonly draftIssues: readonly CanonicalCandidateProfileIssueResult[];
  /** The loaded version, when one is loaded. */
  readonly version: number | null;
  /** Freshness of the loaded reviewed version; ignored for every other status. */
  readonly freshness?: ProfileFreshnessResult | undefined;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function openIssueCount(issues: readonly CanonicalCandidateProfileIssueResult[]): number {
  return issues.filter((issue) => issue.status === "open").length;
}

/** Projects the page status from the loaded version, its draft edits and its freshness. */
export function projectProfileStatus({
  outcome,
  draftIssues,
  version,
  freshness,
}: ProfileStatusInput): ProfileStatus {
  switch (outcome.kind) {
    case "unloaded":
    case "no-version":
      return {
        kind: "none",
        issueCount: 0,
        primaryAction: "generate",
        label: "No profile yet",
        detail:
          "Generate a profile from your career evidence. You review it once before applications use it.",
      };
    case "extraction-failure":
      return {
        kind: "none",
        issueCount: 0,
        primaryAction: "generate",
        label: "Generation failed",
        detail: "The last attempt saved no facts. Fix the cause below, then try again.",
      };
    case "empty":
      return outcome.retry
        ? {
            kind: "none",
            issueCount: 0,
            primaryAction: "generate",
            label: "No facts found",
            detail: "This version has no facts. Check your career evidence, then try again.",
          }
        : {
            kind: "needs-review",
            issueCount: openIssueCount(draftIssues),
            primaryAction: "review",
            label: "Needs review",
            detail: "Every fact was removed from this draft. Restore at least one before saving.",
          };
    case "blocked": {
      const issueCount = openIssueCount(draftIssues);
      return {
        kind: "needs-review",
        issueCount,
        primaryAction: "review",
        label: issueCount === 0 ? "Needs review" : `Needs review: ${plural(issueCount, "issue")}`,
        detail:
          issueCount === 0
            ? "Save your issue decisions, then mark the profile reviewed."
            : "Resolve or acknowledge each open issue, save, then mark the profile reviewed.",
      };
    }
    case "draft-review":
      return {
        kind: "needs-review",
        issueCount: 0,
        primaryAction: "review",
        label: "Needs review",
        detail: "Check the facts below, then mark the profile reviewed so applications can use it.",
      };
    case "reviewed":
      break;
  }
  if (freshness?.state === "update-available") {
    const changes = profileFreshnessChangeText(freshness);
    return {
      kind: "out-of-date",
      issueCount: 0,
      primaryAction: "update",
      label: "Out of date with your evidence",
      detail:
        changes === ""
          ? "Your career evidence changed since this profile was reviewed."
          : `Your career evidence changed since this profile was reviewed: ${changes}.`,
    };
  }
  return {
    kind: "ready",
    issueCount: 0,
    primaryAction: null,
    label: "Ready",
    detail:
      version === null
        ? "This reviewed profile is used for new applications."
        : `Reviewed version ${version} is used for new applications.`,
  };
}

/** The label of the primary action button. */
export function profilePrimaryActionLabel(status: ProfileStatus): string | null {
  switch (status.primaryAction) {
    case "review":
      return status.issueCount > 0 ? "Review issues" : "Review profile";
    case "update":
      return "Update profile";
    case "generate":
      return "Generate profile";
    case null:
      return null;
  }
}

export interface ProfileApprovalTextInput {
  readonly mode: "generate" | "update";
  /** Sources in the career evidence the host reports; omitted when it cannot say. */
  readonly sourceCount?: number | undefined;
  /** The provider the profile is built with, by display name; omitted when unknown. */
  readonly providerName?: string | undefined;
}

/** The one approval line beside the action that sends data, worded as what is sent. */
export function profileApprovalText({
  mode,
  sourceCount,
  providerName,
}: ProfileApprovalTextInput): string {
  const sources =
    sourceCount === undefined || !Number.isSafeInteger(sourceCount) || sourceCount < 0
      ? ""
      : ` (up to ${plural(sourceCount, "source")})`;
  const provider =
    providerName === undefined || providerName.trim() === ""
      ? "the configured provider"
      : providerName.trim();
  return `Send my career evidence${sources} to ${provider} to ${mode === "update" ? "update" : "build"} the profile.`;
}
