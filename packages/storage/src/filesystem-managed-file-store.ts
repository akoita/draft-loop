import { link, mkdir, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { errorCode, isMissing } from "./filesystem-error-codes.js";
import { createFilesystemDeletionStaging } from "./filesystem-managed-file-deletion.js";
import { createFilesystemManagedFileInventory } from "./filesystem-managed-file-inventory.js";
import { createFilesystemManagedFileRecovery } from "./filesystem-managed-file-recovery.js";
import {
  chmodWhereSupported,
  managedPathSegment,
  managedVersionPath,
  readVerifiedManagedFile,
  removeRegularFileIfIdentityMatches,
  requireDirectory,
  sourcesDirectory,
  verifyManagedFile,
} from "./managed-file-io.js";
import type { ManagedFileStorePort, StagedManagedFile } from "./ports/managed-files.js";
import { StorageConflictError } from "./storage-errors.js";

/** Managed files kept under a local knowledge store's `sources` directory, in today's layout. */
export function createFilesystemManagedFileStore(root: string): ManagedFileStorePort {
  const pathOf = (key: { readonly sourceId: string; readonly versionId: string }) =>
    managedVersionPath(root, key.sourceId, key.versionId);
  return Object.freeze({
    read: (key, integrity) => readVerifiedManagedFile(pathOf(key), integrity),
    verify: (key, integrity) => verifyManagedFile(pathOf(key), integrity),
    ensureSource: async (sourceId) => ({
      created: (await ensureManagedSourceDirectory(root, sourceId)).created,
    }),
    publish: (staged, key) => publishManagedFile(staged, pathOf(key)),
    removeStaged: (staged) => removeRegularFileIfIdentityMatches(staged.location, staged.identity),
    discardUncommitted: (staged, write) =>
      cleanUncommittedManagedWrite(
        staged,
        write.target === undefined ? undefined : pathOf(write.target),
        write.published,
        write.createdSource,
      ),
    ...createFilesystemDeletionStaging(root),
    ...createFilesystemManagedFileInventory(root),
    ...createFilesystemManagedFileRecovery(root),
  } satisfies ManagedFileStorePort);
}

async function ensureManagedSourceDirectory(
  root: string,
  sourceId: string,
): Promise<{ readonly path: string; readonly created: boolean }> {
  const path = join(root, sourcesDirectory, managedPathSegment(sourceId));
  try {
    await mkdir(path, { mode: 0o700 });
    await chmodWhereSupported(path, 0o700);
    return { path, created: true };
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    await requireDirectory(path, "Managed candidate knowledge source directory");
    return { path, created: false };
  }
}

/** A hard link never replaces an existing target, which is what makes publication no-clobber. */
async function publishManagedFile(staged: StagedManagedFile, finalPath: string): Promise<void> {
  let created = false;
  try {
    await link(staged.location, finalPath);
    created = true;
    await chmodWhereSupported(finalPath, 0o600);
    await verifyManagedFile(finalPath, staged);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new StorageConflictError(
        "Managed candidate knowledge source version target already exists and is not owned by this operation.",
      );
    }
    if (created) await removeRegularFileIfIdentityMatches(finalPath, staged.identity);
    throw error;
  }
}

async function cleanUncommittedManagedWrite(
  staged: StagedManagedFile,
  finalPath: string | undefined,
  published: boolean,
  createdDirectory: boolean,
): Promise<boolean> {
  let complete = true;
  if (
    published &&
    finalPath !== undefined &&
    !(await removeRegularFileIfIdentityMatches(finalPath, staged.identity))
  ) {
    complete = false;
  }
  if (!(await removeRegularFileIfIdentityMatches(staged.location, staged.identity))) {
    complete = false;
  }
  if (createdDirectory && finalPath !== undefined) {
    try {
      await rmdir(dirname(finalPath));
    } catch (error) {
      if (errorCode(error) !== "ENOTEMPTY" && !isMissing(error)) complete = false;
    }
  }
  return complete;
}
