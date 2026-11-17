import {
  initialSetupPresetId,
  presetsWithinTiers,
  type WorkspaceSetupPreset,
  workspaceSetupPresets,
} from "@draft-loop/ui/workspace-setup";

import { routablePresets } from "./workspace-model.js";

interface CatalogModel {
  readonly company: string;
  readonly model: string;
  readonly tier: string;
}

interface ModelSide {
  readonly company: string;
  readonly model: string;
}

/** What the start dialog offers when the workspace's pair is outside the plan (#2864). */
export interface PlanPresetChoice {
  /** The presets whose two models the service routes and the plan's tiers allow, best first. */
  readonly presets: readonly WorkspaceSetupPreset[];
  /** The preset the dialog selects first. */
  readonly initialId: string;
}

/** The tiers the catalog lists a model under; one model can have profiles in several. */
function tiersOf(side: ModelSide, catalog: readonly CatalogModel[]): readonly string[] {
  return catalog
    .filter(({ company, model }) => company === side.company && model === side.model)
    .map(({ tier }) => tier);
}

/**
 * The choice to offer, or undefined when the pair is within the plan or the plan's tiers are
 * unknown (owner-token mode, or a plan that names none). A model the catalog does not list counts
 * as outside the plan; a model listed under several tiers counts as inside when one is allowed,
 * and the run's own gate stays the final word.
 */
export function planPresetChoice(
  pair: { readonly author: ModelSide; readonly critic: ModelSide },
  catalog: readonly CatalogModel[],
  planTiers: readonly string[] | undefined,
): PlanPresetChoice | undefined {
  if (planTiers === undefined) return undefined;
  const allowed = (side: ModelSide) =>
    tiersOf(side, catalog).some((tier) => planTiers.includes(tier));
  if (allowed(pair.author) && allowed(pair.critic)) return undefined;
  const presets = presetsWithinTiers(routablePresets(workspaceSetupPresets(), catalog), planTiers);
  if (presets.length === 0) return undefined;
  return { presets, initialId: initialSetupPresetId(presets) };
}
