import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { CandidateRecordAssignment } from "@draft-loop/storage/candidate-records";
import {
  type MemberRecord,
  type MemberRole,
  memberRoles,
  type TenantDirectory,
} from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { logAccessRefusal } from "./access-refusal-log.js";
import { apiError, apiErrorSchema } from "./errors.js";
import type { RecordAccessFor } from "./record-access.js";
import { TenantContextMissingError, tenantIdOf } from "./tenant-context.js";

export interface RecordMemberRoutesOptions {
  readonly recordAccessFor: RecordAccessFor;
  /** The organisations' members, for each assigned member's email, role and status. */
  readonly directory: TenantDirectory;
  /** The tenant the owner token acts in, as that organisation's owner. */
  readonly ownerTenantId?: string;
  /** The caller's tenant's application, bound to the request before the handlers run. */
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const recordMemberSchema = z
  .object({
    memberId: z.string(),
    email: z.string(),
    role: z.enum(memberRoles as [MemberRole, ...MemberRole[]]),
    status: z.enum(["invited", "active"]),
    assignedAt: z.string(),
  })
  .meta({ id: "RecordMember" });

const recordMembersSchema = z
  .object({ workspaceId: z.string(), members: z.array(recordMemberSchema) })
  .meta({ id: "RecordMembers" });

const recordAssignmentSchema = recordMemberSchema
  .extend({ workspaceId: z.string() })
  .meta({ id: "RecordAssignment" });

const recordParams = z.strictObject({ workspaceId: identifierSchema });
const assignmentParams = z.strictObject({
  workspaceId: identifierSchema,
  memberId: identifierSchema,
});

const managersOnly = apiError(
  "forbidden",
  "Only an organisation's owners and admins assign members to candidate records.",
);
const workspaceNotFound = apiError("not_found", "No such workspace.");
const memberNotFound = apiError("member_not_found", "The organisation has no such member.");
const notAssigned = apiError("not_found", "The member is not assigned to this candidate record.");

/** Copies only the schema's fields, so a directory row's sign-in binding never reaches a response. */
function recordMemberView(member: MemberRecord, assignment: CandidateRecordAssignment) {
  return {
    memberId: member.memberId,
    email: member.email,
    role: member.role,
    status: member.status,
    assignedAt: assignment.assignedAt,
  };
}

/** One content-free line per assignment change: ids only, never an email or a token. */
function auditAssignment(
  request: FastifyRequest,
  action: "record_member_assigned" | "record_member_unassigned",
  fields: { organisationId: string; workspaceId: string; memberId: string },
): void {
  const caller = request.caller;
  const actor = caller?.kind === "member" ? caller.memberId : "owner-token";
  request.log.info({ audit: { action, ...fields, actor } }, "candidate record members changed");
}

/**
 * Which members work on a candidate record (ADR 0011, D6). Owners and admins, and the owner
 * token in its tenant, assign and remove members; an assigned member may read the list. Record
 * access's hook has already answered 404 to a member not assigned to the record.
 */
export function registerRecordMemberRoutes(
  parent: FastifyInstance,
  options: RecordMemberRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { recordAccessFor, directory, service, workspaceRoot } = options;

  const tenantOf = (request: FastifyRequest): string => {
    const tenantId = tenantIdOf(request.caller, options.ownerTenantId);
    if (tenantId === undefined) throw new TenantContextMissingError();
    return tenantId;
  };

  const exists = async (workspaceId: string): Promise<boolean> => {
    try {
      await service.readWorkspace(workspaceRoot(workspaceId));
      return true;
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) return false;
      throw error;
    }
  };

  /** The tenant the caller manages the record in, or undefined once a refusal is sent. */
  const managedRecord = async (
    request: FastifyRequest,
    reply: FastifyReply,
    workspaceId: string,
  ): Promise<string | undefined> => {
    const caller = request.caller;
    if (caller?.kind === "member" && caller.role !== "owner" && caller.role !== "admin") {
      logAccessRefusal(request, { resource: "record", reason: "role", resourceId: workspaceId });
      await reply.code(403).send(managersOnly);
      return undefined;
    }
    const tenantId = tenantOf(request);
    if (!(await exists(workspaceId))) {
      await reply.code(404).send(workspaceNotFound);
      return undefined;
    }
    return tenantId;
  };

  const directoryMember = async (tenantId: string, memberId: string) =>
    (await directory.listMembers(tenantId)).find((member) => member.memberId === memberId);

  app.get(
    "/v1/workspaces/:workspaceId/members",
    {
      schema: {
        summary: "List the members assigned to a candidate record",
        description:
          "Owners and admins read any record's members; a member reads those of a record assigned to them. Oldest assignment first.",
        params: recordParams,
        response: { 200: recordMembersSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const tenantId = tenantOf(request);
      if (!(await exists(workspaceId))) return reply.code(404).send(workspaceNotFound);
      const assignments = await recordAccessFor(tenantId).listRecordMembers(workspaceId);
      const members = new Map(
        (await directory.listMembers(tenantId)).map((member) => [member.memberId, member]),
      );
      return {
        workspaceId,
        members: assignments.flatMap((assignment) => {
          const member = members.get(assignment.memberId);
          return member === undefined ? [] : [recordMemberView(member, assignment)];
        }),
      };
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/members/:memberId",
    {
      schema: {
        summary: "Assign a member to a candidate record",
        description:
          "Owners and admins only. Assigning a member again returns the existing assignment.",
        params: assignmentParams,
        response: {
          200: recordAssignmentSchema,
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, memberId } = request.params;
      const tenantId = await managedRecord(request, reply, workspaceId);
      if (tenantId === undefined) return reply;
      const member = await directoryMember(tenantId, memberId);
      if (member === undefined) return reply.code(404).send(memberNotFound);
      const assignment = await recordAccessFor(tenantId).assignMember({ workspaceId, memberId });
      auditAssignment(request, "record_member_assigned", {
        organisationId: tenantId,
        workspaceId,
        memberId,
      });
      return { workspaceId, ...recordMemberView(member, assignment) };
    },
  );

  app.delete(
    "/v1/workspaces/:workspaceId/members/:memberId",
    {
      schema: {
        summary: "Remove a member from a candidate record",
        description: "Owners and admins only. The member loses access to the record at once.",
        params: assignmentParams,
        response: {
          204: z.null().describe("Removed."),
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, memberId } = request.params;
      const tenantId = await managedRecord(request, reply, workspaceId);
      if (tenantId === undefined) return reply;
      if (!(await recordAccessFor(tenantId).unassignMember({ workspaceId, memberId }))) {
        return reply.code(404).send(notAssigned);
      }
      auditAssignment(request, "record_member_unassigned", {
        organisationId: tenantId,
        workspaceId,
        memberId,
      });
      return reply.code(204).send(null);
    },
  );
}
