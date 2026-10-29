import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { openTenantBlobs, readBlobBackend } from "./blob-backend.js";
import { ApiConfigError } from "./config.js";

describe("readBlobBackend", () => {
  it("keeps Cloud Storage by default, with the emulator where one is named", () => {
    expect(readBlobBackend({ DRAFT_LOOP_BLOB_BUCKET: "bucket-a" })).toEqual({
      kind: "gcs",
      bucket: "bucket-a",
    });
    expect(
      readBlobBackend({
        DRAFT_LOOP_BLOB_BUCKET: "bucket-a",
        DRAFT_LOOP_GCS_ENDPOINT: "http://gcs:4443",
      }),
    ).toEqual({ kind: "gcs", bucket: "bucket-a", endpoint: "http://gcs:4443" });
  });

  it("reads a self-hosted directory", () => {
    expect(
      readBlobBackend({
        DRAFT_LOOP_BLOB_BACKEND: "filesystem",
        DRAFT_LOOP_BLOB_ROOT: "/var/lib/draft-loop/blobs",
      }),
    ).toEqual({ kind: "filesystem", root: "/var/lib/draft-loop/blobs" });
  });

  it.each([
    ["no bucket", {}],
    ["an unknown backend", { DRAFT_LOOP_BLOB_BACKEND: "s3", DRAFT_LOOP_BLOB_BUCKET: "bucket-a" }],
    ["a directory without a root", { DRAFT_LOOP_BLOB_BACKEND: "filesystem" }],
    ["a relative root", { DRAFT_LOOP_BLOB_BACKEND: "filesystem", DRAFT_LOOP_BLOB_ROOT: "blobs" }],
    [
      "a directory beside a bucket",
      {
        DRAFT_LOOP_BLOB_BACKEND: "filesystem",
        DRAFT_LOOP_BLOB_ROOT: "/blobs",
        DRAFT_LOOP_BLOB_BUCKET: "bucket-a",
      },
    ],
  ])("refuses %s", (_label, env) => {
    expect(() => readBlobBackend(env)).toThrow(ApiConfigError);
  });
});

describe("openTenantBlobs", () => {
  it("keeps each tenant's files under its own prefix in the directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-api-blobs-"));
    try {
      const blobs = openTenantBlobs({ kind: "filesystem", root });
      const prefix = blobs.prefixFor("tenant-a");
      const reference = await blobs
        .storageFor("tenant-a")
        .put(`${prefix}knowledge/version-1`, new TextEncoder().encode("synthetic"));

      expect(prefix).toBe("tenants/tenant-a/");
      await expect(
        readFile(join(root, "tenants", "tenant-a", "knowledge", "version-1"), "utf8"),
      ).resolves.toBe("synthetic");
      await expect(blobs.erasureFor("tenant-a").removeObject(reference.location)).resolves.toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
