import { resolve } from "node:path";

import { readWorkspace } from "./local.js";
import {
  type EvidenceMode,
  readWorkspaceEvidenceMode,
  type WorkspaceEvidenceModeRecord,
  writeWorkspaceEvidenceMode,
} from "./workspace-evidence-mode.js";

export interface WorkspaceEvidenceModeService {
  readonly get: (command: { readonly root: string }) => Promise<WorkspaceEvidenceModeRecord>;
  readonly set: (command: {
    readonly root: string;
    readonly mode: EvidenceMode;
    /** Cost cap on full-source evidence; omitting it clears a saved cap. */
    readonly maxEvidenceTokens?: number;
  }) => Promise<WorkspaceEvidenceModeRecord>;
}

/** Reads and changes the setting of an existing workspace; it never starts a run. */
export function createWorkspaceEvidenceModeService(now?: () => Date): WorkspaceEvidenceModeService {
  return {
    get: async ({ root }) => {
      const workspaceRoot = resolve(root);
      await readWorkspace(workspaceRoot);
      return readWorkspaceEvidenceMode(workspaceRoot);
    },
    set: async ({ root, mode, maxEvidenceTokens }) => {
      const workspaceRoot = resolve(root);
      await readWorkspace(workspaceRoot);
      return writeWorkspaceEvidenceMode(workspaceRoot, mode, now, maxEvidenceTokens);
    },
  };
}

export const workspaceEvidenceModeService = createWorkspaceEvidenceModeService();
