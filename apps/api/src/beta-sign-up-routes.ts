import type { BetaInviteRefusal, BetaInvites } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import type { ResolveSignIn } from "./oidc-sign-in.js";
import { signUpRoute } from "./request-auth.js";

/** What the sign-up route needs besides the invites: the sign-in claim and the Beta plan. */
export interface BetaSignUpOptions {
  readonly invites: BetaInvites;
  /** The most accounts invites may create; 0 closes sign-up. */
  readonly cap: number;
  /** In sign-in mode, so a redeemed invite's owner is claimed on the same request. */
  readonly resolveSignIn?: ResolveSignIn;
  /** Assigns the new organisation the Beta plan. */
  readonly assignBetaPlan?: (organisationId: string, at: Date) => Promise<void>;
  /** Records the new organisation's first activity, so retention counts from sign-up (#2538). */
  readonly recordActivity?: (organisationId: string) => Promise<void>;
  readonly now?: () => Date;
  /** Refused redemptions one sign-in may make in a window before it waits (default 5). */
  readonly refusedAttempts?: number;
  readonly windowMs?: number;
}

/** Reads `DRAFT_LOOP_BETA_ACCOUNT_CAP`: unset or 0 closes invite sign-up. */
export function readBetaAccountCap(env: NodeJS.ProcessEnv): number {
  const text = env.DRAFT_LOOP_BETA_ACCOUNT_CAP ?? "";
  if (text.trim() === "") return 0;
  const cap = Number(text);
  if (!/^\d+$/u.test(text.trim()) || cap > 100_000) {
    throw new Error("DRAFT_LOOP_BETA_ACCOUNT_CAP must be a whole number from 0 to 100000.");
  }
  return cap;
}

const refusalStatus: Readonly<Record<BetaInviteRefusal, 403 | 404 | 409>> = {
  invite_unknown: 404,
  invite_revoked: 403,
  invite_email_mismatch: 403,
  invite_used: 409,
  beta_full: 409,
};

const refusalMessage: Readonly<Record<BetaInviteRefusal, string>> = {
  invite_unknown: "No invite has that code.",
  invite_revoked: "That invite was withdrawn.",
  invite_email_mismatch: "That invite is for another email address.",
  invite_used: "That invite has already been used.",
  beta_full: "The beta is full for now.",
};

const inviteSchema = z
  .object({
    inviteId: z.string(),
    email: z.string(),
    createdAt: z.string(),
    state: z.enum(["open", "revoked", "redeemed"]),
    organisationId: z.string().optional(),
    redeemedAt: z.string().optional(),
    revokedAt: z.string().optional(),
  })
  .meta({ id: "BetaInvite" });

const createdInviteSchema = z
  .object({
    invite: inviteSchema,
    code: z.string().describe("The plain code, shown once: it is stored only as a hash."),
  })
  .meta({ id: "CreatedBetaInvite" });

const signedUpSchema = z
  .object({ organisationId: z.string(), memberId: z.string(), role: z.literal("owner") })
  .meta({ id: "SignedUp" });

interface Attempts {
  readonly start: number;
  refused: number;
}

/**
 * The public beta's invite routes (#2502): the operator creates, lists and revokes codes with the
 * owner token, and a verified sign-in without an account redeems one at `POST /v1/sign-up`.
 */
