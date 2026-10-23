import { isAbsolute, join } from "node:path";
import type { BlobStoragePort } from "@draft-loop/storage";

/** The runtime role the Postgres flow tests connect as, with no superuser rights. */
export const runtimeRole = "draft_loop_test_app";

export function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

/**
 * Filesystem blobs that also take the tenant's relative keys, as Cloud Storage does, by placing
 * them under `root`; references keep the key the caller gave.
 */
export function tenantKeyBlobs(root: string, blobs: BlobStoragePort): BlobStoragePort {
  const path = (location: string) => (isAbsolute(location) ? location : join(root, location));
  return {
    put: async (location, content) => ({
      ...(await blobs.put(path(location), content)),
      location,
    }),
    get: (reference) => blobs.get({ ...reference, location: path(reference.location) }),
    exists: (reference) => blobs.exists({ ...reference, location: path(reference.location) }),
    delete: (reference) => blobs.delete({ ...reference, location: path(reference.location) }),
  };
}
