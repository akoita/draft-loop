import type { Dirent } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { join, relative } from "node:path";

import { errorCode, isMissing } from "./filesystem-error-codes.js";
import {
  managedPathSegment,
  managedVersionPath,
  maximumManagedCandidateKnowledgeInventoryEntries,
  requireDirectory,
  sourcesDirectory,
  verifyManagedFile,
} from "./managed-file-io.js";
import type {
  ManagedFileDeletionInventory,
  ManagedFileDeletionObservation,
  ManagedFileInventoryScan,
  ManagedFileStorePort,
  ManagedFileVersion,
} from "./ports/managed-files.js";

// Verification and bounded inventory of the managed files under a local store's `sources`
// directory. Every scan stops at a fixed number of entries so a crowded directory cannot stall
// store open, retention planning, or deletion planning.

type InventoryPort = Pick<ManagedFileStorePort, "verifyAll" | "inventory" | "inspectDeletion">;

export function createFilesystemManagedFileInventory(root: string): InventoryPort {
  return {
    verifyAll: (versions) => verifyManagedFileVersions(root, versions),
    inventory: (expected) => inspectManagedFiles(root, expected),
    inspectDeletion: (input) => inspectDeletionInventory(root, input),
  };
}

interface MutableInventory {
  scannedEntryCount: number;
  scanLimitReached: boolean;
  readonly unknownEntries: {
    intakeShapedFilesAtSourcesRoot: number;
    opaqueEntriesAtSourcesRoot: number;
    entriesInsideManagedSourceDirectories: number;
    symbolicLinks: number;
    otherEntries: number;
  };
}

function emptyInventory(): MutableInventory {
  return {
    scannedEntryCount: 0,
    scanLimitReached: false,
    unknownEntries: {
      intakeShapedFilesAtSourcesRoot: 0,
      opaqueEntriesAtSourcesRoot: 0,
      entriesInsideManagedSourceDirectories: 0,
      symbolicLinks: 0,
      otherEntries: 0,
    },
  };
}

function frozenScan(inventory: MutableInventory): ManagedFileInventoryScan {
  return {
    scannedEntryCount: inventory.scannedEntryCount,
    scanLimitReached: inventory.scanLimitReached,
    unknownEntries: Object.freeze({ ...inventory.unknownEntries }),
  };
}

const intakeShapedFilename =
  /^\.intake-(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/;

function entryType(entry: Dirent): "directory" | "file" | "symbolic-link" | "other" {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (entry.isSymbolicLink()) return "symbolic-link";
  return "other";
}

async function verifyManagedFileVersions(
  root: string,
  versions: readonly ManagedFileVersion[],
): Promise<void> {
  for (const version of versions) {
    const sourceDirectory = join(root, sourcesDirectory, managedPathSegment(version.sourceId));
    await requireDirectory(sourceDirectory, "Managed candidate knowledge source directory");
    await verifyManagedFile(managedVersionPath(root, version.sourceId, version.versionId), version);
  }
}

async function scanDirectory(
  path: string,
  inventory: MutableInventory,
  inspect: (entry: Dirent, entryPath: string) => void,
): Promise<void> {
  if (inventory.scanLimitReached) return;
  const directory = await opendir(path);
  let closeError: unknown;
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      if (inventory.scannedEntryCount === maximumManagedCandidateKnowledgeInventoryEntries) {
        inventory.scanLimitReached = true;
        break;
      }
      inventory.scannedEntryCount += 1;
      inspect(entry, join(path, entry.name));
    }
  } finally {
    try {
      await directory.close();
    } catch (error) {
      if (errorCode(error) !== "ERR_DIR_CLOSED") closeError = error;
    }
  }
  if (closeError !== undefined) throw closeError;
}

async function inspectManagedFiles(
  root: string,
  expected: readonly { readonly sourceId: string; readonly versionId: string }[],
): Promise<ManagedFileInventoryScan> {
  const expectedFilesBySourceDirectory = new Map<string, Set<string>>();
  for (const version of expected) {
    const sourceDirectory = managedPathSegment(version.sourceId);
    const expectedFiles = expectedFilesBySourceDirectory.get(sourceDirectory) ?? new Set<string>();
    expectedFiles.add(managedPathSegment(version.versionId));
    expectedFilesBySourceDirectory.set(sourceDirectory, expectedFiles);
  }

  const inventory = emptyInventory();
  const observedManagedSourceDirectories: string[] = [];
  const sourcesRoot = join(root, sourcesDirectory);
  await scanDirectory(sourcesRoot, inventory, (entry) => {
    if (entry.isSymbolicLink()) {
      inventory.unknownEntries.symbolicLinks += 1;
    } else if (entry.isFile()) {
      if (intakeShapedFilename.test(entry.name)) {
        inventory.unknownEntries.intakeShapedFilesAtSourcesRoot += 1;
      } else {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      }
    } else if (entry.isDirectory()) {
      if (expectedFilesBySourceDirectory.has(entry.name)) {
        observedManagedSourceDirectories.push(entry.name);
      } else {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      }
    } else {
      inventory.unknownEntries.otherEntries += 1;
    }
  });

  for (const sourceDirectory of observedManagedSourceDirectories) {
    if (inventory.scanLimitReached) break;
    const sourcePath = join(sourcesRoot, sourceDirectory);
    await requireDirectory(sourcePath, "Managed candidate knowledge source directory");
    const expectedFiles = expectedFilesBySourceDirectory.get(sourceDirectory) as Set<string>;
    await scanDirectory(sourcePath, inventory, (entry) => {
      if (entry.isSymbolicLink()) {
        inventory.unknownEntries.symbolicLinks += 1;
      } else if (entry.isFile()) {
        if (!expectedFiles.has(entry.name)) {
          inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
        }
      } else if (entry.isDirectory()) {
        inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
      } else {
        inventory.unknownEntries.otherEntries += 1;
      }
    });
  }
  return frozenScan(inventory);
}

