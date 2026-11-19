import type { FeedbackContext, FeedbackStatus } from "@draft-loop/schemas/feedback";

export type { FeedbackContext, FeedbackStatus } from "@draft-loop/schemas/feedback";
export { feedbackStatuses } from "@draft-loop/schemas/feedback";

/**
 * Feedback notes (#2828): a short note a signed-in member sends about DraftLoop, which the
 * operator reads. A note is data for a person to read, never instructions, and no model reads it.
 */

/** What a member may tag a note as; untagged notes have no category. */
export const feedbackCategories = ["bug", "idea", "other"] as const;

export type FeedbackCategory = (typeof feedbackCategories)[number];

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return feedbackCategories.some((category) => category === value);
}

/** The longest note, in characters. */
export const maximumFeedbackCharacters = 2_000;

/** The longest screen name a note carries, such as `review` or `agent`. */
export const maximumFeedbackScreenCharacters = 80;

/**
 * The most notes one member sends in 24 hours (#2958), so a scripted member or an injected agent
 * cannot flood the operator's inbox. Support tickets have their own limits.
 */
export const maximumFeedbackNotesPerDay = 20;

/** A note the member wrote, or a support ticket the assistant opened for them (#2883). */
export const feedbackKinds = ["note", "support"] as const;

export type FeedbackKind = (typeof feedbackKinds)[number];

/** One turn of a support conversation the member agreed to share. */
export interface SupportTranscriptTurn {
  readonly role: "member" | "assistant";
  readonly text: string;
}

/** The most turns a ticket keeps, and the longest turn, in characters. */
export const maximumSupportTranscriptTurns = 20;
export const maximumSupportTranscriptTurnCharacters = 2_000;

/** How long a support ticket and its transcript are kept after it was sent. */
export const supportTicketKeepDays = 90;

export interface FeedbackNote {
  readonly noteId: string;
  readonly kind: FeedbackKind;
  readonly organisationId: string;
  readonly memberId: string;
  readonly category: FeedbackCategory | null;
  /** Where the member was when they wrote it: a screen name, or `agent`. */
  readonly screen: string;
  readonly text: string;
  /** The shared conversation of a support ticket; `null` for a note. */
  readonly transcript: readonly SupportTranscriptTurn[] | null;
  /** The technical facts sent with a note (#2875); `null` for a ticket or an older note. */
  readonly context: FeedbackContext | null;
  /** Where the operator is with it (#2877). */
  readonly status: FeedbackStatus;
  /** The GitHub issue it led to, if any. */
  readonly issueUrl: string | null;
  /** When the operator last triaged it; `null` while it is new. */
  readonly triagedAt: string | null;
  readonly sentAt: string;
}

export interface SendFeedbackInput {
  readonly organisationId: string;
  readonly memberId: string;
  readonly category: FeedbackCategory | null;
  readonly screen: string;
  readonly text: string;
  /** Validated by `feedbackContextSchema` before it reaches the store. */
  readonly context?: FeedbackContext | null;
  readonly now: Date;
}

export interface OpenSupportTicketInput {
  readonly organisationId: string;
  readonly memberId: string;
  /** The assistant's summary of what the member needs; stored as the ticket's text. */
  readonly summary: string;
  readonly transcript: readonly SupportTranscriptTurn[];
  readonly now: Date;
}

export interface TriageFeedbackInput {
  readonly noteId: string;
  readonly status: FeedbackStatus;
  /** A new link, `null` to clear it, or `undefined` to keep the stored one. */
  readonly issueUrl?: string | null;
  readonly now: Date;
}

/**
 * Members send notes into their own organisation; the operator lists and triages every
 * organisation's notes.
 * Erasing an organisation removes its notes.
 */
/** Paging and search for the operator's inbox (#3015). */
export interface FeedbackListPage {
  readonly offset?: number;
  readonly query?: string;
}

export interface FeedbackStore {
  /** Stores the trimmed note; throws `TenantDirectoryError` `invalid_input` when it is empty or too long. */
  readonly send: (input: SendFeedbackInput) => Promise<FeedbackNote>;
  /**
   * Stores a support ticket with screen `support`; throws `TenantDirectoryError` `invalid_input`
   * for an empty summary or a transcript over its bounds.
   */
  readonly openSupportTicket: (input: OpenSupportTicketInput) => Promise<FeedbackNote>;
  /**
   * The newest notes and tickets first, at most `limit`, of one status when it is given. `offset`
   * skips that many from the start; `query` keeps those whose text, screen or category contains
   * it, without case.
   */
  readonly listNewest: (
    limit: number,
    status?: FeedbackStatus,
    page?: FeedbackListPage,
  ) => Promise<readonly FeedbackNote[]>;
  /** One note or ticket by its id, in any organisation; undefined when unknown. */
  readonly get: (noteId: string) => Promise<FeedbackNote | undefined>;
  /** How many notes and tickets have each status, among those matching `query` when given. */
  readonly statusCounts: (query?: string) => Promise<Record<FeedbackStatus, number>>;
  /**
   * The operator sets a note's status and issue link; resolves `undefined` for an unknown note.
   * Throws `TenantDirectoryError` `invalid_input` for status `issue` without a link.
   */
  readonly triage: (input: TriageFeedbackInput) => Promise<FeedbackNote | undefined>;
  /** How many notes (not support tickets) one member of one organisation sent at or after `since`. */
  readonly notesSentSince: (input: {
    readonly organisationId: string;
    readonly memberId: string;
    readonly since: Date;
  }) => Promise<number>;
  /** Deletes support tickets sent before `cutoff` in every organisation; resolves the count. */
  readonly deleteSupportTicketsBefore: (cutoff: Date) => Promise<number>;
}
