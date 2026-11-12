import { prepareCallsPerCreditedApplication } from "@draft-loop/schemas/entitlements";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { TenantEntitlementsFor } from "./entitlement-gate.js";

const applicationRoute = "/v1/workspaces/:workspaceId/applications/:applicationId";

/**
 * The routes that call a model outside a run (#2487), by method and route pattern. Interview
 * actions count only when they ask the interviewer. Brief extraction is free: a run needs a brief.
 * A Prepare route (#2680) drafts or researches for one application, which its credit covers.
 */
const meteredRoutes: ReadonlyArray<{
  readonly method: string;
  readonly url: string;
  readonly counts?: (body: unknown) => boolean;
  readonly prepare?: true;
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
  { method: "POST", url: `${applicationRoute}/material`, prepare: true },
  { method: "POST", url: `${applicationRoute}/interview-guide`, prepare: true },
  { method: "POST", url: `${applicationRoute}/research`, prepare: true },
  { method: "POST", url: "/v1/workspaces/:workspaceId/profiles/:profileId/derivation" },
];

type MeteredRequest = Pick<FastifyRequest, "method" | "routeOptions" | "body">;

function meteredRoute(request: MeteredRequest) {
  const route = meteredRoutes.find(
    (candidate) =>
      candidate.method === request.method && candidate.url === request.routeOptions.url,
  );
  return route !== undefined && (route.counts?.(request.body) ?? true) ? route : undefined;
}

/** Whether a request is one model call outside a run. */
export function isMeteredModelCall(request: MeteredRequest) {
  return meteredRoute(request) !== undefined;
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
 *
 * A Prepare call for an application whose run kept a credit is covered by that credit instead
 * (#2680): it leaves the day's count alone and counts against the application's fair-use limit,
 * refused past it with 429 `prepare_fair_use_reached`. A plan with unlimited credits has no such
 * limit. A Prepare call for an application without a credit counts against the day as before.
 */
export function registerModelCallGate(app: FastifyInstance, options: ModelCallGateOptions): void {
  const now = options.now ?? (() => new Date());
  app.addHook("preHandler", async (request, reply) => {
    const caller = request.caller;
    if (caller?.kind !== "member") return;
    const route = meteredRoute(request);
    if (route === undefined) return;
    const tenant = options.entitlementsFor(caller.tenantId);
    const entitlements = await tenant.entitlements();
    if (
      route.prepare === true &&
      tenant.prepareCalls !== undefined &&
      entitlements !== undefined &&
      entitlements.creditsPerPeriod !== null
    ) {
      const { workspaceId, applicationId } = request.params as Record<string, string>;
      const fairUse = prepareCallsPerCreditedApplication;
      const prepared =
        workspaceId === undefined || applicationId === undefined
          ? ({ credited: false } as const)
          : await tenant.prepareCalls.take({ workspaceId, applicationId, limit: fairUse });
      if (prepared.credited) {
        if (prepared.allowed) return;
        request.log.warn(
          { event: "prepare_fair_use_reached", organisationId: caller.tenantId, limit: fairUse },
          "prepare fair-use limit reached",
        );
        await reply.code(429).send({
          error: {
            code: "prepare_fair_use_reached",
            message: `This application has used the ${fairUse} drafts, guides and research runs its credit covers.`,
            limit: fairUse,
            params: { limit: fairUse },
          },
        });
        return;
      }
    }
    if (tenant.modelCalls === undefined) return;
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
