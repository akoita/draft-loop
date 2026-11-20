import { randomUUID } from "node:crypto";
import { normalizeMemberEmail } from "@draft-loop/storage/tenant-directory";

import { type CreatedBetaInvite, insertBetaInvite } from "./beta-invites.js";
import {
  type OperatorListPage,
  pageLimit,
  pageOffset,
  searchPattern,
} from "./operator-list-page.js";
import type { SqlRow, SqlSession } from "./sql-client.js";

export interface BetaWaitlistEntry {
  readonly entryId: string;
  /** Trimmed and lower-cased. */
  readonly email: string;
  /** The version of the consent text the visitor accepted. */
  readonly consentVersion: string;
  readonly joinedAt: string;
}

/**
 * The public beta's waitlist (#2566). A visitor joins with an email and consent; the operator
 * lists the entries and turns one into an invite, which deletes the entry in the same transaction.
 */
export interface BetaWaitlist {
  /**
   * Adds the email as confirmed, where the deployment sends no mail; false when it was already
   * listed, which keeps the first consent, or when it {@link hasPlace already has a place}.
   */
  readonly join: (input: {
    readonly email: string;
    readonly consentVersion: string;
    readonly now: Date;
  }) => Promise<boolean>;
  /**
   * Adds the email unconfirmed with a new confirmation token's hash, or renews the token of an
   * unconfirmed entry. Resolves `send` when the caller should email the link: never for a
   * confirmed entry, nor sooner than `resendAfterMs` after the last email, nor past `maxSends`,
   * nor for an email that {@link hasPlace already has a place}, which stores nothing.
   */
  readonly joinUnconfirmed: (input: {
    readonly email: string;
    readonly consentVersion: string;
    readonly locale?: WaitlistLocale;
    /** SHA-256 of the token, in hex. */
    readonly tokenHash: string;
    readonly now: Date;
    readonly resendAfterMs: number;
    readonly maxSends: number;
  }) => Promise<"send" | "skip">;
  /**
   * Confirms the entry whose token hash matches and whose link is younger than `validMs`.
   * Resolves `confirmed` the first time, `again` for a link opened twice, and `unknown` for an
   * unknown or expired link, so operators hear of each sign-up once.
   */
  readonly confirm: (input: {
    readonly tokenHash: string;
    readonly now: Date;
    readonly validMs: number;
  }) => Promise<WaitlistConfirmOutcome>;
  /**
   * One page of entries still waiting, oldest first (the order people asked in): 50 when no limit
   * is given. An email holding an open or redeemed invite is left out.
   */
  readonly list: (page?: OperatorListPage) => Promise<readonly BetaWaitlistEntry[]>;
  /** How many waiting entries match the search, counted as `list` filters them. */
  readonly count: (query?: string) => Promise<number>;
  /**
   * Creates an invite for a confirmed entry's email and deletes the entry; undefined when unknown
   * or unconfirmed.
   */
  readonly invite: (input: {
    readonly entryId: string;
    readonly now: Date;
  }) => Promise<(CreatedBetaInvite & { readonly locale?: WaitlistLocale }) | undefined>;
  /** Deletes entries that joined before the cutoff; resolves how many went (#2568). */
  readonly deleteJoinedBefore: (cutoff: Date) => Promise<number>;
  /** Deletes unconfirmed entries whose last link was sent before the cutoff; resolves how many. */
  readonly deleteUnconfirmedBefore: (cutoff: Date) => Promise<number>;
}

export type WaitlistLocale = "en" | "fr";

export type WaitlistConfirmOutcome = "confirmed" | "again" | "unknown";

