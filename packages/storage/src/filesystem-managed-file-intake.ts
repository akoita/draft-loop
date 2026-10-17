import { createHash } from "node:crypto";
import { type FileHandle, lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  ManagedCandidateKnowledgeFileVersionInput,
  ManagedCandidateKnowledgeUrlVersionInput,
} from "./knowledge-store.js";
import {
  chmodWhereSupported,
  closeQuietly,
  type FileIdentity,
  isWithin,
  managedPathSegment,
  maximumManagedCandidateKnowledgeFileBytes,
  maximumManagedCandidateKnowledgeUrlResponseBytes,
  removeRegularFileIfIdentityMatches,
  requiredManagedText,
  sameFileState,
  sourceOpenFlags,
  sourcesDirectory,
  writeComplete,
} from "./managed-file-io.js";
import type { StagedManagedFile } from "./ports/managed-files.js";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

// The local driver's intake: copies a user-selected file, or approved URL response bytes, into a
// staging file inside the store and verifies it before the write journal records it.

export interface CapturedManagedFile extends StagedManagedFile {
  /** Canonical physical path verified during capture; never part of product projections. */
  readonly originPath: string;
}

export type CapturedManagedBytes = StagedManagedFile;

export async function captureManagedFile(
  root: string,
  input: ManagedCandidateKnowledgeFileVersionInput,
  operationId: string,
): Promise<CapturedManagedFile> {
  const expectedChecksum = requiredManagedText(
    input.checksum,
    "Managed candidate knowledge source expected checksum",
  );
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected checksum must be a lowercase SHA-256 checksum.",
    );
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected size must be a non-negative integer.",
    );
  }
  if (input.sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
    throw new StorageValidationError("Managed candidate knowledge source exceeds the size limit.");
  }
  const selectedPath = resolve(requiredManagedText(input.sourcePath, "Managed source path"));
  if (isWithin(root, selectedPath)) {
    throw new StorageValidationError(
      "A managed candidate knowledge source must be selected outside its store.",
    );
  }

  let sourceHandle: FileHandle | undefined;
  let temporaryHandle: FileHandle | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  const temporaryPath = join(root, sourcesDirectory, `.intake-${managedPathSegment(operationId)}`);
  try {
    const selectedDetails = await lstat(selectedPath);
    if (selectedDetails.isSymbolicLink() || !selectedDetails.isFile()) {
      throw new StorageValidationError(
        "Managed candidate knowledge source must be a regular file, not a symbolic link.",
      );
    }
    if (selectedDetails.size > maximumManagedCandidateKnowledgeFileBytes) {
      throw new StorageValidationError(
        "Managed candidate knowledge source exceeds the size limit.",
      );
    }
    const physicalPath = await realpath(selectedPath);
    if (isWithin(root, physicalPath)) {
      throw new StorageValidationError(
        "A managed candidate knowledge source must be selected outside its store.",
      );
    }
    sourceHandle = await open(selectedPath, sourceOpenFlags());
    const before = await sourceHandle.stat();
    if (
      !before.isFile() ||
      before.dev !== selectedDetails.dev ||
      before.ino !== selectedDetails.ino
    ) {
      throw new StorageValidationError(
        "Managed candidate knowledge source changed while it was being opened.",
      );
    }
    if (before.size > maximumManagedCandidateKnowledgeFileBytes) {
      throw new StorageValidationError(
        "Managed candidate knowledge source exceeds the size limit.",
      );
    }

    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    const temporaryDetails = await temporaryHandle.stat();
    temporaryIdentity = { dev: temporaryDetails.dev, ino: temporaryDetails.ino };
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      const result = await sourceHandle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      sizeBytes += result.bytesRead;
      if (sizeBytes > maximumManagedCandidateKnowledgeFileBytes) {
        throw new StorageValidationError(
          "Managed candidate knowledge source exceeds the size limit.",
        );
      }
      const chunk = buffer.subarray(0, result.bytesRead);
      digest.update(chunk);
      await writeComplete(temporaryHandle, chunk);
    }
    await input.beforeSourceRecheck?.();
    const after = await sourceHandle.stat();
    if (!sameFileState(before, after) || sizeBytes !== before.size) {
      throw new StorageValidationError(
        "Managed candidate knowledge source changed while it was being copied.",
      );
    }
    const checksum = digest.digest("hex");
    if (sizeBytes !== input.sizeBytes || checksum !== expectedChecksum) {
      throw new StorageValidationError(
        "Managed candidate knowledge source does not match its expected integrity metadata.",
      );
    }
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await chmodWhereSupported(temporaryPath, 0o600);
    await sourceHandle.close();
    sourceHandle = undefined;
    return {
      checksum,
      sizeBytes,
      originPath: physicalPath,
      location: temporaryPath,
      identity: temporaryIdentity,
    };
  } catch (error) {
    await closeQuietly(temporaryHandle);
    await closeQuietly(sourceHandle);
    if (temporaryIdentity !== undefined) {
      await removeRegularFileIfIdentityMatches(temporaryPath, temporaryIdentity);
    }
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError(
      "Managed candidate knowledge source could not be read safely.",
    );
  }
}

export async function captureManagedBytes(
  root: string,
  input: ManagedCandidateKnowledgeUrlVersionInput,
  operationId: string,
): Promise<CapturedManagedBytes> {
  const bytes = validateManagedUrlResponseBytes(input);
  const temporaryPath = join(root, sourcesDirectory, `.intake-${managedPathSegment(operationId)}`);
  let temporaryHandle: FileHandle | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  try {
    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    const temporaryDetails = await temporaryHandle.stat();
    temporaryIdentity = { dev: temporaryDetails.dev, ino: temporaryDetails.ino };
    await writeComplete(temporaryHandle, Buffer.from(bytes));
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await chmodWhereSupported(temporaryPath, 0o600);
    return {
      checksum: input.checksum,
      sizeBytes: bytes.byteLength,
      location: temporaryPath,
      identity: temporaryIdentity,
    };
  } catch (error) {
    await closeQuietly(temporaryHandle);
    if (temporaryIdentity !== undefined) {
      await removeRegularFileIfIdentityMatches(temporaryPath, temporaryIdentity);
    }
    if (error instanceof StorageValidationError || error instanceof StorageConflictError) {
      throw error;
    }
    throw new StorageValidationError(
      "Managed candidate knowledge source URL response could not be staged safely.",
    );
  }
}

export function validateManagedUrlResponseBytes(
  input: ManagedCandidateKnowledgeUrlVersionInput,
): Uint8Array {
  if (!(input.responseBytes instanceof Uint8Array)) {
    throw new StorageValidationError("Managed candidate knowledge URL response bytes are invalid.");
  }
  if (input.responseBytes.byteLength > maximumManagedCandidateKnowledgeUrlResponseBytes) {
    throw new StorageValidationError("Managed candidate knowledge source exceeds the size limit.");
  }
  const expectedChecksum = requiredManagedText(
    input.checksum,
    "Managed candidate knowledge source expected checksum",
  );
  if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected checksum must be a lowercase SHA-256 checksum.",
    );
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new StorageValidationError(
      "Managed candidate knowledge source expected size must be a non-negative integer.",
    );
  }
  const bytes = new Uint8Array(input.responseBytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== input.sizeBytes || checksum !== expectedChecksum) {
    throw new StorageValidationError(
      "Managed candidate knowledge source does not match its expected integrity metadata.",
    );
  }
  return bytes;
}
