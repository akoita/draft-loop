import type { FastifyInstance } from "fastify";

import { apiError } from "./errors.js";
import type { TenantErasureFor } from "./record-erasure-routes.js";
import { isOperatorRequest } from "./request-auth.js";
import { tenantIdOf } from "./tenant-context.js";

export interface OrganisationClosingOptions {
  readonly erasureFor: TenantErasureFor;
  /** The tenant the owner token acts in, in owner-token mode. */
  readonly ownerTenantId?: string;
}

const deleteRoute = "/v1/organisation";

const closing = apiError(
  "organisation_closing",
  "The organisation is being deleted; nothing can be added or changed.",
);

/**
 * Refuses every request of a caller whose organisation is being deleted (ADR 0011, D7), so no
 * record or object is created after its record was erased. Only the repeated `DELETE
 * /v1/organisation`, which finishes the deletion, and the operator's routes pass. It runs on the
 * request's arrival, before any body is read, so a refused upload is never received.
 */
export function registerOrganisationClosing(
  app: FastifyInstance,
  options: OrganisationClosingOptions,
): void {
  const { erasureFor, ownerTenantId } = options;
  app.addHook("onRequest", async (request, reply) => {
    if (isOperatorRequest(request.routeOptions.url, request.url)) return;
    if (request.method === "DELETE" && request.routeOptions.url === deleteRoute) return;
    const tenantId = tenantIdOf(request.caller, ownerTenantId);
    if (tenantId === undefined) return;
    if (!(await erasureFor(tenantId).organisation.isClosing())) return;
    await reply.code(409).send(closing);
    return reply;
  });
}
