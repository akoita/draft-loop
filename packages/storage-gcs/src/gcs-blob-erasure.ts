import type { BlobErasure } from "@draft-loop/storage/record-erasure";
import {
  type GcsBlobStorageOptions,
  gcsTenantPrefix,
  requireTenantLocation,
  statusOf,
} from "./gcs-blob-storage.js";

/**
 * Erasure's removal of one tenant's Cloud Storage objects (ADR 0011, D7). Every key must sit under
 * the tenant's prefix, and an object is removed whatever it holds now, so a replaced object never
 * outlives its record.
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
  };
}
