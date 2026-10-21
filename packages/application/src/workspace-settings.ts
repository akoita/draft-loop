import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * A workspace's settings: its configuration, the managed writing policy, and the small documents
 * that record its modes, model pair, consent and decisions. The application reads and writes them
 * through this port so the hosted driver can keep them in Postgres (ADR 0011, D3) while the local
 * driver keeps today's files under `<root>/.draft-loop/`.
 *
 * History, managed candidate files and embedding models are not settings; they have their own
 * ports or stay local.
 */
export const workspaceSettingNames = [
  "workspace.json",
  "writing-policy.md",
  "evidence-mode.json",
  "retrieval-mode.json",
  "model-profile-selection.json",
  "sensitive-knowledge-consent.json",
  "legacy-evidence-migration.json",
] as const;

export type WorkspaceSettingName = (typeof workspaceSettingNames)[number];

export interface WorkspaceSettingsPort {
  /** The document's text, or `undefined` when it was never written; other failures throw. */
  readonly read: (workspace: string, name: WorkspaceSettingName) => Promise<string | undefined>;
  /** Replaces the whole document; a reader sees the old text or the new text, never a mix. */
  readonly write: (workspace: string, name: WorkspaceSettingName, content: string) => Promise<void>;
  /** Removes the document; resolves to whether it existed. */
  readonly remove: (workspace: string, name: WorkspaceSettingName) => Promise<boolean>;
}

const settingsDirectory = ".draft-loop";

function settingPath(workspace: string, name: WorkspaceSettingName): string {
  return join(resolve(workspace), settingsDirectory, name);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** The local driver's settings: one file per document, written atomically by rename. */
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

const activeSettings = new AsyncLocalStorage<WorkspaceSettingsPort>();

/**
 * The settings port of the driver call in progress. A driver that keeps settings elsewhere wraps
 * each of its calls in `withWorkspaceSettings`, which reaches every module the call goes through
 * without threading the port through each of them; outside such a call it is the filesystem.
 */
export function workspaceSettings(): WorkspaceSettingsPort {
  return activeSettings.getStore() ?? filesystemWorkspaceSettings;
}

export function withWorkspaceSettings<Result>(
  settings: WorkspaceSettingsPort,
  action: () => Promise<Result>,
): Promise<Result> {
  return activeSettings.run(settings, action);
}
