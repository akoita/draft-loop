import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import { describe, expect, it } from "vitest";
import {
  hostedApplicationPorts,
  hostedKnowledgeStoreReference,
  hostedWorkspaceReference,
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
});
