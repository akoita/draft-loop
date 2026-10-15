import { createHash } from "node:crypto";

import type { JsonValue, StoragePort } from "@draft-loop/storage";

import type { ExecutionRecord, RunSnapshot } from "./index.js";

/**
 * Every orchestration step appends a row to `run_snapshots`. Embedding the cumulative execution
 * history and the whole draft made each row grow with the run (rows reached 19 MB). A slim row
 * instead references both, so its size no longer depends on how many steps preceded it:
 *
 * - `executionHistoryRef` lists the execution ids and a checksum over their contents. The records
 *   themselves live once each under the execution keys the run store already writes.
 * - `artifactRef` names the draft by id and version with a checksum. The draft is written once under
 *   an artifact key before the row that references it.
 *
 * Rows written before this shape carry the whole snapshot and stay valid. `resolveSnapshotPayload`
 * is the only way a reader should turn a stored row payload into a run snapshot.
 */
export const slimSnapshotShape = "run-snapshot-slim.v1";

/** The single switch for new rows. Off writes the legacy full payload; tests use both shapes. */
export const slimSnapshotWritesDefault = true;

export interface SlimExecutionHistoryRef {
  readonly ids: readonly string[];
  readonly checksum: string;
}

export interface SlimArtifactRef {
  readonly artifactId: string;
  readonly version: number;
  readonly checksum: string;
}

export const executionStorageKey = (runId: string, id: string): string =>
  `draft-loop:orchestration:execution:${runId}:${id}`;

export const artifactStorageKey = (runId: string, artifactId: string): string =>
  `draft-loop:orchestration:artifact:${runId}:${artifactId}`;

export class RunSnapshotReferenceError extends Error {
  public readonly reference: "execution" | "artifact";
  public readonly problem: "missing" | "mismatch" | "malformed";

  public constructor(
    reference: "execution" | "artifact",
    problem: "missing" | "mismatch" | "malformed",
  ) {
    super(`A run snapshot ${reference} reference is ${problem}; the run cannot be rebuilt.`);
    this.name = "RunSnapshotReferenceError";
    this.reference = reference;
    this.problem = problem;
  }
}

/** Reusable between calls in one process so repeated saves and reads skip work already verified. */
export interface SnapshotReferenceCache {
  readonly digests: WeakMap<object, string>;
  readonly verifiedKeys: Map<string, string>;
  readonly executions: Map<string, ExecutionRecord>;
  readonly artifacts: Map<string, unknown>;
}

export function createSnapshotReferenceCache(): SnapshotReferenceCache {
  return {
    digests: new WeakMap(),
    verifiedKeys: new Map(),
    executions: new Map(),
    artifacts: new Map(),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined && typeof child !== "function")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(",")}}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function digestOf(value: object, cache: SnapshotReferenceCache): string {
  const known = cache.digests.get(value);
  if (known !== undefined) return known;
  const digest = sha256(canonicalJson(value));
  cache.digests.set(value, digest);
  return digest;
}

function combinedExecutionChecksum(
  entries: readonly { readonly id: string; readonly digest: string }[],
): string {
  return sha256(entries.map(({ id, digest }) => `${id}:${digest}`).join("\n"));
}

/**
 * Persists `value` under `key` unless an equal value is already there. Returns false when the key
 * holds different content, so the caller can keep the full payload instead of a dangling reference.
 */
async function ensureStored(
  storage: Pick<StoragePort, "get" | "set">,
  key: string,
  value: object,
  digest: string,
  cache: SnapshotReferenceCache,
): Promise<boolean> {
  if (cache.verifiedKeys.get(key) === digest) return true;
  const existing = await storage.get(key);
  if (existing === undefined) {
    await storage.set(key, JSON.stringify(value));
  } else if (sha256(canonicalJson(JSON.parse(existing) as unknown)) !== digest) {
    return false;
  }
  cache.verifiedKeys.set(key, digest);
  return true;
}

/**
 * The payload to store for a run snapshot row: slim when every referenced execution and the draft
 * could be stored (or already were) with identical content, otherwise the full snapshot.
 */
