import { createHash } from "node:crypto";
import { type AgentTokenScope, agentTokenScopes } from "@draft-loop/storage/agent-tokens";
import type { FastifyRequest } from "fastify";

import { agentRouteKey, agentRoutes } from "./agent-route-scopes.js";

/**
 * Agent grants (#2646): on the hosted service, an assistant signs a person in through the
 * identity provider and holds an access token issued to its own client, not to the web screen.
 * Such a token acts as that member, but only on the agent routes its granted scopes admit
 * (`agent-route-scopes.ts`); it never reaches a decision, a setting or another person's route.
 */

/** A granted scope is spelled `draftloop:<agent scope>` in the token's `scope` claim. */
export const agentGrantScopePrefix = "draftloop:";

export interface AgentGrant {
  /** The assistant's client at the identity provider (`azp`, or `client_id`). */
  readonly clientId: string;
  readonly scopes: readonly AgentTokenScope[];
}

/**
 * The grant a verified token carries, or none when the web screen's own client holds it. A
 * token of any other client is a grant, with or without scopes, so a client nobody classified
 * never gets a member's full access.
 */
export function agentGrantOf(
  token: { readonly clientId?: string; readonly grantedScopes: readonly string[] },
  webClientId: string,
): AgentGrant | undefined {
  if (token.clientId === undefined || token.clientId === webClientId) return undefined;
  const granted = new Set(
    token.grantedScopes
      .filter((scope) => scope.startsWith(agentGrantScopePrefix))
      .map((scope) => scope.slice(agentGrantScopePrefix.length)),
  );
  return {
    clientId: token.clientId,
    scopes: agentTokenScopes.filter((scope) => granted.has(scope)),
  };
}

/** A stable id for what a grant files, in the shape of an agent token id; it names no secret. */
export function agentGrantId(grant: AgentGrant): string {
  const digest = createHash("sha256").update(grant.clientId, "utf8").digest("base64url");
  return `dlat_oauth_${digest.slice(0, 16)}`;
}

export type AgentGrantAdmission =
  | { readonly outcome: "allowed"; readonly scope: AgentTokenScope; readonly workspaceId: string }
  | { readonly outcome: "refused"; readonly message: string };

/**
 * Whether a grant may make this request. The member's own rights still decide which workspace
 * it reaches. A route that spends is refused: a grant has no monthly spend cap yet.
 */
export function admitAgentGrant(request: FastifyRequest, grant: AgentGrant): AgentGrantAdmission {
  const rule = agentRoutes[agentRouteKey(request.method, request.routeOptions.url)];
  const workspaceId = (request.params as { readonly workspaceId?: unknown } | undefined)
    ?.workspaceId;
  if (rule === undefined || typeof workspaceId !== "string") {
    return { outcome: "refused", message: "An agent connection cannot reach this route." };
  }
  if (!grant.scopes.includes(rule.scope)) {
    return {
      outcome: "refused",
      message: `This agent connection was not granted the "${rule.scope}" scope; connect it again and grant that scope.`,
    };
  }
  if (rule.charge !== undefined) {
    return {
      outcome: "refused",
      message:
        "An agent connection cannot start runs or drafts yet; start them in DraftLoop or with an agent token.",
    };
  }
  if (request.method === "GET" && rule.allows !== undefined && !rule.allows(request)) {
    return {
      outcome: "refused",
      message: rule.refusal ?? "An agent connection cannot make this request.",
    };
  }
  return { outcome: "allowed", scope: rule.scope, workspaceId };
}
