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
  /** Adds the email; false when it was already listed, which keeps the first consent. */
  readonly join: (input: {
    readonly email: string;
    readonly consentVersion: string;
    readonly now: Date;
  }) => Promise<boolean>;
  /**
   * One page of entries still waiting, oldest first (the order people asked in): 50 when no limit
   * is given. An email that already redeemed an invite has an account and is left out.
   */
  readonly list: (page?: OperatorListPage) => Promise<readonly BetaWaitlistEntry[]>;
  /** How many waiting entries match the search, counted as `list` filters them. */
  readonly count: (query?: string) => Promise<number>;
  /** Creates an invite for the entry's email and deletes the entry; undefined when unknown. */
  readonly invite: (input: {
    readonly entryId: string;
    readonly now: Date;
  }) => Promise<CreatedBetaInvite | undefined>;
  /** Deletes entries that joined before the cutoff; resolves how many went (#2568). */
  readonly deleteJoinedBefore: (cutoff: Date) => Promise<number>;
}

function iso(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function clock(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("A clock must be a valid date.");
  return now.toISOString();
}

/**
 * Entries whose email already redeemed an invite are hidden: that person has an account, and the
 * entry stays only until retention deletes it (an invite made outside the waitlist, or a join after
 * the account existed). Hiding them keeps the operator from inviting an existing account again.
 */
const notRedeemed = `NOT EXISTS (SELECT 1 FROM beta_invites AS invite
  WHERE invite.email = beta_waitlist.email AND invite.redeemed_at IS NOT NULL)`;

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
        `INSERT INTO beta_waitlist (id, email, consent_version, joined_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [randomUUID(), normalizeMemberEmail(email), consentVersion, clock(now)],
      );
      return rows.length > 0;
    },

    list: async (page) =>
      (
        await client.query(
          `SELECT id, email, consent_version, joined_at FROM beta_waitlist
            WHERE ($3::text IS NULL OR email ILIKE $3) AND ${notRedeemed}
            ORDER BY joined_at, id LIMIT $1 OFFSET $2`,
          [pageLimit(page), pageOffset(page), searchPattern(page?.query) ?? null],
        )
      ).map(entryRecord),

    count: async (query) => {
      const [row] = await client.query(
        `SELECT count(*) AS total FROM beta_waitlist
          WHERE ($1::text IS NULL OR email ILIKE $1) AND ${notRedeemed}`,
        [searchPattern(query) ?? null],
      );
      return Number(row?.total ?? 0);
    },

    invite: async ({ entryId, now }) =>
      client.transaction(async (executor) => {
        const [entry] = await executor.query(
          "DELETE FROM beta_waitlist WHERE id = $1 RETURNING email",
          [entryId],
        );
        if (entry === undefined) return undefined;
        return insertBetaInvite(executor, { email: String(entry.email), now });
      }),

    deleteJoinedBefore: async (cutoff) => {
      const rows = await client.query(
        "DELETE FROM beta_waitlist WHERE joined_at < $1 RETURNING id",
        [clock(cutoff)],
      );
      return rows.length;
    },
  };
}
