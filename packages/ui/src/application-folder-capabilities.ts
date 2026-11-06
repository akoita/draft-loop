/**
 * What Home can do with folders, built from the capability port only when the host offers every
 * folder command. A host with none of them (the local-first desktop) gets no folder controls.
 */
import type { ApplicationSummaryView } from "./application-contract.js";
import type {
  ApplicationFolderDeleteResult,
  ApplicationFolderView,
} from "./application-folder-contract.js";
import type { BridgeResult, CapabilityPort } from "./bridge.js";

export interface ApplicationFolderCapabilities {
  readonly listFolders: (workspaceId: string) => Promise<readonly ApplicationFolderView[]>;
  readonly createFolder: (workspaceId: string, name: string) => Promise<ApplicationFolderView>;
  readonly renameFolder: (
    workspaceId: string,
    folderId: string,
    name: string,
  ) => Promise<ApplicationFolderView>;
  /** Deletes the folder; its applications go back to no folder. */
  readonly deleteFolder: (
    workspaceId: string,
    folderId: string,
  ) => Promise<ApplicationFolderDeleteResult>;
  /** Puts an application in a folder, or in none with `null`. */
  readonly moveApplication: (
    workspaceId: string,
    applicationId: string,
    folderId: string | null,
  ) => Promise<ApplicationSummaryView>;
}

const folderCommands = [
  "application.move",
  "application-folder.list",
  "application-folder.create",
  "application-folder.rename",
  "application-folder.delete",
] as const;

export function createApplicationFolderCapabilities(
  port: CapabilityPort,
  unwrap: <Value>(result: BridgeResult<Value>) => Value,
): ApplicationFolderCapabilities | undefined {
  if (!folderCommands.every((command) => port.hasCapability(command))) return undefined;
  return {
    listFolders: async (workspaceId) =>
      unwrap(await port.execute({ type: "application-folder.list", input: { workspaceId } }))
        .folders,
    createFolder: async (workspaceId, name) =>
      unwrap(
        await port.execute({ type: "application-folder.create", input: { workspaceId, name } }),
      ).folder,
    renameFolder: async (workspaceId, folderId, name) =>
      unwrap(
        await port.execute({
          type: "application-folder.rename",
          input: { workspaceId, folderId, name },
        }),
      ).folder,
    deleteFolder: async (workspaceId, folderId) =>
      unwrap(
        await port.execute({ type: "application-folder.delete", input: { workspaceId, folderId } }),
      ),
    moveApplication: async (workspaceId, applicationId, folderId) =>
      unwrap(
        await port.execute({
          type: "application.move",
          input: { workspaceId, applicationId, folderId },
        }),
      ).application,
  };
}
