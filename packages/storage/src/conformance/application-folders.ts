import { expect } from "vitest";
import { StorageConflictError, StorageValidationError } from "../storage-errors.js";
import type { ApplicationsStorage } from "./applications.js";
import type { StorageContract } from "./history-records.js";

const workspaceId = "workspace-folders";
const createdAt = "2030-01-01T00:00:00.000Z";
const jobSource = { kind: "local-file", path: "/synthetic/jobs/northwind.md" } as const;

async function seed(storage: ApplicationsStorage): Promise<void> {
  await storage.saveWorkspace({
    id: workspaceId,
    state: "collecting",
    createdAt,
    updatedAt: createdAt,
  });
  for (const id of ["app-a", "app-b"]) {
    await storage.applications.insertApplication({
      workspaceId,
      id,
      name: `Fictional ${id}`,
      jobSource,
      createdAt,
    });
  }
}

/** Folder contracts (#2281), run beside the application contracts on every store. */
export const applicationFolderContracts: readonly StorageContract<ApplicationsStorage>[] = [
  {
    name: "application folders: creates, lists oldest first, renames and refuses a taken name",
    check: async (storage) => {
      await seed(storage);
      const { applications } = storage;
      const second = await applications.createFolder({
        workspaceId,
        id: "fld_second01",
        name: "  Long   shots ",
        createdAt: "2030-01-02T00:00:00.000Z",
      });
      expect(second).toMatchObject({ id: "fld_second01", name: "Long shots" });
      await applications.createFolder({
        workspaceId,
        id: "fld_first001",
        name: "Fintech roles",
        createdAt,
      });
      expect((await applications.listFolders(workspaceId)).map((folder) => folder.id)).toEqual([
        "fld_first001",
        "fld_second01",
      ]);

      await expect(
        applications.createFolder({
          workspaceId,
          id: "fld_third001",
          name: "FINTECH roles",
          createdAt,
        }),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(
        applications.createFolder({ workspaceId, id: "bad", name: "Other", createdAt }),
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        applications.createFolder({ workspaceId, id: "fld_third001", name: " ", createdAt }),
      ).rejects.toBeInstanceOf(StorageValidationError);

      const renamed = await applications.renameFolder(
        workspaceId,
        "fld_second01",
        "Freelance missions",
        "2030-01-03T00:00:00.000Z",
      );
      expect(renamed).toMatchObject({
        name: "Freelance missions",
        createdAt: "2030-01-02T00:00:00.000Z",
        updatedAt: "2030-01-03T00:00:00.000Z",
      });
      // Its own name in another case is not a collision with itself.
      await applications.renameFolder(workspaceId, "fld_second01", "freelance missions", createdAt);
      await expect(
        applications.renameFolder(workspaceId, "fld_second01", "Fintech Roles", createdAt),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(
        applications.renameFolder(workspaceId, "fld_missing1", "Any", createdAt),
      ).rejects.toBeInstanceOf(StorageValidationError);
      expect(await applications.listFolders("workspace-other")).toEqual([]);
    },
  },
  {
    name: "application folders: places, moves and clears applications, the default one too",
    check: async (storage) => {
      await seed(storage);
      const { applications } = storage;
      await applications.createFolder({ workspaceId, id: "fld_first001", name: "One", createdAt });
      await applications.createFolder({ workspaceId, id: "fld_second01", name: "Two", createdAt });

      await applications.setApplicationFolder(workspaceId, "app-a", "fld_first001", createdAt);
      await applications.setApplicationFolder(workspaceId, "default", "fld_first001", createdAt);
      await applications.setApplicationFolder(workspaceId, "app-a", "fld_second01", createdAt);
      await applications.setApplicationFolder(workspaceId, "app-b", null, createdAt);
      expect(Object.fromEntries(await applications.listFolderPlacements(workspaceId))).toEqual({
        "app-a": "fld_second01",
        default: "fld_first001",
      });

      await expect(
        applications.setApplicationFolder(workspaceId, "app-b", "fld_missing1", createdAt),
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        applications.setApplicationFolder(workspaceId, "app-missing", "fld_first001", createdAt),
      ).rejects.toBeInstanceOf(StorageValidationError);

      await applications.setApplicationFolder(workspaceId, "default", null, createdAt);
      expect(Object.fromEntries(await applications.listFolderPlacements(workspaceId))).toEqual({
        "app-a": "fld_second01",
      });
    },
  },
  {
    name: "application folders: deleting a folder moves its applications out and keeps them",
    check: async (storage) => {
      await seed(storage);
      const { applications } = storage;
      await applications.createFolder({ workspaceId, id: "fld_first001", name: "One", createdAt });
      await applications.setApplicationFolder(workspaceId, "app-a", "fld_first001", createdAt);
      await applications.setApplicationFolder(workspaceId, "app-b", "fld_first001", createdAt);

      expect(await applications.deleteFolder(workspaceId, "fld_first001")).toEqual({
        movedApplications: 2,
      });
      expect(await applications.listFolders(workspaceId)).toEqual([]);
      expect((await applications.listFolderPlacements(workspaceId)).size).toBe(0);
      expect((await applications.listApplications(workspaceId)).map((app) => app.id)).toEqual([
        "app-a",
        "app-b",
      ]);
      await expect(applications.deleteFolder(workspaceId, "fld_first001")).rejects.toBeInstanceOf(
        StorageValidationError,
      );

      // The name is free again, and deleting an application drops its placement.
      await applications.createFolder({ workspaceId, id: "fld_again001", name: "one", createdAt });
      await applications.setApplicationFolder(workspaceId, "app-b", "fld_again001", createdAt);
      await applications.deleteApplication(workspaceId, "app-b");
      expect((await applications.listFolderPlacements(workspaceId)).size).toBe(0);
    },
  },
];
