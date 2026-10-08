import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { applicationNameMaxLength, normalizeApplicationName } from "@draft-loop/domain/application";
import { createStorageRunStore } from "@draft-loop/orchestrator";
import {
  type ArtifactVersionRecord,
  openSqliteStorage,
  openSqliteStorageReadOnly,
  type SqliteStorage,
} from "@draft-loop/storage";
import { jobHeading } from "./application-name.js";
import { CliUserError } from "./cli-user-error.js";

const historyDirectory = ".draft-loop";
const historyFilename = "history.sqlite";
const maximumPastedJobCharacters = 200_000;
const importedEventType = "application.imported";

export interface ImportApplicationCommand {
  /** The current workspace, which receives the application. */
  readonly root: string;
  /** The workspace to import. It is opened read only and never changed. */
  readonly sourceRoot: string;
  /** Defaults to the job's heading, then to the source folder's name. */
  readonly name?: string;
}

/** What an import copied, as content-free counts. */
export interface ImportApplicationCounts {
  readonly runs: number;
  readonly briefs: number;
  readonly briefVersions: number;
  readonly exports: number;
  /** Completed exports whose file could not be read in the source, so they were not imported. */
  readonly skippedExports: number;
}

export interface ImportApplicationResult {
  readonly applicationId: string;
  readonly name: string;
  readonly counts: ImportApplicationCounts;
}

export interface ImportApplicationDependencies {
  readonly readWorkspace: (
    root: string,
  ) => Promise<{ readonly id: string; readonly jobDescriptionPath: string }>;
  readonly now?: () => string;
}

/**
 * The application id an imported workspace always gets. It is derived from the source workspace id
 * so that an interrupted import resumes into the same application instead of starting another.
 */
export function importedApplicationId(sourceWorkspaceId: string): string {
  return `imported-${createHash("sha256").update(sourceWorkspaceId).digest("hex").slice(0, 12)}`;
}

/**
 * Replaces the source workspace id with the target's wherever a record or payload names its
 * workspace, so an imported run reads as belonging to the workspace that now holds it.
 */
function retarget<Value>(value: Value, sourceId: string, targetId: string): Value {
  if (Array.isArray(value)) {
    return value.map((item) => retarget(item, sourceId, targetId)) as Value;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      key === "workspaceId" && child === sourceId ? targetId : retarget(child, sourceId, targetId),
    ]),
  ) as Value;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readSourceWorkspace(
  dependencies: ImportApplicationDependencies,
  sourceRoot: string,
): Promise<{ readonly id: string; readonly jobDescriptionPath: string }> {
  try {
    return await dependencies.readWorkspace(sourceRoot);
  } catch {
    throw new CliUserError("The selected folder is not a DraftLoop workspace.");
  }
}

async function readSourceJob(sourceRoot: string, configuredPath: string): Promise<string> {
  const path = isAbsolute(configuredPath) ? configuredPath : resolve(sourceRoot, configuredPath);
  const text = (await readFile(path, "utf8").catch(() => "")).trim();
  if (text === "")
    throw new CliUserError("The selected workspace has no job description to import.");
  if (text.length > maximumPastedJobCharacters) {
    throw new CliUserError("The job description in the selected workspace is too long to import.");
  }
  return text;
}

function importedName(command: ImportApplicationCommand, jobText: string): string {
  const requested = command.name ?? jobHeading(jobText) ?? basename(resolve(command.sourceRoot));
  try {
    return normalizeApplicationName(requested.slice(0, applicationNameMaxLength));
  } catch {
    throw new CliUserError(
      `The application name must be between 1 and ${applicationNameMaxLength} characters.`,
    );
  }
}

interface CopyContext {
  readonly source: SqliteStorage;
  readonly target: SqliteStorage;
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly applicationId: string;
  readonly now: () => string;
}

