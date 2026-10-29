import { isAbsolute } from "node:path";
import type { BlobStoragePort } from "@draft-loop/storage";
import type { BlobErasure } from "@draft-loop/storage/record-erasure";
import {
  createTenantDirectoryBlobErasure,
  createTenantDirectoryBlobStorage,
  tenantBlobPrefix,
} from "@draft-loop/storage/tenant-blobs";
import {
  createGcsBlobErasure,
  createGcsBlobStorage,
  gcsTenantPrefix,
} from "@draft-loop/storage-gcs";
import { Storage } from "@google-cloud/storage";

import { WorkerConfigError } from "./config-error.js";

/**
 * Where the tenants' files live: Cloud Storage (or its emulator on the dev stack), or a directory
 * on a self-hosted stack's disk (ADR 0011, D15). Both key files `tenants/<tenantId>/...`.
 */
export type BlobBackendConfig =
  | {
      readonly kind: "gcs";
      readonly bucket: string;
      /** A Cloud Storage emulator, for the dev stack only; unset in a deployment. */
      readonly endpoint?: string;
    }
  | { readonly kind: "filesystem"; readonly root: string };

/**
 * Reads `DRAFT_LOOP_BLOB_BACKEND` (default `gcs`): `gcs` needs `DRAFT_LOOP_BLOB_BUCKET` and
 * may name `DRAFT_LOOP_GCS_ENDPOINT`; `filesystem` needs the absolute `DRAFT_LOOP_BLOB_ROOT`
 * and refuses the bucket settings, so no deployment is unclear about where files go.
 */
export function readBlobBackend(env: NodeJS.ProcessEnv): BlobBackendConfig {
  const kind = env.DRAFT_LOOP_BLOB_BACKEND || "gcs";
  const bucket = env.DRAFT_LOOP_BLOB_BUCKET ?? "";
  const endpoint = env.DRAFT_LOOP_GCS_ENDPOINT ?? "";
  if (kind === "filesystem") {
    if (bucket !== "" || endpoint !== "") {
      throw new WorkerConfigError(
        "DRAFT_LOOP_BLOB_BUCKET and DRAFT_LOOP_GCS_ENDPOINT belong to the gcs backend; remove them when DRAFT_LOOP_BLOB_BACKEND is filesystem.",
      );
    }
    const root = env.DRAFT_LOOP_BLOB_ROOT ?? "";
    if (root === "" || !isAbsolute(root)) {
      throw new WorkerConfigError("DRAFT_LOOP_BLOB_ROOT must be an absolute directory path.");
    }
    return { kind, root };
  }
  if (kind !== "gcs")
    throw new WorkerConfigError("DRAFT_LOOP_BLOB_BACKEND must be gcs or filesystem.");
  if (bucket === "") throw new WorkerConfigError("DRAFT_LOOP_BLOB_BUCKET is required.");
  return { kind, bucket, ...(endpoint === "" ? {} : { endpoint }) };
}

/** Each tenant's view of the backend: its files, their erasure and its key prefix. */
export interface TenantBlobs {
  readonly storageFor: (tenantId: string) => BlobStoragePort;
  readonly erasureFor: (tenantId: string) => BlobErasure;
  readonly prefixFor: (tenantId: string) => string;
}

/** Opens the backend once for every tenant: one bucket, or one root directory. */
export function openTenantBlobs(config: BlobBackendConfig): TenantBlobs {
  if (config.kind === "filesystem") {
    const { root } = config;
    return {
      storageFor: (tenantId) => createTenantDirectoryBlobStorage({ root, tenantId }),
      erasureFor: (tenantId) => createTenantDirectoryBlobErasure({ root, tenantId }),
      prefixFor: tenantBlobPrefix,
    };
  }
  const bucket = new Storage(
    config.endpoint === undefined
      ? {}
      : { apiEndpoint: config.endpoint, projectId: "draft-loop-local" },
  ).bucket(config.bucket);
  return {
    storageFor: (tenantId) => createGcsBlobStorage({ bucket, tenantId }),
    erasureFor: (tenantId) => createGcsBlobErasure({ bucket, tenantId }),
    prefixFor: gcsTenantPrefix,
  };
}
