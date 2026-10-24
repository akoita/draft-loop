import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { type ApiError, apiError } from "./errors.js";
import { type RecordAccessFor, reachesEveryRecord } from "./record-access.js";
import type { Caller } from "./request-auth.js";
import { TenantContextMissingError } from "./tenant-context.js";

/** One tenant's knowledge base owners, by tenant id. */
export type KnowledgeOwnersFor = (tenantId: string) => KnowledgeBaseOwners;

export interface KnowledgeAccessOptions {
  readonly knowledgeOwnersFor: KnowledgeOwnersFor;
  readonly recordAccessFor: RecordAccessFor;
  /** The caller's tenant's application, bound to the request before this module's hooks run. */
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

/** What the knowledge routes ask in sign-in mode, where each base belongs to one record. */
export interface KnowledgeOwnership {
  /**
   * The bases the caller may list, only those `workspaceId` owns when it is given; undefined for
   * every base of the tenant.
   */
  readonly listable: (
    request: FastifyRequest,
    workspaceId: string | undefined,
  ) => Promise<ReadonlySet<string> | undefined>;
  /** Records a new base's owning record, which this module checked the caller reaches. */
  readonly setOwner: (
    request: FastifyRequest,
    knowledgeBaseId: string,
    workspaceId: string,
  ) => Promise<void>;
}

const createRoute = "/v1/knowledge-bases";
const selectionRoute = "/v1/workspaces/:workspaceId/knowledge-selection";

const unknownBase = apiError("knowledge_base_not_found", "No such knowledge base.");
const unknownWorkspace = apiError("not_found", "No such workspace.");
const workspaceRequired: ApiError = {
  error: {
    code: "invalid_request",
    message: "The request does not match the route's schema.",
    issues: [{ path: "/workspaceId", message: "Name the candidate record the base belongs to." }],
  },
};

type Member = Extract<Caller, { kind: "member" }>;

function memberOf(request: FastifyRequest): Member {
  const { caller } = request;
  // Sign-in mode serves these routes to members only; the owner token reaches operator routes.
  if (caller?.kind !== "member") throw new TenantContextMissingError();
  return caller;
}

function stringField(value: unknown, field: string): string | undefined {
  const fields = value as Record<string, unknown> | undefined;
  const found = fields?.[field];
  return typeof found === "string" ? found : undefined;
}

async function refuse(reply: FastifyReply, status: number, body: ApiError): Promise<FastifyReply> {
  await reply.code(status).send(body);
  return reply;
}

/**
 * Gives each knowledge base the candidate record that owns it, in sign-in mode (ADR 0011, D6).
 * One hook, after record access, confines every route: a base is created for a record the caller
 * reaches; a member reaches only the bases their assigned records own, and any other answers
 * exactly as an unknown base; and a workspace selects only its own bases. Owners and admins
 * reach every base, including those created before bases had owners. Owner-token mode does not
 * register this module, so its bases stay tenant-wide.
 */
export function registerKnowledgeAccess(
  app: FastifyInstance,
  options: KnowledgeAccessOptions,
): KnowledgeOwnership {
  const { knowledgeOwnersFor, recordAccessFor, service, workspaceRoot } = options;

  const assignedRecords = async (member: Member): Promise<readonly string[]> =>
    (await recordAccessFor(member.tenantId).listMemberRecords(member.memberId)).map(
      (record) => record.workspaceId,
    );

  const exists = async (workspaceId: string): Promise<boolean> => {
    try {
      await service.readWorkspace(workspaceRoot(workspaceId));
      return true;
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) return false;
      throw error;
    }
  };

  /** Whether the member reaches the base: owners and admins every one, a member their records'. */
  const reachesBase = async (member: Member, knowledgeBaseId: string): Promise<boolean> => {
    if (reachesEveryRecord(member)) return true;
    const owner = await knowledgeOwnersFor(member.tenantId).ownerOf(knowledgeBaseId);
    return owner !== undefined && (await assignedRecords(member)).includes(owner);
  };

  app.addHook("preHandler", async (request, reply) => {
    if (request.caller?.kind !== "member") return;
    const member = request.caller;
    const route = request.routeOptions.url;

    const knowledgeBaseId = stringField(request.params, "knowledgeBaseId");
    if (knowledgeBaseId !== undefined && route?.startsWith(`${createRoute}/`) === true) {
      if (!(await reachesBase(member, knowledgeBaseId))) return refuse(reply, 404, unknownBase);
      return;
    }

    if (request.method === "POST" && route === createRoute) {
      const workspaceId = stringField(request.body, "workspaceId");
      if (workspaceId === undefined) return refuse(reply, 400, workspaceRequired);
      const reaches =
        reachesEveryRecord(member) || (await assignedRecords(member)).includes(workspaceId);
      if (!reaches || !(await exists(workspaceId))) return refuse(reply, 404, unknownWorkspace);
      return;
    }

    // Record access has already refused a workspace the member does not reach.
    if (request.method === "PUT" && route === selectionRoute) {
      const workspaceId = stringField(request.params, "workspaceId");
      const selected = (request.body as { knowledgeBaseIds?: unknown } | undefined)
        ?.knowledgeBaseIds;
      if (workspaceId === undefined || !Array.isArray(selected)) return;
      const owned = new Set(await knowledgeOwnersFor(member.tenantId).basesOwnedBy([workspaceId]));
      if (selected.some((id) => typeof id !== "string" || !owned.has(id))) {
        return refuse(reply, 404, unknownBase);
      }
    }
    return;
  });

  return {
    listable: async (request, workspaceId) => {
      const member = memberOf(request);
      const owners = knowledgeOwnersFor(member.tenantId);
      if (reachesEveryRecord(member)) {
        return workspaceId === undefined
          ? undefined
          : new Set(await owners.basesOwnedBy([workspaceId]));
      }
      const assigned = await assignedRecords(member);
      const records =
        workspaceId === undefined ? assigned : assigned.filter((id) => id === workspaceId);
      return new Set(await owners.basesOwnedBy(records));
    },
    setOwner: async (request, knowledgeBaseId, workspaceId) => {
      const member = memberOf(request);
      await knowledgeOwnersFor(member.tenantId).setOwner({ knowledgeBaseId, workspaceId });
    },
  };
}