async function copyArtifacts(context: CopyContext, ids: ReadonlySet<string>): Promise<void> {
  const found = new Map<string, ArtifactVersionRecord>();
  const pending = [...ids];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (found.has(id)) continue;
    const record = await context.source.getArtifactVersion(id);
    if (record === undefined) continue;
    found.set(id, record);
    if (record.parentVersionId !== null) pending.push(record.parentVersionId);
  }
  // A version's parent has the lower number, and the parent row must exist first.
  for (const record of [...found.values()].sort((left, right) => left.version - right.version)) {
    const { checksum: _checksum, ...input } = record;
    await context.target.saveArtifactVersion({ ...input, workspaceId: context.targetId });
  }
}

/** Copies an export file into the workspace, reusing a file that is already there byte for byte. */
async function copyExportFile(
  context: CopyContext,
  exportId: string,
  outputPath: string,
): Promise<string | undefined> {
  const from = isAbsolute(outputPath) ? outputPath : resolve(context.sourceRoot, outputPath);
  if (!(await fileExists(from))) return undefined;
  const directory = join(context.targetRoot, "exports", context.applicationId);
  await mkdir(directory, { recursive: true });
  const bytes = await readFile(from);
  for (const candidate of [basename(from), `${exportId}-${basename(from)}`]) {
    const destination = join(directory, candidate);
    if (!(await fileExists(destination))) {
      await copyFile(from, destination);
      return destination;
    }
    if ((await readFile(destination)).equals(bytes)) return destination;
  }
  return undefined;
}

async function copyRun(context: CopyContext, runId: string): Promise<void> {
  const { source, target, sourceId, targetId } = context;
  const run = await source.getRun(runId);
  if (run === undefined) return;
  // Bind before writing any row: an interrupted import then leaves the run inside the imported
  // application rather than in the default one.
  await target.applications.bindRun({
    workspaceId: targetId,
    applicationId: context.applicationId,
    runId,
    createdAt: context.now(),
  });
  const [snapshots, rounds, executions, findings, decisions, exports] = await Promise.all([
    source.listRunSnapshots(runId),
    source.listRounds(runId),
    source.listExecutions(runId),
    source.listFindings(runId),
    source.listDecisions(runId),
    source.listExports(runId),
  ]);
  const contextIds = new Set([
    run.contextSnapshotId,
    ...snapshots.map((item) => item.contextSnapshotId),
    ...executions.map((item) => item.contextSnapshotId),
  ]);
  for (const id of contextIds) {
    const record = await source.getContextSnapshot(id);
    if (record === undefined) continue;
    const { checksum: _checksum, ...input } = record;
    await target.saveContextSnapshot(retarget(input, sourceId, targetId));
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
    const payload = item.payload as {
      artifact?: { id?: unknown };
      approvedArtifact?: { id?: unknown };
    };
    remember(typeof payload.artifact?.id === "string" ? payload.artifact.id : undefined);
    remember(
      typeof payload.approvedArtifact?.id === "string" ? payload.approvedArtifact.id : undefined,
    );
  }
  await copyArtifacts(context, artifactIds);

  const { checksum: _runChecksum, ...runInput } = run;
  await target.saveRun(retarget(runInput, sourceId, targetId));
  for (const item of snapshots) {
    const { id: _id, sequence: _sequence, checksum: _checksum, ...input } = item;
    await target.saveRunSnapshot(retarget(input, sourceId, targetId));
  }
  for (const item of rounds) {
    const { checksum: _checksum, ...input } = item;
    await target.saveRound(retarget(input, sourceId, targetId));
  }
  for (const item of executions) {
    const { checksum: _checksum, ...input } = item;
    await target.saveExecution(retarget(input, sourceId, targetId));
  }
  for (const item of findings) {
    const { checksum: _checksum, ...input } = item;
    await target.saveFinding(retarget(input, sourceId, targetId));
  }
  for (const item of decisions) {
    const { checksum: _checksum, ...input } = item;
    await target.saveDecision(retarget(input, sourceId, targetId));
  }

  // The orchestration state a run is read from: its latest snapshot, executions and event log.
  const sourceStore = createStorageRunStore(source);
  const targetStore = createStorageRunStore(target);
  const snapshot = await sourceStore.loadRun(runId);
  if (snapshot !== undefined) {
    const moved = retarget(snapshot, sourceId, targetId);
    await targetStore.saveRun(moved);
    for (const execution of moved.executionHistory) await targetStore.saveExecution(execution);
    const events = await sourceStore.listEvents(runId);
    const present = (await targetStore.listEvents(runId)).length;
    for (const event of events.slice(present)) {
      const { sequence: _sequence, ...input } = event;
      await targetStore.appendEvent(retarget(input, sourceId, targetId));
    }
  }
}