export async function slimSnapshotPayload(
  storage: Pick<StoragePort, "get" | "set">,
  snapshot: RunSnapshot,
  cache: SnapshotReferenceCache = createSnapshotReferenceCache(),
): Promise<JsonValue> {
  const full = (): JsonValue => JSON.parse(JSON.stringify(snapshot)) as JsonValue;
  const entries: { id: string; digest: string }[] = [];
  for (const execution of snapshot.executionHistory) {
    const digest = digestOf(execution, cache);
    const stored = await ensureStored(
      storage,
      executionStorageKey(snapshot.runId, execution.id),
      execution,
      digest,
      cache,
    );
    if (!stored) return full();
    entries.push({ id: execution.id, digest });
  }
  let artifactRef: SlimArtifactRef | null = null;
  if (snapshot.artifact !== null) {
    const digest = digestOf(snapshot.artifact, cache);
    const stored = await ensureStored(
      storage,
      artifactStorageKey(snapshot.runId, snapshot.artifact.id),
      snapshot.artifact,
      digest,
      cache,
    );
    if (!stored) return full();
    artifactRef = {
      artifactId: snapshot.artifact.id,
      version: snapshot.artifact.version,
      checksum: digest,
    };
  }
  const { executionHistory: _history, artifact: _artifact, ...rest } = snapshot;
  const executionHistoryRef: SlimExecutionHistoryRef = {
    ids: entries.map(({ id }) => id),
    checksum: combinedExecutionChecksum(entries),
  };
  return JSON.parse(
    JSON.stringify({ ...rest, snapshotShape: slimSnapshotShape, executionHistoryRef, artifactRef }),
  ) as JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSlimSnapshotPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.snapshotShape === slimSnapshotShape;
}

/** The artifact key a stored row payload depends on, in either shape; `undefined` when none. */
export function snapshotPayloadArtifactId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (isSlimSnapshotPayload(payload)) {
    const ref = payload.artifactRef;
    return isRecord(ref) && typeof ref.artifactId === "string" ? ref.artifactId : undefined;
  }
  const artifact = payload.artifact;
  return isRecord(artifact) && typeof artifact.id === "string" ? artifact.id : undefined;
}

/**
 * Turns a stored row payload into the run snapshot it describes. Legacy full payloads pass
 * through unchanged. Slim payloads are rebuilt from the execution and artifact keys, each looked
 * up by primary key and verified against the checksums in the row.
 */
export async function resolveSnapshotPayload(
  storage: Pick<StoragePort, "get">,
  payload: unknown,
  cache: SnapshotReferenceCache = createSnapshotReferenceCache(),
): Promise<RunSnapshot> {
  if (!isSlimSnapshotPayload(payload)) return payload as RunSnapshot;
  const {
    snapshotShape: _shape,
    executionHistoryRef,
    artifactRef,
    ...rest
  } = payload as Record<string, unknown>;
  const runId = rest.runId;
  if (typeof runId !== "string") throw new RunSnapshotReferenceError("execution", "malformed");
  if (
    !isRecord(executionHistoryRef) ||
    !Array.isArray(executionHistoryRef.ids) ||
    !executionHistoryRef.ids.every((id) => typeof id === "string") ||
    typeof executionHistoryRef.checksum !== "string"
  ) {
    throw new RunSnapshotReferenceError("execution", "malformed");
  }
  const entries: { id: string; digest: string }[] = [];
  const executionHistory: ExecutionRecord[] = [];
  for (const id of executionHistoryRef.ids as string[]) {
    const key = executionStorageKey(runId, id);
    let record = cache.executions.get(key);
    if (record === undefined) {
      const value = await storage.get(key);
      if (value === undefined) throw new RunSnapshotReferenceError("execution", "missing");
      record = JSON.parse(value) as ExecutionRecord;
      cache.executions.set(key, record);
    }
    executionHistory.push(record);
    entries.push({ id, digest: digestOf(record, cache) });
  }
  if (combinedExecutionChecksum(entries) !== executionHistoryRef.checksum) {
    throw new RunSnapshotReferenceError("execution", "mismatch");
  }
  let artifact: unknown = null;
  if (artifactRef !== null) {
    if (
      !isRecord(artifactRef) ||
      typeof artifactRef.artifactId !== "string" ||
      typeof artifactRef.checksum !== "string"
    ) {
      throw new RunSnapshotReferenceError("artifact", "malformed");
    }
    const key = artifactStorageKey(runId, artifactRef.artifactId);
    artifact = cache.artifacts.get(key);
    if (artifact === undefined) {
      const value = await storage.get(key);
      if (value === undefined) throw new RunSnapshotReferenceError("artifact", "missing");
      artifact = JSON.parse(value) as unknown;
      cache.artifacts.set(key, artifact);
    }
    if (!isRecord(artifact) || digestOf(artifact, cache) !== artifactRef.checksum) {
      throw new RunSnapshotReferenceError("artifact", "mismatch");
    }
  }
  return { ...rest, artifact, executionHistory } as unknown as RunSnapshot;
}
