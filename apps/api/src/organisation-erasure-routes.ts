import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import type { TenantErasure, TenantErasureFor } from "./record-erasure-routes.js";

export interface OrganisationErasureRoutesOptions {
  readonly erasureFor: TenantErasureFor;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier.");

const eraseBody = z.strictObject({
  confirm: z.string().max(128).describe("The organisation id again, typed back by the person."),
});

const organisationParams = z.strictObject({ organisationId: identifierSchema });

const erasedResponses = {
  204: z.null().describe("Deleted."),
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
};

const description =
  "Erases every candidate record as `DELETE /v1/workspaces/{workspaceId}` does, then every object left under the tenant's storage prefix, then the tenant-wide knowledge bases, idempotency keys and the organisation with its members. The organisation id is typed back as `confirm` (400 `confirmation_mismatch`). A queued or running run anywhere in the organisation answers 409 `run_active`. Calling again finishes an interrupted deletion. Accounts at the identity provider are not touched: a person's sign-in simply no longer resolves to an organisation.";

type OrganisationErasureOutcome =
  | { readonly state: "missing" }
  | { readonly state: "run-active" }
  | {
      readonly state: "erased";
      readonly records: number;
      readonly objectsRemoved: number;
      readonly rowsRemoved: number;
    };

/**
 * Erases one organisation: each record closed and erased in turn, its objects by key, then every
 * object left under the tenant's prefix, then the tenant's remaining rows, the directory last. An
 * interruption leaves the organisation in the directory, so the next call finishes it.
 */
async function eraseOrganisation(erasure: TenantErasure): Promise<OrganisationErasureOutcome> {
  const { organisation, records, blobs } = erasure;
  if (!(await organisation.organisationExists())) return { state: "missing" };
  if (await organisation.hasActiveRun()) return { state: "run-active" };
  let erasedRecords = 0;
  let objectsRemoved = 0;
  let rowsRemoved = 0;
  for (const workspaceId of await organisation.listRecords()) {
    const closure = await records.close(workspaceId);
    if (closure.state === "run-active") return { state: "run-active" };
    if (closure.state === "missing") continue;
    for (const key of closure.objectKeys) {
      if (await blobs.removeObject(key)) objectsRemoved += 1;
    }
    rowsRemoved += (await records.erase(workspaceId)).rowsRemoved;
    erasedRecords += 1;
  }
  objectsRemoved += await blobs.removePrefix(erasure.objectPrefix);
  rowsRemoved += (await organisation.eraseRemainder()).rowsRemoved;
  return { state: "erased", records: erasedRecords, objectsRemoved, rowsRemoved };
}

async function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  organisationId: string,
  outcome: OrganisationErasureOutcome,
): Promise<FastifyReply> {
  if (outcome.state === "missing") {
    return reply.code(404).send(apiError("not_found", "No such organisation."));
  }
  if (outcome.state === "run-active") {
    return reply
      .code(409)
      .send(apiError("run_active", "A run is queued or running; stop it before deleting."));
  }
  const { records, objectsRemoved, rowsRemoved } = outcome;
  // Content-free: ids and counts only.
  request.log.info(
    { erasure: { organisationId, records, objectsRemoved, rowsRemoved } },
    "organisation erased",
  );
  return reply.code(204).send(null);
}

const confirmationMismatch = apiError(
  "confirmation_mismatch",
  "Type the organisation id as `confirm` to delete it.",
);

/**
 * Deleting a whole organisation (ADR 0011, D7): by its owner, or by the operator's token. The
 * identity provider's accounts are not the service's to delete and are left as they are.
 */
export function registerOrganisationErasureRoutes(
  parent: FastifyInstance,
  options: OrganisationErasureRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { erasureFor } = options;

  app.delete(
    "/v1/organisation",
    {
      schema: {
        summary: "Delete the caller's organisation and everything it holds",
        description: `Owners only. ${description}`,
        body: eraseBody,
        response: erasedResponses,
      },
    },
    async (request, reply) => {
      const { caller } = request;
      if (caller?.kind !== "member") {
        return reply
          .code(403)
          .send(
            apiError(
              "forbidden",
              "The owner token belongs to no organisation; use the operator route.",
            ),
          );
      }
      if (caller.role !== "owner") {
        return reply
          .code(403)
          .send(apiError("forbidden", "Only an organisation's owner deletes it."));
      }
      if (request.body.confirm !== caller.tenantId) {
        return reply.code(400).send(confirmationMismatch);
      }
      const outcome = await eraseOrganisation(erasureFor(caller.tenantId));
      return answer(request, reply, caller.tenantId, outcome);
    },
  );

  app.delete(
    "/v1/operator/organisations/:organisationId",
    {
      schema: {
        summary: "Delete an organisation and everything it holds",
        description: `Operator only: takes the deployment's owner token in both authentication modes. ${description}`,
        params: organisationParams,
        body: eraseBody,
        response: erasedResponses,
      },
    },
    async (request, reply) => {
      // Request authentication admits only the owner token here; this repeats it in place.
      if (request.caller?.kind !== "owner") {
        return reply
          .code(403)
          .send(apiError("forbidden", "Only the operator deletes organisations."));
      }
      const { organisationId } = request.params;
      if (request.body.confirm !== organisationId) {
        return reply.code(400).send(confirmationMismatch);
      }
      const outcome = await eraseOrganisation(erasureFor(organisationId));
      return answer(request, reply, organisationId, outcome);
    },
  );
}
