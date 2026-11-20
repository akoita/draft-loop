import { createHash, randomBytes } from "node:crypto";
import type { BetaWaitlist } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { writeAuditLine } from "./audit-line.js";
import { emailInvite } from "./beta-sign-up-routes.js";
import { apiError, apiErrorSchema } from "./errors.js";
import type { InviteMailer } from "./invite-mail.js";
import { operatorPageQuery } from "./operator-page-query.js";
import { type WaitlistConfirmMailer, waitlistConfirmHours } from "./waitlist-confirm-mail.js";

/** Public: a visitor joins before any account exists. Listed with the public routes. */
export const waitlistPath = "/v1/waitlist";

/**
 * The version of the consent text the landing page shows next to the checkbox. Change it with
 * the text, so each entry records which words its person agreed to.
 */
export const betaWaitlistConsentVersion = "waitlist-2026-11-08";

/** The public route a confirmation link's screen posts its token to. */
export const waitlistConfirmPath = "/v1/waitlist/confirm";

/** Joins one address may send per window; more answer 429. */
export const waitlistJoinsPerWindow = 5;
export const waitlistWindowMs = 60 * 60 * 1000;

/** Confirmation emails one email address may receive: at most 3, at least 10 minutes apart. */
export const waitlistConfirmSends = 3;
export const waitlistResendAfterMs = 10 * 60 * 1000;

const entrySchema = z
  .object({
    entryId: z.string(),
    email: z.string(),
    consentVersion: z.string(),
    joinedAt: z.string(),
  })
  .meta({ id: "BetaWaitlistEntry" });

