import type { ApplicationService, ApplicationView } from "@draft-loop/application";
import { CliUserError } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-11-06T00:00:00.000Z";
const root = "/tenants/owner/workspaces/workspace-1";
const folders = "/v1/workspaces/workspace-1/application-folders";
const applications = "/v1/workspaces/workspace-1/applications";
const folderId = "fld_0123456789abcdef";

const folder = {
  id: folderId,
  name: "Fintech",
  createdAt: at,
  updatedAt: at,
  applicationCount: 2,
};

const application = {
  schemaVersion: 1,
  id: "app-platform",
  name: "Example Ledger platform engineer",
  jobSource: { kind: "stored-text", text: "Platform Engineer" },
  createdAt: at,
  updatedAt: at,
  status: "drafting",
  isDefault: false,
  briefs: [],
  runs: [],
  exports: [],
  archivedAt: null,
  folderId: null,
  nameChosen: true,
  suggestedName: null,
  modelProfiles: null,
  chosenRun: null,
} as unknown as ApplicationView;

function scriptedService(methods: Partial<ApplicationService>): ApplicationService {
  return new Proxy(methods, {
    get: (target, name) =>
      (target as Record<string | symbol, unknown>)[name] ??
      (() => {
        throw new Error(`unexpected service call: ${String(name)}`);
      }),
  }) as ApplicationService;
}

let app: FastifyInstance;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: scriptedService(methods),
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("application folders", () => {
  it("lists, creates, renames and deletes folders", async () => {
    const listApplicationFolders = vi.fn(async () => [folder]);
    const createApplicationFolder = vi.fn(async () => ({ ...folder, applicationCount: 0 }));
    const renameApplicationFolder = vi.fn(async () => ({ ...folder, name: "Banks" }));
    const deleteApplicationFolder = vi.fn(async () => ({ folderId, movedApplications: 2 }));
    await build({
      listApplicationFolders,
      createApplicationFolder,
      renameApplicationFolder,
      deleteApplicationFolder,
    });

    const listed = await app.inject({ method: "GET", url: folders, headers: { authorization } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ folders: [folder] });

    const created = await app.inject({
      method: "POST",
      url: folders,
      headers: { authorization },
      payload: { name: "  Fintech  " },
    });
    expect(created.statusCode).toBe(201);
    expect(createApplicationFolder).toHaveBeenCalledWith({ root, name: "Fintech" });

    const renamed = await app.inject({
      method: "PATCH",
      url: `${folders}/${folderId}`,
      headers: { authorization },
      payload: { name: "Banks" },
    });
    expect(renamed.json()).toMatchObject({ name: "Banks" });
    expect(renameApplicationFolder).toHaveBeenCalledWith({ root, folderId, name: "Banks" });

    const deleted = await app.inject({
      method: "DELETE",
      url: `${folders}/${folderId}`,
      headers: { authorization },
    });
    expect(deleted.json()).toEqual({ folderId, movedApplications: 2 });
  });

  it("refuses an empty name, a bad folder id and a taken name", async () => {
    await build({
      createApplicationFolder: async () => {
        throw new CliUserError("A folder with this name already exists.");
      },
    });
    const empty = await app.inject({
      method: "POST",
      url: folders,
      headers: { authorization },
      payload: { name: "   " },
    });
    expect(empty.statusCode).toBe(400);
    const badId = await app.inject({
      method: "DELETE",
      url: `${folders}/not-a-folder`,
      headers: { authorization },
    });
    expect(badId.statusCode).toBe(400);
    const taken = await app.inject({
      method: "POST",
      url: folders,
      headers: { authorization },
      payload: { name: "Fintech" },
    });
    expect(taken.statusCode).toBe(422);
    expect(taken.json()).toEqual({
      error: { code: "rejected", message: "A folder with this name already exists." },
    });
  });

  it("moves an application with PATCH folderId and creates one in a folder", async () => {
    const moveApplication = vi.fn(async () => ({ ...application, folderId }) as ApplicationView);
    const createApplication = vi.fn(async () => application);
    await build({
      getApplication: async () => application,
      moveApplication,
      createApplication,
      listApplicationFolders: async () => [folder],
    });

    const moved = await app.inject({
      method: "PATCH",
      url: `${applications}/app-platform`,
      headers: { authorization },
      payload: { folderId },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ id: "app-platform", folderId });
    expect(moveApplication).toHaveBeenCalledWith({ root, applicationId: "app-platform", folderId });

    const created = await app.inject({
      method: "POST",
      url: applications,
      headers: { authorization },
      payload: { name: "Example Ledger platform engineer", jobText: "Platform", folderId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ folderId });
  });

  it("refuses to create an application in an unknown folder before creating it", async () => {
    const createApplication = vi.fn(async () => application);
    await build({ createApplication, listApplicationFolders: async () => [] });
    const response = await app.inject({
      method: "POST",
      url: applications,
      headers: { authorization },
      payload: { name: "Example Ledger platform engineer", jobText: "Platform", folderId },
    });
    expect(response.statusCode).toBe(422);
    expect(createApplication).not.toHaveBeenCalled();
  });
});
