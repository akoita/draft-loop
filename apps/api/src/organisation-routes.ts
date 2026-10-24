import {
  type MemberRecord,
  type MemberRole,
  memberRoles,
  type TenantDirectory,
} from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface OrganisationRoutesOptions {
  /** The organisations and their members (ADR 0011, D6). */
  readonly directory: TenantDirectory;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier.");
const roleSchema = z.enum(memberRoles as [MemberRole, ...MemberRole[]]);
const emailSchema = z.string().max(320);

const memberSchema = z
  .object({
    memberId: z.string(),
    email: z.string(),
    role: roleSchema,
    status: z.enum(["invited", "active"]),
    invitedAt: z.string(),
    activatedAt: z.string().optional().describe("When the member first signed in."),
  })
  .meta({ id: "OrganisationMember" });

const membersSchema = z
  .object({ organisationId: z.string(), members: z.array(memberSchema) })
  .meta({ id: "OrganisationMembers" });

const meSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("owner") }),
    z.object({
      kind: z.literal("member"),
      organisationId: z.string(),
      memberId: z.string(),
      role: roleSchema,
      email: z.string().optional(),
    }),
  ])
  .describe("The owner token's caller has no organisation; a member acts in exactly one.")
  .meta({ id: "Me" });

const createdOrganisationSchema = z
  .object({
    organisation: z.object({ organisationId: z.string(), name: z.string(), createdAt: z.string() }),
    firstOwner: memberSchema,
  })
  .meta({ id: "CreatedOrganisation" });

const memberParams = z.strictObject({ memberId: identifierSchema });
const inviteBody = z.strictObject({ email: emailSchema, role: roleSchema });
const roleBody = z.strictObject({ role: roleSchema });
const organisationBody = z.strictObject({
  organisationId: identifierSchema.describe("Also the tenant id; it cannot change later."),
  name: z.string().max(200),
  firstOwnerEmail: emailSchema,
});

/** Copies only the schema's fields, so a directory row's sign-in binding never reaches a response. */
function memberView(member: MemberRecord) {
  return {
    memberId: member.memberId,
    email: member.email,
    role: member.role,
    status: member.status,
    invitedAt: member.invitedAt,
    ...(member.activatedAt === undefined ? {} : { activatedAt: member.activatedAt }),
  };
}

type MembershipAction =
  | "organisation_created"
  | "member_invited"
  | "member_role_changed"
  | "member_removed";

/**
 * One content-free line per membership change: ids and the role only, never an email or a token.
 * The hash-chained audit trail is kept per workspace, and an organisation's membership belongs to
 * no workspace, so these changes are recorded in the structured log instead.
 */
function auditMembership(
  request: FastifyRequest,
  action: MembershipAction,
  fields: { organisationId: string; memberId: string; role?: MemberRole },
): void {
  request.log.info({ audit: { action, ...fields } }, "organisation membership changed");
}

const ownerTokenForbidden = apiError(
  "forbidden",
  "The owner token belongs to no organisation; use a member's sign-in.",
);
const managersOnly = apiError(
  "forbidden",
  "Only an organisation's owners and admins manage its members.",
);
const ownersOnly = apiError(
  "forbidden",
  "Only an owner may grant, change or remove the owner role.",
);

/** The organisation the caller manages, or undefined once a 403 is sent. */
async function managedOrganisation(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ organisationId: string; memberId: string; role: MemberRole } | undefined> {
  const caller = request.caller;
  if (caller?.kind !== "member") {
    await reply.code(403).send(ownerTokenForbidden);
    return undefined;
  }
  if (caller.role !== "owner" && caller.role !== "admin") {
    await reply.code(403).send(managersOnly);
    return undefined;
  }
  return { organisationId: caller.tenantId, memberId: caller.memberId, role: caller.role };
}

/** A member's record, for the caller's email and for the audit line's role comparison. */
async function targetMember(
  directory: TenantDirectory,
  organisationId: string,
  memberId: string,
): Promise<MemberRecord | undefined> {
  return (await directory.listMembers(organisationId)).find(
    (member) => member.memberId === memberId,
  );
}

/**
 * Who the caller is, an organisation's members and the operator's organisation creation
 * (ADR 0011, D6). Owners and admins manage members; only an owner touches the owner role, which the
 * directory enforces inside the change.
 */
