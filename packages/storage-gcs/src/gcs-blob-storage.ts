import { createHash } from "node:crypto";
import type { BlobReference, BlobStoragePort } from "@draft-loop/storage";
import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import type { Bucket } from "@google-cloud/storage";

export interface GcsBlobStorageOptions {
  /**
   * The bucket, built by the composition root with its credentials and endpoint. Encryption is
   * the bucket's default customer-managed key, set by infrastructure: this adapter never chooses
   * or holds keys.
   */
  readonly bucket: Bucket;
  /** The tenant every location must sit under (ADR 0011, D3). */
  readonly tenantId: string;
}

/** The custom object metadata that holds the content's SHA-256, written on every put. */
export const sha256MetadataKey = "sha256";

const tenantPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
const controlCharacters = /[\u0000-\u001f\u007f]/u;
const maxObjectNameBytes = 1024;

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function statusOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/** The object-key prefix that holds one tenant's blobs: `tenants/<tenantId>/`. */
export function gcsTenantPrefix(tenantId: string): string {
  if (!tenantPattern.test(tenantId)) throw new StorageValidationError("Invalid tenant id.");
  return `tenants/${tenantId}/`;
}

function requireTenantLocation(prefix: string, location: string): string {
  if (!location.startsWith(prefix)) {
    throw new StorageSecurityError("A blob location must sit under the tenant's prefix.");
  }
  const segments = location.slice(prefix.length).split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    controlCharacters.test(location) ||
    Buffer.byteLength(location, "utf8") > maxObjectNameBytes
  ) {
    throw new StorageValidationError("A blob location must be a valid object key.");
  }
  return location;
}

/**
 * Blobs as Cloud Storage objects under one tenant's prefix. A blob's location is its full object
 * key, and every operation refuses a key outside the tenant's prefix.
 *
 * Reads never trust the object by name: the SHA-256 written as metadata at put time filters out
 * replaced objects cheaply, then the content of that exact generation is downloaded and hashed.
 * Delete names the generation it verified, so a concurrent write is never removed.
 */
export function createGcsBlobStorage(options: GcsBlobStorageOptions): BlobStoragePort {
  const { bucket } = options;
  const prefix = gcsTenantPrefix(options.tenantId);

  /** The generation that holds exactly the referenced content now, and that content. */
  const readMatching = async (
    reference: BlobReference,
  ): Promise<{ readonly generation: string; readonly content: Uint8Array } | undefined> => {
    const name = requireTenantLocation(prefix, reference.location);
    try {
      const [metadata] = await bucket.file(name).getMetadata();
      if (
        metadata.generation === undefined ||
        Number(metadata.size) !== reference.sizeBytes ||
        metadata.metadata?.[sha256MetadataKey] !== reference.checksum
      ) {
        return undefined;
      }
      const generation = String(metadata.generation);
      const [file] = await bucket.file(name, { generation }).download();
      const content = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
      return content.byteLength === reference.sizeBytes && sha256(content) === reference.checksum
        ? { generation, content }
        : undefined;
    } catch (error) {
      if (statusOf(error) === 404) return undefined;
      throw error;
    }
  };

  return {
    put: async (location, content) => {
      const name = requireTenantLocation(prefix, location);
      const checksum = sha256(content);
      await bucket
        .file(name)
        .save(Buffer.from(content.buffer, content.byteOffset, content.byteLength), {
          resumable: false,
          contentType: "application/octet-stream",
          metadata: { metadata: { [sha256MetadataKey]: checksum } },
        });
      return { location: name, checksum, sizeBytes: content.byteLength };
    },
    get: async (reference) => (await readMatching(reference))?.content,
    exists: async (reference) => (await readMatching(reference)) !== undefined,
    delete: async (reference) => {
      const matching = await readMatching(reference);
      if (matching === undefined) return false;
      const { generation } = matching;
      try {
        // Naming the generation alone already spares a newer write; the precondition states the
        // intent to Cloud Storage as well (the emulator honours only the former).
        await bucket
          .file(reference.location, { generation })
          .delete({ ifGenerationMatch: generation });
        return true;
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 412) return false;
        throw error;
      }
    },
  };
}
