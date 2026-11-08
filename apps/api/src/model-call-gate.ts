import type { FastifyInstance, FastifyRequest } from "fastify";

import type { TenantEntitlementsFor } from "./entitlement-gate.js";

/**
 * The routes that call a model outside a run (#2487), by method and route pattern. Interview
 * actions count only when they ask the interviewer. Brief extraction is free: a run needs a brief.
 */
const meteredRoutes: ReadonlyArray<{
  readonly method: string;
  readonly url: string;
  readonly counts?: (body: unknown) => boolean;
}> = [
  {
    method: "POST",
    url: "/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/actions",
    counts: (body) => {
      const action = (body as { action?: unknown } | undefined)?.action;
      return action === "accept" || action === "answer" || action === "own_subject";
    },
  },
  { method: "GET", url: "/v1/workspaces/:workspaceId/career-interview/sessions/:sessionId/live" },
  { method: "POST", url: "/v1/workspaces/:workspaceId/applications/:applicationId/material" },
  { method: "POST", url: "/v1/workspaces/:workspaceId/profiles/:profileId/derivation" },
];

/** Whether a request is one model call outside a run. */
export function isMeteredModelCall(
  request: Pick<FastifyRequest, "method" | "routeOptions" | "body">,
) {
  const route = meteredRoutes.find(
    (candidate) =>
      candidate.method === request.method && candidate.url === request.routeOptions.url,
  );
  return route !== undefined && (route.counts?.(request.body) ?? true);
}

function secondsToNextUtcDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export interface ModelCallGateOptions {
  readonly entitlementsFor: TenantEntitlementsFor;
  readonly now?: () => Date;
}

/**
 * Counts a member's model calls outside runs against the plan's `modelCallsPerDay` and refuses
 * past it with 429 `model_call_cap_reached` until the next UTC day. An organisation with no
 * plan, an unlimited plan and the owner token are not counted. The count is taken before the
 * route runs, so a call the route then refuses for another reason still counts.
 */
export function registerModelCallGate(app: FastifyInstance, options: ModelCallGateOptions): void {
  const now = options.now ?? (() => new Date());
  app.addHook("preHandler", async (request, reply) => {
    const caller = request.caller;
    if (caller?.kind !== "member" || !isMeteredModelCall(request)) return;
    const tenant = options.entitlementsFor(caller.tenantId);
    if (tenant.modelCalls === undefined) return;
    const entitlements = await tenant.entitlements();
    const limit = entitlements?.modelCallsPerDay;
    if (limit === undefined || limit === null) return;
    const at = now();
    const taken = await tenant.modelCalls.take({ limit, now: at });
    if (taken.allowed) return;
    request.log.warn(
      { event: "model_call_cap_reached", organisationId: caller.tenantId, limit },
      "model call cap reached",
    );
    await reply
      .code(429)
      .header("retry-after", String(secondsToNextUtcDay(at)))
      .send({
        error: {
          code: "model_call_cap_reached",
          message: `The organisation has made ${limit} model calls today outside runs, the most its plan allows.`,
          limit,
          params: { limit },
        },
      });
  });
}
