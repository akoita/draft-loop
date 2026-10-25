import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { FastifyInstance } from "fastify";

import { apiError } from "./errors.js";
import type { KnowledgeOwnership } from "./knowledge-access.js";

const selectionRoute = "/v1/workspaces/:workspaceId/knowledge-selection";
const unknownBase = apiError("knowledge_base_not_found", "No such knowledge base.");

/**
 * Knowledge base ownership in owner-token mode (#1758). A base created for a workspace belongs to
 * it, as in sign-in mode, so erasing the workspace erases its bases, a workspace lists only its
 * own, and no workspace selects another's. The owner token still reaches every base, and a base
 * created before bases had owners stays selectable.
 */
export function registerOwnerTokenKnowledge(
  app: FastifyInstance,
  owners: KnowledgeBaseOwners,
): KnowledgeOwnership {
  app.addHook("preHandler", async (request, reply) => {
    if (request.caller?.kind !== "owner") return;
    if (request.method !== "PUT" || request.routeOptions.url !== selectionRoute) return;
    const workspaceId = (request.params as { workspaceId?: unknown } | undefined)?.workspaceId;
    const selected = (request.body as { knowledgeBaseIds?: unknown } | undefined)?.knowledgeBaseIds;
    if (typeof workspaceId !== "string" || !Array.isArray(selected)) return;
    for (const id of selected) {
      if (typeof id !== "string") continue;
      const owner = await owners.ownerOf(id);
      if (owner !== undefined && owner !== workspaceId) {
        return reply.code(404).send(unknownBase);
      }
    }
  });

  return {
    listable: async (_request, workspaceId) =>
      workspaceId === undefined ? undefined : new Set(await owners.basesOwnedBy([workspaceId])),
    setOwner: async (_request, knowledgeBaseId, workspaceId) => {
      try {
        await owners.setOwner({ knowledgeBaseId, workspaceId });
      } catch (error) {
        // Best effort: the failure to report is the owner write's, not the cleanup's.
        await owners.removeUnowned(knowledgeBaseId).catch(() => false);
        throw error;
      }
    },
  };
}
