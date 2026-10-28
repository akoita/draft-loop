import { resolve } from "node:path";
import type { ModelProfileEffort } from "@draft-loop/domain/model-profile";

import type { StatusCommand } from "./index.js";
import { readWorkspace } from "./local.js";
import { storageFactory } from "./local-storage-factory.js";
import { readRunContext } from "./run-context-read.js";

/** One role's model as a run was configured with it. */
export interface RunModelIdentity {
  readonly company: string;
  readonly modelId: string;
  /** The reasoning level the run used, when it ran with a model profile. */
  readonly effort?: ModelProfileEffort;
}

/** The author and critic models a run was configured with, read from its context snapshot. */
export interface RunModels {
  readonly author: RunModelIdentity;
  readonly critic: RunModelIdentity;
}

/**
 * The models of the given run, or of the workspace's latest run. Resolves to `undefined` when
 * there is no run, no history, or no recorded context, so a run list can leave the models blank.
 */
export async function readRunModels(command: StatusCommand): Promise<RunModels | undefined> {
  const root = resolve(command.root);
  const factory = storageFactory();
  if (factory.hasHistory !== undefined && !(await factory.hasHistory(root))) return undefined;
  const context = await readRunContext(root, command.runId, {
    readWorkspace,
    openStorage: factory.open,
  });
  if (context === undefined) return undefined;
  const { author, critic } = context.modelConfiguration;
  const identity = (side: typeof author): RunModelIdentity => {
    const effort = side.profile?.runtime.effort;
    const model = { company: side.company, modelId: side.modelId };
    return effort === undefined ? model : { ...model, effort };
  };
  return { author: identity(author), critic: identity(critic) };
}
