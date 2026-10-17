import type { Dirent } from "node:fs";
import { lstat, mkdir, opendir, rename } from "node:fs/promises";
import { join } from "node:path";

import { errorCode, isMissing } from "./filesystem-error-codes.js";
import {
  chmodWhereSupported,
  type FileIdentity,
  managedPathSegment,
  managedVersionPath,
  privateDirectory,
  removeEmptyDirectoryIfIdentityMatches,
  removeRegularFileIfIdentityMatches,
  requireDirectory,
  sourcesDirectory,
  verifyManagedFile,
} from "./managed-file-io.js";
import type {
  CandidateKnowledgeDeletionArtifactRecord,
  CandidateKnowledgeDeletionOperationRecord,
} from "./ports/candidate-knowledge.js";
import type { ManagedFileStorePort } from "./ports/managed-files.js";
import { StorageConflictError } from "./storage-errors.js";

// Deleting a knowledge base moves its managed files into a per-operation staging directory,
// then commits by removing them or rolls back by moving them home. Every step re-checks the
// device and inode the deletion journal recorded, so it never touches a file it does not own.

const candidateKnowledgeDeletionStagingDirectory = ".deletion-staging";

type DeletionStagingPort = Pick<
  ManagedFileStorePort,
  | "createDeletionStaging"
  | "stageDeletion"
  | "verifyDeletionStaged"
  | "commitDeletion"
  | "restoreDeletion"
>;

export function createFilesystemDeletionStaging(root: string): DeletionStagingPort {
  const stagingPath = (operation: CandidateKnowledgeDeletionOperationRecord) =>
    deletionStagingPath(root, operation.operationId);
  return {
    createDeletionStaging: async (operationId) => ({
      identity: (await createCandidateKnowledgeDeletionStaging(root, operationId)).identity,
    }),
    stageDeletion: (operation) =>
      moveCandidateKnowledgeDeletionArtifactsToStaging(root, operation, stagingPath(operation)),
    verifyDeletionStaged: (operation) =>
      verifyCandidateKnowledgeDeletionStagingArtifacts(root, operation, stagingPath(operation)),
    commitDeletion: (operation) => cleanupCandidateKnowledgeDeletionStaging(root, operation),
    restoreDeletion: (operation) => restoreCandidateKnowledgeDeletionArtifacts(root, operation),
  };
}

function deletionStagingPath(root: string, operationId: string): string {
  return join(root, privateDirectory, candidateKnowledgeDeletionStagingDirectory, operationId);
}

function deletionArtifactStagingPath(
  stagingPath: string,
  sourceId: string,
  versionId: string,
): string {
  return join(stagingPath, `${managedPathSegment(sourceId)}-${managedPathSegment(versionId)}`);
}

function sameFileIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

async function createCandidateKnowledgeDeletionStaging(
  root: string,
  operationId: string,
): Promise<{ readonly path: string; readonly identity: FileIdentity }> {
  const parent = join(root, privateDirectory, candidateKnowledgeDeletionStagingDirectory);
  await mkdir(parent, { mode: 0o700, recursive: true });
  await requireDirectory(parent, "Candidate knowledge deletion staging parent");
  await chmodWhereSupported(parent, 0o700);
  const path = deletionStagingPath(root, operationId);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new StorageConflictError("Candidate knowledge deletion staging is already owned.");
    }
    throw error;
  }
  await chmodWhereSupported(path, 0o700);
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new StorageConflictError("Candidate knowledge deletion staging is not a real directory.");
  }
  return { path, identity: { dev: details.dev, ino: details.ino } };
}

async function verifyDeletionStagingDirectory(
  path: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<FileIdentity | null> {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new StorageConflictError(
        "Candidate knowledge deletion staging is not a real directory.",
      );
    }
    if (
      operation.stagingDevice !== null &&
      operation.stagingInode !== null &&
      (details.dev !== operation.stagingDevice || details.ino !== operation.stagingInode)
    ) {
      throw new StorageConflictError("Candidate knowledge deletion staging ownership changed.");
    }
    return { dev: details.dev, ino: details.ino };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function verifyDeletionArtifactAt(
  path: string,
  artifact: CandidateKnowledgeDeletionArtifactRecord,
): Promise<{
  readonly status: "missing" | "verified" | "preserved";
  readonly identity?: FileIdentity;
}> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return { status: "missing" };
    return { status: "preserved" };
  }
  if (details.isSymbolicLink() || !details.isFile()) return { status: "preserved" };
  const identity = { dev: details.dev, ino: details.ino };
  if (!sameFileIdentity(identity, { dev: artifact.device, ino: artifact.inode })) {
    return { status: "preserved" };
  }
  try {
    await verifyManagedFile(path, artifact);
  } catch {
    return { status: "preserved" };
  }
  return { status: "verified", identity };
}

