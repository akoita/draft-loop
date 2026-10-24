import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError } from "./errors.js";
import type { Caller } from "./request-auth.js";
import { TenantContextMissingError, tenantIdOf } from "./tenant-context.js";

/** One tenant's candidate record assignments, by tenant id. */
export type RecordAccessFor = (tenantId: string) => CandidateRecordAccess;

export interface RecordAccessOptions {
  readonly recordAccessFor: RecordAccessFor;
  /** The tenant the owner token acts in, for its listing of every record. */
  readonly ownerTenantId?: string;
  /** The caller's tenant's application, bound to the request before this module's hooks run. */
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const createRoute = "/v1/workspaces/:workspaceId";

const workspaceListSchema = z
  .object({
    workspaces: z.array(z.object({ id: z.string() })),
  })
  .meta({ id: "WorkspaceList" });

/** Owners and admins reach every record of their organisation; a member only their own. */
function reachesEveryRecord(caller: Caller): boolean {
  return caller.kind === "owner" || caller.role === "owner" || caller.role === "admin";
}

function workspaceIdOf(request: FastifyRequest): string | undefined {
  const params = request.params as { workspaceId?: unknown } | undefined;
  return typeof params?.workspaceId === "string" ? params.workspaceId : undefined;
}

async function isAssigned(
  access: CandidateRecordAccess,
  memberId: string,
  workspaceId: string,
): Promise<boolean> {
  const records = await access.listMemberRecords(memberId);
  return records.some((record) => record.workspaceId === workspaceId);
}

/**
 * Confines each signed-in member to the candidate records assigned to them (ADR 0011, D6), for
 * every route that names a workspace, in one hook that runs after sign-in and tenant binding. A
 * refused record answers exactly as an unknown workspace. A member may create a workspace that
 * does not exist yet, and every signed-in creator is assigned to it. The owner token, which
 * reaches only operator routes in sign-in mode, is never confined.
 */
export function registerRecordAccess(parent: FastifyInstance, options: RecordAccessOptions): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { recordAccessFor, service, workspaceRoot } = options;

  const exists = async (workspaceId: string): Promise<boolean> => {
    try {
      await service.readWorkspace(workspaceRoot(workspaceId));
      return true;
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) return false;
      throw error;
    }
  };

  app.addHook("preHandler", async (request, reply) => {
    const { caller } = request;
    const workspaceId = workspaceIdOf(request);
    if (caller?.kind !== "member" || workspaceId === undefined || reachesEveryRecord(caller)) {
      return;
    }
    if (await isAssigned(recordAccessFor(caller.tenantId), caller.memberId, workspaceId)) return;
    const creating = request.method === "PUT" && request.routeOptions.url === createRoute;
    if (creating && !(await exists(workspaceId))) return;
    await reply.code(404).send(apiError("not_found", "No such workspace."));
    return reply;
  });

  // Assigned before the response leaves, so the creator reaches the record from their next call.
  app.addHook("onSend", async (request, reply, payload) => {
    const { caller } = request;
    const workspaceId = workspaceIdOf(request);
    if (
      caller?.kind === "member" &&
      workspaceId !== undefined &&
      request.method === "PUT" &&
      request.routeOptions.url === createRoute &&
      reply.statusCode === 201
    ) {
      await recordAccessFor(caller.tenantId).assignMember({
        workspaceId,
        memberId: caller.memberId,
      });
    }
    return payload;
  });

  app.get(
    "/v1/workspaces",
    {
      schema: {
        summary: "List the workspaces the caller can reach",
        description:
          "Owners and admins, and the owner token, see every workspace of the organisation; a member sees the workspaces assigned to them. Sorted by id.",
        response: { 200: workspaceListSchema },
      },
    },
    async (request) => {
      const caller = request.caller;
      const tenantId = tenantIdOf(caller, options.ownerTenantId);
      if (caller === undefined || tenantId === undefined) throw new TenantContextMissingError();
      const access = recordAccessFor(tenantId);
      const ids =
        caller.kind === "member" && !reachesEveryRecord(caller)
          ? (await access.listMemberRecords(caller.memberId)).map((record) => record.workspaceId)
          : await access.listRecords();
      return { workspaces: [...new Set(ids)].sort().map((id) => ({ id })) };
    },
  );
}
