import type { ApplicationService, RunBudgetCeiling } from "@draft-loop/application";
import {
  type AgentTokenRecord,
  type AgentTokenStore,
  agentSpendMonth,
  agentSpentCents,
} from "@draft-loop/storage/agent-tokens";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { agentRouteKey, agentRoutes } from "./agent-route-scopes.js";
import { defaultApplicationMaterialMaxCostUsd } from "./application-material-routes.js";
import { apiError } from "./errors.js";

/**
 * The monthly spend cap of an agent token with `runs:start` (#2599). Each start an agent makes
 * reserves its worst case against the token's cap for the UTC month before the route runs: a CV
 * run reserves the workspace's per-run cost limit, which the run cannot pass, and a cover letter
 * or interview questions (#2601) reserve one draft's cost cap. A retry with the
 * same Idempotency-Key reserves nothing more, and a start the route refuses gives its reservation
 * back. The workspace's own run budget still applies to each run.
 */
export interface AgentSpendGate {
  /** What the token may still start this month, for the estimate an agent reads. */
  status(
    token: { readonly id: string; readonly workspaceId: string },
    root: string,
  ): Promise<AgentSpendStatus | undefined>;
}

export interface AgentSpendStatus {
  readonly monthlyCapUsd: number;
  readonly spentThisMonthUsd: number;
  readonly remainingUsd: number;
  /** What one CV run reserves: the workspace's per-run cost limit. */
  readonly runReservesUsd: number;
  /** What one cover letter or set of interview questions reserves: one draft's cost cap. */
  readonly draftReservesUsd: number;
}

export interface AgentSpendGateOptions {
  readonly tokens: AgentTokenStore;
  readonly service: Pick<ApplicationService, "readWorkspace">;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly budgetCeiling: RunBudgetCeiling;
  /** The most one draft of application material may spend, in US dollars. */
  readonly draftMaxCostUsd?: number;
  readonly now?: () => Date;
}

const usd = (cents: number) => cents / 100;

/** Dollars to whole cents, rounded up so a reservation never falls short of the limit. */
export function centsOf(amountUsd: number): number {
  return Math.ceil(Math.round(amountUsd * 10_000) / 100);
}

interface Held {
  readonly workspaceId: string;
  readonly id: string;
  readonly month: string;
  readonly key: string;
  readonly cents: number;
}

/** The reservation each request made, to give back when the route refuses it. */
const held = new WeakMap<FastifyRequest, Held>();

/** Registers the cap's hooks; call it after request authentication so the body is admitted. */
export function registerAgentSpendGate(
  app: FastifyInstance,
  options: AgentSpendGateOptions,
): AgentSpendGate {
  const now = options.now ?? (() => new Date());
  const runCents = async (root: string) => {
    const workspace = await options.service.readWorkspace(root);
    return centsOf(workspace.maxCostUsd ?? options.budgetCeiling.maxCostUsd);
  };
  const draftCents = centsOf(options.draftMaxCostUsd ?? defaultApplicationMaterialMaxCostUsd);
  const find = async (workspaceId: string, id: string): Promise<AgentTokenRecord | undefined> =>
    (await options.tokens.list(workspaceId)).find((token) => token.id === id);

  app.addHook("preHandler", async (request, reply) => {
    const token = request.agentToken;
    if (token === undefined || reply.sent) return;
    const rule = agentRoutes[agentRouteKey(request.method, request.routeOptions.url)];
    if (rule?.charge === undefined) return;
    const key = request.headers["idempotency-key"];
    const reservation = {
      workspaceId: token.workspaceId,
      id: token.id,
      month: agentSpendMonth(now()),
      // Validation answered 400 already when the key is missing; the route keeps keys apart.
      key: `${rule.charge}:${typeof key === "string" ? key : request.id}`,
      cents:
        rule.charge === "run"
          ? await runCents(options.workspaceRoot(token.workspaceId))
          : draftCents,
    };
    const outcome = await options.tokens.reserveSpend(reservation);
    if (outcome.outcome === "reserved") {
      held.set(request, reservation);
      request.log.info(
        { agentTokenId: token.id, cents: reservation.cents, spentCents: outcome.spentCents },
        "agent spend reserved",
      );
      return;
    }
    if (outcome.outcome === "replayed") return;
    const message =
      outcome.outcome !== "cap_reached"
        ? "This agent token has no monthly spend cap; create a token with Start runs and drafts in Workspace settings > Agents."
        : `This agent token has reserved $${usd(outcome.spentCents).toFixed(2)} of its $${usd(outcome.capCents).toFixed(2)} monthly cap, and this ${rule.charge} reserves $${usd(reservation.cents).toFixed(2)}; it starts again next month, or the person raises the cap with a new token.`;
    request.log.info({ agentTokenId: token.id }, "agent spend cap reached");
    await reply.code(429).send(
      apiError("agent_spend_cap_reached", message, {
        ...(outcome.outcome === "cap_reached"
          ? { capUsd: usd(outcome.capCents), spentUsd: usd(outcome.spentCents) }
          : {}),
      }),
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    const reservation = held.get(request);
    if (reservation === undefined || reply.statusCode < 400) return;
    held.delete(request);
    await options.tokens.releaseSpend(reservation);
    request.log.info({ agentTokenId: reservation.id }, "agent spend released");
  });

  return {
    status: async (token, root) => {
      const record = await find(token.workspaceId, token.id);
      if (record?.monthlyCapCents === undefined) return undefined;
      const spent = agentSpentCents(record, agentSpendMonth(now()));
      return {
        monthlyCapUsd: usd(record.monthlyCapCents),
        spentThisMonthUsd: usd(spent),
        remainingUsd: usd(Math.max(0, record.monthlyCapCents - spent)),
        runReservesUsd: usd(await runCents(root)),
        draftReservesUsd: usd(draftCents),
      };
    },
  };
}
