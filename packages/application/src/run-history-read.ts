import type { WorkspaceHistoryStorage } from "@draft-loop/storage";

import { storageFactory } from "./local-storage-factory.js";

/**
 * Opens a workspace's history for a run read through the active storage factory, or `undefined`
 * when it has none yet. Locally that is the history file; on the hosted service it is the
 * tenant's Postgres history, so the run details read the same events on both.
 */
export async function openRunHistory(root: string): Promise<WorkspaceHistoryStorage | undefined> {
  const factory = storageFactory();
  if (factory.hasHistory !== undefined && !(await factory.hasHistory(root))) return undefined;
  return factory.open(root);
}
