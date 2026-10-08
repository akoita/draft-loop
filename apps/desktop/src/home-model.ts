/**
 * Pure model for the Home dashboard, the landing page of an open workspace (ADR 0010).
 *
 * Home summarizes what a workspace holds once for the candidate (career profile, career evidence)
 * and lists the applications inside it. This module holds the navigation state and the wording
 * for each state, so the components stay thin and the states are testable without a DOM.
 */
import type { ApplicationStatus, ApplicationSummaryView } from "./application-contract.js";
import {
  type CareerEvidenceStatus,
  careerEvidenceReadinessText,
  careerEvidenceSourcesText,
} from "./career-evidence.js";
import type { DesktopProfileCapabilities } from "./native.js";
import { projectCanonicalCandidateProfileOutcome } from "./profile-outcome.js";

/** What the workspace window shows: Home, the profile screen, the New application flow, or one application. */
export type WorkspaceView =
  | { readonly kind: "home" }
  | { readonly kind: "profile" }
  | { readonly kind: "new-application" }
  | {
      readonly kind: "application";
      readonly applicationId: string;
      /** Shown as the current screen while the application is open. */
      readonly name: string;
    };

export const homeView: WorkspaceView = Object.freeze({ kind: "home" });
export const profileView: WorkspaceView = Object.freeze({ kind: "profile" });
export const newApplicationView: WorkspaceView = Object.freeze({ kind: "new-application" });

export function applicationView(applicationId: string, name: string): WorkspaceView {
  return { kind: "application", applicationId, name };
}

/** Opening or creating a workspace never resumes the last review: it lands on Home. */
export function workspaceEntryView(): WorkspaceView {
  return homeView;
}

export function isHomeView(view: WorkspaceView): boolean {
  return view.kind === "home";
}

// -- Career profile --------------------------------------------------------------------------

/** The latest saved profile version of the workspace, as Home reports it. */
export type HomeProfileStatus =
  | { readonly kind: "loading" }
  /** The host offers no profile workflow (browser or fixture). */
  | { readonly kind: "unsupported" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "none" }
  | { readonly kind: "draft"; readonly version: number }
  | { readonly kind: "failed"; readonly version: number }
  | { readonly kind: "reviewed"; readonly version: number };

export type HomeTone = "ready" | "attention" | "error" | "neutral";

export interface HomeStatusPresentation {
  readonly chip: string;
  readonly tone: HomeTone;
  readonly description: string;
  /** The label of the one action that moves the profile forward. */
  readonly action: string;
}

export function profileStatusPresentation(status: HomeProfileStatus): HomeStatusPresentation {
  switch (status.kind) {
    case "loading":
      return {
        chip: "Checking",
        tone: "neutral",
        description: "Reading the saved career profile…",
        action: "Manage profile",
      };
    case "unsupported":
      return {
        chip: "Unavailable",
        tone: "neutral",
        description: "This version of DraftLoop cannot manage a career profile.",
        action: "Manage profile",
      };
    case "unavailable":
      return {
        chip: "Unavailable",
        tone: "error",
        description: "The saved career profile could not be read. Open it to try again.",
        action: "Manage profile",
      };
    case "none":
      return {
        chip: "Not yet generated",
        tone: "attention",
        description:
          "Generate your career profile once from your career evidence. Every application reuses it.",
        action: "Generate profile",
      };
    case "draft":
      return {
        chip: "Draft",
        tone: "attention",
        description: `Version ${status.version} is saved but not reviewed. Review it before an application uses it.`,
        action: "Review profile",
      };
    case "failed":
      return {
        chip: "Failed",
        tone: "error",
        description: `Generating version ${status.version} saved no facts. Check your career evidence, then try again.`,
        action: "Manage profile",
      };
    case "reviewed":
      return {
        chip: "Reviewed",
        tone: "ready",
        description: `Version ${status.version} is reviewed and ready for applications.`,
        action: "Manage profile",
      };
  }
}

/**
 * Reads the newest saved profile and classifies it. Generation failures are saved as an empty
 * draft with the recorded cause, so the version itself is read to tell "failed" from "draft".
 */
export async function loadHomeProfileStatus(
  capabilities: DesktopProfileCapabilities,
  workspaceId: string,
): Promise<HomeProfileStatus> {
  const listSummaries = capabilities.listCanonicalCandidateProfileSummaries;
  if (listSummaries === undefined) return { kind: "unsupported" };
  try {
    const newest = (await listSummaries(workspaceId))[0];
    if (newest === undefined) return { kind: "none" };
    if (newest.status === "reviewed") return { kind: "reviewed", version: newest.latestVersion };
    const read = capabilities.getCanonicalCandidateProfile;
    if (read !== undefined) {
      const record = await read(newest.profileId, newest.latestVersion);
      const outcome = projectCanonicalCandidateProfileOutcome(
        record,
        newest.profileId,
        newest.profileId,
      );
      if (outcome.kind === "extraction-failure") {
        return { kind: "failed", version: newest.latestVersion };
      }
    }
    return { kind: "draft", version: newest.latestVersion };
  } catch {
    return { kind: "unavailable" };
  }
}

