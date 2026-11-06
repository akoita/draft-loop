import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { type ApplicationService, createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";

const silent = { write: () => undefined };

type Folders = Required<
  Pick<
    ApplicationService,
    | "listApplicationFolders"
    | "createApplicationFolder"
    | "renameApplicationFolder"
    | "deleteApplicationFolder"
    | "moveApplication"
    | "archiveApplication"
  >
>;

describe("application folders", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function workspace(): Promise<{ root: string; service: ApplicationService & Folders }> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-folders-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "# Synthetic Platform Engineer\n\nBuild tools.\n");
    await writeFile(join(root, "evidence", "resume.md"), "Built synthetic TypeScript tools.\n");
    const service = createApplicationService(createLocalApplicationDriver()) as ApplicationService &
      Folders;
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    return { root, service };
  }

  it("creates, renames, places and deletes folders without touching applications", async () => {
    const { root, service } = await workspace();
    const created = await service.createApplication({
      root,
      name: "Northwind Bank, Platform Engineer",
      jobSource: { kind: "pasted-text", text: "Synthetic job." },
    });
    expect(created.folderId).toBeNull();

    const folder = await service.createApplicationFolder({ root, name: "  Fintech   roles " });
    expect(folder).toMatchObject({ name: "Fintech roles", applicationCount: 0 });
    expect(folder.id).toMatch(/^fld_[a-f0-9]{32}$/u);
    await expect(service.createApplicationFolder({ root, name: "fintech ROLES" })).rejects.toThrow(
      new CliUserError("A folder with this name already exists."),
    );

    const moved = await service.moveApplication({
      root,
      applicationId: created.id,
      folderId: folder.id,
    });
    expect(moved.folderId).toBe(folder.id);
    await service.moveApplication({ root, applicationId: "default", folderId: folder.id });
    // Archiving keeps the folder, so restoring puts the application back where it was.
    const archived = await service.archiveApplication({
      root,
      applicationId: created.id,
      archived: true,
    });
    expect(archived.folderId).toBe(folder.id);
    expect(await service.listApplicationFolders({ root })).toMatchObject([
      { id: folder.id, applicationCount: 2 },
    ]);

    const renamed = await service.renameApplicationFolder({
      root,
      folderId: folder.id,
      name: "Payments",
    });
    expect(renamed.name).toBe("Payments");

    expect(await service.deleteApplicationFolder({ root, folderId: folder.id })).toEqual({
      folderId: folder.id,
      movedApplications: 2,
    });
    expect(await service.listApplicationFolders({ root })).toEqual([]);
    const applications = await service.listApplications({ root });
    expect(applications.map((application) => application.folderId)).toEqual([null, null]);
    expect(applications).toHaveLength(2);
  });

  it("refuses an unknown folder or application with a message", async () => {
    const { root, service } = await workspace();
    await expect(
      service.moveApplication({ root, applicationId: "default", folderId: "fld_missing01" }),
    ).rejects.toThrow("Folder fld_missing01 was not found.");
    await expect(
      service.moveApplication({ root, applicationId: "app-missing", folderId: null }),
    ).rejects.toThrow("Application app-missing was not found.");
    await expect(
      service.renameApplicationFolder({ root, folderId: "fld_missing01", name: "Any" }),
    ).rejects.toBeInstanceOf(CliUserError);
    await expect(service.createApplicationFolder({ root, name: "   " })).rejects.toBeInstanceOf(
      CliUserError,
    );
  });
});
