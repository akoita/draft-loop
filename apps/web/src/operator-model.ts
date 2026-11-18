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

export type InviteState = BetaInvite["state"];
export const inviteStates: readonly InviteState[] = ["open", "redeemed", "revoked"];

/** One page of invites with the seats, and how many match the search in all and per state. */
export interface InviteList extends BetaSeats {
  readonly invites: readonly BetaInvite[];
  readonly total: number;
  readonly counts: Record<InviteState, number>;
}

/** One page of the waitlist and how many entries match the search. */
export interface WaitlistPage {
  readonly entries: readonly WaitlistEntry[];
  readonly total: number;
}

/** One page of the inbox, how many notes match, and each tab's count for the search. */
export interface FeedbackPage {
  readonly notes: readonly FeedbackNote[];
  readonly total: number;
  readonly counts: Record<FeedbackNote["status"], number>;
}

/** Rows an operator list reads at a time (#3015); Show more reads the next ones. */
export const operatorPageSize = 50;

/** Where a list read starts and what it looks for. */
export interface ListRequest {
  /** Rows already shown; the read starts after them. */
  readonly offset?: number;
  /** Text the rows must contain; blank reads every row. */
  readonly query?: string;
}

function pageQuery(request: ListRequest) {
  const query = request.query?.trim() ?? "";
  return {
    limit: operatorPageSize,
    offset: request.offset ?? 0,
    ...(query === "" ? {} : { q: query.slice(0, 200) }),
  };
}

/** The first list followed by the rows of `more` it does not hold yet, in their order. */
export function appendUnique<T>(
  first: readonly T[],
  more: readonly T[],
  key: (item: T) => string,
): readonly T[] {
  const seen = new Set(first.map(key));
  return [...first, ...more.filter((item) => !seen.has(key(item)))];
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

/** One page of the waitlist, oldest first: the order people asked in, and the order to invite. */
export function readWaitlist(
  client: ApiClient,
  request: ListRequest = {},
): Promise<Loaded<WaitlistPage>> {
  return settle(() => client.call("GET /v1/operator/waitlist", { query: pageQuery(request) }));
}

/** One page of invites, newest first, with the seats and each state's count. */
export function readInvites(
  client: ApiClient,
  request: ListRequest & { readonly state?: InviteState | undefined } = {},
): Promise<Loaded<InviteList>> {
  return settle(() =>
    client.call("GET /v1/operator/beta-invites", {
      query: {
        ...pageQuery(request),
        ...(request.state === undefined ? {} : { state: request.state }),
      },
    }),
  );
}

/** One page of one inbox tab, newest first, with each tab's count. */
export function readFeedback(
  client: ApiClient,
  request: ListRequest & { readonly status?: FeedbackStatus | undefined } = {},
): Promise<Loaded<FeedbackPage>> {
  return settle(() =>
    client.call("GET /v1/operator/feedback", {
      query: {
        ...pageQuery(request),
        ...(request.status === undefined ? {} : { status: request.status }),
      },
    }),
  );
}

/** The note an address names, wherever it sits; undefined when it cannot be read. */
export async function readFeedbackNote(
  client: ApiClient,
  noteId: string,
): Promise<FeedbackNote | undefined> {
  try {
    return await client.call("GET /v1/operator/feedback/{noteId}", { path: { noteId } });
  } catch {
    return undefined;
  }
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

/**
 * The counts once a triage moved notes between tabs: each moved note leaves its old tab and
 * joins its new one.
 */
export function movedCounts(
  counts: Record<FeedbackStatus, number>,
  moves: readonly { readonly from: FeedbackStatus; readonly to: FeedbackStatus }[],
): Record<FeedbackStatus, number> {
  const next = { ...counts };
  for (const { from, to } of moves) {
    if (from === to) continue;
    next[from] = Math.max(0, next[from] - 1);
    next[to] += 1;
  }
  return next;
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
    const { counts } = await client.call("GET /v1/operator/feedback", {
      query: { status: "new", limit: 1 },
    });
    return counts.new;
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
