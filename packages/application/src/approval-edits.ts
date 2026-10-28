import {
  createStorageRunStore,
  type OrchestrationEngine,
  type RunSnapshot,
} from "@draft-loop/orchestrator";
import type {
  ArtifactHistoryStoragePort,
  HistoryStoragePort,
  JsonValue,
} from "@draft-loop/storage";

import type { LifecycleOptions } from "./lifecycle-decision.js";
import { recordedReviewEdits } from "./recorded-review-choices.js";

export { findingDecisionType } from "./recorded-review-choices.js";

type ApprovalStorage = Pick<HistoryStoragePort, "listDecisions"> &
  ArtifactHistoryStoragePort &
  Parameters<typeof createStorageRunStore>[0];

/**
 * Approve a run with the candidate's review edits (#1900): the latest edit per block recorded
 * against the artifact under review, on the desktop, the CLI and the hosted API alike, so the
 * approved and exported CV carries them. The version the edits make joins the artifact history
 * before anything records a decision against it.
 */
export async function approveWithReviewEdits(
  engine: Pick<OrchestrationEngine, "approve">,
  storage: ApprovalStorage,
  runId: string,
  options: LifecycleOptions,
): Promise<RunSnapshot> {
  const artifactId = (await createStorageRunStore(storage).loadRun(runId))?.artifact?.id;
  const candidateEdits =
    artifactId === undefined
      ? []
      : recordedReviewEdits(await storage.listDecisions(runId), artifactId);
  const approved = await engine.approve(runId, { ...options, candidateEdits });
  const version = approved.artifact;
  if (version !== null && version.id !== artifactId)
    await storage.saveArtifactVersion({
      id: version.id,
      workspaceId: approved.workspaceId,
      version: version.version,
      parentVersionId: version.parentVersionId,
      createdAt: version.createdAt,
      payload: JSON.parse(JSON.stringify(version)) as JsonValue,
    });
  return approved;
}
