import type { ContextSnapshot } from "@draft-loop/domain";
import { createStorageRunStore } from "@draft-loop/orchestrator";
import { contextSnapshotSchema } from "@draft-loop/schemas";
import type { RunHistoryStorage, WorkspaceRecord } from "@draft-loop/storage";

import { CliUserError } from "./cli-user-error.js";
import { timestamp } from "./response-execution.js";

/** Ensure an initialized workspace has the durable parent row used by child records. */
export async function ensureWorkspaceRecord(
  storage: RunHistoryStorage,
  workspaceId: string,
): Promise<void> {
  if ((await storage.getWorkspace(workspaceId)) !== undefined) return;
  const now = timestamp();
  const record: WorkspaceRecord = {
    id: workspaceId,
    state: "collecting",
    createdAt: now,
    updatedAt: now,
  };
  await storage.saveWorkspace(record);
}

/** The context snapshot a saved run was started with; fails when the run or context is missing. */
export async function contextForRun(
  storage: RunHistoryStorage,
  runId: string,
): Promise<ContextSnapshot> {
  const runStore = createStorageRunStore(storage);
  const snapshot = await runStore.loadRun(runId);
  if (snapshot === undefined) throw new CliUserError(`Run ${runId} was not found.`);
  const contextRecord = await storage.getContextSnapshot(snapshot.contextSnapshotId);
  if (contextRecord === undefined) throw new CliUserError("The run context snapshot is missing.");
  return contextSnapshotSchema.parse(contextRecord.payload) as unknown as ContextSnapshot;
}
