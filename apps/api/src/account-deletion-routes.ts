import { eraseOrganisation } from "@draft-loop/storage/organisation-erasure-flow";
import type { TenantDirectory } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import type { IdentityAccounts } from "./identity-accounts.js";
import type { TenantErasureFor } from "./record-erasure-routes.js";

export interface AccountDeletionRoutesOptions {
  readonly erasureFor: TenantErasureFor;
  readonly directory: Pick<TenantDirectory, "listMembers">;
  /** The identity provider's account client; without it the sign-in account stays. */
  readonly identityAccounts?: IdentityAccounts;
}

const deleteBody = z.strictObject({
  confirm: z.string().max(320).describe("The account's email address, typed back by the person."),
});

const deletedSchema = z
  .strictObject({
    identity: z
      .enum(["deleted", "kept"])
      .describe(
        "Whether the sign-in account was deleted too. `kept` means it could not be deleted now; the operator is told, and signing in again finds no account.",
      ),
  })
  .describe("The account and everything it held were deleted.");

/** The route the organisation closing hook lets through while an account deletion finishes. */
export const accountDeletionRoute = "/v1/account";

const sameEmail = (typed: string, email: string | undefined) =>
  email !== undefined && typed.trim().toLowerCase() === email.trim().toLowerCase();

/**
 * Deleting one's own account (#3033): a person alone in their organisation erases it, as
 * `DELETE /v1/organisation` does, which also frees their beta place, and then their account at
 * the identity provider. Only the person's own sign-in reaches it, never an agent's token.
 */
export function registerAccountDeletionRoutes(
  parent: FastifyInstance,
  options: AccountDeletionRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { erasureFor, directory, identityAccounts } = options;

  app.delete(
    accountDeletionRoute,
    {
      schema: {
        summary: "Delete my account and everything it holds",
        description:
          "For a person alone in their organisation, signed in themselves (an agent token or an assistant's sign-in answers 403). The account's email address is typed back as `confirm` (400 `confirmation_mismatch`). Erases the organisation as `DELETE /v1/organisation` does, which frees its beta place, then deletes the sign-in account at the identity provider. A queued or running run answers 409 `run_active`; an organisation with other members answers 409 `organisation_has_members`; a sign-in with the operator role answers 409 `operator_account`, so an operator cannot lock the service out of its own screen. Calling again finishes an interrupted deletion while the sign-in still resolves.",
        body: deleteBody,
        response: {
          200: deletedSchema,
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller, signInIdentity } = request;
      if (caller?.kind !== "member" || signInIdentity === undefined) {
        return reply
          .code(403)
          .send(
            apiError("forbidden", "Only the person themselves, signed in, deletes an account."),
          );
      }
      if (caller.holdsOperatorRole === true) {
        return reply
          .code(409)
          .send(
            apiError(
              "operator_account",
              "This account runs DraftLoop as an operator; remove its operator role before deleting it.",
            ),
          );
      }
      if (!sameEmail(request.body.confirm, signInIdentity.email)) {
        return reply
          .code(400)
          .send(
            apiError("confirmation_mismatch", "Type your email address as `confirm` to delete it."),
          );
      }
      const others = (await directory.listMembers(caller.tenantId)).filter(
        (member) => member.memberId !== caller.memberId && member.status === "active",
      );
      if (others.length > 0) {
        return reply
          .code(409)
          .send(
            apiError(
              "organisation_has_members",
              "Your organisation has other members; its owner deletes the organisation instead.",
            ),
          );
      }
      const outcome = await eraseOrganisation(erasureFor(caller.tenantId));
      if (outcome.state === "missing") {
        return reply.code(404).send(apiError("not_found", "No such account."));
      }
      if (outcome.state === "run-active") {
        return reply
          .code(409)
          .send(apiError("run_active", "A run is queued or running; stop it before deleting."));
      }
      let identity: "deleted" | "kept" = "kept";
      if (identityAccounts !== undefined) {
        try {
          await identityAccounts.deleteAccount(signInIdentity.subject);
          identity = "deleted";
        } catch (error) {
          // The service holds nothing more; the operator deletes the sign-in account by hand.
          request.log.error(
            { err: error, organisationId: caller.tenantId },
            "sign-in account not deleted",
          );
        }
      }
      // Content-free: ids and counts only.
      request.log.info(
        {
          accountDeletion: {
            organisationId: caller.tenantId,
            records: outcome.records,
            objectsRemoved: outcome.objectsRemoved,
            rowsRemoved: outcome.rowsRemoved,
            identity,
          },
        },
        "account deleted",
      );
      return reply.code(200).send({ identity });
    },
  );
}