async function moveCandidateKnowledgeDeletionArtifactsToStaging(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
  stagingPath: string,
): Promise<void> {
  for (const artifact of operation.artifacts) {
    const originalPath = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    const stagedPath = deletionArtifactStagingPath(
      stagingPath,
      artifact.sourceId,
      artifact.versionId,
    );
    const staged = await verifyDeletionArtifactAt(stagedPath, artifact);
    const original = await verifyDeletionArtifactAt(originalPath, artifact);
    if (staged.status === "verified") {
      if (original.status !== "missing") {
        throw new StorageConflictError(
          "Candidate knowledge deletion artifact exists in two locations.",
        );
      }
      continue;
    }
    if (staged.status === "preserved") {
      throw new StorageConflictError(
        "Candidate knowledge deletion staging contains an unowned entry.",
      );
    }
    if (original.status !== "verified") {
      throw new StorageConflictError(
        "Candidate knowledge deletion managed artifact changed before staging.",
      );
    }
    try {
      await rename(originalPath, stagedPath);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new StorageConflictError(
          "Candidate knowledge deletion artifact target already exists.",
        );
      }
      throw error;
    }
    const moved = await verifyDeletionArtifactAt(stagedPath, artifact);
    if (moved.status !== "verified") {
      throw new StorageConflictError(
        "Candidate knowledge deletion artifact changed while staging.",
      );
    }
  }
}

async function verifyCandidateKnowledgeDeletionStagingArtifacts(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
  stagingPath: string,
): Promise<void> {
  const stagingIdentity = await verifyDeletionStagingDirectory(stagingPath, operation);
  if (stagingIdentity === null) {
    throw new StorageConflictError("Candidate knowledge deletion staging disappeared.");
  }
  for (const artifact of operation.artifacts) {
    const stagedPath = deletionArtifactStagingPath(
      stagingPath,
      artifact.sourceId,
      artifact.versionId,
    );
    const originalPath = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    const staged = await verifyDeletionArtifactAt(stagedPath, artifact);
    const original = await verifyDeletionArtifactAt(originalPath, artifact);
    if (staged.status !== "verified" || original.status !== "missing") {
      throw new StorageConflictError("Candidate knowledge deletion staging inventory changed.");
    }
  }
}

async function cleanupCandidateKnowledgeDeletionStaging(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<void> {
  const stagingPath = deletionStagingPath(root, operation.operationId);
  const identity = await verifyDeletionStagingDirectory(stagingPath, operation);
  if (identity !== null) {
    const entries = await readDirectoryEntriesSafely(stagingPath);
    const expected = new Map(
      operation.artifacts.map((artifact) => [
        `${managedPathSegment(artifact.sourceId)}-${managedPathSegment(artifact.versionId)}`,
        artifact,
      ]),
    );
    for (const entry of entries) {
      const artifact = expected.get(entry.name);
      if (artifact === undefined || !entry.isFile()) {
        throw new StorageConflictError(
          "Candidate knowledge deletion staging contains an unowned entry.",
        );
      }
      const path = join(stagingPath, entry.name);
      const observed = await verifyDeletionArtifactAt(path, artifact);
      if (observed.status !== "verified" || observed.identity === undefined) {
        throw new StorageConflictError(
          "Candidate knowledge deletion staging artifact is not owned.",
        );
      }
      await removeRegularFileIfIdentityMatches(path, observed.identity);
    }
    await removeEmptyDirectoryIfIdentityMatches(stagingPath, identity);
  }
  await removeCandidateKnowledgeDeletionSourceDirectories(root, operation);
}

async function removeCandidateKnowledgeDeletionSourceDirectories(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<void> {
  const sourceIds = [...new Set(operation.artifacts.map((artifact) => artifact.sourceId))];
  for (const sourceId of sourceIds) {
    const path = join(root, sourcesDirectory, managedPathSegment(sourceId));
    let details: Awaited<ReturnType<typeof lstat>>;
    try {
      details = await lstat(path);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (details.isSymbolicLink() || !details.isDirectory()) continue;
    const entries = await readDirectoryEntriesSafely(path);
    if (entries.length > 0) continue;
    // The helper re-checks lstat identity immediately before rmdir. A race
    // that adds an unknown entry therefore leaves the directory untouched.
    await removeEmptyDirectoryIfIdentityMatches(path, { dev: details.dev, ino: details.ino });
  }
}

async function restoreCandidateKnowledgeDeletionArtifacts(
  root: string,
  operation: CandidateKnowledgeDeletionOperationRecord,
): Promise<boolean> {
  const stagingPath = deletionStagingPath(root, operation.operationId);
  const identity = await verifyDeletionStagingDirectory(stagingPath, operation);
  if (identity === null) return true;
  let restored = true;
  for (const artifact of operation.artifacts) {
    const originalPath = managedVersionPath(root, artifact.sourceId, artifact.versionId);
    const stagedPath = deletionArtifactStagingPath(
      stagingPath,
      artifact.sourceId,
      artifact.versionId,
    );
    const staged = await verifyDeletionArtifactAt(stagedPath, artifact);
    const original = await verifyDeletionArtifactAt(originalPath, artifact);
    if (staged.status === "missing") {
      if (original.status === "verified") continue;
      restored = false;
      continue;
    }
    if (staged.status !== "verified" || original.status !== "missing") {
      restored = false;
      continue;
    }
    try {
      await rename(stagedPath, originalPath);
    } catch {
      restored = false;
    }
  }
  if (!restored) return false;
  await removeEmptyDirectoryIfIdentityMatches(stagingPath, identity);
  return true;
}

async function readDirectoryEntriesSafely(path: string): Promise<readonly Dirent[]> {
  const directory = await opendir(path);
  const entries: Dirent[] = [];
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      entries.push(entry);
    }
  } finally {
    await directory.close().catch((error: unknown) => {
      if (errorCode(error) !== "ERR_DIR_CLOSED") throw error;
    });
  }
  return entries;
}
