/**
 * Agent tokens (#2147, #2158): credentials an agent holds instead of the owner token. Each
 * one reaches only the scopes it was issued with (#2438) in one workspace, expires, and can be
 * revoked on its own (the
 * audit in `docs/security/agent-token-audit.md`). A store keeps
 * only a SHA-256 hash of the secret, never the secret itself. This module holds the port and an
 * in-memory implementation for tests and single-process stacks; Postgres implements it too.
 */

/**
 * What an agent token may do (ADR 0011 D17, #2438). `journal` reaches the work journal intake and
 * title listing; `applications:read` lists and reads job applications and run state;
 * `jobs:write` creates a job application from pasted job text; `drafts:read` (#2569) reads a
 * run's exports and the application's saved cover letters and interview questions;
 * `runs:start` (#2599) prices and starts CV runs within the token's monthly spend cap.
 */
export const agentTokenScopes = [
  "journal",
  "applications:read",
  "jobs:write",
  "drafts:read",
  "runs:start",
] as const;
export type AgentTokenScope = (typeof agentTokenScopes)[number];

/** The scopes of a token issued without any, and of every token issued before scopes existed. */
export const defaultAgentTokenScopes: readonly AgentTokenScope[] = ["journal"];

export function isAgentTokenScope(value: unknown): value is AgentTokenScope {
  return (agentTokenScopes as readonly unknown[]).includes(value);
}

/** Scopes in the catalogue's order, without repeats; undefined when one is unknown or none given. */
export function normalizeAgentTokenScopes(
  scopes: readonly unknown[],
): readonly AgentTokenScope[] | undefined {
  if (scopes.length === 0 || !scopes.every(isAgentTokenScope)) return undefined;
  return agentTokenScopes.filter((scope) => scopes.includes(scope));
}

/** An agent token as stored and listed: everything but the secret. */
export interface AgentTokenRecord {
  /** `dlat_` followed by 8 to 64 URL-safe characters. */
  readonly id: string;
  readonly workspaceId: string;
  /** Who holds it, such as "Claude Code on my laptop"; 1 to 120 characters. */
  readonly label: string;
  readonly createdAt: string;
  /** When the token stops working; after `createdAt`, at most a year later. */
  readonly expiresAt: string;
  readonly revokedAt?: string;
  /** What it may do; at least one scope, in the catalogue's order. */
  readonly scopes: readonly AgentTokenScope[];
  /**
   * What the token may spend each UTC month on what it starts, in US cents (#2599). Set exactly
   * when the token has `runs:start`; the workspace's own run budget still applies to each run.
   */
  readonly monthlyCapCents?: number;
  /** What it reserved in `month` (`YYYY-MM`, UTC); absent before its first start. */
  readonly spend?: { readonly month: string; readonly cents: number };
}

export interface AgentTokenInsert extends AgentTokenRecord {
  /** SHA-256 of the secret, in lower-case hex. */
  readonly secretHash: string;
}

export interface AgentTokenStore {
  /** Stores a new token; refuses an id or hash already stored. */
  insert(token: AgentTokenInsert): Promise<void>;
  /** The token whose secret has this hash, revoked or not. */
  findByHash(secretHash: string): Promise<AgentTokenRecord | undefined>;
  /** A workspace's tokens, newest first. */
  list(workspaceId: string): Promise<readonly AgentTokenRecord[]>;
  /** Revokes a token; false when the workspace has no such token or it is already revoked. */
  revoke(workspaceId: string, id: string, at: string): Promise<boolean>;
  /**
   * Reserves `cents` against the token's cap for `month`, once per `key`: a key already reserved
   * this month reserves nothing more. Atomic, so two starts never both pass the last cents.
   */
  reserveSpend(reservation: AgentSpendReservation): Promise<AgentSpendOutcome>;
  /** Gives back a reservation whose request failed; does nothing for an unknown key. */
  releaseSpend(reservation: AgentSpendReservation): Promise<void>;
}

export interface AgentSpendReservation {
  readonly workspaceId: string;
  readonly id: string;
  /** `YYYY-MM`, UTC. */
  readonly month: string;
  /** What makes a retry the same start, such as the request's Idempotency-Key. */
  readonly key: string;
  readonly cents: number;
}

export type AgentSpendOutcome =
  | { readonly outcome: "reserved" | "replayed"; readonly spentCents: number }
  | {
      readonly outcome: "cap_reached";
      readonly spentCents: number;
      readonly capCents: number;
    }
  | { readonly outcome: "no_cap" };

/** The UTC month a reservation at `at` counts in, as `YYYY-MM`. */
export function agentSpendMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/** The most a token may spend in a month: $500, far above a candidate's month of runs. */
export const maximumAgentMonthlyCapCents = 50_000;

/** What a token has reserved in `month`; 0 when its record holds another month. */
export function agentSpentCents(token: AgentTokenRecord, month: string): number {
  return token.spend?.month === month ? token.spend.cents : 0;
}

export class AgentTokenStoreError extends Error {
  readonly code: "duplicate_token" | "invalid_token";

  constructor(code: AgentTokenStoreError["code"], message: string) {
    super(message);
    this.name = "AgentTokenStoreError";
    this.code = code;
  }
}

