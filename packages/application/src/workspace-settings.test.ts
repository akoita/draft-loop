import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "draft-loop-settings-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("filesystem workspace settings", () => {
  it("reads a document that was never written as undefined", async () => {
    await expect(filesystemWorkspaceSettings.read(root, "workspace.json")).resolves.toBeUndefined();
  });

  it("writes under .draft-loop and replaces the whole document", async () => {
    await filesystemWorkspaceSettings.write(root, "evidence-mode.json", "first\n");
    await filesystemWorkspaceSettings.write(root, "evidence-mode.json", "second\n");

    await expect(readFile(join(root, ".draft-loop", "evidence-mode.json"), "utf8")).resolves.toBe(
      "second\n",
    );
    await expect(filesystemWorkspaceSettings.read(root, "evidence-mode.json")).resolves.toBe(
      "second\n",
    );
    expect(await readdir(join(root, ".draft-loop"))).toEqual(["evidence-mode.json"]);
  });

  it("removes a document and says whether it existed", async () => {
    await filesystemWorkspaceSettings.write(root, "model-profile-selection.json", "{}\n");

    await expect(
      filesystemWorkspaceSettings.remove(root, "model-profile-selection.json"),
    ).resolves.toBe(true);
    await expect(
      filesystemWorkspaceSettings.remove(root, "model-profile-selection.json"),
    ).resolves.toBe(false);
    await expect(
      filesystemWorkspaceSettings.read(root, "model-profile-selection.json"),
    ).resolves.toBeUndefined();
  });

  it("throws on a failure other than a missing document", async () => {
    await filesystemWorkspaceSettings.write(root, "workspace.json", "{}\n");

    await expect(
      filesystemWorkspaceSettings.read(
        join(root, ".draft-loop", "workspace.json"),
        "workspace.json",
      ),
    ).rejects.toThrow();
  });
});

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
