import { randomUUID } from "node:crypto";
import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import { type Bucket, Storage } from "@google-cloud/storage";
import { afterAll, describe, expect, it } from "vitest";
import { createGcsBlobErasure } from "./gcs-blob-erasure.js";
import { createGcsBlobStorage, gcsTenantPrefix } from "./gcs-blob-storage.js";

/** Set by the Cloud Storage CI job and by developers running the emulator; skipped otherwise. */
const emulatorUrl = process.env.DRAFT_LOOP_TEST_GCS_URL;

const bytes = (text: string) => new TextEncoder().encode(text);

/** A bucket on an endpoint nothing listens on: refusals must happen before any request. */
const unreachableBucket = new Storage({
  apiEndpoint: "http://127.0.0.1:9",
  projectId: "draft-loop-test",
  retryOptions: { autoRetry: false },
}).bucket("unreachable");

describe("Cloud Storage erasure keys", () => {
  it("refuses a key outside the tenant's prefix or one that is not a plain path", async () => {
    const erasure = createGcsBlobErasure({ bucket: unreachableBucket, tenantId: "tenant-a" });
    for (const key of ["tenants/tenant-b/cv.md", "tenants/tenant-a", "cv.md", "/cv.md"]) {
      await expect(erasure.removeObject(key)).rejects.toBeInstanceOf(StorageSecurityError);
    }
    for (const key of ["tenants/tenant-a/", "tenants/tenant-a/../tenant-b/cv.md"]) {
      await expect(erasure.removeObject(key)).rejects.toBeInstanceOf(StorageValidationError);
    }
    for (const keyPrefix of ["tenants/tenant-b/", "tenants/tenant-a", "tenants/", ""]) {
      await expect(erasure.removePrefix(keyPrefix)).rejects.toBeInstanceOf(StorageSecurityError);
    }
    for (const keyPrefix of ["tenants/tenant-a/workspaces", "tenants/tenant-a/../tenant-b/"]) {
      await expect(erasure.removePrefix(keyPrefix)).rejects.toBeInstanceOf(StorageValidationError);
    }
  });
});

describe.runIf(emulatorUrl !== undefined)("Cloud Storage erasure on the emulator", () => {
  const storage = new Storage({ apiEndpoint: emulatorUrl ?? "", projectId: "draft-loop-test" });
  const bucket = storage.bucket(`draft-loop-erasure-${randomUUID()}`);
  let created: Promise<unknown> | undefined;
  const ready = async (): Promise<Bucket> => {
    created ??= bucket.create();
    await created;
    return bucket;
  };
  afterAll(async () => {
    if (created === undefined) return;
    await bucket.deleteFiles();
    await bucket.delete();
  });

  it("removes an object whatever it holds now, and reports one already gone", async () => {
    const tenantBucket = await ready();
    const tenantId = `tenant-${randomUUID()}`;
    const blobs = createGcsBlobStorage({ bucket: tenantBucket, tenantId });
    const erasure = createGcsBlobErasure({ bucket: tenantBucket, tenantId });
    const key = `${gcsTenantPrefix(tenantId)}workspaces/record-1/exports/run-1.md`;
    const kept = await blobs.put(
      `${gcsTenantPrefix(tenantId)}workspaces/record-2/cv.md`,
      bytes("2"),
    );
    await blobs.put(key, bytes("approved"));
    // Replaced around the adapter: a checked delete would leave it, erasure does not.
    await tenantBucket.file(key).save(Buffer.from("replaced"), { resumable: false });

    await expect(erasure.removeObject(key)).resolves.toBe(true);
    await expect(erasure.removeObject(key)).resolves.toBe(false);
    const [exists] = await tenantBucket.file(key).exists();
    expect(exists).toBe(false);
    await expect(blobs.exists(kept)).resolves.toBe(true);
  });

  it("removes every object under the tenant's prefix and none of another tenant's", async () => {
    const tenantBucket = await ready();
    const [tenantA, tenantB] = [`tenant-${randomUUID()}`, `tenant-${randomUUID()}`];
    const blobsA = createGcsBlobStorage({ bucket: tenantBucket, tenantId: tenantA });
    const blobsB = createGcsBlobStorage({ bucket: tenantBucket, tenantId: tenantB });
    const erasure = createGcsBlobErasure({ bucket: tenantBucket, tenantId: tenantA });
    const prefixA = gcsTenantPrefix(tenantA);
    for (const name of ["workspaces/record-1/exports/run-1.md", "knowledge/knowledge/v-1", "x"]) {
      await blobsA.put(`${prefixA}${name}`, bytes(name));
    }
    const kept = await blobsB.put(`${gcsTenantPrefix(tenantB)}knowledge/knowledge/v-1`, bytes("b"));

    await expect(erasure.removePrefix(`${prefixA}workspaces/`)).resolves.toBe(1);
    await expect(erasure.removePrefix(prefixA)).resolves.toBe(2);
    await expect(erasure.removePrefix(prefixA)).resolves.toBe(0);
    const [left] = await tenantBucket.getFiles({ prefix: prefixA });
    expect(left).toEqual([]);
    await expect(blobsB.exists(kept)).resolves.toBe(true);
  });
});
