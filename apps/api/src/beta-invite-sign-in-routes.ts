import type { BetaInvites } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";
import type { IdentityAccounts, InvitedAccount } from "./identity-accounts.js";

/** The most open invites one call prepares; the operator calls again for the rest. */
export const inviteSignInBatch = 200;

export interface BetaInviteSignInOptions {
  readonly invites: BetaInvites;
  readonly prepareInvitedAccount: IdentityAccounts["prepareInvitedAccount"];
}

const preparedSchema = z
  .object({
    passwordEmails: z
      .number()
      .int()
      .describe("Open invites whose person was sent the provider's choose-a-password email."),
    existing: z
      .number()
      .int()
      .describe("Open invites whose person already has a sign-in with a password."),
    failed: z.number().int().describe("Open invites the provider did not prepare; call again."),
  })
  .meta({ id: "PreparedInviteSignIns" });

/**
 * Prepares a sign-in account for every open invite (#3082). Run it once before the realm stops
 * letting people register, so invites sent earlier still lead to an account, and again for any
 * failed one. A person who already has a password receives nothing.
 */
export function registerBetaInviteSignInRoutes(
  parent: FastifyInstance,
  options: BetaInviteSignInOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/v1/operator/beta-invites/sign-ins",
    {
      schema: {
        summary: "Prepare a sign-in account for every open beta invite",
        description: `Operator only. For each open invite, at most ${inviteSignInBatch} per call, creates the person's sign-in account at the identity provider where it is missing, and has the provider email a link to choose a password where none is set yet. An account with a password is left alone. Answers the counts.`,
        response: { 200: preparedSchema, 403: apiErrorSchema },
      },
    },
    async (request) => {
      const open = await options.invites.list({ state: "open", limit: inviteSignInBatch });
      const outcomes: Array<InvitedAccount | "failed"> = [];
      for (const invite of open) {
        try {
          outcomes.push(await options.prepareInvitedAccount({ email: invite.email }));
        } catch (error) {
          request.log.warn(
            { inviteId: invite.inviteId, err: error },
            "invite sign-in not prepared",
          );
          outcomes.push("failed");
        }
      }
      const result = {
        passwordEmails: outcomes.filter((outcome) => outcome === "password-email").length,
        existing: outcomes.filter((outcome) => outcome === "exists").length,
        failed: outcomes.filter((outcome) => outcome === "failed").length,
      };
      request.log.info({ audit: { action: "beta_invite_sign_ins_prepared", ...result } }, "audit");
      return result;
    },
  );
}
