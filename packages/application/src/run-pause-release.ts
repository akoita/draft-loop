import { resolve } from "node:path";

import {
  createOrchestrationEngine,
  createStorageRunStore,
  type RunSnapshot,
} from "@draft-loop/orchestrator";

import { readWorkspace } from "./local.js";
import { storageFactory } from "./local-storage-factory.js";
import { noopAgents } from "./noop-agents.js";
import { RunActionError } from "./run-action-error.js";

export interface ReleasePauseCommand {
  readonly root: string;
  readonly runId: string;
}

/**
 * Lifts the person's pause on a run without executing it, so a worker can resume it from its
 * current step. The engine has no agents, so this never reaches a provider; the hosted service
 * queues the run after it.
 */
export async function releaseRunPause(command: ReleasePauseCommand): Promise<RunSnapshot> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const storage = await storageFactory().open(root);
  try {
    const store = createStorageRunStore(storage);
    const snapshot = await store.loadRun(command.runId);
    if (snapshot === undefined || snapshot.workspaceId !== config.id)
      throw new RunActionError("run_not_found", "No such run.");
    return await createOrchestrationEngine({ ...noopAgents(), store }).releasePause(command.runId);
  } finally {
    await storage.close();
  }
}
