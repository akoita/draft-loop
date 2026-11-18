import { formatDateTime } from "@draft-loop/ui/locale-format";
import { t } from "@lingui/core/macro";

import { type ApiClient, type ApiSchemas, describeError } from "./api-client.js";

type Me = ApiSchemas["Me"];
export type WaitlistEntry = ApiSchemas["BetaWaitlistEntry"];
export type BetaInvite = ApiSchemas["BetaInvite"];
export type FeedbackNote = ApiSchemas["FeedbackNote"];

/** A list the operator screen reads: loading, failed with a message, or ready. */
export type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly value: T };

/** The seats invites use and the cap, which the operator changes at runtime (#2998). */
export type BetaSeats = ApiSchemas["BetaSeats"];

export interface InviteList extends BetaSeats {
  readonly invites: readonly BetaInvite[];
}

/** What one Invite press on a waitlist entry gave: the plain code, shown once, or a refusal. */
export type InviteOutcome =
  | { readonly kind: "invited"; readonly email: string; readonly code: string }
  | { readonly kind: "failed"; readonly email: string; readonly message: string };

/**
 * Whether the caller reaches the operator routes (#2829): the owner token, or a member's
 * sign-in that `/v1/me` marks as the operator's. Any other member never sees the screen.
 */
export function canOperate(me: Me): boolean {
  return me.kind === "owner" || me.operator === true;
}

/** Newest first by an ISO 8601 time; the input is left as it was. */
export function newestFirst<T>(items: readonly T[], time: (item: T) => string): T[] {
  return [...items].sort((a, b) => time(b).localeCompare(time(a)));
}

type SeatCount = Pick<BetaSeats, "redeemed" | "open" | "cap">;

/** Seats still free once every open invite is used; never below zero. */
export function seatsLeft(list: SeatCount): number {
  return Math.max(0, list.cap - list.redeemed - list.open);
}

/**
 * Whether one more invite goes past the cap: every seat is used or promised to an open invite.
 * The invite is still allowed, but its person cannot sign up until a seat frees or the cap rises.
 */
export function inviteGoesPastCap(list: SeatCount): boolean {
  return list.redeemed + list.open >= list.cap;
}

/** An invite's state as the operator reads it. */
export function inviteStateLabel(state: BetaInvite["state"]): string {
  switch (state) {
    case "open":
      return t`Sent, not used yet`;
    case "redeemed":
      return t`Redeemed`;
    case "revoked":
      return t`Revoked`;
  }
}

/** A feedback note's kind and category in a few words. */
export function feedbackKindLabel(note: Pick<FeedbackNote, "kind" | "category">): string {
  if (note.kind === "support") return t`Support ticket`;
  switch (note.category) {
    case "bug":
      return t`Something is broken`;
    case "idea":
      return t`An idea`;
    case "other":
      return t`Something else`;
    default:
      return t`Note`;
  }
}

/** A stored time as people read it, in UTC. */
export function operatorTime(value: string, locale?: string): string {
  const time =
    formatDateTime(value, { timeZone: "UTC", ...(locale === undefined ? {} : { locale }) }) ??
    value;
  return `${time} UTC`;
}

async function settle<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { kind: "ready", value: await read() };
  } catch (error) {
    return { kind: "failed", message: describeError(error) };
  }
}

/** The waitlist, newest first; the API lists it oldest first. */
export function readWaitlist(client: ApiClient): Promise<Loaded<readonly WaitlistEntry[]>> {
  return settle(async () => {
    const { entries } = await client.call("GET /v1/operator/waitlist", {});
    return newestFirst(entries, (entry) => entry.joinedAt);
  });
}

/** The invites newest first, with the accounts they created and the cap. */
export function readInvites(client: ApiClient): Promise<Loaded<InviteList>> {
  return settle(async () => {
    const list = await client.call("GET /v1/operator/beta-invites", {});
    return { ...list, invites: newestFirst(list.invites, (invite) => invite.createdAt) };
  });
}

/** Members' notes and support tickets, newest first, as the API lists them. */
export function readFeedback(client: ApiClient): Promise<Loaded<readonly FeedbackNote[]>> {
  return settle(async () => {
    const { notes } = await client.call("GET /v1/operator/feedback", {});
    return newestFirst(notes, (note) => note.sentAt);
  });
}

/** Turns one waitlist entry into an invite; the API removes the entry and logs the audit line. */
export async function inviteFromWaitlist(
  client: ApiClient,
  entry: Pick<WaitlistEntry, "entryId" | "email">,
): Promise<InviteOutcome> {
  try {
    const created = await client.call("POST /v1/operator/waitlist/{entryId}/invite", {
      path: { entryId: entry.entryId },
    });
    return { kind: "invited", email: created.invite.email, code: created.code };
  } catch (error) {
    return { kind: "failed", email: entry.email, message: describeError(error) };
  }
}

