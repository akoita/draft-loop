import { resolve } from "node:path";

import type { ApplicationService, ModelProfileReferences } from "./index.js";
import { readWorkspace } from "./local.js";
import type { ModelProfileRegistry } from "./model-profiles.js";
import {
  clearWorkspaceModelProfileSelection,
  describeModelProfileReferences,
  describeModelProfileSelectionMismatch,
  readWorkspaceModelProfileSelection,
  saveWorkspaceModelProfileSelection,
  type WorkspaceModelProfileSelection,
} from "./workspace-model-profile-selection.js";

export interface WorkspaceModelProfileSelectionService {
  /** The applied pair, or undefined when none is applied; a corrupt file throws. */
  readonly get: (command: {
    readonly root: string;
  }) => Promise<WorkspaceModelProfileSelection | undefined>;
  /** Applies an exact pair for future runs after checking it against the workspace models. */
  readonly save: (command: {
    readonly root: string;
    readonly modelProfiles: ModelProfileReferences;
  }) => Promise<WorkspaceModelProfileSelection>;
  /** Removes the applied pair; resolves to whether one was applied. */
  readonly clear: (command: { readonly root: string }) => Promise<boolean>;
}

/** Reads and changes the applied pair of an existing workspace; it never starts a run. */
export function createWorkspaceModelProfileSelectionService(
  options: { readonly registry?: ModelProfileRegistry; readonly now?: () => Date } = {},
): WorkspaceModelProfileSelectionService {
  return {
    get: async ({ root }) => {
      const workspaceRoot = resolve(root);
      await readWorkspace(workspaceRoot);
      return readWorkspaceModelProfileSelection(workspaceRoot);
    },
    save: ({ root, modelProfiles }) =>
      saveWorkspaceModelProfileSelection(root, modelProfiles, options),
    clear: ({ root }) => clearWorkspaceModelProfileSelection(root),
  };
}

export const workspaceModelProfileSelectionService = createWorkspaceModelProfileSelectionService();

const legacyPathLine =
  "Model profiles: none attached (legacy path: provider-default runtime controls, unknown context windows).";

/**
 * Makes the workspace's applied pair the default for new runs. A run that names its own profiles is
 * untouched apart from a status line, and resume is never altered because a resumed run reuses the
 * profiles recorded in its own snapshot. A corrupt selection file stops the start before any work.
 */
export function withSavedModelProfiles<Service extends ApplicationService>(
  service: Service,
  options: { readonly registry?: ModelProfileRegistry } = {},
): Service {
  return {
    ...service,
    start: async (command, io) => {
      const write = (line: string): void => io?.write(line);
      if (command.modelProfiles !== undefined) {
        write(
          `Model profiles: explicit (${describeModelProfileReferences(command.modelProfiles)}).`,
        );
        return service.start(command, io);
      }
      const saved = await readWorkspaceModelProfileSelection(command.root);
      if (saved === undefined) {
        write(legacyPathLine);
        return service.start(command, io);
      }
      const workspace = await service.readWorkspace(command.root);
      const mismatch = describeModelProfileSelectionMismatch(
        workspace,
        saved.modelProfiles,
        options.registry,
      );
      if (mismatch !== undefined) {
        write(
          `Model profiles: the saved pair (${describeModelProfileReferences(saved.modelProfiles)}) was ignored because ${mismatch}.`,
        );
        write(legacyPathLine);
        return service.start(command, io);
      }
      write(
        `Model profiles: saved for this workspace (${describeModelProfileReferences(saved.modelProfiles)}).`,
      );
      return service.start({ ...command, modelProfiles: saved.modelProfiles }, io);
    },
  };
}
