import type { AgentTokenStore } from "@draft-loop/storage/agent-tokens";
import type { TenantDirectory } from "@draft-loop/storage/tenant-directory";
import type { FastifyRequest } from "fastify";

import type { MemberAgentTokens } from "./request-auth.js";

/**
 * Agent tokens for signed-in members (#2784): each tenant keeps its members' tokens in its own
 * store, and a token acts as the member who issued it while they stay active. Without the tenant
 * stores or the directory, sign-in mode issues and accepts no agent token.
 */
export function memberAgentTokens(
  agentTokensFor: ((tenantId: string) => AgentTokenStore) | undefined,
  directory: Pick<TenantDirectory, "listMembers"> | undefined,
): MemberAgentTokens | undefined {
  if (agentTokensFor === undefined || directory === undefined) return undefined;
  return {
    tokensFor: agentTokensFor,
    memberOf: async (tenantId, memberId) => {
      const member = (await directory.listMembers(tenantId)).find(
        (held) => held.memberId === memberId && held.status === "active",
      );
      return member === undefined ? undefined : { tenantId, memberId, role: member.role };
    },
  };
}

/** The request's tenant's tokens: the owner's store, or the signed-in member's tenant's. */
export function requestAgentTokens(
  ownerTokens: AgentTokenStore | undefined,
  memberTokens: MemberAgentTokens | undefined,
): ((request: FastifyRequest) => AgentTokenStore | undefined) | undefined {
  if (ownerTokens !== undefined) return () => ownerTokens;
  if (memberTokens === undefined) return undefined;
  return (request) =>
    request.caller?.kind === "member" ? memberTokens.tokensFor(request.caller.tenantId) : undefined;
}

/** In sign-in mode, the member a new token acts as and the tenant its secret names. */
export function agentTokenIssuer(
  request: FastifyRequest,
): { readonly tenantId: string; readonly memberId: string } | undefined {
  const { caller } = request;
  return caller?.kind === "member"
    ? { tenantId: caller.tenantId, memberId: caller.memberId }
    : undefined;
}