/** The inbox's tabs (#3002): a note's triage status, as the operator reads it. */
export type FeedbackStatus = FeedbackNote["status"];
export const feedbackStatuses: readonly FeedbackStatus[] = ["new", "triaged", "issue", "closed"];

/** A tab's name. */
export function feedbackStatusLabel(status: FeedbackStatus): string {
  switch (status) {
    case "new":
      return t`New`;
    case "triaged":
      return t`Kept`;
    case "issue":
      return t`Linked to an issue`;
    case "closed":
      return t`Closed`;
  }
}

/** How many notes each tab holds. */
export function feedbackCounts(notes: readonly FeedbackNote[]): Record<FeedbackStatus, number> {
  const counts: Record<FeedbackStatus, number> = { new: 0, triaged: 0, issue: 0, closed: 0 };
  for (const note of notes) counts[note.status] += 1;
  return counts;
}

/** The list with one note replaced by its triaged copy; the order stays. */
export function replaceNote(
  notes: readonly FeedbackNote[],
  updated: FeedbackNote,
): readonly FeedbackNote[] {
  return notes.map((note) => (note.noteId === updated.noteId ? updated : note));
}

/** What one triage press asks: a status, and for `issue` the issue's address. */
export interface FeedbackTriage {
  readonly status: FeedbackStatus;
  readonly issueUrl?: string | null;
}

/** What a triage press gave: the stored note, or the API's refusal in words. */
export type TriageOutcome =
  | { readonly kind: "triaged"; readonly note: FeedbackNote }
  | { readonly kind: "failed"; readonly message: string };

/** Sets one note's status and issue link. */
export async function triageFeedback(
  client: ApiClient,
  noteId: string,
  triage: FeedbackTriage,
): Promise<TriageOutcome> {
  try {
    const note = await client.call("PATCH /v1/operator/feedback/{noteId}", {
      path: { noteId },
      body: {
        status: triage.status,
        ...(triage.issueUrl === undefined ? {} : { issueUrl: triage.issueUrl }),
      },
    });
    return { kind: "triaged", note };
  } catch (error) {
    return { kind: "failed", message: describeError(error) };
  }
}

/** How many notes wait in New, for the count on the Operator button; undefined when unread. */
export async function readNewFeedbackCount(client: ApiClient): Promise<number | undefined> {
  try {
    const { notes } = await client.call("GET /v1/operator/feedback", {
      query: { status: "new", limit: 500 },
    });
    return notes.length;
  } catch {
    return undefined;
  }
}

/** A GitHub issue address, the only kind of link a note takes. */
export function isIssueUrl(value: string): boolean {
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/u.test(value.trim());
}

/** The public repository the From feedback template lives in. */
export const feedbackIssueRepository = "https://github.com/akoita/draft-loop";

/**
 * GitHub's new-issue page with the From feedback template, prefilled with the note's technical
 * context and id. The member's words, the ids in view and the organisation never go in it: the
 * issue is public, and the operator writes the summary in their own words.
 */
export function draftIssueUrl(note: FeedbackNote): string {
  const { ids: _ids, ...context } = note.context ?? {};
  const body = [
    "## Summary",
    "",
    "<!-- What the member ran into, in your own anonymised words. Never their text, email or name. -->",
    "",
    "## Technical context",
    "",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    "## Note",
    "",
    `- Note id: ${note.noteId}`,
    `- Kind: ${note.kind === "support" ? "support" : (note.category ?? "not given")}`,
    "",
    "This issue never holds the member's words, email or name.",
  ].join("\n");
  const query = new URLSearchParams({
    template: "from-feedback.md",
    title: "[Feedback]: ",
    body,
  });
  return `${feedbackIssueRepository}/issues/new?${query.toString()}`;
}

/** Where a page address sends the operator: the page, and the note to show first, if any. */
export interface OperatorTarget {
  readonly noteId?: string;
}

/**
 * Reads `#operator`, `#operator/feedback` or `#operator/feedback/<noteId>`, the address the alert
 * email links to; any other fragment is not the operator page's.
 */
export function operatorTarget(hash: string): OperatorTarget | undefined {
  const match = /^#operator(?:\/feedback(?:\/([A-Za-z0-9-]{1,128}))?)?$/u.exec(hash);
  if (match === null) return undefined;
  return match[1] === undefined ? {} : { noteId: match[1] };
}
