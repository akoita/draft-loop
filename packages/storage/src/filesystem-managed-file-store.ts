import {
  managedVersionPath,
  readVerifiedManagedFile,
  verifyManagedFile,
} from "./managed-file-io.js";
import type { ManagedFileStorePort } from "./ports/managed-files.js";

/** Managed files kept under a local knowledge store's `sources` directory, in today's layout. */
export function createFilesystemManagedFileStore(root: string): ManagedFileStorePort {
  return Object.freeze({
    read: (key, integrity) =>
      readVerifiedManagedFile(managedVersionPath(root, key.sourceId, key.versionId), integrity),
    verify: (key, integrity) =>
      verifyManagedFile(managedVersionPath(root, key.sourceId, key.versionId), integrity),
  } satisfies ManagedFileStorePort);
}
