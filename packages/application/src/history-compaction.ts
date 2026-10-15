import { createHash, type Hash } from "node:crypto";
import { copyFile, rename, rm, stat, statfs } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  createSnapshotReferenceCache,
  createStorageRunStore,
  isSlimSnapshotPayload,
  resolveSnapshotPayload,
  slimSnapshotPayload,
} from "@draft-loop/orchestrator";
import { openSqliteStorage, openSqliteStorageReadOnly, SqliteStorage } from "@draft-loop/storage";
import {
  backupHistoryDatabase,
  type CompactionSnapshotRow,
  compactHistoryDatabase,
  readSnapshotRows,
  relieveMemoryPressure,
  verifyHistoryChain,
} from "@draft-loop/storage/history-compaction";
import { CliUserError } from "./cli-user-error.js";

const historyDirectory = ".draft-loop";
const historyFilename = "history.sqlite";

/** The audit event recorded in the compacted history, naming the chain it replaces. */
export const historyCompactedEventType = "workspace.history-compacted";

/** Runs in these states are being worked on; compaction waits until they pause or finish. */
const executingStates: ReadonlySet<string> = new Set([
  "ingesting",
  "drafting",
  "reviewing",
  "revising",
]);

export interface CompactHistoryCommand {
  readonly root: string;
}

export interface CompactHistoryResult {
  readonly beforeBytes: number;
  readonly afterBytes: number;
  /** The file name, beside the history file, that holds the full history from before. */
  readonly backupFileName: string;
  /** Runs whose reloaded state was checked equal before and after. */
  readonly runsVerified: number;
}

export interface CompactHistoryDependencies {
  readonly readWorkspace: (root: string) => Promise<{ readonly id: string }>;
  readonly now?: () => string;
  /** Runs once the compacted copy has verified, just before it replaces the history file. */
  readonly beforeSwap?: () => Promise<void>;
}

function stamp(iso: string): string {
  return iso.replace(/[-:]/gu, "").replace(/\.\d+/u, "");
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const found = await stat(path);
    return found.isFile() ? found.size : undefined;
  } catch {
    return undefined;
  }
}

async function removeFiles(...paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      await rm(`${path}${suffix}`, { force: true });
    }
  }
}

/** Refuses unless the disk can hold the backup, the working copy and the vacuum's own copy. */
async function requireFreeSpace(directory: string, bytes: number): Promise<void> {
  let free: number;
  try {
    const status = await statfs(directory);
    free = Number(status.bavail) * Number(status.bsize);
  } catch {
    return;
  }
  if (free < bytes * 3) {
    throw new CliUserError(
      "There is not enough free disk space to compact the run history safely. Free up space of about three times the history file's size, then try again.",
    );
  }
}

async function openedStorage<Result>(
  path: string,
  use: (storage: SqliteStorage) => Promise<Result>,
): Promise<Result> {
  const storage = openSqliteStorageReadOnly(path);
  try {
    return await use(storage);
  } finally {
    await storage.close();
  }
}

/** Checks the preconditions on the original, read only, and returns the runs and event count. */
async function inspectOriginal(
  path: string,
  workspaceId: string,
): Promise<{ readonly runIds: readonly string[]; readonly eventCount: number }> {
  return openedStorage(path, async (storage) => {
    const store = createStorageRunStore(storage);
    const runIds = (await storage.listRuns(workspaceId)).map((run) => run.id);
    for (const runId of runIds) {
      const run = await store.loadRun(runId);
      if (run !== undefined && executingStates.has(run.state)) {
        throw new CliUserError(
          "A run is still working. Pause or stop it, or wait for it to finish, before compacting the run history.",
        );
      }
    }
    const chain = verifyHistoryChain(path, workspaceId);
    if (!chain.ok) {
      const first = chain.problems[0];
      throw new CliUserError(
        `The run history's audit chain did not verify (${chain.problems.length} problems, first: ${first?.code ?? "unknown"}), so it was not changed. Nothing was compacted.`,
      );
    }
    return { runIds, eventCount: chain.eventCount };
  });
}

