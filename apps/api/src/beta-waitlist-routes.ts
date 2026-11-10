import type { BetaWaitlist } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

/** Public: a visitor joins before any account exists. Listed with the public routes. */
export const waitlistPath = "/v1/waitlist";

/**
 * The version of the consent text the landing page shows next to the checkbox. Change it with
 * the text, so each entry records which words its person agreed to.
 */
export const betaWaitlistConsentVersion = "waitlist-2026-11-08";

/** Joins one address may send per window; more answer 429. */
export const waitlistJoinsPerWindow = 5;
export const waitlistWindowMs = 60 * 60 * 1000;

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
  readonly now?: () => Date;
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
  const { waitlist } = options;
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
          "Public. Takes an email and the visitor's consent to keep it until they are invited, for at most six months. Answers 202 whether or not the email was already listed. 400 invalid_input for an address that is not an email, 429 rate_limited after 5 joins in an hour from one address.",
        security: [],
        body: z.strictObject({
          email: z.string().max(320),
          consent: z.literal(true),
        }),
        response: {
          202: z.object({ listed: z.literal(true) }),
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
      let joined: boolean;
      try {
        joined = await waitlist.join({
          email: request.body.email,
          consentVersion: betaWaitlistConsentVersion,
          now: at,
        });
      } catch (error) {
        if ((error as Error).name !== "TenantDirectoryError") throw error;
        return reply.code(400).send(apiError("invalid_input", "That is not an email address."));
      }
      request.log.info({ event: "waitlist_join", joined }, "waitlist join");
      return reply.code(202).send({ listed: true as const });
    },
  );

  app.get(
    "/v1/operator/waitlist",
    {
      schema: {
        summary: "List the beta waitlist, oldest first",
        description: "Operator only.",
        response: { 200: z.object({ entries: z.array(entrySchema) }), 403: apiErrorSchema },
      },
    },
    async () => ({ entries: [...(await waitlist.list())] }),
  );

  app.post(
    "/v1/operator/waitlist/:entryId/invite",
    {
      schema: {
        summary: "Turn a waitlist entry into a beta invite",
        description:
          "Operator only. Creates an invite for the entry's email and deletes the entry. The answer carries the plain code once. 404 when no entry has that id.",
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
      return reply.code(201).send(created);
    },
  );
}
