import type { ModelProfileReferences, StartRunCommand } from "./index.js";
import { listModelProfilePresets } from "./model-profile-catalog.js";
import { defaultModelProfileRegistry, type ModelProfileRegistry } from "./model-profiles.js";
import {
  type ConfiguredModelPair,
  describeModelProfileSelectionMismatch,
} from "./workspace-model-profile-selection.js";

/**
 * The profile pair a hosted run uses when nothing names one: the first preset, Economy first,
 * whose author and critic are the workspace's own models. Undefined when no preset matches.
 *
 * A hosted workspace keeps only its model ids, so a run that named no profiles reached the
 * provider without one: no thinking effort and the adapter's 4,096-token default output budget,
 * which the Economy writer spends on thinking before it answers (max_tokens on every attempt).
 */
export function presetProfileReferencesFor(
  configured: ConfiguredModelPair,
  registry: ModelProfileRegistry = defaultModelProfileRegistry,
): ModelProfileReferences | undefined {
  for (const preset of listModelProfilePresets()) {
    const references = { author: preset.author, critic: preset.critic };
    if (describeModelProfileSelectionMismatch(configured, references, registry) === undefined) {
      return references;
    }
  }
  return undefined;
}

/**
 * Gives a new hosted run that names no profiles the preset matching its workspace's models. A run
 * that names its own profiles, or whose application has its own pair, keeps that choice.
 */
export async function withPresetModelProfiles<Command extends StartRunCommand>(
  command: Command,
  readWorkspace: (root: string) => Promise<ConfiguredModelPair>,
  registry: ModelProfileRegistry = defaultModelProfileRegistry,
): Promise<Command> {
  if (command.modelProfiles !== undefined) return command;
  const references = presetProfileReferencesFor(await readWorkspace(command.root), registry);
  return references === undefined ? command : { ...command, modelProfiles: references };
}
