import type { ApplicationIo, ConfigureRunBudgetCommand } from "./index.js";
import type { WorkspaceConfig } from "./local.js";
import type { WorkspaceAutopilotDependencies } from "./workspace-autopilot.js";

/**
 * Replace the run budget an existing workspace gives its next runs (#1993). A limit the command
 * leaves out is removed, so the run falls back to the deployment's ceiling; recorded runs keep the
 * budget they ran with. The API checks the new budget against the ceiling before calling this.
 */
export async function configureWorkspaceRunBudget(
  root: string,
  command: ConfigureRunBudgetCommand,
  dependencies: WorkspaceAutopilotDependencies,
  io: ApplicationIo = { write: () => undefined },
): Promise<WorkspaceConfig> {
  const {
    maxRounds: _rounds,
    maxCostUsd: _cost,
    maxDurationMs: _duration,
    ...config
  } = await dependencies.readWorkspace(root);
  const next: WorkspaceConfig = {
    ...config,
    maxRounds: command.maxRounds,
    ...(command.maxCostUsd === undefined ? {} : { maxCostUsd: command.maxCostUsd }),
    ...(command.maxDurationMs === undefined ? {} : { maxDurationMs: command.maxDurationMs }),
  };
  await dependencies.saveWorkspaceConfig(root, next);
  io.write(`Run budget set for workspace ${next.id}: ${describeBudget(next)}`);
  return next;
}

function describeBudget(config: WorkspaceConfig): string {
  return [
    `${config.maxRounds} rounds`,
    config.maxCostUsd === undefined ? "cost at the deployment's limit" : `US$${config.maxCostUsd}`,
    config.maxDurationMs === undefined
      ? "duration at the deployment's limit"
      : `${config.maxDurationMs} ms`,
  ].join(", ");
}
