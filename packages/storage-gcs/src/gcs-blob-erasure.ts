import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import type { BlobErasure } from "@draft-loop/storage/record-erasure";
import {
  type GcsBlobStorageOptions,
  gcsTenantPrefix,
  requireTenantLocation,
  statusOf,
} from "./gcs-blob-storage.js";

/**
 * Erasure's removal of one tenant's Cloud Storage objects (ADR 0011, D7). Every key and prefix must
 * sit under the tenant's prefix, and an object is removed whatever it holds now, so a replaced
 * object never outlives its record or its organisation.
 */
export function createGcsBlobErasure(options: GcsBlobStorageOptions): BlobErasure {
  const { bucket } = options;
  const prefix = gcsTenantPrefix(options.tenantId);
  return {
    removeObject: async (key) => {
      const name = requireTenantLocation(prefix, key);
      try {
        await bucket.file(name).delete();
        return true;
      } catch (error) {
        if (statusOf(error) === 404) return false;
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
      if (keyPrefix !== prefix) requireTenantLocation(prefix, keyPrefix.slice(0, -1));
      const [files] = await bucket.getFiles({ prefix: keyPrefix });
      let removed = 0;
      for (const file of files) {
        // Listing by prefix returns only these keys; the check keeps that a guarantee here.
        if (!file.name.startsWith(keyPrefix)) continue;
        try {
          await file.delete();
          removed += 1;
        } catch (error) {
          if (statusOf(error) !== 404) throw error;
        }
      }
      return removed;
    },
  };
}