async function copyExports(context: CopyContext, runId: string): Promise<[number, number]> {
  const { source, target, sourceId, targetId } = context;
  let copied = 0;
  let skipped = 0;
  for (const item of await source.listExports(runId)) {
    const { checksum: _checksum, ...input } = item;
    let outputPath = input.outputPath;
    if (item.status === "completed" && outputPath !== null) {
      const destination = await copyExportFile(context, item.id, outputPath);
      if (destination === undefined) {
        skipped += 1;
        continue;
      }
      outputPath = destination;
    }
    await target.saveExport({ ...retarget(input, sourceId, targetId), outputPath });
    copied += 1;
  }
  return [copied, skipped];
}

async function copyBrief(context: CopyContext, briefId: string): Promise<number> {
  const versions = await context.source.listOpportunityBriefVersions(context.sourceId, briefId);
  if (versions.length === 0) return 0;
  await context.target.applications.bindBrief({
    workspaceId: context.targetId,
    applicationId: context.applicationId,
    briefId,
    createdAt: context.now(),
  });
  for (const version of versions) {
    await context.target.saveOpportunityBrief(context.targetId, version.brief);
  }
  return versions.length;
}

async function assertNoCollisions(
  context: CopyContext,
  runIds: readonly string[],
  briefIds: readonly string[],
): Promise<void> {
  const { target, targetId, applicationId } = context;
  for (const runId of runIds) {
    if (
      (await target.getRun(runId)) !== undefined &&
      (await target.applications.applicationIdForRun(targetId, runId)) !== applicationId
    ) {
      throw new CliUserError(
        "This workspace already holds a run with the same identifier as one being imported, so nothing was imported.",
      );
    }
  }
  for (const briefId of briefIds) {
    if (
      (await target.listOpportunityBriefVersions(targetId, briefId)).length > 0 &&
      (await target.applications.applicationIdForBrief(targetId, briefId)) !== applicationId
    ) {
      throw new CliUserError(
        "This workspace already holds an opportunity brief with the same identifier as one being imported, so nothing was imported.",
      );
    }
  }
}

/**
 * Imports another workspace as one application of this workspace (ADR 0010).
 *
 * - The source is opened read only and is never changed. Only its default application (the job
 *   description with the runs, briefs and exports that no application owns) is imported.
 * - Runs, briefs and exports keep their exact ids and versions. They are written with this
 *   workspace's id; the pinned profile and brief references inside a run stay as they were, as
 *   history. Profiles are not merged and evidence rows are not copied.
 * - The application id is derived from the source workspace id and the import is recorded as an
 *   audit event, so importing the same source twice is refused, and an interrupted import resumes.
 */
