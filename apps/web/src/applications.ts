import type { ApiClient, ApiSchemas } from "./api-client.js";
import { ownerWorkspaceId } from "./workspace-model.js";

/** The workspace's default application, where the screen's briefs and runs live. */
export async function readDefaultApplication(
  client: ApiClient,
  workspaceId: string = ownerWorkspaceId,
): Promise<ApiSchemas["Application"] | undefined> {
  const { applications } = await client.call("GET /v1/workspaces/{workspaceId}/applications", {
    path: { workspaceId },
  });
  return applications.find((item) => item.isDefault) ?? applications[0];
}