function iso(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function clock(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("A clock must be a valid date.");
  return now.toISOString();
}

/**
 * Entries whose email holds an open or redeemed invite are hidden: that person has an invite to
 * use or an account, and the entry stays only until retention deletes it (an entry made before an
 * invite sent outside the waitlist). Hiding them keeps the operator from inviting them twice; an
 * entry shows again if its invite is withdrawn.
 */
const notRedeemed = `NOT EXISTS (SELECT 1 FROM beta_invites AS invite
  WHERE invite.email = beta_waitlist.email AND invite.revoked_at IS NULL)`;

/**
 * An email already has a place when a beta invite for it is open or redeemed: its person has an
 * invite to use, or an account to sign in to. Joining the waitlist then stores nothing and sends
 * no mail; the route's answer stays the same, revealing nobody. Erasing an account deletes its
 * redeemed invite, so its person may join again. `$2` is the normalized email.
 */
const hasPlace = `EXISTS (SELECT 1 FROM beta_invites AS invite
  WHERE invite.email = $2 AND invite.revoked_at IS NULL)`;

/** Only confirmed entries wait for a place; the rest wait for their person to open the link. */
const confirmed = "confirmed_at IS NOT NULL";

const tokenHashPattern = /^[0-9a-f]{64}$/u;

function entryRecord(row: SqlRow): BetaWaitlistEntry {
  return {
    entryId: String(row.id),
    email: String(row.email),
    consentVersion: String(row.consent_version),
    joinedAt: iso(row.joined_at),
  };
}

export function createBetaWaitlist(client: SqlSession): BetaWaitlist {
  return {
    join: async ({ email, consentVersion, now }) => {
      const rows = await client.query(
        `INSERT INTO beta_waitlist (id, email, consent_version, joined_at)
         SELECT $1, $2, $3, $4 WHERE NOT ${hasPlace}
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [randomUUID(), normalizeMemberEmail(email), consentVersion, clock(now)],
      );
      return rows.length > 0;
    },

    joinUnconfirmed: async (input) => {
      if (!tokenHashPattern.test(input.tokenHash))
        throw new Error("A token hash is 64 hex digits.");
      const at = clock(input.now);
      const rows = await client.query(
        `INSERT INTO beta_waitlist (id, email, consent_version, joined_at, confirmed_at,
           confirm_token_hash, confirm_sent_at, confirm_sends, locale)
         SELECT $1, $2, $3, $4::timestamptz, NULL, $5, $4::timestamptz, 1, $6
          WHERE NOT ${hasPlace}
         ON CONFLICT (email) DO UPDATE SET
           confirm_token_hash = EXCLUDED.confirm_token_hash,
           confirm_sent_at = EXCLUDED.confirm_sent_at,
           confirm_sends = beta_waitlist.confirm_sends + 1,
           consent_version = EXCLUDED.consent_version,
           locale = EXCLUDED.locale
         WHERE beta_waitlist.confirmed_at IS NULL
           AND (beta_waitlist.confirm_sent_at IS NULL OR beta_waitlist.confirm_sent_at < $7)
           AND beta_waitlist.confirm_sends < $8
         RETURNING id`,
        [
          randomUUID(),
          normalizeMemberEmail(input.email),
          input.consentVersion,
          at,
          input.tokenHash,
          input.locale ?? null,
          new Date(input.now.getTime() - input.resendAfterMs).toISOString(),
          input.maxSends,
        ],
      );
      return rows.length > 0 ? "send" : "skip";
    },

    confirm: async ({ tokenHash, now, validMs }) => {
      if (!tokenHashPattern.test(tokenHash)) return "unknown";
      const since = new Date(now.getTime() - validMs).toISOString();
      // Only the click that sets confirmed_at counts as the first; a concurrent second click
      // waits on the row lock, then finds it set.
      const first = await client.query(
        `UPDATE beta_waitlist SET confirmed_at = $2
          WHERE confirm_token_hash = $1 AND confirm_sent_at >= $3 AND confirmed_at IS NULL
          RETURNING id`,
        [tokenHash, clock(now), since],
      );
      if (first.length > 0) return "confirmed";
      const known = await client.query(
        `SELECT id FROM beta_waitlist WHERE confirm_token_hash = $1 AND confirm_sent_at >= $2`,
        [tokenHash, since],
      );
      return known.length > 0 ? "again" : "unknown";
    },

    list: async (page) =>
      (
        await client.query(
          `SELECT id, email, consent_version, joined_at FROM beta_waitlist
            WHERE ($3::text IS NULL OR email ILIKE $3) AND ${confirmed} AND ${notRedeemed}
            ORDER BY joined_at, id LIMIT $1 OFFSET $2`,
          [pageLimit(page), pageOffset(page), searchPattern(page?.query) ?? null],
        )
      ).map(entryRecord),

    count: async (query) => {
      const [row] = await client.query(
        `SELECT count(*) AS total FROM beta_waitlist
          WHERE ($1::text IS NULL OR email ILIKE $1) AND ${confirmed} AND ${notRedeemed}`,
        [searchPattern(query) ?? null],
      );
      return Number(row?.total ?? 0);
    },

    invite: async ({ entryId, now }) =>
      client.transaction(async (executor) => {
        const [entry] = await executor.query(
          `DELETE FROM beta_waitlist WHERE id = $1 AND confirmed_at IS NOT NULL
            RETURNING email, locale`,
          [entryId],
        );
        if (entry === undefined) return undefined;
        const created = await insertBetaInvite(executor, { email: String(entry.email), now });
        const locale = entry.locale === "en" || entry.locale === "fr" ? entry.locale : undefined;
        return locale === undefined ? created : { ...created, locale };
      }),

    deleteJoinedBefore: async (cutoff) => {
      const rows = await client.query(
        "DELETE FROM beta_waitlist WHERE joined_at < $1 RETURNING id",
        [clock(cutoff)],
      );
      return rows.length;
    },

    deleteUnconfirmedBefore: async (cutoff) => {
      const rows = await client.query(
        `DELETE FROM beta_waitlist WHERE confirmed_at IS NULL AND confirm_sent_at < $1
          RETURNING id`,
        [clock(cutoff)],
      );
      return rows.length;
    },
  };
}
