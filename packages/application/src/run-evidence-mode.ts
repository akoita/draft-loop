import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { openSqliteStorage } from "@draft-loop/storage";
import { z } from "zod";

import { previewEvidenceMode } from "./evidence-mode-preview.js";
import type { ApplicationDriver, StatusCommand } from "./index.js";
import { type LocalApplicationDriverOptions, readWorkspace } from "./local.js";
import { readRunApplicationPlan } from "./run-application-plan-read.js";
import { readRunAuthorInput } from "./run-author-input-read.js";
import { readRunInputs } from "./run-inputs-read.js";
import { readRunModels } from "./run-models-read.js";
import { evidenceModes } from "./workspace-evidence-mode.js";

/** The write side lives with the decision; the local driver reaches both through this module. */
export { announceRunEvidenceMode } from "./full-source-evidence.js";

/**
 * The evidence mode a run actually used, read back from its `run.evidence-mode` audit event, so a
 * review surface can say what the run sent instead of what a fresh retrieval would select. The
 * event is written only when full source was requested, so a retrieval run reads as `undefined`.
 */
export interface RunEvidenceMode {
  readonly requestedMode: (typeof evidenceModes)[number];
  readonly effectiveMode: (typeof evidenceModes)[number];
  readonly chunkCount: number;
  /** Absent on events recorded before the source count was kept. */
  readonly sourceCount?: number;
  readonly fallbackReason?: "budget-exceeded" | "no-eligible-chunks";
}

const historyPath = (root: string): string => join(root, ".draft-loop", "history.sqlite");

const runEvidenceModePayloadSchema = z.object({
  requestedMode: z.enum(evidenceModes),
  effectiveMode: z.enum(evidenceModes),
  chunkCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative().optional(),
  fallbackReason: z.enum(["budget-exceeded", "no-eligible-chunks"]).optional(),
});

/** The parsed payload, or `undefined` when it does not have the recorded shape. */
export function parseRunEvidenceModePayload(payload: unknown): RunEvidenceMode | undefined {
  const parsed = runEvidenceModePayloadSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  const { requestedMode, effectiveMode, chunkCount, sourceCount, fallbackReason } = parsed.data;
  return {
    requestedMode,
    effectiveMode,
    chunkCount,
    ...(sourceCount === undefined ? {} : { sourceCount }),
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  };
}

/**
 * The latest recorded evidence mode of the given run, or of the workspace's latest run. Resolves
 * to `undefined` when there is no run, no history, no event for the run, or a malformed payload.
 */
export async function readRunEvidenceMode(
  command: StatusCommand,
): Promise<RunEvidenceMode | undefined> {
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
      eventType: "run.evidence-mode",
      entityType: "run",
      entityId: runId,
    });
    return event === undefined ? undefined : parseRunEvidenceModePayload(event.payload);
  } finally {
    await storage.close();
  }
}

/**
 * Adds the run-history readers, the recorded evidence mode, author input and models, and the
 * evidence-mode preview of a new run to a local driver without widening the driver itself. The
 * preview resolves profiles with the driver's own registry and provider routes, as a start does.
 */
export function withRunHistoryReaders(
  driver: ApplicationDriver,
  options: LocalApplicationDriverOptions = {},
): ApplicationDriver {
  return {
    ...driver,
    previewEvidenceMode: async (command) => previewEvidenceMode(command, options),
    readRunEvidenceMode: async (command) => readRunEvidenceMode(command),
    readRunApplicationPlan: async (command) => readRunApplicationPlan(command),
    readRunAuthorInput: async (command) => readRunAuthorInput(command),
    readRunModels: async (command) => readRunModels(command),
    readRunInputs: async (command) => readRunInputs(command),
  };
}
