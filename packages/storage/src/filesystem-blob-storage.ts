import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { isMissing } from "./filesystem-error-codes.js";
import type { BlobReference, BlobStoragePort } from "./ports/blobs.js";
import { StorageValidationError } from "./storage-errors.js";

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function requireAbsoluteLocation(location: string): string {
  if (location.trim() === "" || !isAbsolute(location)) {
    throw new StorageValidationError("A filesystem blob location must be an absolute path.");
  }
  return location;
}

async function readMatching(reference: BlobReference): Promise<Uint8Array | undefined> {
  let content: Uint8Array;
  try {
    const file = await readFile(requireAbsoluteLocation(reference.location));
    content = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  return content.byteLength === reference.sizeBytes && sha256(content) === reference.checksum
    ? content
    : undefined;
}

/**
 * Blobs as files at absolute paths, the layout local exports already use: a blob's location is
 * the file it is written to, and its parent directories are created on write.
 */
export function createFilesystemBlobStorage(): BlobStoragePort {
  return {
    put: async (location, content) => {
      const path = requireAbsoluteLocation(location);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      return { location: path, checksum: sha256(content), sizeBytes: content.byteLength };
    },
    get: readMatching,
    exists: async (reference) => (await readMatching(reference)) !== undefined,
    delete: async (reference) => {
      if ((await readMatching(reference)) === undefined) return false;
      await rm(reference.location, { force: true });
      return true;
    },
  };
}