/** Feeds a value's canonical JSON (sorted keys) to a hash in pieces, never as one large string. */
function updateCanonical(hash: Hash, value: unknown): void {
  let pending = "";
  const write = (text: string): void => {
    pending += text;
    if (pending.length >= 65_536) {
      hash.update(pending, "utf8");
      pending = "";
    }
  };
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      write("[");
      current.forEach((item, index) => {
        if (index > 0) write(",");
        visit(item ?? null);
      });
      write("]");
    } else if (current === null || typeof current !== "object") {
      write(JSON.stringify(current) ?? "null");
    } else {
      const entries = Object.entries(current as Record<string, unknown>)
        .filter(([, child]) => child !== undefined && typeof child !== "function")
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      write("{");
      entries.forEach(([key, child], index) => {
        if (index > 0) write(",");
        write(`${JSON.stringify(key)}:`);
        visit(child);
      });
      write("}");
    }
  };
  visit(value);
  hash.update(pending, "utf8");
}

/**
 * A hash of a value's canonical JSON. Comparing hashes is comparing the values, but each side can
 * be dropped before the other is built, so two multi-megabyte snapshots are never in memory
 * together.
 */
function canonicalHash(value: unknown): string {
  const hash = createHash("sha256");
  updateCanonical(hash, value);
  return hash.digest("hex");
}

/** The hash of the next snapshot row's resolved snapshot; the row is dropped before it returns. */
async function nextResolvedHash(
  rows: AsyncGenerator<CompactionSnapshotRow>,
  storage: SqliteStorage,
): Promise<{ readonly sequence: number; readonly hash: string } | undefined> {
  const next = await rows.next();
  if (next.done === true) return undefined;
  return {
    sequence: next.value.sequence,
    hash: canonicalHash(await resolveSnapshotPayload(storage, next.value.payload)),
  };
}

/** Every run reloads equal, and every snapshot row resolves to the same snapshot, before and after. */
async function verifyCompacted(
  originalPath: string,
  compactedPath: string,
  workspaceId: string,
  runIds: readonly string[],
  previousEventCount: number,
): Promise<number> {
  const chain = verifyHistoryChain(compactedPath, workspaceId);
  if (!chain.ok || chain.eventCount !== previousEventCount + 1) {
    throw new Error("The compacted audit chain did not verify.");
  }
  if (!SqliteStorage.verifyDatabaseIntegrity(compactedPath)) {
    throw new Error("The compacted history did not pass the integrity check.");
  }
  const original = openSqliteStorageReadOnly(originalPath);
  const compacted = openSqliteStorageReadOnly(compactedPath);
  try {
    const originalStore = createStorageRunStore(original);
    const compactedStore = createStorageRunStore(compacted);
    for (const runId of runIds) {
      relieveMemoryPressure();
      const earlier = canonicalHash(await originalStore.loadRun(runId));
      if (earlier !== canonicalHash(await compactedStore.loadRun(runId))) {
        throw new Error(`Run ${runId} did not reload equal after compaction.`);
      }
    }
    const before = readSnapshotRows(originalPath, workspaceId);
    const after = readSnapshotRows(compactedPath, workspaceId);
    for (;;) {
      relieveMemoryPressure();
      const earlier = await nextResolvedHash(before, original);
      const later = await nextResolvedHash(after, compacted);
      if (earlier === undefined && later === undefined) break;
      if (earlier === undefined || later === undefined || earlier.sequence !== later.sequence) {
        throw new Error("The compacted snapshots do not match the original.");
      }
      if (earlier.hash !== later.hash) {
        throw new Error(`Run snapshot ${later.sequence} did not resolve equal after compaction.`);
      }
    }
  } finally {
    await original.close();
    await compacted.close();
  }
  return runIds.length;
}

