import type { ContextSnapshot } from "@draft-loop/domain";
import { createStorageRunStore, type RunSnapshot } from "@draft-loop/orchestrator";
import { contextSnapshotSchema } from "@draft-loop/schemas";
import type { RunHistoryStorage, WorkspaceRecord } from "@draft-loop/storage";

import { CliUserError } from "./cli-user-error.js";
import { timestamp } from "./response-execution.js";
import { runNotFound } from "./run-action-error.js";

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

/** The saved run; a missing one is `run_not_found`, which the hosted API answers with 404. */
export async function requireRun(storage: RunHistoryStorage, runId: string): Promise<RunSnapshot> {
  const snapshot = await createStorageRunStore(storage).loadRun(runId);
  if (snapshot === undefined) throw runNotFound(runId);
  return snapshot;
}

/** The context snapshot a saved run was started with; fails when the run or context is missing. */
export async function contextForRun(
  storage: RunHistoryStorage,
  runId: string,
): Promise<ContextSnapshot> {
  const snapshot = await requireRun(storage, runId);
  const contextRecord = await storage.getContextSnapshot(snapshot.contextSnapshotId);
  if (contextRecord === undefined) throw new CliUserError("The run context snapshot is missing.");
  return contextSnapshotSchema.parse(contextRecord.payload) as unknown as ContextSnapshot;
}