// -- Career evidence -------------------------------------------------------------------------

export interface HomeEvidencePresentation {
  readonly chip: string;
  readonly tone: HomeTone;
  /** The knowledge base name and source count, or a sentence when there is no base. */
  readonly headline: string;
  readonly detail: string;
  /** True when the candidate has no usable career evidence yet. */
  readonly empty: boolean;
  readonly action: string;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function evidencePresentation(
  status: CareerEvidenceStatus,
  legacySourceCount: number,
): HomeEvidencePresentation {
  const emptyDetail = "Add a CV, portfolio or other source so DraftLoop can quote you accurately.";
  switch (status.kind) {
    case "loading":
      return {
        chip: "Checking",
        tone: "neutral",
        headline: "Reading career evidence…",
        detail: "",
        empty: false,
        action: "Manage evidence",
      };
    case "unavailable":
      return {
        chip: "Unavailable",
        tone: "error",
        headline: "The selected knowledge base could not be read",
        detail: "Open career evidence to choose or repair it.",
        empty: false,
        action: "Manage evidence",
      };
    case "selected": {
      const empty = status.sourceCount === 0;
      return {
        chip: empty ? "Empty" : status.blockedCount > 0 ? "Needs attention" : "Ready",
        tone: empty || status.blockedCount > 0 ? "attention" : "ready",
        headline: careerEvidenceSourcesText(status),
        detail: empty ? emptyDetail : careerEvidenceReadinessText(status),
        empty,
        action: empty ? "Add career evidence" : "Manage evidence",
      };
    }
    case "none":
    case "unsupported": {
      if (legacySourceCount > 0) {
        return {
          chip: "Ready",
          tone: "ready",
          headline: `${plural(legacySourceCount, "source file")} in this workspace`,
          detail: "Stored with the workspace rather than in a knowledge base.",
          empty: false,
          action: "Manage evidence",
        };
      }
      return {
        chip: "None yet",
        tone: "attention",
        headline: "No career evidence yet",
        detail: emptyDetail,
        empty: true,
        action: "Add career evidence",
      };
    }
  }
}

// -- Applications ----------------------------------------------------------------------------

export type HomeApplicationsState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly applications: readonly ApplicationSummaryView[] };

const applicationStatusLabels: Readonly<Record<ApplicationStatus, string>> = {
  drafting: "Drafting",
  "in-review": "In review",
  approved: "Approved",
  exported: "Exported",
};

export function applicationStatusLabel(status: ApplicationStatus): string {
  return applicationStatusLabels[status];
}

export function applicationStatusTone(status: ApplicationStatus): HomeTone {
  switch (status) {
    case "exported":
    case "approved":
      return "ready";
    case "in-review":
      return "attention";
    case "drafting":
      return "neutral";
  }
}

export function applicationRunText(runCount: number): string {
  return runCount === 0 ? "No runs yet" : plural(runCount, "run");
}

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** "Last activity …" in words a person uses; the exact time stays available as a tooltip. */
export function applicationActivityText(updatedAt: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(updatedAt);
  if (!Number.isFinite(elapsed)) return "Last activity unknown";
  if (elapsed < minute) return "Last activity just now";
  if (elapsed < hour) return `Last activity ${plural(Math.floor(elapsed / minute), "minute")} ago`;
  if (elapsed < day) return `Last activity ${plural(Math.floor(elapsed / hour), "hour")} ago`;
  if (elapsed < 30 * day) return `Last activity ${plural(Math.floor(elapsed / day), "day")} ago`;
  return `Last activity on ${new Date(updatedAt).toISOString().slice(0, 10)}`;
}

/** Most recent activity first; the order is otherwise stable. */
export function applicationsByActivity(
  applications: readonly ApplicationSummaryView[],
): readonly ApplicationSummaryView[] {
  return applications
    .map((application, index) => ({ application, index }))
    .sort(
      (left, right) =>
        Date.parse(right.application.updatedAt) - Date.parse(left.application.updatedAt) ||
        left.index - right.index,
    )
    .map((entry) => entry.application);
}

/** True when the list holds nothing but the application a workspace is always read as. */
export function onlyDefaultApplication(applications: readonly ApplicationSummaryView[]): boolean {
  return applications.every((application) => application.isDefault);
}
