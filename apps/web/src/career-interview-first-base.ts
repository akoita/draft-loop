import type { ApiClient } from "./api-client.js";
import { defaultHostedKnowledgeBaseName } from "./knowledge-bridge.js";

/**
 * Where a confirmed interview summary goes when the record selects no knowledge base (#2733): the
 * record's newest active base, or a new one named as the first document's base is. The caller
 * selects it only after the summary is saved, so a refused save never leaves a record pointing at
 * an empty base.
 */
export async function firstInterviewBase(
  client: ApiClient,
  workspaceId: string,
): Promise<{ readonly id: string; readonly select: () => Promise<void> }> {
  const { knowledgeBases } = await client.call("GET /v1/knowledge-bases", {
    query: { workspaceId },
  });
  const newest = knowledgeBases
    .filter((base) => base.state !== "archived")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const base =
    newest ??
    (await client.call("POST /v1/knowledge-bases", {
      body: { displayName: defaultHostedKnowledgeBaseName, workspaceId },
    }));
  return {
    id: base.id,
    select: async () => {
      await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
        path: { workspaceId },
        body: { knowledgeBaseIds: [base.id] },
      });
    },
  };
}
