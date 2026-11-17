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

export interface InviteList {
  readonly invites: readonly BetaInvite[];
  /** Accounts the invites created. */
  readonly redeemed: number;
  /** The most accounts invites may create (`readBetaAccountCap`). */
  readonly cap: number;
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

/** Accounts invites may still create; never below zero. */
export function seatsLeft(list: Pick<InviteList, "redeemed" | "cap">): number {
  return Math.max(0, list.cap - list.redeemed);
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