export async function importApplicationFromWorkspace(
  command: ImportApplicationCommand,
  dependencies: ImportApplicationDependencies,
): Promise<ImportApplicationResult> {
  const clock = dependencies.now ?? (() => new Date().toISOString());
  const root = resolve(command.root);
  const sourceRoot = resolve(command.sourceRoot);
  const selfError = "A workspace cannot be imported into itself. Choose a different workspace.";
  if (root === sourceRoot) throw new CliUserError(selfError);
  const targetWorkspace = await dependencies.readWorkspace(root);
  const sourceWorkspace = await readSourceWorkspace(dependencies, sourceRoot);
  if (sourceWorkspace.id === targetWorkspace.id) throw new CliUserError(selfError);
  const jobText = await readSourceJob(sourceRoot, sourceWorkspace.jobDescriptionPath);
  const name = importedName({ ...command, sourceRoot }, jobText);
  const applicationId = importedApplicationId(sourceWorkspace.id);

  await mkdir(join(root, historyDirectory), { recursive: true });
  const target = openSqliteStorage(join(root, historyDirectory, historyFilename));
  const sourceHistory = join(sourceRoot, historyDirectory, historyFilename);
  const source = (await fileExists(sourceHistory))
    ? openSqliteStorageReadOnly(sourceHistory)
    : undefined;
  try {
    const earlier = (await target.listAuditEvents(targetWorkspace.id)).find(
      (event) =>
        event.eventType === importedEventType &&
        (event.payload as { sourceWorkspaceId?: unknown }).sourceWorkspaceId === sourceWorkspace.id,
    );
    if (earlier !== undefined) {
      const existing = await target.applications.getApplication(targetWorkspace.id, applicationId);
      throw new CliUserError(
        `This workspace was already imported${existing === undefined ? "" : ` as the application "${existing.name}"`}.`,
      );
    }

    let runIds: readonly string[] = [];
    let briefIds: readonly string[] = [];
    if (source !== undefined) {
      try {
        runIds = await source.applications.listDefaultRunIds(sourceWorkspace.id);
        briefIds = await source.applications.listDefaultBriefIds(sourceWorkspace.id);
      } catch {
        throw new CliUserError(
          "The history of the selected workspace could not be read. Open it once in DraftLoop, then try again.",
        );
      }
    }
    const context: CopyContext = {
      // A source that never ran has no history: nothing is read from it, so the target stands in.
      source: source ?? target,
      target,
      sourceRoot,
      targetRoot: root,
      sourceId: sourceWorkspace.id,
      targetId: targetWorkspace.id,
      applicationId,
      now: clock,
    };
    await assertNoCollisions(context, runIds, briefIds);

    try {
      if ((await target.getWorkspace(targetWorkspace.id)) === undefined) {
        const at = clock();
        await target.saveWorkspace({
          id: targetWorkspace.id,
          state: "collecting",
          createdAt: at,
          updatedAt: at,
        });
      }
      if (
        (await target.applications.getApplication(targetWorkspace.id, applicationId)) === undefined
      ) {
        const storedPath = join(historyDirectory, "applications", applicationId, "job.md");
        await mkdir(dirname(join(root, storedPath)), { recursive: true });
        await writeFile(join(root, storedPath), `${jobText}\n`, "utf8");
        await target.applications.insertApplication({
          workspaceId: targetWorkspace.id,
          id: applicationId,
          name,
          jobSource: { kind: "pasted-text", storedPath },
          createdAt: clock(),
        });
      }
      let exportCount = 0;
      let skippedExports = 0;
      for (const runId of runIds) {
        await copyRun(context, runId);
        const [copied, skipped] = await copyExports(context, runId);
        exportCount += copied;
        skippedExports += skipped;
      }
      let briefVersions = 0;
      let briefCount = 0;
      for (const briefId of briefIds) {
        const copied = await copyBrief(context, briefId);
        briefVersions += copied;
        briefCount += copied > 0 ? 1 : 0;
      }
      const counts: ImportApplicationCounts = {
        runs: runIds.length,
        briefs: briefCount,
        briefVersions,
        exports: exportCount,
        skippedExports,
      };
      await target.appendAuditEvent({
        id: `application-import:${targetWorkspace.id}:${applicationId}`,
        workspaceId: targetWorkspace.id,
        eventType: importedEventType,
        entityType: "application",
        entityId: applicationId,
        payload: { sourceWorkspaceId: sourceWorkspace.id, applicationId, ...counts },
        createdAt: clock(),
      });
      return { applicationId, name, counts };
    } catch (error) {
      if (error instanceof CliUserError) throw error;
      throw new CliUserError(
        "Importing stopped before it finished. Run the import again to resume it.",
      );
    }
  } finally {
    await target.close();
    await source?.close();
  }
}
