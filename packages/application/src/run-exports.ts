import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { createStorageRunStore, RunTransitionError } from "@draft-loop/orchestrator";
import { extensionForFormat, type OutputFormat } from "@draft-loop/rendering";
import type { ExportRecord } from "@draft-loop/storage";

import { readWorkspace } from "./local.js";
import { storageFactory } from "./local-storage-factory.js";
import { RunActionError } from "./run-action-error.js";

export interface RunExportsCommand {
  readonly root: string;
  readonly runId: string;
}

/** One completed export of a run, with what a reader needs to fetch and verify its bytes. */
export interface RunExport {
  readonly id: string;
  readonly runId: string;
  readonly format: string;
  readonly mimeType: string;
  readonly createdAt: string;
  /** Lowercase hex SHA-256 of the document. */
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly artifactVersion?: number;
  readonly templateId?: string;
  /** Where the export path put the document; for the driver's blob store, never shown to a client. */
  readonly location: string;
}

function payloadField(record: ExportRecord, name: string): unknown {
  const { payload } = record;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  return (payload as Readonly<Record<string, unknown>>)[name];
}

/**
 * A completed export whose stored reference is whole. Exports recorded before their size was kept
 * cannot be verified by reference, so they are left out rather than served unchecked.
 */
function runExport(record: ExportRecord): RunExport | undefined {
  const sizeBytes = payloadField(record, "sizeBytes");
  const mimeType = payloadField(record, "mimeType");
  if (
    record.status !== "completed" ||
    record.outputPath === null ||
    record.outputChecksum === null ||
    typeof sizeBytes !== "number" ||
    typeof mimeType !== "string"
  )
    return undefined;
  const artifactVersion = payloadField(record, "artifactVersion");
  const template = payloadField(record, "renderingTemplate");
  const templateId =
    typeof template === "object" && template !== null && "id" in template
      ? (template as { readonly id: unknown }).id
      : undefined;
  return {
    id: record.id,
    runId: record.runId,
    format: record.format,
    mimeType,
    createdAt: record.createdAt,
    checksum: record.outputChecksum,
    sizeBytes,
    ...(typeof artifactVersion === "number" ? { artifactVersion } : {}),
    ...(typeof templateId === "string" ? { templateId } : {}),
    location: record.outputPath,
  };
}

/** A run's completed exports, newest first; refuses a run the workspace does not have. */
export async function listRunExports(command: RunExportsCommand): Promise<readonly RunExport[]> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const storage = await storageFactory().open(root);
  try {
    const snapshot = await createStorageRunStore(storage).loadRun(command.runId);
    if (snapshot === undefined || snapshot.workspaceId !== config.id)
      throw new RunActionError("run_not_found", "No such run.");
    return (await storage.listExports(command.runId))
      .flatMap((record) => runExport(record) ?? [])
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } finally {
    await storage.close();
  }
}

/**
 * Refuses an export of an unknown run or of a run not yet approved, before rendering anything, so
 * an adapter can answer not-found or conflict instead of a generic refusal.
 */
export async function assertRunExportable(command: RunExportsCommand): Promise<void> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const storage = await storageFactory().open(root);
  try {
    const snapshot = await createStorageRunStore(storage).loadRun(command.runId);
    if (snapshot === undefined || snapshot.workspaceId !== config.id)
      throw new RunActionError("run_not_found", "No such run.");
    if (snapshot.state !== "approved" && snapshot.state !== "exported")
      throw new RunTransitionError(
        "Only an approved run can be exported. Review and approve it first.",
      );
  } finally {
    await storage.close();
  }
}

/**
 * Where the hosted service keeps one export: a new path under the workspace for every export, so
 * an earlier export's bytes are never replaced and its checksum keeps verifying them.
 */
export function hostedExportPath(runId: string, format: OutputFormat): string {
  return `exports/${runId}/${randomUUID()}${extensionForFormat(format)}`;
}

export interface RunExportContentCommand extends RunExportsCommand {
  readonly exportId: string;
}

/** One export's document, read back and verified against the checksum and size it recorded. */
export interface RunExportContent {
  readonly export: RunExport;
  readonly content: Uint8Array;
}

/**
 * Reads one export's document. The blob store returns the bytes only while they match the
 * recorded checksum and size, so a replaced or damaged document is refused, never served.
 */
export async function readRunExportContent(
  command: RunExportContentCommand,
): Promise<RunExportContent> {
  const entry = (await listRunExports(command)).find(({ id }) => id === command.exportId);
  if (entry === undefined)
    throw new RunActionError("export_not_found", "No such export of this run.");
  const content = await storageFactory().exportBlobs.get({
    location: entry.location,
    checksum: entry.checksum,
    sizeBytes: entry.sizeBytes,
  });
  if (content === undefined)
    throw new RunActionError(
      "export_integrity",
      "The exported document no longer matches its recorded checksum. Export the run again.",
    );
  return { export: entry, content };
}
