import type { BlobErasure, CandidateRecordErasure } from "@draft-loop/storage/record-erasure";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { reachesEveryRecord } from "./record-access.js";
import { TenantContextMissingError, tenantIdOf } from "./tenant-context.js";

/** One tenant's record erasure: its rows and the objects they name. */
export interface TenantErasure {
  readonly records: CandidateRecordErasure;
  readonly blobs: BlobErasure;
}

/** One tenant's erasure, by tenant id. */
export type TenantErasureFor = (tenantId: string) => TenantErasure;

export interface RecordErasureRoutesOptions {
  readonly erasureFor: TenantErasureFor;
  /** The tenant the owner token acts in, in owner-token mode. */
  readonly ownerTenantId?: string;
}

const eraseRoute = "/v1/workspaces/:workspaceId";

const workspaceParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const eraseBody = z.strictObject({
  confirm: z.string().max(128).describe("The workspace id again, typed back by the person."),
});

const notFound = apiError("not_found", "No such workspace.");

function workspaceIdOf(request: FastifyRequest): string | undefined {
  const params = request.params as { workspaceId?: unknown } | undefined;
  return typeof params?.workspaceId === "string" ? params.workspaceId : undefined;
}

/**
 * Erasing a candidate record through the API (ADR 0011, D7). The record is closed at once, which
 * this module's hook turns into 404 on every other route that names it; then its stored objects
 * are removed by key, then its rows. A call after an interruption finds the record closed and
 * finishes the erasure; a record already gone answers 404.
 */
export function registerRecordErasureRoutes(
  parent: FastifyInstance,
  options: RecordErasureRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { erasureFor, ownerTenantId } = options;

  // Before the workspace routes, so a record being erased is missing for each of them.
  app.addHook("preHandler", async (request, reply) => {
    const workspaceId = workspaceIdOf(request);
    if (workspaceId === undefined) return;
    if (request.method === "DELETE" && request.routeOptions.url === eraseRoute) return;
    const tenantId = tenantIdOf(request.caller, ownerTenantId);
    if (tenantId === undefined) return;
    if (!(await erasureFor(tenantId).records.isClosed(workspaceId))) return;
    await reply.code(404).send(notFound);
    return reply;
  });

  app.delete(
    eraseRoute,
    {
      schema: {
        summary: "Erase a workspace's candidate record",
        description:
          "Removes the record for good: its stored files and exports, then its history, settings, consent ledger, audit trail, assignments and the knowledge bases it owns. Owners and admins only, or the owner token in owner-token mode, with the workspace id typed back as `confirm` (400 `confirmation_mismatch`). A queued or running run answers 409 `run_active`; stop it first. The record is missing to every other route from the first call, and calling again finishes an interrupted erasure.",
        params: workspaceParams,
        body: eraseBody,
        response: {
          204: z.null().describe("Erased."),
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      if (caller === undefined || !reachesEveryRecord(caller)) {
        return reply
          .code(403)
          .send(apiError("forbidden", "Only an organisation's owners and admins erase a record."));
      }
      const tenantId = tenantIdOf(caller, ownerTenantId);
      if (tenantId === undefined) throw new TenantContextMissingError();
      const { workspaceId } = request.params;
      if (request.body.confirm !== workspaceId) {
        return reply
          .code(400)
          .send(
            apiError("confirmation_mismatch", "Type the workspace id as `confirm` to erase it."),
          );
      }
      const erasure = erasureFor(tenantId);
      const closure = await erasure.records.close(workspaceId);
      if (closure.state === "missing") return reply.code(404).send(notFound);
      if (closure.state === "run-active") {
        return reply
          .code(409)
          .send(apiError("run_active", "A run is queued or running; stop it before erasing."));
      }
      let objectsRemoved = 0;
      for (const key of closure.objectKeys) {
        if (await erasure.blobs.removeObject(key)) objectsRemoved += 1;
      }
      const erased = await erasure.records.erase(workspaceId);
      // Content-free: ids and counts only; the tenant and member ids are on the request's logger.
      request.log.info(
        {
          erasure: {
            workspaceId,
            resumed: closure.resumed,
            objectKeys: closure.objectKeys.length,
            objectsRemoved,
            rowsRemoved: erased.rowsRemoved,
          },
        },
        "candidate record erased",
      );
      return reply.code(204).send(null);
    },
  );
}
