/**
 * Pure model for creating an application (ADR 0010) and for the reviewed career profiles an
 * application can reuse. Home's New application form holds the draft; the application screen's
 * Profile step lists the reviewed profiles. Every state is testable without a DOM.
 */
import type { CandidateProfileSelection } from "./model.js";
import type { DesktopProfileCapabilities } from "./native.js";
import { parseReviewedCanonicalCandidateProfileCatalogResult } from "./profile-catalog.js";

// -- The new application's name and job ------------------------------------------------------

export type NewApplicationJobKind = "text" | "url" | "file";

/** A job description file the person attached, read in the browser; never a path. */
export interface NewApplicationJobFile {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface NewApplicationDraft {
  readonly name: string;
  readonly jobKind: NewApplicationJobKind;
  readonly jobText: string;
  readonly jobUrl: string;
  /** The person allowed DraftLoop to fetch the job page when requirements are extracted. */
  readonly urlApproved: boolean;
  /** The attached file, once read; null before one is chosen. */
  readonly jobFile: NewApplicationJobFile | null;
  /** Why the chosen file was refused, such as its type or size; null otherwise. */
  readonly jobFileProblem: string | null;
}

export const emptyNewApplicationDraft: NewApplicationDraft = Object.freeze({
  name: "",
  jobKind: "text",
  jobText: "",
  jobUrl: "",
  urlApproved: false,
  jobFile: null,
  jobFileProblem: null,
});

/** The job description files both hosts read, as career evidence: by extension, then type. */
const jobFileMediaTypes: Readonly<Record<string, string>> = Object.freeze({
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
});

/** The file input's `accept` list. */
export const newApplicationJobFileAccept = Object.keys(jobFileMediaTypes)
  .map((extension) => `.${extension}`)
  .join(",");

/** The largest job file taken, the career-evidence upload limit (10 MiB). */
export const newApplicationJobFileMaxBytes = 10 * 1024 * 1024;

export const newApplicationJobFileMessage = "Attach the job description file.";
export const newApplicationJobFileTypeMessage = "Attach a PDF, DOCX, Markdown or plain text file.";
export const newApplicationJobFileSizeMessage = "The file is larger than 10 MB.";

/** The media type a job file is read as, from its name; undefined for any other file. */
export function newApplicationJobFileMediaType(name: string): string | undefined {
  const extension = name.toLowerCase().match(/\.([a-z]+)$/u)?.[1];
  return extension === undefined ? undefined : jobFileMediaTypes[extension];
}

/**
 * The draft after the person chose a file: its bytes read, or the reason it cannot be used. The
 * size is checked before reading, so a large file is never read into memory.
 */
export async function withChosenJobFile(
  draft: NewApplicationDraft,
  file: Pick<File, "name" | "size" | "arrayBuffer">,
): Promise<NewApplicationDraft> {
  const mediaType = newApplicationJobFileMediaType(file.name);
  if (mediaType === undefined) {
    return { ...draft, jobFile: null, jobFileProblem: newApplicationJobFileTypeMessage };
  }
  if (file.size > newApplicationJobFileMaxBytes) {
    return { ...draft, jobFile: null, jobFileProblem: newApplicationJobFileSizeMessage };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { ...draft, jobFile: { name: file.name, mediaType, bytes }, jobFileProblem: null };
}

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
  if (draft.jobKind === "file") {
    return draft.jobFile === null ? (draft.jobFileProblem ?? newApplicationJobFileMessage) : null;
  }
  if (!isWebAddress(draft.jobUrl)) return newApplicationJobUrlMessage;
  return draft.urlApproved ? null : newApplicationUrlApprovalMessage;
}

/** The job as the application port takes it: pasted text, the approved URL, or the file. */
export function newApplicationJobInput(draft: NewApplicationDraft): NewApplicationJob {
  if (draft.jobKind === "file" && draft.jobFile !== null) return { file: draft.jobFile };
  return draft.jobKind === "url" ? { url: draft.jobUrl.trim() } : draft.jobText;
}

/** A new application's job: pasted text, an approved job page, or an attached file. */
export type NewApplicationJob =
  | string
  | { readonly url: string }
  | { readonly file: NewApplicationJobFile };

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
