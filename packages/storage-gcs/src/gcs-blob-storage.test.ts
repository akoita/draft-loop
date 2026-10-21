import { randomUUID } from "node:crypto";
import { describeBlobStorageConformance } from "@draft-loop/storage/conformance";
import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import { type Bucket, Storage } from "@google-cloud/storage";
import { afterAll, describe, expect, it } from "vitest";
import { createGcsBlobStorage, gcsTenantPrefix, sha256MetadataKey } from "./gcs-blob-storage.js";

/**
 * Set by the Cloud Storage CI job and by developers running the emulator. Without it the emulator
 * suites are skipped, so the workspace gate runs where no emulator is available.
 */
const emulatorUrl = process.env.DRAFT_LOOP_TEST_GCS_URL;

const bytes = (text: string) => new TextEncoder().encode(text);

/** A bucket on an endpoint nothing listens on: refusals must happen before any request. */
const unreachableBucket = new Storage({
  apiEndpoint: "http://127.0.0.1:9",
  projectId: "draft-loop-test",
  retryOptions: { autoRetry: false },
}).bucket("unreachable");

describe("Cloud Storage blob locations", () => {
  const blobs = createGcsBlobStorage({ bucket: unreachableBucket, tenantId: "tenant-a" });
  const reference = (location: string) => ({ location, checksum: "0".repeat(64), sizeBytes: 1 });

  it("puts every tenant under its own prefix and refuses an invalid tenant id", () => {
    expect(gcsTenantPrefix("tenant-a")).toBe("tenants/tenant-a/");
    for (const tenantId of ["", "../tenant-b", "tenant/b", ".hidden"]) {
      expect(() => createGcsBlobStorage({ bucket: unreachableBucket, tenantId })).toThrow(
        StorageValidationError,
      );
    }
  });

  it("refuses a location outside the tenant's prefix for every operation", async () => {
    for (const location of ["tenants/tenant-b/cv.md", "tenants/tenant-a", "cv.md", "/cv.md"]) {
      await expect(blobs.put(location, bytes("x"))).rejects.toBeInstanceOf(StorageSecurityError);
      await expect(blobs.get(reference(location))).rejects.toBeInstanceOf(StorageSecurityError);
      await expect(blobs.exists(reference(location))).rejects.toBeInstanceOf(StorageSecurityError);
      await expect(blobs.delete(reference(location))).rejects.toBeInstanceOf(StorageSecurityError);
    }
  });

  it("refuses keys that are not plain object paths", async () => {
    const tooLong = `tenants/tenant-a/${"a".repeat(1_100)}`;
    for (const location of [
      "tenants/tenant-a/",
      "tenants/tenant-a/a//b",
      "tenants/tenant-a/../tenant-b/cv.md",
      "tenants/tenant-a/./cv.md",
      "tenants/tenant-a/cv\n.md",
      tooLong,
    ]) {
      await expect(blobs.put(location, bytes("x"))).rejects.toBeInstanceOf(StorageValidationError);
      await expect(blobs.get(reference(location))).rejects.toBeInstanceOf(StorageValidationError);
    }
  });
});

describe.runIf(emulatorUrl !== undefined)("Cloud Storage blobs on the emulator", () => {
  const storage = new Storage({ apiEndpoint: emulatorUrl ?? "", projectId: "draft-loop-test" });
  const bucket = storage.bucket(`draft-loop-test-${randomUUID()}`);
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

  /** A fresh tenant in the shared test bucket, and its objects removed afterwards. */
  const openTenant = async (tenantId = `tenant-${randomUUID()}`) => {
    const tenantBucket = await ready();
    return {
      blobs: createGcsBlobStorage({ bucket: tenantBucket, tenantId }),
      locate: (name: string) => `${gcsTenantPrefix(tenantId)}${name}`,
      close: () => tenantBucket.deleteFiles({ prefix: gcsTenantPrefix(tenantId) }),
    };
  };

  describeBlobStorageConformance("Cloud Storage", async () => {
    const { close, ...opened } = await openTenant();
    return { storage: opened, close };
  });

  it("stores the SHA-256 as object metadata", async () => {
    const { blobs, locate, close } = await openTenant();
    try {
      const reference = await blobs.put(locate("cv.md"), bytes("# CV\n"));
      const [metadata] = await bucket.file(reference.location).getMetadata();
      expect(metadata.metadata?.[sha256MetadataKey]).toBe(reference.checksum);
      expect(Number(metadata.size)).toBe(5);
    } finally {
      await close();
    }
  });

  it("never passes a replaced object for the original, even with copied metadata", async () => {
    const { blobs, locate, close } = await openTenant();
    try {
      const reference = await blobs.put(locate("cv.md"), bytes("approved"));
      // Written around the adapter, with the same size and the original's checksum metadata.
      await bucket.file(reference.location).save(Buffer.from("tampered"), {
        resumable: false,
        metadata: { metadata: { [sha256MetadataKey]: reference.checksum } },
      });
      expect(await blobs.get(reference)).toBeUndefined();
      expect(await blobs.exists(reference)).toBe(false);
      expect(await blobs.delete(reference)).toBe(false);
      const [content] = await bucket.file(reference.location).download();
      expect(content.toString()).toBe("tampered");
    } finally {
      await close();
    }
  });

  it("does not delete an object written after the delete verified it", async () => {
    const { blobs, locate, close } = await openTenant();
    try {
      const reference = await blobs.put(locate("cv.md"), bytes("approved"));
      // A concurrent writer replaces the object between the verifying download and the delete.
      const racing = new Proxy(bucket, {
        get: (target, property, receiver) => {
          if (property !== "file") return Reflect.get(target, property, receiver);
          return (...args: Parameters<Bucket["file"]>) => {
            const file = target.file(...args);
            if (args[1]?.generation === undefined) return file;
            const download = file.download.bind(file) as () => Promise<[Buffer]>;
            Object.assign(file, {
              download: async () => {
                const downloaded = await download();
                await target.file(args[0]).save(Buffer.from("concurrent"), { resumable: false });
                return downloaded;
              },
            });
            return file;
          };
        },
      });
      const tenantId = reference.location.split("/")[1] ?? "";
      const racingBlobs = createGcsBlobStorage({ bucket: racing, tenantId });
      expect(await racingBlobs.delete(reference)).toBe(false);
      const [content] = await bucket.file(reference.location).download();
      expect(content.toString()).toBe("concurrent");
    } finally {
      await close();
    }
  });

  it("refuses another tenant's reference and leaves its object in place", async () => {
    const tenantA = await openTenant();
    const tenantB = await openTenant();
    try {
      const reference = await tenantA.blobs.put(tenantA.locate("cv.md"), bytes("tenant A"));
      await expect(tenantB.blobs.get(reference)).rejects.toBeInstanceOf(StorageSecurityError);
      await expect(tenantB.blobs.delete(reference)).rejects.toBeInstanceOf(StorageSecurityError);
      await expect(tenantB.blobs.put(reference.location, bytes("tenant B"))).rejects.toBeInstanceOf(
        StorageSecurityError,
      );
      expect(await tenantA.blobs.get(reference)).toEqual(new Uint8Array(bytes("tenant A")));
    } finally {
      await tenantA.close();
      await tenantB.close();
    }
  });
});