export interface BetaWaitlistRoutesOptions {
  readonly waitlist: BetaWaitlist;
  /** Emails each new invite's link; without it the operator sends the code themselves. */
  readonly inviteMailer?: InviteMailer;
  /**
   * Emails a confirmation link to each new sign-up, which waits unconfirmed until it is opened.
   * Without it, a sign-up is listed at once.
   */
  readonly confirmMailer?: WaitlistConfirmMailer;
  readonly now?: () => Date;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The public beta's waitlist (#2566). A visitor joins with an email and consent; the answer is
 * the same whether the email was new or already listed, so the route reveals nobody. The operator
 * lists the entries and turns one into an invite code.
 */
export function registerBetaWaitlistRoutes(
  parent: FastifyInstance,
  options: BetaWaitlistRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { waitlist, confirmMailer } = options;
  const now = options.now ?? (() => new Date());
  const windows = new Map<string, { start: number; joins: number }>();

  const admit = (address: string, at: number): boolean => {
    for (const [key, window] of windows) {
      if (at - window.start >= waitlistWindowMs) windows.delete(key);
    }
    const window = windows.get(address) ?? { start: at, joins: 0 };
    window.joins += 1;
    windows.set(address, window);
    return window.joins <= waitlistJoinsPerWindow;
  };

  app.post(
    waitlistPath,
    {
      bodyLimit: 2 * 1024,
      schema: {
        summary: "Join the beta waitlist",
        description:
          "Public. Takes an email and the visitor's consent to keep it until they are invited, for at most six months. Where the server sends mail, a new email gets a confirmation link valid 48 hours, and waits unconfirmed until it is opened; one address gets at most 3 links, 10 minutes apart. `confirm` says whether this server asks for that. Answers 202 whether or not the email was already listed. 400 invalid_input for an address that is not an email, 429 rate_limited after 5 joins in an hour from one address.",
        security: [],
        body: z.strictObject({
          email: z.string().max(320),
          consent: z.literal(true),
          locale: z
            .enum(["en", "fr"])
            .optional()
            .describe("The screen's language, so the emails speak it."),
        }),
        response: {
          202: z.object({
            listed: z.literal(true),
            confirm: z
              .boolean()
              .describe("True when the visitor must open the emailed link to keep their place."),
          }),
          400: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const at = now();
      if (!admit(request.ip, at.getTime())) {
        return reply.code(429).send(apiError("rate_limited", "Too many requests; retry later."));
      }
      const { email, locale } = request.body;
      try {
        if (confirmMailer === undefined) {
          const joined = await waitlist.join({
            email,
            consentVersion: betaWaitlistConsentVersion,
            now: at,
          });
          request.log.info({ event: "waitlist_join", joined }, "waitlist join");
        } else {
          // The email holds the token; the database keeps only its hash.
          const token = randomBytes(24).toString("base64url");
          const outcome = await waitlist.joinUnconfirmed({
            email,
            consentVersion: betaWaitlistConsentVersion,
            ...(locale === undefined ? {} : { locale }),
            tokenHash: tokenHash(token),
            now: at,
            resendAfterMs: waitlistResendAfterMs,
            maxSends: waitlistConfirmSends,
          });
          const emailed =
            outcome === "send" &&
            (await confirmMailer({
              email,
              token,
              ...(locale === undefined ? {} : { locale }),
            }));
          request.log.info(
            { event: "waitlist_join", confirmation: outcome, emailed },
            "waitlist join",
          );
        }
      } catch (error) {
        if ((error as Error).name !== "TenantDirectoryError") throw error;
        return reply.code(400).send(apiError("invalid_input", "That is not an email address."));
      }
      return reply.code(202).send({ listed: true as const, confirm: confirmMailer !== undefined });
    },
  );

  app.post(
    waitlistConfirmPath,
    {
      bodyLimit: 1024,
      schema: {
        summary: "Confirm a waitlist sign-up's email",
        description:
          "Public. Takes the token from the confirmation email's link. 200 when the entry is confirmed, also for a link opened twice. 404 invalid_token for an unknown token or a link older than 48 hours. 429 rate_limited after 5 attempts in an hour from one address.",
        security: [],
        body: z.strictObject({ token: z.string().min(16).max(128) }),
        response: {
          200: z.object({ confirmed: z.literal(true) }),
          404: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const at = now();
      if (!admit(`confirm:${request.ip}`, at.getTime())) {
        return reply.code(429).send(apiError("rate_limited", "Too many requests; retry later."));
      }
      const outcome = await waitlist.confirm({
        tokenHash: tokenHash(request.body.token),
        now: at,
        validMs: waitlistConfirmHours * 60 * 60 * 1000,
      });
      // `first` is true once per sign-up, so an operator alert on it never repeats (#3208).
      request.log.info(
        {
          event: "waitlist_confirm",
          confirmed: outcome !== "unknown",
          first: outcome === "confirmed",
        },
        "waitlist confirm",
      );
      if (outcome === "unknown") {
        return reply
          .code(404)
          .send(apiError("invalid_token", "That link is unknown or has expired."));
      }
      return reply.code(200).send({ confirmed: true as const });
    },
  );

  app.get(
    "/v1/operator/waitlist",
    {
      schema: {
        summary: "List the beta waitlist, oldest first",
        description:
          "Operator only. One page: at most `limit` entries, 50 by default, after skipping `offset`. `q` keeps entries whose email contains it, without case. `total` counts every matching entry.",
        querystring: operatorPageQuery,
        response: {
          200: z.object({ entries: z.array(entrySchema), total: z.number().int() }),
          403: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset, q } = request.query;
      const [entries, total] = await Promise.all([
        waitlist.list({ limit, offset, ...(q === undefined ? {} : { query: q }) }),
        waitlist.count(q),
      ]);
      // Never the search text, which may be an email.
      writeAuditLine(request, "waitlist_listed", {
        listed: entries.length,
        searched: q !== undefined,
      });
      return { entries: [...entries], total };
    },
  );

  app.post(
    "/v1/operator/waitlist/:entryId/invite",
    {
      schema: {
        summary: "Turn a waitlist entry into a beta invite",
        description:
          "Operator only. Creates an invite for the entry's email, deletes the entry and emails the person a sign-up link with the code where mail is on; `emailed` says whether it went. The answer carries the plain code once. 404 when no entry has that id.",
        params: z.strictObject({ entryId: z.string().min(1).max(128) }),
        response: {
          201: z.object({
            invite: z.object({
              inviteId: z.string(),
              email: z.string(),
              createdAt: z.string(),
              state: z.enum(["open", "revoked", "redeemed"]),
            }),
            code: z.string(),
            emailed: z.boolean(),
          }),
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await waitlist.invite({ entryId: request.params.entryId, now: now() });
      if (created === undefined) {
        return reply.code(404).send(apiError("not_found", "No waitlist entry has that id."));
      }
      request.log.info(
        {
          audit: { action: "beta_waitlist_invited", inviteId: created.invite.inviteId },
        },
        "audit",
      );
      const { locale, ...invite } = created;
      const emailed = await emailInvite(options.inviteMailer, invite, locale);
      return reply.code(201).send({ ...invite, emailed });
    },
  );
}
