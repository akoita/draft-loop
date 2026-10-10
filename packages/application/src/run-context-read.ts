import { resolve } from "node:path";

import type { ContextSnapshot } from "@draft-loop/domain";
import { createStorageRunStore } from "@draft-loop/orchestrator";
import { contextSnapshotSchema } from "@draft-loop/schemas";
import type { SqliteStorage } from "@draft-loop/storage";

import type { WorkspaceConfig } from "./local.js";

export interface RunContextReadDependencies {
  readonly readWorkspace: (root: string) => Promise<Pick<WorkspaceConfig, "latestRunId">>;
  readonly openStorage: (root: string) => Promise<SqliteStorage>;
}

/**
 * The context snapshot a run was configured with: the given run, or the workspace's latest.
 *
 * Resolves to `undefined` when there is no run yet, the run is unknown, or its context is
 * missing, so display surfaces can say nothing was recorded instead of failing the view.
 */
export async function readRunContext(
  rootInput: string,
  runIdInput: string | undefined,
  dependencies: RunContextReadDependencies,
): Promise<ContextSnapshot | undefined> {
  const root = resolve(rootInput);
  const config = await dependencies.readWorkspace(root);
  const runId = runIdInput ?? config.latestRunId;
  if (runId === undefined) return undefined;
  const storage = await dependencies.openStorage(root);
  try {
    const snapshot = await createStorageRunStore(storage).loadRun(runId);
    if (snapshot === undefined) return undefined;
    const contextRecord = await storage.getContextSnapshot(snapshot.contextSnapshotId);
    if (contextRecord === undefined) return undefined;
    return contextSnapshotSchema.parse(contextRecord.payload) as unknown as ContextSnapshot;
  } finally {
    await storage.close();
  }
}

/** One job requirement a run was judged against, as the candidate reviewed it. */
export interface RunRequirementText {
  readonly id: string;
  readonly text: string;
}

/** The requirements a run's coverage was judged against, in their recorded order. */
export function runRequirementTexts(
  context: Pick<ContextSnapshot, "requirements">,
): readonly RunRequirementText[] {
  return context.requirements.map(({ id, text }) => ({ id, text }));
}
