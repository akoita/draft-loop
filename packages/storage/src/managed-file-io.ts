import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";
import { join } from "node:path";

import { isMissing } from "./filesystem-error-codes.js";
import type { ManagedFileIntegrity } from "./ports/managed-files.js";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

// Low-level checks for managed candidate-knowledge files, shared by the knowledge store and the
// filesystem managed-file store.

export const sourcesDirectory = "sources";
export const maximumManagedCandidateKnowledgeFileBytes = 20 * 1024 * 1024;

export function managedPathSegment(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex");
}

export function managedVersionPath(root: string, sourceId: string, versionId: string): string {
  return join(root, sourcesDirectory, managedPathSegment(sourceId), managedPathSegment(versionId));
}

export function sourceOpenFlags(): number {
  return process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
}

export async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    // Preserve the failure that caused cleanup.
  }
}

export function sameFileState(
  first: Awaited<ReturnType<FileHandle["stat"]>>,
  second: Awaited<ReturnType<FileHandle["stat"]>>,
): boolean {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs &&
    first.ctimeMs === second.ctimeMs
  );
}

export async function requireRegularFile(
  path: string,
  label: string,
  maximumBytes: number,
): Promise<void> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      throw new StorageValidationError(`${label} is missing.`);
    }
    throw error;
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new StorageValidationError(`${label} must be a regular file, not a symbolic link.`);
  }
  if (details.size > maximumBytes) {
    throw new StorageValidationError(`${label} exceeds the supported size limit.`);
  }
}

async function hashManagedFile(path: string, expectedSize: number): Promise<string> {
  await requireRegularFile(
    path,
    "Managed candidate knowledge source version",
    maximumManagedCandidateKnowledgeFileBytes,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, sourceOpenFlags());
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedSize) {
      throw new StorageValidationError(
        "Managed candidate knowledge source version size does not match its record.",
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      sizeBytes += result.bytesRead;
      if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
        throw new StorageValidationError(
          "Managed candidate knowledge source version exceeds the size limit.",
        );
      }
      digest.update(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat();
    if (!sameFileState(before, after) || sizeBytes !== expectedSize) {
      throw new StorageValidationError(
        "Managed candidate knowledge source version changed while it was being verified.",
      );
    }
    return digest.digest("hex");
  } finally {
    await closeQuietly(handle);
  }
}

export async function readVerifiedManagedFile(
  path: string,
  version: ManagedFileIntegrity,
): Promise<Uint8Array> {
  try {
    if (
      !/^[0-9a-f]{64}$/.test(version.checksum) ||
      !Number.isSafeInteger(version.sizeBytes) ||
      version.sizeBytes < 0 ||
      version.sizeBytes > maximumManagedCandidateKnowledgeFileBytes
    ) {
      throw new StorageValidationError(
        "Managed candidate knowledge source version integrity metadata is invalid.",
      );
    }
    await requireRegularFile(
      path,
      "Managed candidate knowledge source version",
      maximumManagedCandidateKnowledgeFileBytes,
    );

    let handle: FileHandle | undefined;
    try {
      handle = await open(path, sourceOpenFlags());
      const before = await handle.stat();
      if (!before.isFile() || before.size !== version.sizeBytes) {
        throw new StorageValidationError(
          "Managed candidate knowledge source version size does not match its record.",
        );
      }

      const digest = createHash("sha256");
      const chunks: Buffer[] = [];
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let sizeBytes = 0;
      while (true) {
        const result = await handle.read(buffer, 0, buffer.length, null);
        if (result.bytesRead === 0) break;
        if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes - result.bytesRead) {
          throw new StorageValidationError(
            "Managed candidate knowledge source version exceeds the size limit.",
          );
        }
        sizeBytes += result.bytesRead;
        const chunk = Buffer.from(buffer.subarray(0, result.bytesRead));
        chunks.push(chunk);
        digest.update(chunk);
      }

      const after = await handle.stat();
      if (!sameFileState(before, after) || sizeBytes !== version.sizeBytes) {
        throw new StorageValidationError(
          "Managed candidate knowledge source version changed while it was being read.",
        );
      }
      if (digest.digest("hex") !== version.checksum) {
        throw new StorageValidationError(
          "Managed candidate knowledge source version checksum does not match its record.",
        );
      }
      return new Uint8Array(Buffer.concat(chunks, sizeBytes));
    } finally {
      await closeQuietly(handle);
    }
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError(
      "Managed candidate knowledge source version could not be read safely.",
    );
  }
}

export async function verifyManagedFile(
  path: string,
  version: ManagedFileIntegrity,
): Promise<void> {
  const checksum = await hashManagedFile(path, version.sizeBytes);
  if (checksum !== version.checksum) {
    throw new StorageValidationError(
      "Managed candidate knowledge source version checksum does not match its record.",
    );
  }
}
