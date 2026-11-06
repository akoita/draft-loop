/**
 * Folders that group a workspace's applications on Home (#2282). A folder holds nothing itself:
 * deleting one moves its applications back to no folder, and an archived application keeps its
 * folder. Storage refusals become messages a person can act on, never a path or an id dump.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import { type ApplicationHistory, historyExists, openHistory } from "./application-history.js";
import { CliUserError } from "./cli-user-error.js";
import type {
  ApplicationView,
  WorkspaceApplicationDependencies,
} from "./workspace-applications.js";

export interface ApplicationFolderView {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Applications in the folder, archived ones included. */
  readonly applicationCount: number;
}

export interface ListApplicationFoldersCommand {
  readonly root: string;
}

export interface CreateApplicationFolderCommand {
  readonly root: string;
  readonly name: string;
}

export interface RenameApplicationFolderCommand {
  readonly root: string;
  readonly folderId: string;
  readonly name: string;
}

export interface DeleteApplicationFolderCommand {
  readonly root: string;
  readonly folderId: string;
}

export interface DeleteApplicationFolderResult {
  readonly folderId: string;
  /** How many applications went back to no folder. */
  readonly movedApplications: number;
}

export interface MoveApplicationCommand {
  readonly root: string;
  readonly applicationId: string;
  /** The folder to put the application in, or null for no folder. */
  readonly folderId: string | null;
}

export interface ApplicationFolderService {
  /** The workspace's folders, oldest first. */
  readonly listFolders: (
    command: ListApplicationFoldersCommand,
  ) => Promise<readonly ApplicationFolderView[]>;
  readonly createFolder: (
    command: CreateApplicationFolderCommand,
  ) => Promise<ApplicationFolderView>;
  readonly renameFolder: (
    command: RenameApplicationFolderCommand,
  ) => Promise<ApplicationFolderView>;
  /** Deletes the folder only; its applications stay, in no folder. */
  readonly deleteFolder: (
    command: DeleteApplicationFolderCommand,
  ) => Promise<DeleteApplicationFolderResult>;
}

/** A storage refusal as the person's own problem to fix; anything else is rethrown. */
function asUserError(error: unknown): never {
  if (error instanceof StorageConflictError || error instanceof StorageValidationError) {
    throw new CliUserError(`${error.message}.`.replace(/\.\.$/u, "."));
  }
  throw error;
}

function newFolderId(): string {
  return `fld_${randomUUID().replaceAll("-", "")}`;
}

export function createApplicationFolderService(
  dependencies: WorkspaceApplicationDependencies,
): ApplicationFolderService {
  const clock = dependencies.now ?? (() => new Date().toISOString());
  const withHistory = async <Result>(
    rootInput: string,
    work: (storage: ApplicationHistory, workspaceId: string) => Promise<Result>,
  ): Promise<Result> => {
    const root = resolve(rootInput);
    const workspace = await dependencies.readWorkspace(root);
    const storage = await openHistory(root);
    try {
      return await work(storage, workspace.id);
    } catch (error) {
      return asUserError(error);
    } finally {
      await storage.close();
    }
  };
  const describe = async (
    storage: ApplicationHistory,
    workspaceId: string,
  ): Promise<readonly ApplicationFolderView[]> => {
    const [folders, placements] = await Promise.all([
      storage.applications.listFolders(workspaceId),
      storage.applications.listFolderPlacements(workspaceId),
    ]);
    const counts = new Map<string, number>();
    for (const folderId of placements.values()) {
      counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
    }
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      applicationCount: counts.get(folder.id) ?? 0,
    }));
  };
  const described = async (
    storage: ApplicationHistory,
    workspaceId: string,
    folderId: string,
  ): Promise<ApplicationFolderView> => {
    const folder = (await describe(storage, workspaceId)).find((item) => item.id === folderId);
    if (folder === undefined) throw new CliUserError("The folder could not be read back.");
    return folder;
  };
  return {
    listFolders: async ({ root }) => {
      if (!(await historyExists(resolve(root)))) return [];
      return withHistory(root, describe);
    },
    createFolder: async ({ root, name }) =>
      withHistory(root, async (storage, workspaceId) => {
        const folder = await storage.applications.createFolder({
          workspaceId,
          id: newFolderId(),
          name,
          createdAt: clock(),
        });
        return described(storage, workspaceId, folder.id);
      }),
    renameFolder: async ({ root, folderId, name }) =>
      withHistory(root, async (storage, workspaceId) => {
        await storage.applications.renameFolder(workspaceId, folderId, name, clock());
        return described(storage, workspaceId, folderId);
      }),
    deleteFolder: async ({ root, folderId }) =>
      withHistory(root, async (storage, workspaceId) => ({
        folderId,
        ...(await storage.applications.deleteFolder(workspaceId, folderId)),
      })),
  };
}

/** Puts an application in a folder or in none, then reads it back with `get`. */
export async function moveApplicationToFolder(
  dependencies: WorkspaceApplicationDependencies,
  get: (command: { root: string; applicationId: string }) => Promise<ApplicationView | undefined>,
  { root: rootInput, applicationId, folderId }: MoveApplicationCommand,
): Promise<ApplicationView> {
  const root = resolve(rootInput);
  if ((await get({ root, applicationId })) === undefined) {
    throw new CliUserError(`Application ${applicationId} was not found.`);
  }
  const workspace = await dependencies.readWorkspace(root);
  const storage = await openHistory(root);
  try {
    await storage.applications.setApplicationFolder(
      workspace.id,
      applicationId,
      folderId,
      (dependencies.now ?? (() => new Date().toISOString()))(),
    );
  } catch (error) {
    asUserError(error);
  } finally {
    await storage.close();
  }
  const view = await get({ root, applicationId });
  if (view === undefined) throw new CliUserError("The application could not be read back.");
  return view;
}