/**
 * Makes a workspace's run history smaller without breaking its audit chain.
 *
 * The history file's audit events and run snapshots are immutable and hash-chained, so the live
 * file is never rewritten. Compaction instead:
 *
 * 1. refuses while a run is working or when the audit chain does not verify;
 * 2. keeps a verified backup of the whole file beside it, named `history.sqlite.pre-compaction-*`;
 * 3. rewrites a copy of that backup: legacy full run snapshots become slim rows, snapshot audit
 *    events become references, the chain is recomputed, and `workspace.history-compacted` records
 *    the old chain's head, the backup's name and the sizes;
 * 4. checks the copy's chain and that every run and snapshot reads back equal; and
 * 5. replaces the history file with the copy.
 *
 * Any failure before the last step deletes the copy and the backup and leaves the original as it
 * was. The old chain survives whole in the backup and the new chain names where it came from.
 */
export async function compactWorkspaceHistory(
  command: CompactHistoryCommand,
  dependencies: CompactHistoryDependencies,
): Promise<CompactHistoryResult> {
  const clock = dependencies.now ?? (() => new Date().toISOString());
  const root = resolve(command.root);
  const workspace = await dependencies.readWorkspace(root);
  const directory = join(root, historyDirectory);
  const historyPath = join(directory, historyFilename);
  const beforeBytes = await fileSize(historyPath);
  if (beforeBytes === undefined) {
    throw new CliUserError("This workspace has no run history to compact.");
  }
  const { runIds, eventCount } = await inspectOriginal(historyPath, workspace.id);
  await requireFreeSpace(dirname(historyPath), beforeBytes);

  const startedAt = clock();
  const backupPath = join(directory, `${historyFilename}.pre-compaction-${stamp(startedAt)}`);
  const workPath = join(directory, `${historyFilename}.compacting-${stamp(startedAt)}`);
  if ((await fileSize(backupPath)) !== undefined || (await fileSize(workPath)) !== undefined) {
    throw new CliUserError("A compaction backup with this timestamp already exists. Try again.");
  }
  try {
    const backup = await backupHistoryDatabase(historyPath, backupPath);
    if (backup.sizeBytes !== beforeBytes || !SqliteStorage.verifyDatabaseIntegrity(backupPath)) {
      throw new Error("The backup did not verify.");
    }
    await copyFile(backupPath, workPath);

    const working = openSqliteStorage(workPath);
    const references = createSnapshotReferenceCache();
    let afterEventBytes = 0;
    try {
      await compactHistoryDatabase(workPath, {
        workspaceId: workspace.id,
        rewritePayload: async ({ payload }) => {
          if (isSlimSnapshotPayload(payload)) return payload;
          const slim = await slimSnapshotPayload(
            working,
            await resolveSnapshotPayload(working, payload),
            references,
          );
          return slim;
        },
        compactionEvent: (summary) => {
          afterEventBytes = summary.databaseBytes;
          return {
            id: `history-compaction:${workspace.id}:${stamp(startedAt)}`,
            workspaceId: workspace.id,
            eventType: historyCompactedEventType,
            entityType: "workspace",
            entityId: workspace.id,
            payload: {
              previousHeadChecksum: summary.previousHeadChecksum,
              previousEventCount: summary.previousEventCount,
              backupFileName: basename(backupPath),
              beforeBytes,
              afterBytes: summary.databaseBytes,
            },
            createdAt: startedAt,
          };
        },
      });
    } finally {
      await working.close();
    }
    const runsVerified = await verifyCompacted(
      backupPath,
      workPath,
      workspace.id,
      runIds,
      eventCount,
    );
    await dependencies.beforeSwap?.();
    for (const suffix of ["-journal", "-wal", "-shm"])
      await rm(`${historyPath}${suffix}`, { force: true });
    await rename(workPath, historyPath);
    const afterBytes = (await fileSize(historyPath)) ?? afterEventBytes;
    return { beforeBytes, afterBytes, backupFileName: basename(backupPath), runsVerified };
  } catch (error) {
    await removeFiles(workPath, backupPath);
    if (error instanceof CliUserError) throw error;
    throw new CliUserError(
      "Compacting the run history stopped before it finished. The run history was not changed.",
    );
  }
}
