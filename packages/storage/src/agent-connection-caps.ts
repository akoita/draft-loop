import { type AgentSpendOutcome, maximumAgentMonthlyCapCents } from "./agent-tokens.js";

/**
 * Spend caps of assistant connections (#2653). An assistant signed in through the identity
 * provider holds no agent token, so what it may spend each month is kept here instead: one cap
 * per workspace and assistant client, set by the person, with what the connection reserved this
 * UTC month. A connection without a cap starts nothing. This module holds the port and an
 * in-memory implementation for tests and single-process stacks; Postgres implements it too.
 */

/** A connection's cap as stored and listed. */
export interface AgentConnectionCap {
  readonly workspaceId: string;
  /** The assistant's client at the identity provider; 1 to 200 visible characters. */
  readonly clientId: string;
  /** What the connection may reserve each UTC month, in US cents. */
  readonly monthlyCapCents: number;
  readonly updatedAt: string;
  /** What it reserved in `month` (`YYYY-MM`, UTC); absent before its first start. */
  readonly spend?: { readonly month: string; readonly cents: number };
}

export interface AgentConnectionSpendReservation {
  readonly workspaceId: string;
  readonly clientId: string;
  /** `YYYY-MM`, UTC. */
  readonly month: string;
  /** What makes a retry the same start, such as the request's Idempotency-Key. */
  readonly key: string;
  readonly cents: number;
}

export interface AgentConnectionCapStore {
  /** Sets or changes a connection's cap; what it reserved this month is kept. */
  set(cap: Omit<AgentConnectionCap, "spend">): Promise<AgentConnectionCap>;
  get(workspaceId: string, clientId: string): Promise<AgentConnectionCap | undefined>;
  /** A workspace's caps, by client id. */
  list(workspaceId: string): Promise<readonly AgentConnectionCap[]>;
  /** Removes a cap and its spend; false when the workspace holds none for the client. */
  remove(workspaceId: string, clientId: string): Promise<boolean>;
  /**
   * Reserves `cents` against the connection's cap for `month`, once per `key`. Atomic, so two
   * starts never both pass the last cents; `no_cap` when the connection holds none.
   */
  reserveSpend(reservation: AgentConnectionSpendReservation): Promise<AgentSpendOutcome>;
  /** Gives back a reservation whose request failed; does nothing for an unknown key. */
  releaseSpend(reservation: AgentConnectionSpendReservation): Promise<void>;
}

export class AgentConnectionCapStoreError extends Error {
  readonly code = "invalid_cap";

  constructor() {
    super("The connection cap is malformed.");
    this.name = "AgentConnectionCapStoreError";
  }
}

const clientIdPattern = /^[\x21-\x7e]{1,200}$/u;

/** Checks a cap before it is stored, so a store never holds a malformed one. */
export function requireAgentConnectionCap(
  cap: Omit<AgentConnectionCap, "spend">,
): Omit<AgentConnectionCap, "spend"> {
  if (
    cap.workspaceId.length < 1 ||
    cap.workspaceId.length > 256 ||
    !clientIdPattern.test(cap.clientId) ||
    !Number.isInteger(cap.monthlyCapCents) ||
    cap.monthlyCapCents < 1 ||
    cap.monthlyCapCents > maximumAgentMonthlyCapCents ||
    Number.isNaN(Date.parse(cap.updatedAt))
  ) {
    throw new AgentConnectionCapStoreError();
  }
  return {
    workspaceId: cap.workspaceId,
    clientId: cap.clientId,
    monthlyCapCents: cap.monthlyCapCents,
    updatedAt: cap.updatedAt,
  };
}

/** What a connection has reserved in `month`; 0 when its record holds another month. */
export function agentConnectionSpentCents(cap: AgentConnectionCap, month: string): number {
  return cap.spend?.month === month ? cap.spend.cents : 0;
}

/** Connection caps in memory, for tests and single-process stacks. */
export function createMemoryAgentConnectionCapStore(): AgentConnectionCapStore {
  const caps = new Map<string, AgentConnectionCap>();
  /** The keys each connection reserved, with the month they count in. */
  const keys = new Map<string, { month: string; keys: Map<string, number> }>();
  const idOf = (workspaceId: string, clientId: string) => JSON.stringify([workspaceId, clientId]);
  return {
    set: async (input) => {
      const cap = requireAgentConnectionCap(input);
      const id = idOf(cap.workspaceId, cap.clientId);
      const spend = caps.get(id)?.spend;
      const stored = { ...cap, ...(spend === undefined ? {} : { spend }) };
      caps.set(id, stored);
      return stored;
    },
    get: async (workspaceId, clientId) => caps.get(idOf(workspaceId, clientId)),
    list: async (workspaceId) =>
      [...caps.values()]
        .filter((cap) => cap.workspaceId === workspaceId)
        .sort((a, b) => a.clientId.localeCompare(b.clientId)),
    remove: async (workspaceId, clientId) => {
      const id = idOf(workspaceId, clientId);
      keys.delete(id);
      return caps.delete(id);
    },
    reserveSpend: async ({ workspaceId, clientId, month, key, cents }) => {
      const id = idOf(workspaceId, clientId);
      const cap = caps.get(id);
      if (cap === undefined) return { outcome: "no_cap" };
      const spent = agentConnectionSpentCents(cap, month);
      const held = keys.get(id);
      const reserved = held?.month === month ? held.keys : new Map<string, number>();
      if (reserved.has(key)) return { outcome: "replayed", spentCents: spent };
      if (spent + cents > cap.monthlyCapCents) {
        return { outcome: "cap_reached", spentCents: spent, capCents: cap.monthlyCapCents };
      }
      reserved.set(key, cents);
      keys.set(id, { month, keys: reserved });
      caps.set(id, { ...cap, spend: { month, cents: spent + cents } });
      return { outcome: "reserved", spentCents: spent + cents };
    },
    releaseSpend: async ({ workspaceId, clientId, month, key }) => {
      const id = idOf(workspaceId, clientId);
      const cap = caps.get(id);
      const held = keys.get(id);
      const cents = held?.month === month ? held.keys.get(key) : undefined;
      if (cap?.spend === undefined || held === undefined || cents === undefined) return;
      held.keys.delete(key);
      caps.set(id, { ...cap, spend: { month, cents: Math.max(0, cap.spend.cents - cents) } });
    },
  };
}
