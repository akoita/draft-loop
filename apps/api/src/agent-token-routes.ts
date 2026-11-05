import type { ApplicationService } from "@draft-loop/application";
import {
  type AgentTokenRecord,
  type AgentTokenStore,
  defaultAgentTokenLifetimeDays,
  isAgentTokenActive,
  maximumActiveAgentTokens,
  maximumAgentTokenLifetimeDays,
} from "@draft-loop/storage/agent-tokens";
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
    expires_at: z.string().describe("When the token stops working."),
    revoked_at: z.string().optional(),
    active: z.boolean().describe("False once the token is revoked or expired."),
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
  expires_in_days: z
    .number()
    .int()
    .min(1)
    .max(maximumAgentTokenLifetimeDays)
    .optional()
    .describe(`Days until the token stops working; ${defaultAgentTokenLifetimeDays} by default.`),
});

const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema } as const;

const dayMs = 86_400_000;

function view(token: AgentTokenRecord, at: Date) {
  return {
    id: token.id,
    label: token.label,
    created_at: token.createdAt,
    expires_at: token.expiresAt,
    ...(token.revokedAt === undefined ? {} : { revoked_at: token.revokedAt }),
    active: isAgentTokenActive(token, at),
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
        description: `A token for a coding agent that reaches only this workspace's work journal intake (record_work) and title listing (list_work). It expires after expires_in_days (${defaultAgentTokenLifetimeDays} by default, at most ${maximumAgentTokenLifetimeDays}). A workspace holds at most ${maximumActiveAgentTokens} active tokens (409 agent_token_limit); revoke one first. The secret is in this answer only.`,
        params: workspaceParams,
        body: issueBody,
        response: { 201: issuedSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      const at = now();
      const active = (await tokens.list(workspaceId)).filter((token) =>
        isAgentTokenActive(token, at),
      );
      if (active.length >= maximumActiveAgentTokens) {
        return reply
          .code(409)
          .send(
            apiError(
              "agent_token_limit",
              `This workspace already has ${maximumActiveAgentTokens} active agent tokens; revoke one first.`,
            ),
          );
      }
      const issued = newAgentToken();
      const lifetimeDays = request.body.expires_in_days ?? defaultAgentTokenLifetimeDays;
      const record: AgentTokenRecord = {
        id: issued.id,
        workspaceId,
        label: request.body.label,
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + lifetimeDays * dayMs).toISOString(),
      };
      await tokens.insert({ ...record, secretHash: agentTokenHash(issued.token) });
      request.log.info(
        { agentTokenId: record.id, expiresAt: record.expiresAt },
        "agent token issued",
      );
      return reply.code(201).send({ ...view(record, at), token: issued.token });
    },
  );

  app.get(
    path,
    {
      schema: {
        summary: "List agent tokens",
        description:
          "The workspace's agent tokens, newest first, without their secrets; `active` is false once one is revoked or expired.",
        params: workspaceParams,
        response: { 200: z.object({ tokens: z.array(tokenSchema) }), ...errors },
      },
    },
    async (request) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      const at = now();
      return { tokens: (await tokens.list(workspaceId)).map((token) => view(token, at)) };
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
