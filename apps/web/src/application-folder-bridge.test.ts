import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";

const workspaceId = "owner";
const folder = {
  id: "fld_fintech0001",
  name: "Fintech",
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
  applicationCount: 1,
};
const moved: ApiSchemas["Application"] = {
  id: "app-ledger",
  name: "Example Ledger platform engineer",
  nameChosen: true,
  status: "drafting",
  isDefault: false,
  jobMissing: false,
  archivedAt: null,
  folderId: folder.id,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  briefs: [],
  runs: [],
  chosenRunId: null,
  jobSourceKind: "pasted-text",
  suggestedName: null,
  exportCount: 0,
  modelProfiles: null,
  language: null,
};

function portOver(handlers: Readonly<Record<string, (input: Record<string, unknown>) => unknown>>) {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      calls.push({ operation, input: input as Record<string, unknown> });
      const handler = handlers[operation];
      if (handler === undefined) throw new Error(`unexpected call: ${operation}`);
      return (await handler(input as Record<string, unknown>)) as never;
    },
  };
  return { port: createCapabilityPort(createHttpBridge({ client })), calls };
}

describe("application folders over HTTP", () => {
  it("lists, creates, renames and deletes folders, and moves an application", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}/application-folders": () => ({ folders: [folder] }),
      "POST /v1/workspaces/{workspaceId}/application-folders": () => folder,
      "PATCH /v1/workspaces/{workspaceId}/application-folders/{folderId}": () => ({
        ...folder,
        name: "Banks",
      }),
      "DELETE /v1/workspaces/{workspaceId}/application-folders/{folderId}": () => ({
        folderId: folder.id,
        movedApplications: 1,
      }),
      "PATCH /v1/workspaces/{workspaceId}/applications/{applicationId}": () => moved,
    });
    expect(port.hasCapability("application-folder.list")).toBe(true);
    expect(await port.execute({ type: "application-folder.list", input: { workspaceId } })).toEqual(
      { ok: true, value: { workspaceId, folders: [folder] } },
    );
    expect(
      await port.execute({
        type: "application-folder.create",
        input: { workspaceId, name: "Fintech" },
      }),
    ).toEqual({ ok: true, value: { workspaceId, folder } });
    const renamed = await port.execute({
      type: "application-folder.rename",
      input: { workspaceId, folderId: folder.id, name: "Banks" },
    });
    expect(renamed.ok && renamed.value.folder.name).toBe("Banks");
    expect(
      await port.execute({
        type: "application-folder.delete",
        input: { workspaceId, folderId: folder.id },
      }),
    ).toEqual({ ok: true, value: { workspaceId, folderId: folder.id, movedApplications: 1 } });
    const move = await port.execute({
      type: "application.move",
      input: { workspaceId, applicationId: "app-ledger", folderId: folder.id },
    });
    expect(move.ok && move.value.application.folderId).toBe(folder.id);
    expect(calls.at(-1)?.input).toEqual({
      path: { workspaceId, applicationId: "app-ledger" },
      body: { folderId: folder.id },
    });
  });
});