export function registerBetaSignUpRoutes(
  parent: FastifyInstance,
  options: BetaSignUpOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { invites } = options;
  const now = options.now ?? (() => new Date());
  const limit = options.refusedAttempts ?? 5;
  const windowMs = options.windowMs ?? 15 * 60_000;
  const attempts = new Map<string, Attempts>();

  const attemptsFor = (key: string, at: number): Attempts => {
    const current = attempts.get(key);
    if (current !== undefined && at - current.start < windowMs) return current;
    for (const [other, entry] of attempts) {
      if (at - entry.start >= windowMs) attempts.delete(other);
    }
    const fresh = { start: at, refused: 0 };
    attempts.set(key, fresh);
    return fresh;
  };

  app.post(
    "/v1/operator/beta-invites",
    {
      schema: {
        summary: "Create a single-use beta invite code for one email",
        description: "Operator only. The answer carries the plain code once.",
        body: z.strictObject({ email: z.string().max(320) }),
        response: { 201: createdInviteSchema, 400: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async (request, reply) => {
      let created: Awaited<ReturnType<BetaInvites["create"]>>;
      try {
        created = await invites.create({ email: request.body.email, now: now() });
      } catch (error) {
        if ((error as Error).name !== "TenantDirectoryError") throw error;
        return reply.code(400).send(apiError("invalid_input", "That is not an email address."));
      }
      request.log.info(
        { audit: { action: "beta_invite_created", inviteId: created.invite.inviteId } },
        "audit",
      );
      return reply.code(201).send(created);
    },
  );

  app.get(
    "/v1/operator/beta-invites",
    {
      schema: {
        summary: "List beta invites, the accounts they created and the cap",
        description: "Operator only. Codes are never listed.",
        response: {
          200: z.object({
            invites: z.array(inviteSchema),
            redeemed: z.number().int(),
            cap: z.number().int(),
          }),
          403: apiErrorSchema,
        },
      },
    },
    async () => ({
      invites: [...(await invites.list())],
      redeemed: await invites.redeemedCount(),
      cap: options.cap,
    }),
  );

  app.delete(
    "/v1/operator/beta-invites/:inviteId",
    {
      schema: {
        summary: "Revoke an open beta invite",
        description: "Operator only. A redeemed or revoked invite answers 404.",
        params: z.strictObject({ inviteId: z.string().min(1).max(128) }),
        response: { 204: z.null(), 403: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const revoked = await invites.revoke({ inviteId: request.params.inviteId, now: now() });
      if (!revoked) {
        return reply.code(404).send(apiError("not_found", "No open invite has that id."));
      }
      request.log.info(
        { audit: { action: "beta_invite_revoked", inviteId: request.params.inviteId } },
        "audit",
      );
      return reply.code(204).send(null);
    },
  );

  app.post(
    signUpRoute,
    {
      schema: {
        summary: "Create your account from a beta invite code",
        description:
          "Takes a verified sign-in that has no account yet. The code must be open and name the sign-in's verified email, and the beta must have room: 404 invite_unknown, 403 invite_revoked or invite_email_mismatch, 409 invite_used, beta_full or already_member, 429 rate_limited after repeated refusals. The new organisation gets the Beta plan, and the caller is its owner.",
        body: z.strictObject({ code: z.string().min(1).max(64) }),
        response: {
          201: signedUpSchema,
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.caller?.kind === "member") {
        return reply
          .code(409)
          .send(apiError("already_member", "This sign-in already has an account."));
      }
      const identity = request.signUpIdentity;
      if (identity === undefined || options.resolveSignIn === undefined) {
        return reply
          .code(403)
          .send(apiError("forbidden", "Sign up with a verified sign-in, not the owner token."));
      }
      if (!identity.emailVerified || identity.email === undefined) {
        return reply
          .code(403)
          .send(apiError("email_unverified", "Verify your email address before signing up."));
      }
      const at = now();
      const key = `${identity.issuer}\n${identity.subject}`;
      const window = attemptsFor(key, at.getTime());
      if (window.refused >= limit) {
        request.log.warn({ event: "rate_limited", scope: "sign_up" }, "request rate limited");
        const wait = Math.max(1, Math.ceil((window.start + windowMs - at.getTime()) / 1000));
        return reply
          .code(429)
          .header("retry-after", String(wait))
          .send(apiError("rate_limited", "Too many attempts; retry later."));
      }

      const result = await invites.redeem({
        code: request.body.code,
        verifiedEmail: identity.email,
        cap: options.cap,
        organisationName: "My applications",
        now: at,
      });
      if (!result.redeemed) {
        window.refused += 1;
        request.log.info({ event: "sign_up_refused", refusal: result.refusal }, "sign-up refused");
        return reply
          .code(refusalStatus[result.refusal])
          .send(apiError(result.refusal, refusalMessage[result.refusal]));
      }
      await options.assignBetaPlan?.(result.organisationId, at);
      await options.recordActivity?.(result.organisationId);
      const member = await options.resolveSignIn(identity);
      request.log.info(
        {
          audit: {
            action: "beta_invite_redeemed",
            organisationId: result.organisationId,
            memberId: result.memberId,
          },
        },
        "audit",
      );
      return reply.code(201).send({
        organisationId: member?.tenantId ?? result.organisationId,
        memberId: member?.memberId ?? result.memberId,
        role: "owner" as const,
      });
    },
  );
}
