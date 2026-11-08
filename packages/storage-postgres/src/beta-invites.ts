import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  normalizeMemberEmail,
  requireOrganisationName,
} from "@draft-loop/storage/tenant-directory";
import type { SqlRow, SqlSession } from "./sql-client.js";

/** Serialises redemptions so two at the last seat cannot both pass the cap. */
const betaInviteLockKey = 0x62657461;

/** Unambiguous letters and digits: no 0/O, 1/I/L. */
const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const codeLength = 16;

export interface BetaInvite {
  readonly inviteId: string;
  /** Trimmed and lower-cased. */
  readonly email: string;
  readonly createdAt: string;
  readonly state: "open" | "revoked" | "redeemed";
  /** The organisation the redemption created; absent until redeemed. */
  readonly organisationId?: string;
  readonly redeemedAt?: string;
  readonly revokedAt?: string;
}

/** A new invite and its plain code, which is never stored and cannot be read again. */
export interface CreatedBetaInvite {
  readonly invite: BetaInvite;
  readonly code: string;
}

export type BetaInviteRefusal =
  | "invite_unknown"
  | "invite_revoked"
  | "invite_used"
  | "invite_email_mismatch"
  | "beta_full";

export type RedeemBetaInviteResult =
  | { readonly redeemed: true; readonly organisationId: string; readonly memberId: string }
  | { readonly redeemed: false; readonly refusal: BetaInviteRefusal };

export interface RedeemBetaInviteInput {
  readonly code: string;
  /** The sign-in's verified email; the invite must name it. */
  readonly verifiedEmail: string;
  /** The most redeemed invites the beta allows; 0 closes sign-up. */
  readonly cap: number;
  readonly organisationName: string;
  readonly now: Date;
}

/**
 * The public beta's single-use invite codes (#2501). Redeeming one creates the person's
 * organisation and invites them as its owner with the invite's email, in one transaction with the
 * code and cap checks; the directory's sign-in then claims that pending owner as for any invite.
 */
export interface BetaInvites {
  readonly create: (input: {
    readonly email: string;
    readonly now: Date;
  }) => Promise<CreatedBetaInvite>;
  /** Every invite, newest first, without codes. */
  readonly list: () => Promise<readonly BetaInvite[]>;
  /** Revokes an open invite. False when it is unknown, already revoked or redeemed. */
  readonly revoke: (input: { readonly inviteId: string; readonly now: Date }) => Promise<boolean>;
  readonly redeem: (input: RedeemBetaInviteInput) => Promise<RedeemBetaInviteResult>;
  /** Invites redeemed so far: the accounts the cap counts. */
  readonly redeemedCount: () => Promise<number>;
}

export class BetaInviteError extends Error {
  override readonly name = "BetaInviteError";
}

/** A new code: 16 characters from a 31-letter alphabet, about 79 bits. */
export function newBetaInviteCode(): string {
  const bytes = randomBytes(codeLength);
  let code = "";
  for (const byte of bytes) code += codeAlphabet[byte % codeAlphabet.length];
  return code;
}

/** Codes are compared without case, spaces or dashes, so a typed code matches a printed one. */
export function normalizeBetaInviteCode(code: string): string {
  return code.replaceAll(/[\s-]/gu, "").toUpperCase();
}

function codeHash(code: string): string {
  return createHash("sha256").update(normalizeBetaInviteCode(code)).digest("hex");
}

function requireCap(cap: number): void {
  if (!Number.isInteger(cap) || cap < 0) {
    throw new BetaInviteError("The beta account cap must be a whole number of 0 or more.");
  }
}

function iso(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function clock(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new BetaInviteError("A clock must be a valid date.");
  return now.toISOString();
}

const inviteColumns = "id, email, created_at, revoked_at, redeemed_at, organisation_id";

function inviteRecord(row: SqlRow): BetaInvite {
  const state =
    row.redeemed_at !== null ? "redeemed" : row.revoked_at !== null ? "revoked" : "open";
  return {
    inviteId: String(row.id),
    email: String(row.email),
    createdAt: iso(row.created_at),
    state,
    ...(row.organisation_id === null ? {} : { organisationId: String(row.organisation_id) }),
    ...(row.redeemed_at === null ? {} : { redeemedAt: iso(row.redeemed_at) }),
    ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
  };
}

export function createBetaInvites(client: SqlSession): BetaInvites {
  return {
    create: async ({ email, now }) => {
      const normalized = normalizeMemberEmail(email);
      const code = newBetaInviteCode();
      const [row] = await client.query(
        `INSERT INTO beta_invites (id, code_hash, email, created_at) VALUES ($1, $2, $3, $4)
         RETURNING ${inviteColumns}`,
        [randomUUID(), codeHash(code), normalized, clock(now)],
      );
      if (row === undefined) throw new Error("The invite was not recorded");
      return { invite: inviteRecord(row), code };
    },

    list: async () =>
      (
        await client.query(`SELECT ${inviteColumns} FROM beta_invites ORDER BY created_at DESC, id`)
      ).map(inviteRecord),

    revoke: async ({ inviteId, now }) => {
      const rows = await client.query(
        `UPDATE beta_invites SET revoked_at = $2
          WHERE id = $1 AND revoked_at IS NULL AND redeemed_at IS NULL RETURNING id`,
        [inviteId, clock(now)],
      );
      return rows.length > 0;
    },

    redeem: async (input) => {
      requireCap(input.cap);
      const email = normalizeMemberEmail(input.verifiedEmail);
      const name = requireOrganisationName(input.organisationName);
      const at = clock(input.now);
      return client.transaction(async (executor): Promise<RedeemBetaInviteResult> => {
        await executor.query("SELECT pg_advisory_xact_lock($1)", [betaInviteLockKey]);
        const [invite] = await executor.query(
          `SELECT ${inviteColumns} FROM beta_invites WHERE code_hash = $1 FOR UPDATE`,
          [codeHash(input.code)],
        );
        if (invite === undefined) return { redeemed: false, refusal: "invite_unknown" };
        if (invite.revoked_at !== null) return { redeemed: false, refusal: "invite_revoked" };
        if (invite.redeemed_at !== null) return { redeemed: false, refusal: "invite_used" };
        if (String(invite.email) !== email) {
          return { redeemed: false, refusal: "invite_email_mismatch" };
        }
        const [counted] = await executor.query(
          "SELECT count(*) AS redeemed FROM beta_invites WHERE redeemed_at IS NOT NULL",
        );
        if (Number(counted?.redeemed ?? 0) >= input.cap) {
          return { redeemed: false, refusal: "beta_full" };
        }

        const organisationId = `beta-${randomUUID()}`;
        const memberId = randomUUID();
        await executor.query("SELECT set_config('draft_loop.tenant_id', $1, true)", [
          organisationId,
        ]);
        await executor.query("INSERT INTO organisations (id, name) VALUES ($1, $2)", [
          organisationId,
          name,
        ]);
        await executor.query(
          `INSERT INTO organisation_members (id, email, role, status) VALUES ($1, $2, 'owner', 'invited')`,
          [memberId, email],
        );
        await executor.query(
          "UPDATE beta_invites SET redeemed_at = $2, organisation_id = $3 WHERE id = $1",
          [invite.id, at, organisationId],
        );
        return { redeemed: true, organisationId, memberId };
      });
    },

    redeemedCount: async () => {
      const [row] = await client.query(
        "SELECT count(*) AS redeemed FROM beta_invites WHERE redeemed_at IS NOT NULL",
      );
      return Number(row?.redeemed ?? 0);
    },
  };
}
