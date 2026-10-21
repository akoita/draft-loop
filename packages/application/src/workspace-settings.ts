import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkspaceSettingsPort } from "@draft-loop/storage";
import { filesystemWorkspaceSettings } from "@draft-loop/storage/workspace-settings";

export {
  type WorkspaceSettingName,
  type WorkspaceSettingsPort,
  workspaceSettingNames,
} from "@draft-loop/storage";
export { filesystemWorkspaceSettings };

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
