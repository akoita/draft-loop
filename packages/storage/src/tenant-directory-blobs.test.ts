import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeBlobStorageConformance } from "./conformance/blobs.js";
import { StorageSecurityError, StorageValidationError } from "./storage-errors.js";
import {
  createTenantDirectoryBlobErasure,
  createTenantDirectoryBlobStorage,
  tenantBlobPrefix,
} from "./tenant-directory-blobs.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describeBlobStorageConformance("Tenant directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-tenant-blobs-"));
  return {
    storage: {
      blobs: createTenantDirectoryBlobStorage({ root, tenantId: "tenant-a" }),
      locate: (name) => `tenants/tenant-a/${name}`,
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
});

describe("tenant directory blobs", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draft-loop-tenant-blobs-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the Cloud Storage key as the location and writes the file under the root", async () => {
    const blobs = createTenantDirectoryBlobStorage({ root, tenantId: "tenant-a" });
    const key = "tenants/tenant-a/knowledge/knowledge/version-1";

    const reference = await blobs.put(key, bytes("synthetic source"));

    expect(reference.location).toBe(key);
    const path = join(root, "tenants", "tenant-a", "knowledge", "knowledge", "version-1");
    await expect(readFile(path, "utf8")).resolves.toBe("synthetic source");
    expect((await stat(path)).mode & 0o077).toBe(0);
    // No partial file is left beside it.
    expect(await readdir(join(root, "tenants", "tenant-a", "knowledge", "knowledge"))).toEqual([
      "version-1",
    ]);
  });

  it("never passes a file changed on disk for the referenced content", async () => {
    const blobs = createTenantDirectoryBlobStorage({ root, tenantId: "tenant-a" });
    const reference = await blobs.put("tenants/tenant-a/cv.md", bytes("approved"));
    await writeFile(join(root, "tenants", "tenant-a", "cv.md"), "edited by hand");

    await expect(blobs.get(reference)).resolves.toBeUndefined();
    await expect(blobs.delete(reference)).resolves.toBe(false);
  });

  it.each([
    ["another tenant's key", "tenants/tenant-b/cv.md", StorageSecurityError],
    ["a key with no tenant", "cv.md", StorageSecurityError],
    ["a parent segment", "tenants/tenant-a/../tenant-b/cv.md", StorageValidationError],
    ["an empty segment", "tenants/tenant-a//cv.md", StorageValidationError],
    ["a backslash", "tenants/tenant-a/..\\cv.md", StorageValidationError],
    ["an absolute path", "/etc/passwd", StorageSecurityError],
  ])("refuses %s", async (_label, key, error) => {
    const blobs = createTenantDirectoryBlobStorage({ root, tenantId: "tenant-a" });

    await expect(blobs.put(key, bytes("x"))).rejects.toBeInstanceOf(error);
  });

  it("needs an absolute root and a valid tenant", () => {
    expect(() => createTenantDirectoryBlobStorage({ root: "blobs", tenantId: "a" })).toThrow(
      StorageValidationError,
    );
    expect(() => tenantBlobPrefix("../a")).toThrow(StorageValidationError);
  });

  it("erases one object and a whole prefix, counting the files removed", async () => {
    const blobs = createTenantDirectoryBlobStorage({ root, tenantId: "tenant-a" });
    const erasure = createTenantDirectoryBlobErasure({ root, tenantId: "tenant-a" });
    await blobs.put("tenants/tenant-a/workspaces/record-1/exports/run-1.md", bytes("one"));
    await blobs.put("tenants/tenant-a/workspaces/record-1/exports/run-2.md", bytes("two"));
    await blobs.put("tenants/tenant-a/workspaces/record-2/exports/run-3.md", bytes("three"));
    const other = createTenantDirectoryBlobStorage({ root, tenantId: "tenant-b" });
    const kept = await other.put("tenants/tenant-b/cv.md", bytes("other tenant"));

    await expect(
      erasure.removeObject("tenants/tenant-a/workspaces/record-2/exports/run-3.md"),
    ).resolves.toBe(true);
    await expect(
      erasure.removeObject("tenants/tenant-a/workspaces/record-2/exports/run-3.md"),
    ).resolves.toBe(false);
    await expect(erasure.removePrefix("tenants/tenant-a/workspaces/record-1/")).resolves.toBe(2);
    await expect(erasure.removePrefix("tenants/tenant-a/workspaces/missing/")).resolves.toBe(0);
    await expect(erasure.removePrefix(tenantBlobPrefix("tenant-a"))).resolves.toBe(0);
    await expect(other.exists(kept)).resolves.toBe(true);
  });

  it("refuses to erase outside the tenant's prefix", async () => {
    const erasure = createTenantDirectoryBlobErasure({ root, tenantId: "tenant-a" });

    await expect(erasure.removePrefix("tenants/tenant-b/")).rejects.toBeInstanceOf(
      StorageSecurityError,
    );
    await expect(erasure.removePrefix("tenants/tenant-a/records")).rejects.toBeInstanceOf(
      StorageValidationError,
    );
    await expect(erasure.removeObject("tenants/tenant-b/cv.md")).rejects.toBeInstanceOf(
      StorageSecurityError,
    );
  });
});
