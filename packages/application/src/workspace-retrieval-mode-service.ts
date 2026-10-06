import { resolve } from "node:path";

import type { EmbeddingModelTier } from "./embedding-model-install.js";
import { readWorkspace } from "./local.js";
import {
  type RetrievalMode,
  readWorkspaceRetrievalMode,
  type WorkspaceRetrievalModeRecord,
  writeWorkspaceRetrievalMode,
} from "./workspace-retrieval-mode.js";

export interface WorkspaceRetrievalModeService {
  readonly get: (command: { readonly root: string }) => Promise<WorkspaceRetrievalModeRecord>;
  readonly set: (command: {
    readonly root: string;
    readonly mode: RetrievalMode;
    readonly modelTier?: EmbeddingModelTier;
  }) => Promise<WorkspaceRetrievalModeRecord>;
}

/** Reads and changes the setting of an existing workspace; it never starts a run. */
export function createWorkspaceRetrievalModeService(
  now?: () => Date,
): WorkspaceRetrievalModeService {
  return {
    get: async ({ root }) => {
      const workspaceRoot = resolve(root);
      await readWorkspace(workspaceRoot);
      return readWorkspaceRetrievalMode(workspaceRoot);
    },
    set: async ({ root, mode, modelTier }) => {
      const workspaceRoot = resolve(root);
      await readWorkspace(workspaceRoot);
      return writeWorkspaceRetrievalMode(
        workspaceRoot,
        modelTier === undefined ? { mode } : { mode, modelTier },
        now,
      );
    },
  };
}

export const workspaceRetrievalModeService = createWorkspaceRetrievalModeService();