async function observeDeletionArtifacts(
  root: string,
  artifacts: readonly ManagedFileVersion[],
): Promise<readonly ManagedFileDeletionObservation[]> {
  const observations: ManagedFileDeletionObservation[] = [];
  for (const artifact of artifacts) {
    const path = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    try {
      const details = await lstat(path);
      if (details.isSymbolicLink() || !details.isFile()) {
        observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
        continue;
      }
      try {
        await verifyManagedFile(path, artifact);
        const after = await lstat(path);
        if (
          after.isSymbolicLink() ||
          !after.isFile() ||
          after.dev !== details.dev ||
          after.ino !== details.ino
        ) {
          observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
          continue;
        }
        observations.push({
          ...artifact,
          status: "verified",
          identity: { dev: after.dev, ino: after.ino },
        });
      } catch {
        observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
      }
    } catch (error) {
      if (isMissing(error)) {
        observations.push({ ...artifact, status: "missing", identity: null });
        continue;
      }
      observations.push({ ...artifact, status: "integrity-mismatch", identity: null });
    }
  }
  return observations;
}

async function inspectDeletionInventory(
  root: string,
  input: {
    readonly managedSourceIds: readonly string[];
    readonly targetSourceIds: readonly string[];
    readonly artifacts: readonly ManagedFileVersion[];
  },
): Promise<ManagedFileDeletionInventory> {
  const expectedSourceDirectories = new Set(input.managedSourceIds.map(managedPathSegment));
  const targetSourceDirectories = new Map<string, Set<string>>();
  for (const sourceId of input.targetSourceIds) {
    targetSourceDirectories.set(managedPathSegment(sourceId), new Set<string>());
  }
  for (const artifact of input.artifacts) {
    const sourceDirectory = managedPathSegment(artifact.sourceId);
    const expectedFiles = targetSourceDirectories.get(sourceDirectory) ?? new Set<string>();
    expectedFiles.add(managedPathSegment(artifact.versionId));
    targetSourceDirectories.set(sourceDirectory, expectedFiles);
  }
  const inventory = emptyInventory();
  const entryFingerprints: string[] = [];
  const targetDirectories: string[] = [];
  const sourcesRoot = join(root, sourcesDirectory);
  await scanDirectory(sourcesRoot, inventory, (entry, entryPath) => {
    entryFingerprints.push(`${relative(sourcesRoot, entryPath)}:${entryType(entry)}`);
    if (entry.isSymbolicLink()) {
      inventory.unknownEntries.symbolicLinks += 1;
    } else if (entry.isFile()) {
      if (intakeShapedFilename.test(entry.name)) {
        inventory.unknownEntries.intakeShapedFilesAtSourcesRoot += 1;
      } else {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      }
    } else if (entry.isDirectory()) {
      if (!expectedSourceDirectories.has(entry.name)) {
        inventory.unknownEntries.opaqueEntriesAtSourcesRoot += 1;
      } else if (targetSourceDirectories.has(entry.name)) {
        targetDirectories.push(entry.name);
      }
    } else {
      inventory.unknownEntries.otherEntries += 1;
    }
  });
  for (const sourceDirectory of targetDirectories) {
    if (inventory.scanLimitReached) break;
    const sourcePath = join(sourcesRoot, sourceDirectory);
    try {
      await scanDirectory(sourcePath, inventory, (entry, entryPath) => {
        entryFingerprints.push(`${relative(sourcesRoot, entryPath)}:${entryType(entry)}`);
        if (entry.isSymbolicLink()) {
          inventory.unknownEntries.symbolicLinks += 1;
        } else if (entry.isFile()) {
          const expectedFiles = targetSourceDirectories.get(sourceDirectory);
          if (expectedFiles === undefined || !expectedFiles.has(entry.name)) {
            inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
          }
        } else if (entry.isDirectory()) {
          inventory.unknownEntries.entriesInsideManagedSourceDirectories += 1;
        } else {
          inventory.unknownEntries.otherEntries += 1;
        }
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return {
    ...frozenScan(inventory),
    artifacts: Object.freeze([...(await observeDeletionArtifacts(root, input.artifacts))]),
    entryFingerprints: Object.freeze(entryFingerprints.sort()),
  };
}
