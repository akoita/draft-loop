import {
  createSnapshotReferenceCache,
  createStorageRunStore,
  isSlimSnapshotPayload,
  resolveSnapshotPayload,
  slimSnapshotPayload,
  snapshotPayloadArtifactId,
} from "@draft-loop/orchestrator";
import type {
  OpportunityBriefStoragePort,
  RunHistoryStorage,
  WorkspaceApplicationsStoragePort,
} from "@draft-loop/storage";

/** The history an application import reads from and writes to. */
export type ApplicationBundleHistory = RunHistoryStorage &
  OpportunityBriefStoragePort &
  WorkspaceApplicationsStoragePort;

type Loaded = NonNullable<Awaited<ReturnType<ReturnType<typeof createStorageRunStore>["loadRun"]>>>;
type RunEvent = Awaited<ReturnType<ReturnType<typeof createStorageRunStore>["listEvents"]>>[number];
type Stored<Method extends keyof ApplicationBundleHistory> =
  ApplicationBundleHistory[Method] extends (...args: never[]) => Promise<infer Result>
    ? NonNullable<Result>
    : never;
type Without<Record, Keys extends PropertyKey> = Omit<Record, Keys>;

/**
 * One run with everything a server needs to show and review it: its record, the context and
 * artifacts it names, its saved steps, and its orchestration state and event log. Every row is
 * written as it was read, without its checksum; a slim snapshot row is carried with its payload
 * resolved, so the bundle names no content outside itself.
 */
export interface RunBundle {
  readonly run: Without<Stored<"getRun">, "checksum">;
  readonly contextSnapshots: readonly Without<Stored<"getContextSnapshot">, "checksum">[];
  /** Ordered by version, so a parent is always written before its child. */
  readonly artifacts: readonly Without<Stored<"getArtifactVersion">, "checksum">[];
  readonly snapshots: readonly {
    readonly record: Without<
      Stored<"listRunSnapshots">[number],
      "id" | "sequence" | "checksum" | "payload"
    >;
    readonly payload: unknown;
    readonly slim: boolean;
  }[];
  readonly rounds: readonly Without<Stored<"listRounds">[number], "checksum">[];
  readonly executions: readonly Without<Stored<"listExecutions">[number], "checksum">[];
  readonly findings: readonly Without<Stored<"listFindings">[number], "checksum">[];
  readonly decisions: readonly Without<Stored<"listDecisions">[number], "checksum">[];
  readonly state?: Loaded;
  readonly events: readonly Without<RunEvent, "sequence">[];
}

/** One job brief's versions, oldest first. */
export interface BriefBundle {
  readonly briefId: string;
  readonly versions: readonly unknown[];
}

function withoutChecksum<Record extends { readonly checksum?: unknown }>(
  record: Record,
): Without<Record, "checksum"> {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

/**
 * Replaces the source workspace id with the target's wherever a record or payload names its
 * workspace, so an imported run reads as belonging to the workspace that now holds it.
 */
export function retargetWorkspace<Value>(value: Value, sourceId: string, targetId: string): Value {
  if (Array.isArray(value)) {
    return value.map((item) => retargetWorkspace(item, sourceId, targetId)) as Value;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      key === "workspaceId" && child === sourceId
        ? targetId
        : retargetWorkspace(child, sourceId, targetId),
    ]),
  ) as Value;
}

