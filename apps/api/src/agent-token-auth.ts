import { createHash, randomBytes } from "node:crypto";
import {
  type AgentTokenScope,
  type AgentTokenStore,
  isAgentTokenActive,
} from "@draft-loop/storage/agent-tokens";
import "fastify";

/**
 * Agent tokens (#2147, #2159): what an agent holds instead of the owner token. One reaches
 * only the routes its scopes admit in one workspace (`agent-route-scopes.ts`, #2438), so an
 * injected instruction in a repository the agent reads cannot use it to reach the candidate's
 * records or decisions.
 */

/** Every agent token starts with this, so a leaked one is recognisable and is never the owner's. */
export const agentTokenPrefix = "dlagent_";

declare module "fastify" {
  interface FastifyRequest {
    /** The agent token a request came with; unset for every other credential. */
    agentToken:
      | {
          readonly id: string;
          readonly workspaceId: string;
          readonly scopes: readonly AgentTokenScope[];
          /** Set for an assistant's sign-in (#2646): its client, which holds the spend cap. */
          readonly clientId?: string;
        }
      | undefined;
  }
}

/** SHA-256 of a token, in lower-case hex: all a store keeps of it. */
export function agentTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new token's id and secret; the secret is shown once and only its hash is stored. */
export function newAgentToken(): { readonly id: string; readonly token: string } {
  return {
    id: `dlat_${randomBytes(12).toString("base64url")}`,
    token: `${agentTokenPrefix}${randomBytes(32).toString("base64url")}`,
  };
}

export function isAgentTokenShape(token: string): boolean {
  return /^dlagent_[A-Za-z0-9_-]{43}$/u.test(token);
}

export type AgentAuthentication =
  | {
      readonly outcome: "agent";
      readonly id: string;
      readonly workspaceId: string;
      readonly scopes: readonly AgentTokenScope[];
    }
  | { readonly outcome: "unauthenticated"; readonly reason: string };

/** Looks a presented agent token up by its hash; a revoked, expired or unknown one is refused. */
export async function authenticateAgentToken(
  store: AgentTokenStore,
  token: string,
  now: Date = new Date(),
): Promise<AgentAuthentication> {
  const found = await store.findByHash(agentTokenHash(token));
  if (found === undefined) return { outcome: "unauthenticated", reason: "unknown agent token" };
  if (found.revokedAt !== undefined) {
    return { outcome: "unauthenticated", reason: "revoked agent token" };
  }
  if (!isAgentTokenActive(found, now)) {
    return { outcome: "unauthenticated", reason: "expired agent token" };
  }
  return {
    outcome: "agent",
    id: found.id,
    workspaceId: found.workspaceId,
    scopes: found.scopes,
  };
}
