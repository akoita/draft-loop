import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { isMissing } from "./filesystem-error-codes.js";
import type { BlobReference, BlobStoragePort } from "./ports/blobs.js";
import type { BlobErasure } from "./record-erasure.js";
import { StorageSecurityError, StorageValidationError } from "./storage-errors.js";

/**
 * Blobs as files under one directory, keyed exactly as the hosted service keys Cloud Storage
 * objects (`tenants/<tenantId>/...`), for a self-hosted stack that keeps files on disk (ADR 0011,
 * D15). A blob's location is its key, never a path, so run history reads the same on either
 * backend. Encryption at rest is the host disk's.
 */
export interface TenantDirectoryBlobOptions {
  /** The absolute directory that holds every tenant's files. */
  readonly root: string;
  /** The tenant every key must sit under (ADR 0011, D3). */
  readonly tenantId: string;
}

const tenantPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
const controlCharacters = /[\u0000-\u001f\u007f]/u;
const maxKeyBytes = 1024;

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** The key prefix that holds one tenant's blobs: `tenants/<tenantId>/`. */
export function tenantBlobPrefix(tenantId: string): string {
  if (!tenantPattern.test(tenantId)) throw new StorageValidationError("Invalid tenant id.");
  return `tenants/${tenantId}/`;
}

function requireRoot(root: string): string {
  if (root.trim() === "" || !isAbsolute(root)) {
    throw new StorageValidationError("A blob root must be an absolute path.");
  }
  return resolve(root);
}

/** A key under the tenant's prefix whose segments are plain names, or a refusal. */
function requireTenantKey(prefix: string, key: string): string {
  if (!key.startsWith(prefix)) {
    throw new StorageSecurityError("A blob location must sit under the tenant's prefix.");
  }
  const segments = key.slice(prefix.length).split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\"),
    ) ||
    controlCharacters.test(key) ||
    Buffer.byteLength(key, "utf8") > maxKeyBytes
  ) {
    throw new StorageValidationError("A blob location must be a valid object key.");
  }
  return key;
}

/** The file a checked key names, which must stay inside the root. */
function pathOf(root: string, key: string): string {
  const path = join(root, ...key.split("/"));
  if (!path.startsWith(`${root}${sep}`)) {
    throw new StorageSecurityError("A blob location must stay inside the blob root.");
  }
  return path;
}

export function createTenantDirectoryBlobStorage(
  options: TenantDirectoryBlobOptions,
): BlobStoragePort {
  const root = requireRoot(options.root);
  const prefix = tenantBlobPrefix(options.tenantId);

  const readMatching = async (reference: BlobReference): Promise<Uint8Array | undefined> => {
    const path = pathOf(root, requireTenantKey(prefix, reference.location));
    let content: Uint8Array;
    try {
      const file = await readFile(path);
      content = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    return content.byteLength === reference.sizeBytes && sha256(content) === reference.checksum
      ? content
      : undefined;
  };

  return {
    put: async (location, content) => {
      const key = requireTenantKey(prefix, location);
      const path = pathOf(root, key);
      await mkdir(dirname(path), { recursive: true });
      // Written beside the target and renamed over it, so a reader never sees half a file.
      const partial = `${path}.${randomUUID()}.partial`;
      await writeFile(partial, content, { mode: 0o600 });
      try {
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      return { location: key, checksum: sha256(content), sizeBytes: content.byteLength };
    },
    get: readMatching,
    exists: async (reference) => (await readMatching(reference)) !== undefined,
    delete: async (reference) => {
      if ((await readMatching(reference)) === undefined) return false;
      await rm(pathOf(root, reference.location), { force: true });
      return true;
    },
  };
}

async function countFiles(directory: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) count += await countFiles(join(directory, entry.name));
    else count += 1;
  }
  return count;
}

/**
 * Erasure's removal of one tenant's files (ADR 0011, D7). Every key and prefix must sit under the
 * tenant's prefix, and a file is removed whatever it holds now, so a replaced file never outlives
 * its record or its organisation.
 */
export function createTenantDirectoryBlobErasure(options: TenantDirectoryBlobOptions): BlobErasure {
  const root = requireRoot(options.root);
  const prefix = tenantBlobPrefix(options.tenantId);
  return {
    removeObject: async (key) => {
      const path = pathOf(root, requireTenantKey(prefix, key));
      try {
        await rm(path);
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
    removePrefix: async (keyPrefix) => {
      if (!keyPrefix.startsWith(prefix)) {
        throw new StorageSecurityError("A key prefix must sit under the tenant's prefix.");
      }
      if (!keyPrefix.endsWith("/")) {
        throw new StorageValidationError("A key prefix must end with a slash.");
      }
      if (keyPrefix !== prefix) requireTenantKey(prefix, keyPrefix.slice(0, -1));
      const directory = pathOf(root, keyPrefix.slice(0, -1));
      const removed = await countFiles(directory);
      await rm(directory, { recursive: true, force: true });
      return removed;
    },
  };
}
