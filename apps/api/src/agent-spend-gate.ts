import type { ApplicationService, RunBudgetCeiling } from "@draft-loop/application";
import {
  type AgentConnectionCapStore,
  agentConnectionSpentCents,
} from "@draft-loop/storage/agent-connection-caps";
import {
  type AgentSpendOutcome,
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
 *
 * An assistant's sign-in holds no token, so its starts reserve against the cap its person set
 * for the connection (#2656): one per workspace and assistant client.
 */
export interface AgentSpendGate {
  /** What the request's agent may still start this month, for the estimate an agent reads. */
  status(request: FastifyRequest, root: string): Promise<AgentSpendStatus | undefined>;
}

/** The connection caps of the tenant a request acts in; none when it has no tenant. */
export type AgentConnectionCapsFor = (
  request: FastifyRequest,
) => AgentConnectionCapStore | undefined;

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
  /** Owner mode's agent tokens; without them only connections are held to a cap. */
  readonly tokens?: AgentTokenStore;
  /** Sign-in mode's connection caps; without them only tokens are held to a cap. */
  readonly connectionCaps?: AgentConnectionCapsFor;
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
  readonly id: string;
  readonly release: () => Promise<void>;
}

/** Where one request's start is reserved: its token's cap, or its connection's. */
interface Ledger {
  /** "token" or "connection", as the refusal names the agent. */
  readonly noun: "token" | "connection";
  reserve(month: string, key: string, cents: number): Promise<AgentSpendOutcome>;
  release(month: string, key: string, cents: number): Promise<void>;
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
    (await options.tokens?.list(workspaceId))?.find((token) => token.id === id);
  const ledgerOf = (request: FastifyRequest): Ledger | undefined => {
    const agent = request.agentToken;
    if (agent === undefined) return undefined;
    const { workspaceId, id, clientId } = agent;
    if (clientId !== undefined) {
      const caps = options.connectionCaps?.(request);
      if (caps === undefined) return undefined;
      return {
        noun: "connection",
        reserve: (month, key, cents) =>
          caps.reserveSpend({ workspaceId, clientId, month, key, cents }),
        release: (month, key, cents) =>
          caps.releaseSpend({ workspaceId, clientId, month, key, cents }),
      };
    }
    const { tokens } = options;
    if (tokens === undefined) return undefined;
    return {
      noun: "token",
      reserve: (month, key, cents) => tokens.reserveSpend({ workspaceId, id, month, key, cents }),
      release: (month, key, cents) => tokens.releaseSpend({ workspaceId, id, month, key, cents }),
    };
  };

  app.addHook("preHandler", async (request, reply) => {
    const token = request.agentToken;
    if (token === undefined || reply.sent) return;
    const rule = agentRoutes[agentRouteKey(request.method, request.routeOptions.url)];
    if (rule?.charge === undefined) return;
    const ledger = ledgerOf(request);
    if (ledger === undefined) {
      // Nothing holds this agent to a cap here, so it starts nothing.
      await reply
        .code(403)
        .send(apiError("forbidden", "This agent cannot start runs or drafts on this server."));
      return;
    }
    const idempotencyKey = request.headers["idempotency-key"];
    const month = agentSpendMonth(now());
    // Validation answered 400 already when the key is missing; the route keeps keys apart.
    const key = `${rule.charge}:${typeof idempotencyKey === "string" ? idempotencyKey : request.id}`;
    const cents =
      rule.charge === "run" ? await runCents(options.workspaceRoot(token.workspaceId)) : draftCents;
    const outcome = await ledger.reserve(month, key, cents);
    if (outcome.outcome === "reserved") {
      held.set(request, { id: token.id, release: () => ledger.release(month, key, cents) });
      request.log.info(
        { agentTokenId: token.id, cents, spentCents: outcome.spentCents },
        "agent spend reserved",
      );
      return;
    }
    if (outcome.outcome === "replayed") return;
    const noCap =
      ledger.noun === "connection"
        ? "This agent connection has no monthly spend cap; the person sets one in Workspace settings > Agents."
        : "This agent token has no monthly spend cap; create a token with Start runs and drafts in Workspace settings > Agents.";
    const raise =
      ledger.noun === "connection"
        ? "the person raises the cap in Workspace settings > Agents"
        : "the person raises the cap with a new token";
    const message =
      outcome.outcome !== "cap_reached"
        ? noCap
        : `This agent ${ledger.noun} has reserved $${usd(outcome.spentCents).toFixed(2)} of its $${usd(outcome.capCents).toFixed(2)} monthly cap, and this ${rule.charge} reserves $${usd(cents).toFixed(2)}; it starts again next month, or ${raise}.`;
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
    await reservation.release();
    request.log.info({ agentTokenId: reservation.id }, "agent spend released");
  });

  const statusOf = async (capCents: number, spent: number, root: string) => ({
    monthlyCapUsd: usd(capCents),
    spentThisMonthUsd: usd(spent),
    remainingUsd: usd(Math.max(0, capCents - spent)),
    runReservesUsd: usd(await runCents(root)),
    draftReservesUsd: usd(draftCents),
  });

  return {
    status: async (request, root) => {
      const agent = request.agentToken;
      if (agent === undefined) return undefined;
      const month = agentSpendMonth(now());
      if (agent.clientId !== undefined) {
        const cap = await options.connectionCaps?.(request)?.get(agent.workspaceId, agent.clientId);
        if (cap === undefined) return undefined;
        return statusOf(cap.monthlyCapCents, agentConnectionSpentCents(cap, month), root);
      }
      const record = await find(agent.workspaceId, agent.id);
      if (record?.monthlyCapCents === undefined) return undefined;
      return statusOf(record.monthlyCapCents, agentSpentCents(record, month), root);
    },
  };
}
