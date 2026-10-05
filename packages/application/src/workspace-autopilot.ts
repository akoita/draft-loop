import type { ApplicationIo, ConfigureAutopilotCommand } from "./index.js";
import type { WorkspaceConfig } from "./local.js";

export interface WorkspaceAutopilotDependencies {
  readonly readWorkspace: (root: string) => Promise<WorkspaceConfig>;
  readonly saveWorkspaceConfig: (root: string, config: WorkspaceConfig) => Promise<void>;
}

/** Turn unattended revision on or off for this workspace's next run actions. */
export async function configureWorkspaceAutopilot(
  root: string,
  command: ConfigureAutopilotCommand,
  dependencies: WorkspaceAutopilotDependencies,
  io: ApplicationIo = { write: () => undefined },
): Promise<WorkspaceConfig> {
  const { autopilot: _autopilot, ...config } = await dependencies.readWorkspace(root);
  const next = command.enabled ? { ...config, autopilot: true as const } : config;
  await dependencies.saveWorkspaceConfig(root, next);
  io.write(`Autopilot ${command.enabled ? "on" : "off"} for workspace ${next.id}`);
  return next;
}
