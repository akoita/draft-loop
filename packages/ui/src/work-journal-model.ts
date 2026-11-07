import { t } from "@lingui/core/macro";
/**
 * The Work journal review's view model (#2024): the notes an agent recorded, as the candidate
 * reviews them on the Career evidence page. It only arranges what the API returns; the server
 * checks every edit, merges the content and refuses what screening holds.
 */

export type WorkJournalStatus = "pending" | "approved" | "merged" | "discarded";
export type WorkJournalTier = "normal" | "sensitive" | "never-share";
export type WorkJournalRole = "designed" | "implemented" | "directed" | "reviewed";

/** A note's content as the API returns and takes it. */
export interface WorkJournalContent {
  readonly title: string;
  readonly summary: string;
  readonly period: { readonly start: string; readonly end?: string };
  readonly project: {
    readonly name: string;
    readonly visibility: "public" | "private" | "unknown";
    readonly repository?: string;
  };
  readonly technologies: readonly string[];
  readonly category: string;
  readonly candidate_role: readonly WorkJournalRole[];
  readonly links: readonly { readonly kind: string; readonly url: string }[];
  readonly metrics: readonly { readonly description: string; readonly how_measured?: string }[];
}

/** A stored note, with only the fields the review shows or sends back. */
export interface WorkJournalReviewNote {
  readonly id: string;
  readonly status: WorkJournalStatus;
  readonly content: WorkJournalContent;
  readonly possible_duplicate_of: readonly string[];
  readonly screening: { readonly verdict: "clear" | "flagged" | "unscreened" };
  readonly created_at: string;
  /** The agent token that filed the note, when one did. */
  readonly agent_token_id?: string | undefined;
  /** The agent tokens that amended it since. */
  readonly amended_by_agent_token_ids?: readonly string[] | undefined;
}

/** Which agent tokens sent a note, in words; null when the owner filed it. */
export function workJournalProvenance(note: WorkJournalReviewNote): string | null {
  const amending = (note.amended_by_agent_token_ids ?? []).filter(
    (id) => id !== note.agent_token_id,
  );
  if (note.agent_token_id === undefined && amending.length === 0) return null;
  const filed =
    note.agent_token_id === undefined
      ? t`Filed without an agent token`
      : t`Filed by agent token ${note.agent_token_id}`;
  return amending.length === 0 ? `${filed}.` : `${filed}; amended by ${amending.join(", ")}.`;
}

/** What the review sends to the API's review route. */
export type WorkJournalReviewAction =
  | {
      readonly action: "approve";
      readonly knowledge_base_id: string;
      readonly tier?: WorkJournalTier;
    }
  | { readonly action: "edit"; readonly content: WorkJournalContent }
  | { readonly action: "merge"; readonly into: string; readonly keep_summary?: "into" | "this" }
  | { readonly action: "discard" };

export interface WorkJournalScreeningView {
  readonly kind: "clear" | "flagged" | "unscreened";
  /** Text first; colour only adds to it. */
  readonly label: string;
  /** Held back: the note can be edited or discarded, never approved, until it screens clear. */
  readonly held: boolean;
}

const roleLabels = (): Readonly<Record<WorkJournalRole, string>> => ({
  designed: t`Designed`,
  implemented: t`Implemented`,
  directed: t`Directed`,
  reviewed: t`Reviewed`,
});

export function workJournalRoleLabel(role: WorkJournalRole): string {
  return roleLabels()[role];
}

export function workJournalPeriod(period: WorkJournalContent["period"]): string {
  return period.end === undefined || period.end === period.start
    ? period.start
    : `${period.start} to ${period.end}`;
}

export function workJournalScreening(
  screening: WorkJournalReviewNote["screening"],
): WorkJournalScreeningView {
  switch (screening.verdict) {
    case "clear":
      return { kind: "clear", label: t`Screened: clear`, held: false };
    case "flagged":
      return { kind: "flagged", label: t`Quarantined: flagged`, held: true };
    case "unscreened":
      return { kind: "unscreened", label: t`Quarantined: not screened`, held: true };
  }
}

/** One pending note on the review list, with the pending notes it likely repeats. */
export interface WorkJournalReviewItem {
  readonly note: WorkJournalReviewNote;
  readonly duplicates: readonly WorkJournalReviewNote[];
  /** Merge when a likely duplicate is pending, so the candidate keeps one note for one piece of work. */
  readonly suggested: "merge" | "approve";
}

/** The pending notes, newest first, each with its pending likely duplicates side by side. */
export function workJournalReviewItems(
  notes: readonly WorkJournalReviewNote[],
): WorkJournalReviewItem[] {
  const pending = notes.filter((note) => note.status === "pending");
  const byId = new Map(pending.map((note) => [note.id, note]));
  return [...pending]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((note) => {
      const duplicates = note.possible_duplicate_of.flatMap((id) => {
        const other = byId.get(id);
        return other === undefined ? [] : [other];
      });
      return { note, duplicates, suggested: duplicates.length > 0 ? "merge" : "approve" };
    });
}

/** The fields the edit form changes; the rest of the content is sent back unchanged. */
export interface WorkJournalEditDraft {
  readonly title: string;
  readonly summary: string;
  /** Comma-separated. */
  readonly technologies: string;
  readonly roles: readonly WorkJournalRole[];
  readonly visibility: WorkJournalContent["project"]["visibility"];
}

export function workJournalEditDraft(content: WorkJournalContent): WorkJournalEditDraft {
  return {
    title: content.title,
    summary: content.summary,
    technologies: content.technologies.join(", "),
    roles: content.candidate_role,
    visibility: content.project.visibility,
  };
}

/** The edited content, or why the form cannot be sent; the server checks the rest. */
export function workJournalEditedContent(
  content: WorkJournalContent,
  draft: WorkJournalEditDraft,
): { readonly content: WorkJournalContent } | { readonly problem: string } {
  const technologies = [
    ...new Set(
      draft.technologies
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
  if (draft.title.trim().length === 0) return { problem: t`Give the note a title.` };
  if (draft.summary.trim().length === 0) return { problem: t`Keep a summary of the work.` };
  if (technologies.length === 0) return { problem: t`Name at least one technology.` };
  if (draft.roles.length === 0) return { problem: t`Choose what the candidate did.` };
  return {
    content: {
      ...content,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      technologies,
      candidate_role: draft.roles,
      project: { ...content.project, visibility: draft.visibility },
    },
  };
}

const refusals = (): Readonly<Record<string, string>> => ({
  note_quarantined: t`Screening holds this note. Edit it or discard it; it cannot be approved.`,
  note_not_pending: t`This note was already reviewed. Reload to see its status.`,
  note_not_found: t`This note is gone. Reload the list.`,
  approval_unavailable: t`This server cannot turn notes into career evidence yet.`,
  invalid_note: t`The server refused the edit. Check the title, summary and technologies.`,
  secret_like_content: t`The edit looks like it holds a key or password. Remove it and save again.`,
});

/** What to tell the candidate when the API refuses a review, from its content-free code. */
export function workJournalRefusal(code: string, message: string): string {
  return refusals()[code] ?? message;
}
