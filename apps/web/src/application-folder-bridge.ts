import type { BridgeCommand } from "@draft-loop/ui/bridge";

import type { ApiClient } from "./api-client.js";

/** The application folder commands the hosted service serves, in the port's order. */
export const hostedApplicationFolderCapabilities = [
  "application-folder.list",
  "application-folder.create",
  "application-folder.rename",
  "application-folder.delete",
] as const;

type FolderCommandType = (typeof hostedApplicationFolderCapabilities)[number];
export type ApplicationFolderCommand = Extract<BridgeCommand, { type: FolderCommandType }>;

export function isApplicationFolderCommand(
  command: BridgeCommand,
): command is ApplicationFolderCommand {
  return (hostedApplicationFolderCapabilities as readonly string[]).includes(command.type);
}

/** Answers the folder commands over `/application-folders` (#2282) in the desktop's shapes. */
export function createApplicationFolderAnswers(client: ApiClient) {
  return async (command: ApplicationFolderCommand): Promise<unknown> => {
    const { workspaceId } = command.input;
    switch (command.type) {
      case "application-folder.list": {
        const { folders } = await client.call(
          "GET /v1/workspaces/{workspaceId}/application-folders",
          { path: { workspaceId } },
        );
        return { workspaceId, folders };
      }
      case "application-folder.create": {
        const folder = await client.call("POST /v1/workspaces/{workspaceId}/application-folders", {
          path: { workspaceId },
          body: { name: command.input.name },
        });
        return { workspaceId, folder };
      }
      case "application-folder.rename": {
        const folder = await client.call(
          "PATCH /v1/workspaces/{workspaceId}/application-folders/{folderId}",
          {
            path: { workspaceId, folderId: command.input.folderId },
            body: { name: command.input.name },
          },
        );
        return { workspaceId, folder };
      }
      case "application-folder.delete": {
        const deleted = await client.call(
          "DELETE /v1/workspaces/{workspaceId}/application-folders/{folderId}",
          { path: { workspaceId, folderId: command.input.folderId } },
        );
        return { workspaceId, ...deleted };
      }
    }
  };
}
