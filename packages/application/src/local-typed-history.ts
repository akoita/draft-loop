import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { JsonObject } from "@draft-loop/providers";
import type { SqliteStorage } from "@draft-loop/storage";

import type { WorkspaceConfig } from "./local.js";
import { prepareArtifactHistory } from "./local-artifact-history.js";

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export async function saveTypedHistory(
  storage: SqliteStorage,
  config: Pick<WorkspaceConfig, "id">,
  snapshot: RunSnapshot,
): Promise<void> {
  const history = await prepareArtifactHistory(storage, config.id, snapshot);
  if ((await storage.getRun(snapshot.runId)) === undefined) {
    await storage.saveRun({
      id: snapshot.runId,
      workspaceId: config.id,
      contextSnapshotId: snapshot.contextSnapshotId,
      state: snapshot.state,
      round: snapshot.round,
      currentStep: snapshot.currentStep,
      budget: asJsonObject(snapshot.budget),
      artifactId: snapshot.artifact?.id ?? null,
      approval: snapshot.approval,
      totalCostUsd: snapshot.totalCostUsd,
      startedAt: snapshot.startedAt,
      updatedAt: snapshot.updatedAt,
      lastError: snapshot.lastError === null ? null : asJsonObject(snapshot.lastError),
      payload: { executionCount: snapshot.executionHistory.length },
    });
  }
  for (const roundSnapshot of history) {
    const roundId = `${roundSnapshot.runId}:round:${roundSnapshot.round}`;
    if ((await storage.getRound(roundId)) === undefined) {
      await storage.saveRound({
        id: roundId,
        workspaceId: config.id,
        runId: roundSnapshot.runId,
        number: roundSnapshot.round,
        state:
          roundSnapshot.state === "drafting" ||
          roundSnapshot.state === "reviewing" ||
          roundSnapshot.state === "revising" ||
          roundSnapshot.state === "budget-exhausted" ||
          roundSnapshot.state === "provider-error" ||
          roundSnapshot.state === "paused" ||
          roundSnapshot.state === "stopped" ||
          roundSnapshot.state === "awaiting-approval"
            ? roundSnapshot.state
            : "awaiting-approval",
        startedAt: roundSnapshot.startedAt,
        completedAt: roundSnapshot.updatedAt,
        evaluation:
          roundSnapshot.latestEvaluation === null
            ? null
            : asJsonObject(roundSnapshot.latestEvaluation),
        payload: { executionCount: roundSnapshot.executionHistory.length },
      });
    }
  }
  const roundId = `${snapshot.runId}:round:${snapshot.round}`;
  for (const executionRecord of snapshot.executionHistory) {
    if ((await storage.getExecution(executionRecord.id)) !== undefined) continue;
    await storage.saveExecution({
      id: executionRecord.id,
      workspaceId: config.id,
      runId: snapshot.runId,
      roundId: `${snapshot.runId}:round:${executionRecord.round}`,
      contextSnapshotId: executionRecord.contextSnapshotId,
      artifactId: snapshot.artifact?.id ?? null,
      attempt: Number(executionRecord.id.split(":attempt:")[1] ?? 1),
      step: executionRecord.step,
      status: executionRecord.status,
      provider: executionRecord.provider,
      modelId: executionRecord.modelId,
      providerRequestId: executionRecord.providerRequestId,
      outputChecksum: executionRecord.outputChecksum ?? null,
      inputTokens: executionRecord.inputTokens,
      outputTokens: executionRecord.outputTokens,
      totalTokens: executionRecord.totalTokens,
      estimatedUsd: executionRecord.estimatedUsd,
      startedAt: snapshot.startedAt,
      completedAt: executionRecord.completedAt,
      errorCode: executionRecord.errorCode ?? null,
      output: executionRecord.output === undefined ? null : asJsonObject(executionRecord.output),
      payload: { source: "phase-zero-cli" },
    });
  }
  for (const [findingIndex, finding] of snapshot.findings.entries()) {
    const findingId = `${snapshot.runId}:round:${snapshot.round}:finding:${findingIndex}:${finding.code}`;
    if ((await storage.getFinding(findingId)) !== undefined) continue;
    await storage.saveFinding({
      id: findingId,
      workspaceId: config.id,
      runId: snapshot.runId,
      roundId,
      executionId: null,
      artifactId: snapshot.artifact?.id ?? null,
      code: finding.code,
      category: finding.category ?? "quality",
      severity: finding.severity,
      message: finding.message,
      claimId: finding.claimId ?? null,
      sectionId: finding.sectionId ?? null,
      requirementId: finding.requirementId ?? null,
      createdAt: snapshot.updatedAt,
      payload: { source: "phase-zero-cli" },
    });
  }
}
