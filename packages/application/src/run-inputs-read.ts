import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { authorPromptSupportsCandidateDirection } from "./author-adjudication.js";
import type { StatusCommand } from "./index.js";
import { readWorkspace } from "./local.js";
import { localHistoryPath, openLocalHistory } from "./local-storage-factory.js";
import { readRunContext } from "./run-context-read.js";

/** The reviewed requirements brief a run was bound to when it started. */
export interface RunBriefInput {
  readonly briefId: string;
  readonly version: number;
}

/** The reviewed career profile version a run was bound to when it started. */
export interface RunProfileInput {
  readonly profileId: string;
  readonly version: number;
}

/**
 * The reviewed inputs a run recorded in its context snapshot when it started. A run started from
 * raw job text records no brief, and a run without a reviewed profile records no profile; both
 * read as `null` so that "recorded none" stays distinct from "recorded nothing at all".
 */
export interface RunInputs {
  readonly brief: RunBriefInput | null;
  readonly profile: RunProfileInput | null;
  /** Whether the run's recorded author prompt can take the candidate's directions (v9 or later). */
  readonly authorDirections: boolean;
}

function supportsDirections(version: string): boolean {
  try {
    return authorPromptSupportsCandidateDirection(version);
  } catch {
    return false;
  }
}

/**
 * The requirements brief and career profile version of the given run, or of the workspace's
 * latest run. Resolves to `undefined` when there is no run, no history, or no recorded context.
 * One run row and one context-snapshot row are read; the audit trail is never listed.
 */
export async function readRunInputs(command: StatusCommand): Promise<RunInputs | undefined> {
  const root = resolve(command.root);
  try {
    await stat(localHistoryPath(root));
  } catch {
    return undefined;
  }
  const context = await readRunContext(root, command.runId, {
    readWorkspace,
    openStorage: async (workspaceRoot) => openLocalHistory(localHistoryPath(workspaceRoot)),
  });
  if (context === undefined) return undefined;
  const brief = context.opportunityBriefReference;
  const profile = context.candidateProfileReference;
  return {
    brief: brief === undefined ? null : { briefId: brief.briefId, version: brief.version },
    profile:
      profile === undefined ? null : { profileId: profile.profileId, version: profile.version },
    authorDirections: supportsDirections(context.modelConfiguration.author.promptTemplateVersion),
  };
}
