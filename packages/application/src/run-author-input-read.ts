import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { openSqliteStorage } from "@draft-loop/storage";

import type { StatusCommand } from "./index.js";
import { readWorkspace } from "./local.js";
import { parseRunAuthorInputPayload, type RunAuthorInput } from "./run-author-input.js";

const historyPath = (root: string): string => join(root, ".draft-loop", "history.sqlite");

/**
 * What the latest author step of the given run, or of the workspace's latest run, was sent, read
 * back from its `run.author-input` audit event. Resolves to `undefined` when there is no run, no
 * history, no event for the run, or a malformed payload.
 */
export async function readRunAuthorInput(
  command: StatusCommand,
): Promise<RunAuthorInput | undefined> {
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
    // One targeted read: listing the whole trail would parse every run snapshot it repeats.
    const event = await storage.auditEvents.findLatestAuditEvent({
      workspaceId: config.id,
      eventType: "run.author-input",
      entityType: "run",
      entityId: runId,
    });
    return event === undefined ? undefined : parseRunAuthorInputPayload(event.payload);
  } finally {
    await storage.close();
  }
}
