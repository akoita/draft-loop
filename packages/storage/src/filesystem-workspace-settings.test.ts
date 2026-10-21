import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeWorkspaceSettingsConformance } from "./conformance/workspace-settings.js";
import { filesystemWorkspaceSettings } from "./filesystem-workspace-settings.js";

describeWorkspaceSettingsConformance("Filesystem", async () => {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-settings-"));
  return {
    storage: {
      settings: filesystemWorkspaceSettings,
      workspaces: [join(directory, "first"), join(directory, "second")],
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
});

describe("filesystem workspace settings", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draft-loop-settings-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps each document as a file under .draft-loop, with no temporary file left", async () => {
    await filesystemWorkspaceSettings.write(root, "evidence-mode.json", "first\n");
    await filesystemWorkspaceSettings.write(root, "evidence-mode.json", "second\n");

    await expect(readFile(join(root, ".draft-loop", "evidence-mode.json"), "utf8")).resolves.toBe(
      "second\n",
    );
    expect(await readdir(join(root, ".draft-loop"))).toEqual(["evidence-mode.json"]);
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
