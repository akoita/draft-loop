import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { WorkspaceSettingName, WorkspaceSettingsPort } from "./ports/workspace-settings.js";

const settingsDirectory = ".draft-loop";

function settingPath(workspace: string, name: WorkspaceSettingName): string {
  return join(resolve(workspace), settingsDirectory, name);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** The local driver's settings: one file per document under `<root>/.draft-loop/`, renamed into place. */
export const filesystemWorkspaceSettings: WorkspaceSettingsPort = {
  read: async (workspace, name) => {
    try {
      return await readFile(settingPath(workspace, name), "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  },
  write: async (workspace, name, content) => {
    const target = settingPath(workspace, name);
    await mkdir(join(resolve(workspace), settingsDirectory), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, "utf8");
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  remove: async (workspace, name) => {
    const target = settingPath(workspace, name);
    try {
      await readFile(target);
    } catch (error) {
      if (isMissing(error)) return false;
    }
    await rm(target, { force: true });
    return true;
  },
};
