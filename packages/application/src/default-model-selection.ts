import type { ApplicationService } from "./index.js";
import { getModelProfilePreset } from "./model-profile-catalog.js";
import { defaultModelProfileRegistry, type ModelProfileRegistry } from "./model-profiles.js";
import { saveWorkspaceModelProfileSelection } from "./workspace-model-profile-selection.js";

/**
 * The pair a new workspace gets when no model is chosen: the economy preset. The built-in
 * workspace defaults in `local.ts` and the `init` option defaults spell the same ids out, and a
 * test keeps them equal to this preset so the three cannot drift apart.
 */
const defaultPresetId = "economy";

export interface DefaultModelPair {
  readonly author: { readonly company: string; readonly model: string };
  readonly critic: { readonly company: string; readonly model: string };
}

/** The author and critic company and model of the economy preset, read from the profile registry. */
export function economyDefaultModelPair(
  registry: ModelProfileRegistry = defaultModelProfileRegistry,
): DefaultModelPair {
  const preset = getModelProfilePreset(defaultPresetId);
  const author = registry.resolve(preset.author.id, preset.author.version, "author");
  const critic = registry.resolve(preset.critic.id, preset.critic.version, "critic");
  return {
    author: { company: author.provider, model: author.modelId },
    critic: { company: critic.provider, model: critic.modelId },
  };
}

/**
 * Applies the economy preset's exact profiles to a workspace that was just created with the
 * economy pair, as if Economy had been chosen in the picker. A workspace whose models differ
 * (an explicit choice) is left without a selection.
 */
export async function applyEconomySelectionToNewWorkspace(
  root: string,
  configured: DefaultModelPair,
  registry: ModelProfileRegistry = defaultModelProfileRegistry,
): Promise<boolean> {
  const economy = economyDefaultModelPair(registry);
  for (const role of ["author", "critic"] as const) {
    if (
      configured[role].company !== economy[role].company ||
      configured[role].model !== economy[role].model
    ) {
      return false;
    }
  }
  const preset = getModelProfilePreset(defaultPresetId);
  await saveWorkspaceModelProfileSelection(
    root,
    { author: preset.author, critic: preset.critic },
    { registry },
  );
  return true;
}

/** Makes `initialize` record the economy selection whenever the new workspace has the economy pair. */
export function withEconomyDefaultSelection<Service extends ApplicationService>(
  service: Service,
  options: { readonly registry?: ModelProfileRegistry } = {},
): Service {
  return {
    ...service,
    initialize: async (command, io) => {
      const descriptor = await service.initialize(command, io);
      await applyEconomySelectionToNewWorkspace(descriptor.root, descriptor, options.registry);
      return descriptor;
    },
  };
}