/** How long a token lives when its issuer names no lifetime, and the longest it may live. */
export const defaultAgentTokenLifetimeDays = 90;
export const maximumAgentTokenLifetimeDays = 365;
/** The most tokens one workspace may hold that are neither revoked nor expired. */
export const maximumActiveAgentTokens = 20;

const dayMs = 86_400_000;

/**
 * When a token stored before tokens expired stops working: the default lifetime after it was
 * issued (#2147's tokens carry no expiry of their own).
 */
export function legacyAgentTokenExpiry(createdAt: string): string {
  return new Date(Date.parse(createdAt) + defaultAgentTokenLifetimeDays * dayMs).toISOString();
}

/** Whether a token still works at `at`: neither revoked nor past its expiry. */
export function isAgentTokenActive(token: AgentTokenRecord, at: Date): boolean {
  return token.revokedAt === undefined && Date.parse(token.expiresAt) > at.getTime();
}

const idPattern = /^dlat_[A-Za-z0-9_-]{8,64}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;

/** Checks a token before it is stored, so a store never holds a malformed one. */
export function requireAgentTokenInsert(token: AgentTokenInsert): AgentTokenInsert {
  const label = token.label.trim();
  const scopes = normalizeAgentTokenScopes(token.scopes);
  if (
    scopes === undefined ||
    scopes.length !== token.scopes.length ||
    !idPattern.test(token.id) ||
    !hashPattern.test(token.secretHash) ||
    token.workspaceId.length < 1 ||
    token.workspaceId.length > 256 ||
    label.length < 1 ||
    label.length > 120 ||
    Number.isNaN(Date.parse(token.createdAt)) ||
    !(Date.parse(token.expiresAt) > Date.parse(token.createdAt)) ||
    Date.parse(token.expiresAt) - Date.parse(token.createdAt) >
      maximumAgentTokenLifetimeDays * dayMs ||
    token.revokedAt !== undefined ||
    scopes.includes("runs:start") !== (token.monthlyCapCents !== undefined) ||
    (token.monthlyCapCents !== undefined &&
      (!Number.isInteger(token.monthlyCapCents) ||
        token.monthlyCapCents < 1 ||
        token.monthlyCapCents > maximumAgentMonthlyCapCents)) ||
    token.spend !== undefined
  ) {
    throw new AgentTokenStoreError("invalid_token", "The agent token is malformed.");
  }
  return { ...token, label, scopes };
}

function recordOf(token: AgentTokenInsert): AgentTokenRecord {
  const { secretHash: _secretHash, ...record } = token;
  return record;
}

/** Agent tokens in memory, for tests and single-process stacks. */
export function createMemoryAgentTokenStore(): AgentTokenStore {
  const tokens: AgentTokenInsert[] = [];
  /** The keys each token reserved, with the month they count in. */
  const keys = new Map<string, { month: string; keys: Map<string, number> }>();
  const find = (workspaceId: string, id: string) =>
    tokens.findIndex((held) => held.workspaceId === workspaceId && held.id === id);
  return {
    insert: async (input) => {
      const token = requireAgentTokenInsert(input);
      if (tokens.some((held) => held.id === token.id || held.secretHash === token.secretHash)) {
        throw new AgentTokenStoreError("duplicate_token", "The agent token is already stored.");
      }
      tokens.push(token);
    },
    findByHash: async (secretHash) => {
      const token = tokens.find((held) => held.secretHash === secretHash);
      return token === undefined ? undefined : recordOf(token);
    },
    list: async (workspaceId) =>
      tokens
        .filter((held) => held.workspaceId === workspaceId)
        .map(recordOf)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    revoke: async (workspaceId, id, at) => {
      const index = tokens.findIndex(
        (held) =>
          held.workspaceId === workspaceId && held.id === id && held.revokedAt === undefined,
      );
      if (index < 0) return false;
      tokens[index] = { ...(tokens[index] as AgentTokenInsert), revokedAt: at };
      return true;
    },
    reserveSpend: async ({ workspaceId, id, month, key, cents }) => {
      const index = find(workspaceId, id);
      const token = tokens[index];
      if (token?.monthlyCapCents === undefined) return { outcome: "no_cap" };
      const spent = agentSpentCents(token, month);
      const held = keys.get(id);
      const reserved = held?.month === month ? held.keys : new Map<string, number>();
      if (reserved.has(key)) return { outcome: "replayed", spentCents: spent };
      if (spent + cents > token.monthlyCapCents) {
        return { outcome: "cap_reached", spentCents: spent, capCents: token.monthlyCapCents };
      }
      reserved.set(key, cents);
      keys.set(id, { month, keys: reserved });
      tokens[index] = { ...token, spend: { month, cents: spent + cents } };
      return { outcome: "reserved", spentCents: spent + cents };
    },
    releaseSpend: async ({ workspaceId, id, month, key }) => {
      const index = find(workspaceId, id);
      const token = tokens[index];
      const held = keys.get(id);
      const cents = held?.month === month ? held.keys.get(key) : undefined;
      if (token === undefined || cents === undefined) return;
      held?.keys.delete(key);
      tokens[index] = {
        ...token,
        spend: { month, cents: Math.max(0, agentSpentCents(token, month) - cents) },
      };
    },
  };
}
