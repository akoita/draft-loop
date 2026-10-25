/**
 * Pure model for creating an application (ADR 0010) and for the reviewed career profiles an
 * application can reuse. Home's New application form holds the draft; the application screen's
 * Profile step lists the reviewed profiles. Every state is testable without a DOM.
 */
import type { CandidateProfileSelection } from "./model.js";
import type { DesktopProfileCapabilities } from "./native.js";
import { parseReviewedCanonicalCandidateProfileCatalogResult } from "./profile-catalog.js";

// -- The new application's name and job ------------------------------------------------------

export type NewApplicationJobKind = "text" | "url";

export interface NewApplicationDraft {
  readonly name: string;
  readonly jobKind: NewApplicationJobKind;
  readonly jobText: string;
  readonly jobUrl: string;
  /** The person allowed DraftLoop to fetch the job page when requirements are extracted. */
  readonly urlApproved: boolean;
}

export const emptyNewApplicationDraft: NewApplicationDraft = Object.freeze({
  name: "",
  jobKind: "text",
  jobText: "",
  jobUrl: "",
  urlApproved: false,
});

export const newApplicationNameMessage = "Name the application, for example a company and role.";
export const newApplicationJobTextMessage = "Paste the job description to work from.";
export const newApplicationJobUrlMessage = "Enter the web address (http or https) of the job page.";
export const newApplicationUrlApprovalMessage =
  "Allow DraftLoop to fetch this page to continue. Nothing is fetched until you extract requirements.";

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The first thing wrong with the draft, in the order the fields appear; null when it is valid. */
export function newApplicationProblem(draft: NewApplicationDraft): string | null {
  if (draft.name.trim() === "") return newApplicationNameMessage;
  if (draft.jobKind === "text") {
    return draft.jobText.trim() === "" ? newApplicationJobTextMessage : null;
  }
  if (!isWebAddress(draft.jobUrl)) return newApplicationJobUrlMessage;
  return draft.urlApproved ? null : newApplicationUrlApprovalMessage;
}

/** The job as the application port takes it: pasted text, or the approved URL. */
export function newApplicationJobInput(
  draft: NewApplicationDraft,
): string | { readonly url: string } {
  return draft.jobKind === "text" ? draft.jobText : { url: draft.jobUrl.trim() };
}

// -- Reviewed career profiles --------------------------------------------------------------

export interface ReviewedProfileChoice {
  readonly profileId: string;
  readonly version: number;
  readonly reviewedAt: string;
}

export function reviewedProfileKey(choice: CandidateProfileSelection): string {
  return `${choice.profileId}@${choice.version}`;
}

/** Newest review first; ties keep a stable order by profile id and version. */
export function sortReviewedProfileChoices(
  choices: readonly ReviewedProfileChoice[],
): readonly ReviewedProfileChoice[] {
  return [...choices].sort(
    (left, right) =>
      Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt) ||
      left.profileId.localeCompare(right.profileId) ||
      right.version - left.version,
  );
}

/** The workspace's latest reviewed profile, which a new application selects on its own. */
export function defaultReviewedProfile(
  choices: readonly ReviewedProfileChoice[],
): ReviewedProfileChoice | undefined {
  return choices[0];
}

export function reviewedProfileLabel(choice: ReviewedProfileChoice): string {
  return `${choice.profileId} · version ${choice.version} · reviewed ${choice.reviewedAt.slice(0, 10)}`;
}

export type ReviewedProfilesState =
  | { readonly status: "loading" }
  | { readonly status: "unsupported" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly choices: readonly ReviewedProfileChoice[] };

export const noReviewedProfileMessage =
  "No reviewed career profile yet. Generate and review one once, and every application reuses it.";

/**
 * Reads every reviewed version of every saved profile. The catalog names the latest reviewed
 * version of each profile; a profile's history adds its earlier reviewed versions, so the person
 * can pick another. An unreadable history leaves the catalog's version available.
 */
export async function loadReviewedProfileChoices(
  capabilities: Pick<
    DesktopProfileCapabilities,
    "listReviewedCanonicalCandidateProfiles" | "listCanonicalCandidateProfileVersions"
  >,
  workspaceId: string,
): Promise<ReviewedProfilesState> {
  const listCatalog = capabilities.listReviewedCanonicalCandidateProfiles;
  if (listCatalog === undefined) return { status: "unsupported" };
  try {
    const catalog = parseReviewedCanonicalCandidateProfileCatalogResult(
      await listCatalog(workspaceId),
      workspaceId,
    );
    const listVersions = capabilities.listCanonicalCandidateProfileVersions;
    const choices: ReviewedProfileChoice[] = [];
    for (const entry of catalog.profiles) {
      const known = new Map<number, ReviewedProfileChoice>([[entry.version, entry]]);
      if (listVersions !== undefined) {
        try {
          const history = await listVersions(entry.profileId);
          for (const record of history.versions) {
            // Only a version the catalog would offer: reviewed, with facts and no open issue.
            if (
              record.status === "reviewed" &&
              record.reviewedAt !== null &&
              record.facts.length > 0 &&
              record.issues.every((issue) => issue.status !== "open")
            ) {
              known.set(record.version, {
                profileId: entry.profileId,
                version: record.version,
                reviewedAt: record.reviewedAt,
              });
            }
          }
        } catch {
          // The catalog's own version stays selectable.
        }
      }
      choices.push(...known.values());
    }
    return { status: "ready", choices: sortReviewedProfileChoices(choices) };
  } catch {
    return { status: "failed" };
  }
}
