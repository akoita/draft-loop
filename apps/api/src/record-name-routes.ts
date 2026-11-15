import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import {
  normaliseRecordName,
  RecordNameError,
  type RecordNames,
  recordNameMaxLength,
} from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { TenantContextMissingError, tenantIdOf } from "./tenant-context.js";

/** One tenant's candidate record names, by tenant id. */
export type RecordNamesFor = (tenantId: string) => RecordNames;

export interface RecordNameRoutesOptions {
  readonly recordNamesFor: RecordNamesFor;
  /** The tenant the owner token acts in. */
  readonly ownerTenantId?: string;
  /** The caller's tenant's application, bound to the request before the handlers run. */
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly now?: () => Date;
}

const paramsSchema = z.object({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const bodySchema = z.object({
  name: z
    .string()
    .max(400)
    .describe(
      `The name people see for the record: a plain name or a short sentence, 1 to ${recordNameMaxLength} characters once its spaces are tidied.`,
    ),
});

const recordNameSchema = z.object({ id: z.string(), name: z.string() }).meta({ id: "RecordName" });

/**
 * Names a candidate record (#2737). The id stays what routes and storage use; the name is what
 * the screens show. Anyone who reaches the record may name it: the record access hook has already
 * confined the caller.
 */
export function registerRecordNameRoutes(
  parent: FastifyInstance,
  options: RecordNameRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const now = options.now ?? (() => new Date());

  app.put(
    "/v1/workspaces/:workspaceId/name",
    {
      schema: {
        summary: "Name a candidate record",
        description:
          "Sets the name the screens show for the record. The record keeps its id. A record without a name is shown by its id.",
        params: paramsSchema,
        body: bodySchema,
        response: { 200: recordNameSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const tenantId = tenantIdOf(request.caller, options.ownerTenantId);
      if (request.caller === undefined || tenantId === undefined) {
        throw new TenantContextMissingError();
      }
      const { workspaceId } = request.params;
      let name: string;
      try {
        name = normaliseRecordName(request.body.name);
      } catch (error) {
        if (!(error instanceof RecordNameError)) throw error;
        return reply.code(400).send(apiError("invalid_record_name", error.message));
      }
      try {
        await options.service.readWorkspace(options.workspaceRoot(workspaceId));
      } catch (error) {
        if (!(error instanceof WorkspaceNotFoundError)) throw error;
        return reply
          .code(404)
          .send(apiError("not_found", "No such workspace.", { resource: "workspace" }));
      }
      const stored = await options.recordNamesFor(tenantId).set({ workspaceId, name, now: now() });
      return { id: workspaceId, name: stored };
    },
  );
}
