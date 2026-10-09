import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApplicationService, createLocalApplicationDriver } from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "../application-contract.js";
import { createNativeHost } from "./host.js";

let parent: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-archive-host-"));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function openHost() {
  const host = createNativeHost({
    applicationService: createApplicationService(createLocalApplicationDriver({})),
    dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
  });
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "target", mode: "real" },
  });
  if (!created.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(created)}`);
  const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
  return { host, workspaceId };
}

async function listed(host: Awaited<ReturnType<typeof openHost>>["host"], workspaceId: string) {
  const result = await host.invoke({ type: "application.list", input: { workspaceId } });
  if (!result.ok) throw new Error("Expected a list");
  return (result.value as { applications: ApplicationSummaryView[] }).applications.map(
    (item) => [item.id, item.archivedAt === null ? "active" : "archived"] as const,
  );
}

describe("application.archive and application.delete in the native host", () => {
  it("archives, restores and deletes an application", async () => {
    const { host, workspaceId } = await openHost();
    const created = await host.invoke({
      type: "application.create",
      input: { workspaceId, name: "HCcompany", jobText: "Build tools." },
    });
    if (!created.ok) throw new Error("Expected an application");
    const { id } = (created.value as { application: ApplicationSummaryView }).application;

    const archived = await host.invoke({
      type: "application.archive",
      input: { workspaceId, applicationId: id, archived: true },
    });
    await host.invoke({
      type: "application.archive",
      input: { workspaceId, applicationId: "default", archived: true },
    });
    expect(archived).toMatchObject({
      ok: true,
      value: { workspaceId, application: { id, archivedAt: expect.any(String) } },
    });
    expect(await listed(host, workspaceId)).toEqual([
      ["default", "archived"],
      [id, "archived"],
    ]);

    await host.invoke({
      type: "application.archive",
      input: { workspaceId, applicationId: "default", archived: false },
    });
    await expect(
      host.invoke({ type: "application.delete", input: { workspaceId, applicationId: id } }),
    ).resolves.toEqual({ ok: true, value: { workspaceId, applicationId: id, deleted: true } });
    expect(await listed(host, workspaceId)).toEqual([["default", "active"]]);
  });

  it("says why the default application cannot be deleted", async () => {
    const { host, workspaceId } = await openHost();
    await expect(
      host.invoke({
        type: "application.delete",
        input: { workspaceId, applicationId: "default" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: "The default application is the workspace's own job. Archive it instead." },
    });
  });
});
