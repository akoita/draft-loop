import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { openSqliteStorage } from "@draft-loop/storage";

import type { StatusCommand } from "./index.js";
import { readWorkspace } from "./local.js";
import {
  applicationPlanEventType,
  parseRunApplicationPlanPayload,
  type RunApplicationPlan,
} from "./run-application-plan.js";

const historyPath = (root: string): string => join(root, ".draft-loop", "history.sqlite");

/**
 * The application plan of the given run, or of the workspace's latest run, from its latest
 * `run.application-plan` event. Resolves to `undefined` when there is no run, no history, no
 * plan (an earlier run, or one with planning off), or a malformed payload.
 */
export async function readRunApplicationPlan(
  command: StatusCommand,
): Promise<RunApplicationPlan | undefined> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const runId = command.runId ?? config.latestRunId;
  if (runId === undefined) return undefined;
  try {
    await stat(historyPath(root));
  } catch {
    return undefined;
  }
  const storage = openSqliteStorage(historyPath(root));
  try {
    const event = await storage.auditEvents.findLatestAuditEvent({
      workspaceId: config.id,
      eventType: applicationPlanEventType,
      entityType: "run",
      entityId: runId,
    });
    return event === undefined ? undefined : parseRunApplicationPlanPayload(event.payload);
  } finally {
    await storage.close();
  }
}
