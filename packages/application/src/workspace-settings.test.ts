import { describe, expect, it } from "vitest";

import {
  readWorkspaceEvidenceMode,
  writeWorkspaceEvidenceMode,
} from "./workspace-evidence-mode.js";
import {
  filesystemWorkspaceSettings,
  type WorkspaceSettingName,
  type WorkspaceSettingsPort,
  withWorkspaceSettings,
  workspaceSettings,
} from "./workspace-settings.js";

function memorySettings(): WorkspaceSettingsPort & {
  readonly documents: Map<string, string>;
} {
  const documents = new Map<string, string>();
  const key = (workspace: string, name: WorkspaceSettingName) => `${workspace}#${name}`;
  return {
    documents,
    read: async (workspace, name) => documents.get(key(workspace, name)),
    write: async (workspace, name, content) => {
      documents.set(key(workspace, name), content);
    },
    remove: async (workspace, name) => documents.delete(key(workspace, name)),
  };
}

describe("workspaceSettings", () => {
  it("is the filesystem outside a driver call", () => {
    expect(workspaceSettings()).toBe(filesystemWorkspaceSettings);
  });

  it("reaches every module a wrapped call goes through, across awaits", async () => {
    const settings = memorySettings();

    const mode = await withWorkspaceSettings(settings, async () => {
      await writeWorkspaceEvidenceMode(
        "/tenants/t1/workspaces/w1",
        "retrieval",
        () => new Date("2026-10-21T00:00:00.000Z"),
      );
      await new Promise((resolve) => setTimeout(resolve, 1));
      return readWorkspaceEvidenceMode("/tenants/t1/workspaces/w1");
    });

    expect(mode).toEqual({ mode: "retrieval", updatedAt: "2026-10-21T00:00:00.000Z" });
    expect([...settings.documents.keys()]).toEqual([
      "/tenants/t1/workspaces/w1#evidence-mode.json",
    ]);
    expect(workspaceSettings()).toBe(filesystemWorkspaceSettings);
  });

  it("keeps concurrent calls apart", async () => {
    const first = memorySettings();
    const second = memorySettings();
    await first.write("w", "evidence-mode.json", "not json");

    const [failed, defaulted] = await Promise.allSettled([
      withWorkspaceSettings(first, () => readWorkspaceEvidenceMode("w")),
      withWorkspaceSettings(second, () => readWorkspaceEvidenceMode("w")),
    ]);

    expect(failed.status).toBe("rejected");
    expect(defaulted).toEqual({ status: "fulfilled", value: { mode: "full-source" } });
  });
});
