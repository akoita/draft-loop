import type { ApplicationService } from "@draft-loop/application";
import {
  type AgentConnectionCap,
  agentConnectionSpentCents,
} from "@draft-loop/storage/agent-connection-caps";
import { agentSpendMonth, maximumAgentMonthlyCapCents } from "@draft-loop/storage/agent-tokens";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { AgentConnectionCapsFor } from "./agent-spend-gate.js";
import { apiError, apiErrorSchema } from "./errors.js";

export interface AgentConnectionCapRoutesOptions {
  readonly service: Pick<ApplicationService, "readWorkspace">;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly capsFor: AgentConnectionCapsFor;
  readonly now?: () => Date;
}

const workspaceParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

/** A client id may be a URL, so it travels in the body or the query, never in the path. */
const clientIdSchema = z
  .string()
  .regex(/^[\x21-\x7e]{1,200}$/u, "must be 1 to 200 visible characters")
  .describe("The assistant's client at the identity provider.");

const connectionSchema = z
  .object({
    client_id: clientIdSchema,
    monthly_cap_usd: z.number().describe("What the connection may reserve each UTC month."),
    spent_this_month_usd: z.number().describe("What it reserved this UTC month."),
    updated_at: z.string(),
  })
  .meta({ id: "AgentConnectionCap" });

const setBody = z.strictObject({
  client_id: clientIdSchema,
  monthly_cap_usd: z
    .number()
    .min(0.01)
    .max(maximumAgentMonthlyCapCents / 100)
    .multipleOf(0.01)
    .describe(
      "The US dollars the connection may reserve each UTC month. Each run reserves the workspace's per-run cost limit, and each draft its cost cap.",
    ),
});

const errors = { 400: apiErrorSchema, 404: apiErrorSchema } as const;

function view(cap: AgentConnectionCap, at: Date) {
  return {
    client_id: cap.clientId,
    monthly_cap_usd: cap.monthlyCapCents / 100,
    spent_this_month_usd: agentConnectionSpentCents(cap, agentSpendMonth(at)) / 100,
    updated_at: cap.updatedAt,
  };
}

/**
 * The monthly spend caps of assistant connections (#2656): an assistant that signs a person in
 * starts runs and drafts only within the cap that person set for it in the workspace. An
 * assistant itself never reaches these routes.
 */
export function registerAgentConnectionCapRoutes(
  parent: FastifyInstance,
  options: AgentConnectionCapRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, capsFor } = options;
  const now = options.now ?? (() => new Date());
  const path = "/v1/workspaces/:workspaceId/agent-connections";
  /** The caller's caps, once the workspace is known to be theirs. */
  const capsOf = async (request: Parameters<AgentConnectionCapsFor>[0], workspaceId: string) => {
    await service.readWorkspace(workspaceRoot(workspaceId));
    const caps = capsFor(request);
    if (caps === undefined) throw new Error("The request has no tenant to keep caps for.");
    return caps;
  };

  app.get(
    path,
    {
      schema: {
        summary: "List assistant connection caps",
        description:
          "The monthly spend cap of each assistant connection in the workspace, by client id. A connection without a cap starts no run or draft.",
        params: workspaceParams,
        response: { 200: z.object({ connections: z.array(connectionSchema) }), ...errors },
      },
    },
    async (request) => {
      const { workspaceId } = request.params;
      const caps = await capsOf(request, workspaceId);
      const at = now();
      return { connections: (await caps.list(workspaceId)).map((cap) => view(cap, at)) };
    },
  );

  app.put(
    path,
    {
      schema: {
        summary: "Set an assistant connection's monthly spend cap",
        description:
          "Sets or changes what one assistant connection may reserve each UTC month in this workspace. What it reserved this month is kept. The assistant must also be granted the runs:start scope when it connects.",
        params: workspaceParams,
        body: setBody,
        response: { 200: connectionSchema, ...errors },
      },
    },
    async (request) => {
      const { workspaceId } = request.params;
      const caps = await capsOf(request, workspaceId);
      const at = now();
      const cap = await caps.set({
        workspaceId,
        clientId: request.body.client_id,
        monthlyCapCents: Math.round(request.body.monthly_cap_usd * 100),
        updatedAt: at.toISOString(),
      });
      request.log.info(
        { agentClientId: cap.clientId, monthlyCapCents: cap.monthlyCapCents },
        "agent connection cap set",
      );
      return view(cap, at);
    },
  );

  app.delete(
    path,
    {
      schema: {
        summary: "Remove an assistant connection's monthly spend cap",
        description:
          "The connection starts no run or draft from now on; it keeps its other scopes.",
        params: workspaceParams,
        querystring: z.strictObject({ client_id: clientIdSchema }),
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const caps = await capsOf(request, workspaceId);
      if (!(await caps.remove(workspaceId, request.query.client_id))) {
        return reply
          .code(404)
          .send(apiError("agent_connection_cap_not_found", "No cap is set for this connection."));
      }
      request.log.info({ agentClientId: request.query.client_id }, "agent connection cap removed");
      return reply.code(204).send(null);
    },
  );
}
