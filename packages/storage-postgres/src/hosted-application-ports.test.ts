import type { BlobReference, BlobStoragePort } from "@draft-loop/storage";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import { describe, expect, it } from "vitest";
import {
  hostedApplicationPorts,
  hostedKnowledgeStoreReference,
  hostedWorkspaceReference,
  workspaceReferenceBlobs,
} from "./hosted-application-ports.js";
import type { PostgresStorage } from "./postgres-storage.js";

describe("hosted application ports", () => {
  it("builds absolute references and refuses unsafe ids", () => {
    expect(hostedWorkspaceReference("tenant-a", "workspace-1")).toBe(
      "/tenants/tenant-a/workspaces/workspace-1",
    );
    expect(hostedKnowledgeStoreReference("tenant-a", "store-1")).toBe(
      "/tenants/tenant-a/knowledge-stores/store-1",
    );
    expect(() => hostedWorkspaceReference("tenant-a", "../tenant-b")).toThrow(
      StorageValidationError,
    );
  });

  it("opens no knowledge store outside the tenant", async () => {
    const ports = hostedApplicationPorts({
      // Never reached: every reference below is refused first.
      storage: {} as PostgresStorage,
      tenantId: "tenant-a",
      blobs: createFilesystemBlobStorage(),
    });

    await expect(
      ports.openKnowledgeStore(hostedKnowledgeStoreReference("tenant-b", "store-1")),
    ).rejects.toBeInstanceOf(StorageSecurityError);
    await expect(
      ports.openKnowledgeStore("/tenants/tenant-a/knowledge-stores/a/b"),
    ).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("stores an export at its workspace path, keyed under the tenant's blob prefix", async () => {
    const seen: string[] = [];
    const reference = (location: string): BlobReference => ({
      location,
      checksum: "c".repeat(64),
      sizeBytes: 3,
    });
    const blobs: BlobStoragePort = {
      put: async (location) => {
        seen.push(location);
        return reference(location);
      },
      get: async (stored) => {
        seen.push(stored.location);
        return new Uint8Array([1, 2, 3]);
      },
      exists: async () => true,
      delete: async () => true,
    };
    const exports = workspaceReferenceBlobs(blobs);
    const path = "/tenants/tenant-a/workspaces/workspace-1/exports/run-1/doc.docx";

    const stored = await exports.put(path, new Uint8Array([1, 2, 3]));
    await exports.get(stored);

    expect(stored.location).toBe(path);
    expect(seen).toEqual([path.slice(1), path.slice(1)]);
    await expect(exports.put("relative/doc.docx", new Uint8Array())).rejects.toBeInstanceOf(
      StorageSecurityError,
    );
  });
});