export function registerOrganisationRoutes(
  parent: FastifyInstance,
  options: OrganisationRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { directory } = options;
  const forbidden = { 403: apiErrorSchema };

  app.get(
    "/v1/me",
    {
      schema: {
        summary: "Read who the caller is: the owner token or an organisation's member",
        response: { 200: meSchema, 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const caller = request.caller;
      if (caller === undefined) {
        return reply.code(401).send(apiError("unauthorized", "A credential is required."));
      }
      if (caller.kind === "owner") return { kind: "owner" as const };
      const record = await targetMember(directory, caller.tenantId, caller.memberId);
      return {
        kind: "member" as const,
        organisationId: caller.tenantId,
        memberId: caller.memberId,
        role: caller.role,
        ...(record === undefined ? {} : { email: record.email }),
      };
    },
  );

  app.get(
    "/v1/organisation/members",
    {
      schema: {
        summary: "List the members of the caller's organisation",
        response: { 200: membersSchema, ...forbidden },
      },
    },
    async (request, reply) => {
      const manager = await managedOrganisation(request, reply);
      if (manager === undefined) return reply;
      const members = await directory.listMembers(manager.organisationId);
      return { organisationId: manager.organisationId, members: members.map(memberView) };
    },
  );

  app.post(
    "/v1/organisation/members",
    {
      schema: {
        summary: "Invite a person to the caller's organisation by email",
        description: "They become active on their first sign-in with that verified email.",
        body: inviteBody,
        response: { 201: memberSchema, 400: apiErrorSchema, ...forbidden, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const manager = await managedOrganisation(request, reply);
      if (manager === undefined) return reply;
      const { email, role } = request.body;
      if (role === "owner" && manager.role !== "owner") {
        return reply.code(403).send(ownersOnly);
      }
      const member = await directory.inviteMember({
        organisationId: manager.organisationId,
        email,
        role,
      });
      auditMembership(request, "member_invited", {
        organisationId: member.organisationId,
        memberId: member.memberId,
        role: member.role,
      });
      return reply.code(201).send(memberView(member));
    },
  );

  app.patch(
    "/v1/organisation/members/:memberId",
    {
      schema: {
        summary: "Change a member's role",
        description: "The organisation's last owner keeps the owner role.",
        params: memberParams,
        body: roleBody,
        response: {
          200: memberSchema,
          400: apiErrorSchema,
          ...forbidden,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const manager = await managedOrganisation(request, reply);
      if (manager === undefined) return reply;
      const { memberId } = request.params;
      const { role } = request.body;
      // Read only to skip the audit line of a change that changes nothing; the directory
      // decides authority itself, under its lock, from the target's role at that moment.
      const before = await targetMember(directory, manager.organisationId, memberId);
      const member = await directory.changeRole({
        organisationId: manager.organisationId,
        memberId,
        role,
        actorRole: manager.role,
      });
      if (before?.role !== member.role) {
        auditMembership(request, "member_role_changed", {
          organisationId: member.organisationId,
          memberId: member.memberId,
          role: member.role,
        });
      }
      return memberView(member);
    },
  );

  app.delete(
    "/v1/organisation/members/:memberId",
    {
      schema: {
        summary: "Remove a member from the caller's organisation",
        description: "The organisation's last owner cannot be removed.",
        params: memberParams,
        response: {
          204: z.null().describe("Removed."),
          400: apiErrorSchema,
          ...forbidden,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const manager = await managedOrganisation(request, reply);
      if (manager === undefined) return reply;
      const { memberId } = request.params;
      const removed = await directory.removeMember({
        organisationId: manager.organisationId,
        memberId,
        actorRole: manager.role,
      });
      auditMembership(request, "member_removed", {
        organisationId: manager.organisationId,
        memberId,
        role: removed.role,
      });
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/v1/operator/organisations",
    {
      schema: {
        summary: "Create an organisation and invite its first owner",
        description:
          "Operator only: takes the deployment's owner token in both authentication modes, " +
          "never a member's sign-in.",
        body: organisationBody,
        response: {
          201: createdOrganisationSchema,
          400: apiErrorSchema,
          ...forbidden,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      // Request authentication admits only the owner token here; this repeats it in place.
      if (request.caller?.kind !== "owner") {
        return reply
          .code(403)
          .send(apiError("forbidden", "Only the operator creates organisations."));
      }
      const created = await directory.createOrganisation(request.body);
      auditMembership(request, "organisation_created", {
        organisationId: created.organisation.organisationId,
        memberId: created.firstOwner.memberId,
        role: created.firstOwner.role,
      });
      return reply.code(201).send({
        organisation: {
          organisationId: created.organisation.organisationId,
          name: created.organisation.name,
          createdAt: created.organisation.createdAt,
        },
        firstOwner: memberView(created.firstOwner),
      });
    },
  );
}
