import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { RunSnapshot } from "@draft-loop/orchestrator";
import { type DraftArtifact, draftArtifactSchema } from "@draft-loop/schemas";
import type { JsonValue, SqliteStorage } from "@draft-loop/storage";

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function checksum(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value)) as JsonValue)))
    .digest("hex");
}

function invalid(): never {
  throw new Error("Artifact history is missing or inconsistent; typed history was not projected.");
}

/** Validate the complete chain before writing, then replay immutable artifacts parent-first. */
export async function prepareArtifactHistory(
  storage: SqliteStorage,
  workspaceId: string,
  snapshot: RunSnapshot,
): Promise<readonly RunSnapshot[]> {
  if (snapshot.workspaceId !== workspaceId) invalid();
  const artifacts = new Map<string, DraftArtifact>();
  const rounds = new Map<number, RunSnapshot>();
  const remember = (value: unknown): DraftArtifact => {
    const parsed = draftArtifactSchema.safeParse(value);
    if (!parsed.success) invalid();
    const artifact = value as DraftArtifact;
    const previous = artifacts.get(artifact.id);
    if (previous !== undefined && !isDeepStrictEqual(previous, artifact)) invalid();
    artifacts.set(artifact.id, artifact);
    return artifact;
  };
  for (const record of await storage.listRunSnapshots(snapshot.runId)) {
    const { id, sequence, checksum: storedChecksum, ...input } = record;
    if (
      checksum(input) !== storedChecksum ||
      id !== `run-snapshot:${snapshot.runId}:${storedChecksum}` ||
      !Number.isSafeInteger(sequence) ||
      record.workspaceId !== workspaceId ||
      record.runId !== snapshot.runId ||
      record.contextSnapshotId !== snapshot.contextSnapshotId
    )
      invalid();
    const historical = record.payload as unknown as RunSnapshot;
    if (
      historical.workspaceId !== workspaceId ||
      historical.runId !== snapshot.runId ||
      historical.contextSnapshotId !== snapshot.contextSnapshotId ||
      historical.round !== record.round ||
      historical.artifact?.id !== (record.artifactId ?? undefined) ||
      !Array.isArray(historical.executionHistory)
    )
      invalid();
    if (historical.artifact !== null) remember(historical.artifact);
    if (historical.round <= snapshot.round) rounds.set(historical.round, historical);
  }
  rounds.set(snapshot.round, snapshot);
  for (const execution of snapshot.executionHistory) {
    if (!rounds.has(execution.round)) invalid();
  }
  const chain: DraftArtifact[] = [];
  const visited = new Set<string>();
  let artifact = snapshot.artifact === null ? null : remember(snapshot.artifact);
  while (artifact !== null) {
    if (visited.has(artifact.id)) invalid();
    visited.add(artifact.id);
    const stored = await storage.getArtifactVersion(artifact.id);
    if (
      stored !== undefined &&
      (stored.workspaceId !== workspaceId ||
        stored.version !== artifact.version ||
        stored.parentVersionId !== artifact.parentVersionId ||
        stored.createdAt !== artifact.createdAt ||
        stored.checksum !== checksum(artifact) ||
        !isDeepStrictEqual(stored.payload, artifact))
    )
      invalid();
    chain.push(artifact);
    if (artifact.parentVersionId === null) break;
    const parent = artifacts.get(artifact.parentVersionId);
    if (parent === undefined || parent.version !== artifact.version - 1) invalid();
    artifact = parent;
  }
  for (const item of chain.reverse()) {
    await storage.saveArtifactVersion({
      id: item.id,
      workspaceId,
      version: item.version,
      parentVersionId: item.parentVersionId,
      createdAt: item.createdAt,
      payload: JSON.parse(JSON.stringify(item)) as JsonValue,
    });
  }
  return [...rounds.values()].sort((left, right) => left.round - right.round);
}
