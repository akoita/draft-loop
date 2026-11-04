import { createHash, randomBytes } from "node:crypto";
import type { AgentTokenStore } from "@draft-loop/storage/agent-tokens";
import type { FastifyRequest } from "fastify";

/**
 * Agent tokens (#2147, #2159): what a coding agent holds instead of the owner token. One reaches
 * only the work journal intake and listing of one workspace, so an injected instruction in a
 * repository the agent reads cannot use it to reach the candidate's records.
 */

/** Every agent token starts with this, so a leaked one is recognisable and is never the owner's. */
export const agentTokenPrefix = "dlagent_";

declare module "fastify" {
  interface FastifyRequest {
    /** The agent token a request came with; unset for every other credential. */
    agentToken: { readonly id: string; readonly workspaceId: string } | undefined;
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
  | { readonly outcome: "agent"; readonly id: string; readonly workspaceId: string }
  | { readonly outcome: "unauthenticated"; readonly reason: string };

/** Looks a presented agent token up by its hash; a revoked or unknown one is refused. */
export async function authenticateAgentToken(
  store: AgentTokenStore,
  token: string,
): Promise<AgentAuthentication> {
  const found = await store.findByHash(agentTokenHash(token));
  if (found === undefined) return { outcome: "unauthenticated", reason: "unknown agent token" };
  if (found.revokedAt !== undefined) {
    return { outcome: "unauthenticated", reason: "revoked agent token" };
  }
  return { outcome: "agent", id: found.id, workspaceId: found.workspaceId };
}

const agentRoute = "/v1/workspaces/:workspaceId/work-journal/notes";

/**
 * Whether an agent token may make this request: only `record_work` (POST) and `list_work` (GET
 * with titles) on its own workspace's notes. Whole notes stay with the candidate's review.
 */
export function isAgentRequestAllowed(request: FastifyRequest, workspaceId: string): boolean {
  if (request.routeOptions.url !== agentRoute) return false;
  const params = request.params as { readonly workspaceId?: unknown } | undefined;
  if (params?.workspaceId !== workspaceId) return false;
  if (request.method === "POST") return true;
  if (request.method !== "GET") return false;
  const query = request.query as { readonly fields?: unknown } | undefined;
  return query?.fields === undefined || query.fields === "titles";
}
