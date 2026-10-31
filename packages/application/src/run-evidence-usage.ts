import { resolve } from "node:path";

import type { ContextSnapshot } from "@draft-loop/domain";
import { type EvidenceUsageReport, evidenceUsage } from "@draft-loop/evaluations";
import {
  createStorageRunStore,
  type ExecutionRecord,
  type RunSnapshot,
} from "@draft-loop/orchestrator";
import { contextSnapshotSchema, type DraftArtifact } from "@draft-loop/schemas";

import type { StatusCommand } from "./index.js";
import { readWorkspace } from "./local.js";
import { openRunHistory } from "./run-history-read.js";

/** One author call's evidence usage: what it was sent against what its draft cites. */
export interface RunEvidenceUsageCall extends EvidenceUsageReport {
  readonly executionId: string;
  readonly round: number;
  readonly step: "author" | "revision";
}

/** The evidence usage of every author call of a run that recorded what it was sent (#2010). */
export interface RunEvidenceUsage {
  readonly runId: string;
  readonly calls: readonly RunEvidenceUsageCall[];
}

function draftOf(execution: ExecutionRecord): DraftArtifact | undefined {
  const { output } = execution;
  return typeof output === "object" && output !== null && "claims" in output
    ? (output as DraftArtifact)
    : undefined;
}

/**
 * The usage report of each completed author or revision call that recorded its retrieved
 * evidence, in execution order. Calls recorded before the retrieved references were kept, and
 * runs without retrieval, contribute nothing: the report never guesses what a call saw.
 */
export function runEvidenceUsage(
  snapshot: Pick<RunSnapshot, "runId" | "executionHistory">,
  context: Pick<ContextSnapshot, "evidenceManifest">,
): RunEvidenceUsage {
  const sources = context.evidenceManifest.map(({ id, path }) => ({ id, path }));
  const calls: RunEvidenceUsageCall[] = [];
  for (const execution of snapshot.executionHistory) {
    if (execution.status !== "completed" || execution.retrievedEvidence === undefined) continue;
    if (execution.step !== "author" && execution.step !== "revision") continue;
    const draft = draftOf(execution);
    if (draft === undefined) continue;
    calls.push({
      executionId: execution.id,
      round: execution.round,
      step: execution.step,
      ...evidenceUsage(draft.claims, execution.retrievedEvidence, sources),
    });
  }
  return { runId: snapshot.runId, calls };
}

/**
 * The evidence usage of the given run, or of the workspace's latest run. Resolves to `undefined`
 * when there is no run, no history, an unknown run, or no recorded context.
 */
export async function readRunEvidenceUsage(
  command: StatusCommand,
): Promise<RunEvidenceUsage | undefined> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const runId = command.runId ?? config.latestRunId;
  if (runId === undefined) return undefined;
  const storage = await openRunHistory(root);
  if (storage === undefined) return undefined;
  try {
    const snapshot = await createStorageRunStore(storage).loadRun(runId);
    if (snapshot === undefined || snapshot.workspaceId !== config.id) return undefined;
    const contextRecord = await storage.getContextSnapshot(snapshot.contextSnapshotId);
    if (contextRecord === undefined) return undefined;
    const context = contextSnapshotSchema.parse(
      contextRecord.payload,
    ) as unknown as ContextSnapshot;
    return runEvidenceUsage(snapshot, context);
  } finally {
    await storage.close();
  }
}