/** Reads one run of `source` into a bundle; undefined when the run does not exist. */
export async function readRunBundle(
  source: ApplicationBundleHistory,
  runId: string,
): Promise<RunBundle | undefined> {
  const run = await source.getRun(runId);
  if (run === undefined) return undefined;
  const [snapshots, rounds, executions, findings, decisions] = await Promise.all([
    source.listRunSnapshots(runId),
    source.listRounds(runId),
    source.listExecutions(runId),
    source.listFindings(runId),
    source.listDecisions(runId),
  ]);
  const exports = await source.listExports(runId);
  const contextIds = new Set([
    run.contextSnapshotId,
    ...snapshots.map((item) => item.contextSnapshotId),
    ...executions.map((item) => item.contextSnapshotId),
  ]);
  const contextSnapshots: RunBundle["contextSnapshots"][number][] = [];
  for (const id of contextIds) {
    const record = await source.getContextSnapshot(id);
    if (record !== undefined) contextSnapshots.push(withoutChecksum(record));
  }
  const artifactIds = new Set<string>();
  const remember = (id: string | null | undefined): void => {
    if (typeof id === "string") artifactIds.add(id);
  };
  remember(run.artifactId);
  for (const item of [...snapshots, ...executions, ...findings, ...decisions]) {
    remember(item.artifactId);
  }
  for (const item of exports) remember(item.artifactId);
  for (const item of snapshots) {
    const payload = item.payload as { approvedArtifact?: { id?: unknown } };
    remember(snapshotPayloadArtifactId(item.payload));
    remember(
      typeof payload.approvedArtifact?.id === "string" ? payload.approvedArtifact.id : undefined,
    );
  }
  const artifacts = new Map<string, Stored<"getArtifactVersion">>();
  const pending = [...artifactIds];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (artifacts.has(id)) continue;
    const record = await source.getArtifactVersion(id);
    if (record === undefined) continue;
    artifacts.set(id, record);
    if (record.parentVersionId !== null) pending.push(record.parentVersionId);
  }
  const references = createSnapshotReferenceCache();
  const bundledSnapshots: RunBundle["snapshots"][number][] = [];
  for (const item of snapshots) {
    const { id: _id, sequence: _sequence, checksum: _checksum, payload, ...record } = item;
    const slim = isSlimSnapshotPayload(payload);
    bundledSnapshots.push({
      record,
      payload: slim ? await resolveSnapshotPayload(source, payload, references) : payload,
      slim,
    });
  }
  const store = createStorageRunStore(source);
  const state = await store.loadRun(runId);
  const events = (await store.listEvents(runId)).map(({ sequence: _sequence, ...event }) => event);
  return {
    run: withoutChecksum(run),
    contextSnapshots,
    artifacts: [...artifacts.values()]
      .sort((left, right) => left.version - right.version)
      .map(withoutChecksum),
    snapshots: bundledSnapshots,
    rounds: rounds.map(withoutChecksum),
    executions: executions.map(withoutChecksum),
    findings: findings.map(withoutChecksum),
    decisions: decisions.map(withoutChecksum),
    ...(state === undefined ? {} : { state }),
    events,
  };
}

export interface BundleTarget {
  readonly target: ApplicationBundleHistory;
  readonly sourceId: string;
  readonly targetId: string;
  readonly applicationId: string;
  readonly now: () => string;
}

/**
 * Writes one bundled run into `target` under the target workspace and application. Writing the
 * same bundle again rewrites the same rows and appends only the events not yet present, so an
 * interrupted import resumes.
 */
export async function writeRunBundle(context: BundleTarget, bundle: RunBundle): Promise<void> {
  const { target, sourceId, targetId } = context;
  const move = <Value>(value: Value): Value => retargetWorkspace(value, sourceId, targetId);
  const runId = bundle.run.id;
  // Bind before writing any row: an interrupted import then leaves the run inside the imported
  // application rather than in the default one.
  await target.applications.bindRun({
    workspaceId: targetId,
    applicationId: context.applicationId,
    runId,
    createdAt: context.now(),
  });
  for (const record of bundle.contextSnapshots) await target.saveContextSnapshot(move(record));
  for (const record of bundle.artifacts) {
    await target.saveArtifactVersion({ ...record, workspaceId: targetId });
  }
  await target.saveRun(move(bundle.run));
  // A run imported from legacy rows keeps writing legacy rows so its final snapshot still matches
  // the row that was copied for it. Executions go in first because slim snapshot rows reference them.
  const targetStore = createStorageRunStore(target, {
    slimSnapshots: bundle.snapshots.some((item) => item.slim),
  });
  const moved = bundle.state === undefined ? undefined : move(bundle.state);
  if (moved !== undefined) {
    for (const execution of moved.executionHistory) await targetStore.saveExecution(execution);
  }
  const references = createSnapshotReferenceCache();
  for (const item of bundle.snapshots) {
    await target.saveRunSnapshot({
      ...move(item.record),
      payload: item.slim
        ? await slimSnapshotPayload(target, move(item.payload) as never, references)
        : move(item.payload),
    } as Parameters<ApplicationBundleHistory["saveRunSnapshot"]>[0]);
  }
  for (const record of bundle.rounds) await target.saveRound(move(record));
  for (const record of bundle.executions) await target.saveExecution(move(record));
  for (const record of bundle.findings) await target.saveFinding(move(record));
  for (const record of bundle.decisions) await target.saveDecision(move(record));
  if (moved !== undefined) {
    await targetStore.saveRun(moved);
    const present = (await targetStore.listEvents(runId)).length;
    for (const event of bundle.events.slice(present)) {
      await targetStore.appendEvent(move(event));
    }
  }
}
