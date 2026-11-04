/**
 * Agent tokens (#2147, #2158): credentials a coding agent holds instead of the owner token. Each
 * one reaches only the work journal of one workspace and can be revoked on its own. A store keeps
 * only a SHA-256 hash of the secret, never the secret itself. This module holds the port and an
 * in-memory implementation for tests and single-process stacks; Postgres implements it too.
 */

/** An agent token as stored and listed: everything but the secret. */
export interface AgentTokenRecord {
  /** `dlat_` followed by 8 to 64 URL-safe characters. */
  readonly id: string;
  readonly workspaceId: string;
  /** Who holds it, such as "Claude Code on my laptop"; 1 to 120 characters. */
  readonly label: string;
  readonly createdAt: string;
  readonly revokedAt?: string;
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
}

export class AgentTokenStoreError extends Error {
  readonly code: "duplicate_token" | "invalid_token";

  constructor(code: AgentTokenStoreError["code"], message: string) {
    super(message);
    this.name = "AgentTokenStoreError";
    this.code = code;
  }
}

const idPattern = /^dlat_[A-Za-z0-9_-]{8,64}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;

/** Checks a token before it is stored, so a store never holds a malformed one. */
export function requireAgentTokenInsert(token: AgentTokenInsert): AgentTokenInsert {
  const label = token.label.trim();
  if (
    !idPattern.test(token.id) ||
    !hashPattern.test(token.secretHash) ||
    token.workspaceId.length < 1 ||
    token.workspaceId.length > 256 ||
    label.length < 1 ||
    label.length > 120 ||
    Number.isNaN(Date.parse(token.createdAt)) ||
    token.revokedAt !== undefined
  ) {
    throw new AgentTokenStoreError("invalid_token", "The agent token is malformed.");
  }
  return { ...token, label };
}

function recordOf(token: AgentTokenInsert): AgentTokenRecord {
  const { secretHash: _secretHash, ...record } = token;
  return record;
}

/** Agent tokens in memory, for tests and single-process stacks. */
export function createMemoryAgentTokenStore(): AgentTokenStore {
  const tokens: AgentTokenInsert[] = [];
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
  };
}
