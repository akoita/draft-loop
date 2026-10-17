import { lstat, rmdir } from "node:fs/promises";
import { join } from "node:path";

import { isMissing } from "./filesystem-error-codes.js";
import {
  managedPathSegment,
  managedVersionPath,
  removeRegularFileIfIdentityMatches,
  sourcesDirectory,
  verifyManagedFile,
} from "./managed-file-io.js";
import type {
  InterruptedWriteArtifact,
  ManagedFileIdentity,
  ManagedFileIntegrity,
  ManagedFileStorePort,
} from "./ports/managed-files.js";

// Store-open recovery of managed writes a crash interrupted. Recovery only ever removes a file
// whose content and device/inode identity match what the write journal recorded.

type RecoveryPort = Pick<
  ManagedFileStorePort,
  "inspectInterruptedWrite" | "removeInterruptedWriteArtifact" | "removeSourceIfEmpty"
>;

export function createFilesystemManagedFileRecovery(root: string): RecoveryPort {
  return {
    inspectInterruptedWrite: async (write) => {
      const stagingPath = join(
        root,
        sourcesDirectory,
        `.intake-${managedPathSegment(write.operationId)}`,
      );
      const targetPath = managedVersionPath(root, write.target.sourceId, write.target.versionId);
      return {
        staging: requireIdentity(
          await inspectArtifact(stagingPath, write.integrity),
          write.stagedIdentity,
        ),
        target: requireIdentity(
          await inspectArtifact(targetPath, write.integrity),
          write.stagedIdentity,
        ),
      };
    },
    removeInterruptedWriteArtifact: async (artifact) => {
      if (artifact.status === "missing") return true;
      if (artifact.status !== "verified") return false;
      return removeRegularFileIfIdentityMatches(artifact.location, artifact.identity);
    },
    removeSourceIfEmpty: async (sourceId) => {
      try {
        await rmdir(join(root, sourcesDirectory, managedPathSegment(sourceId)));
        return true;
      } catch (error) {
        return isMissing(error);
      }
    },
  };
}

async function inspectArtifact(
  path: string,
  integrity: ManagedFileIntegrity,
): Promise<InterruptedWriteArtifact> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(path);
  } catch (error) {
    return isMissing(error) ? { status: "missing" } : { status: "preserved" };
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    return { status: "preserved" };
  }
  try {
    await verifyManagedFile(path, integrity);
    const after = await lstat(path);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.dev !== details.dev ||
      after.ino !== details.ino
    ) {
      return { status: "preserved" };
    }
    return { status: "verified", location: path, identity: { dev: after.dev, ino: after.ino } };
  } catch {
    return { status: "preserved" };
  }
}

function requireIdentity(
  artifact: InterruptedWriteArtifact,
  expected: ManagedFileIdentity | null,
): InterruptedWriteArtifact {
  if (
    expected !== null &&
    artifact.status === "verified" &&
    (artifact.identity.dev !== expected.dev || artifact.identity.ino !== expected.ino)
  ) {
    return { status: "preserved" };
  }
  return artifact;
}
