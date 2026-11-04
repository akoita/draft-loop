import type { ApplicationService } from "@draft-loop/application";
import type { AgentTokenRecord, AgentTokenStore } from "@draft-loop/storage/agent-tokens";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { agentTokenHash, newAgentToken } from "./agent-token-auth.js";
import { apiError, apiErrorSchema } from "./errors.js";

export interface AgentTokenRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly tokens: AgentTokenStore;
  readonly now?: () => Date;
}

const workspaceParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const tokenParams = workspaceParams.extend({
  tokenId: z.string().regex(/^dlat_[A-Za-z0-9_-]{8,64}$/u, "must be an agent token id"),
});

const tokenSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    created_at: z.string(),
    revoked_at: z.string().optional(),
  })
  .meta({ id: "AgentToken" });

const issuedSchema = tokenSchema
  .extend({
    token: z
      .string()
      .describe("The secret, shown only in this answer; the server keeps only its hash."),
  })
  .meta({ id: "IssuedAgentToken" });

const issueBody = z.strictObject({
  label: z.string().trim().min(1).max(120).describe("Who holds it, such as the agent's name."),
});

const errors = { 400: apiErrorSchema, 404: apiErrorSchema } as const;

function view(token: AgentTokenRecord) {
  return {
    id: token.id,
    label: token.label,
    created_at: token.createdAt,
    ...(token.revokedAt === undefined ? {} : { revoked_at: token.revokedAt }),
  };
}

/**
 * The owner's agent tokens (#2159): issued for one workspace, listed without their secrets and
 * revoked one at a time. An agent token itself never reaches these routes.
 */
export function registerAgentTokenRoutes(
  parent: FastifyInstance,
  options: AgentTokenRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, tokens } = options;
  const now = options.now ?? (() => new Date());
  const requireWorkspace = async (workspaceId: string) => {
    await service.readWorkspace(workspaceRoot(workspaceId));
  };
  const path = "/v1/workspaces/:workspaceId/agent-tokens";

  app.post(
    path,
    {
      schema: {
        summary: "Issue an agent token",
        description:
          "A token for a coding agent that reaches only this workspace's work journal intake (record_work) and title listing (list_work). The secret is in this answer only.",
        params: workspaceParams,
        body: issueBody,
        response: { 201: issuedSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      const issued = newAgentToken();
      const record: AgentTokenRecord = {
        id: issued.id,
        workspaceId,
        label: request.body.label,
        createdAt: now().toISOString(),
      };
      await tokens.insert({ ...record, secretHash: agentTokenHash(issued.token) });
      request.log.info({ agentTokenId: record.id }, "agent token issued");
      return reply.code(201).send({ ...view(record), token: issued.token });
    },
  );

  app.get(
    path,
    {
      schema: {
        summary: "List agent tokens",
        description: "The workspace's agent tokens, newest first, without their secrets.",
        params: workspaceParams,
        response: { 200: z.object({ tokens: z.array(tokenSchema) }), ...errors },
      },
    },
    async (request) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      return { tokens: (await tokens.list(workspaceId)).map(view) };
    },
  );

  app.delete(
    `${path}/:tokenId`,
    {
      schema: {
        summary: "Revoke an agent token",
        description: "The token is refused from now on; the other tokens keep working.",
        params: tokenParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId, tokenId } = request.params;
      await requireWorkspace(workspaceId);
      if (!(await tokens.revoke(workspaceId, tokenId, now().toISOString()))) {
        return reply
          .code(404)
          .send(apiError("agent_token_not_found", "No such active agent token."));
      }
      request.log.info({ agentTokenId: tokenId }, "agent token revoked");
      return reply.code(204).send(null);
    },
  );
}
