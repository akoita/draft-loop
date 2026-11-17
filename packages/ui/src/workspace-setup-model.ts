import {
  documentLanguageChoiceLabel,
  documentLanguages,
} from "@draft-loop/domain/document-language";
import { modelProfileCatalog, modelProfilePresets } from "./model-profile-picker-state.js";
import { isDevelopmentPreset, presetDisplayName } from "./model-profile-presentation.js";

/** One model a preset assigns to a role, as the host's workspace records it. */
export interface WorkspaceSetupModel {
  readonly company: string;
  readonly model: string;
}

export interface WorkspaceSetupPreset {
  readonly id: string;
  readonly label: string;
  readonly author: WorkspaceSetupModel;
  readonly critic: WorkspaceSetupModel;
  /** The price tiers of the two models, which a plan's model tiers must both include. */
  readonly tiers?: readonly string[];
}

/** What the person chose on the first-run setup screen. */
export interface WorkspaceSetupChoice {
  readonly language: string;
  readonly maxRounds: number;
  readonly preset: WorkspaceSetupPreset;
  readonly fixtureMode: boolean;
}

/** English and French first; the other languages work but are labelled previews (#2317). */
export const workspaceSetupLanguages: readonly { readonly code: string; readonly label: string }[] =
  documentLanguages.map((language) => ({
    code: language.code,
    label: documentLanguageChoiceLabel(language),
  }));

export const workspaceSetupRoundLimits = [1, 2, 3, 4, 5] as const;
export const defaultWorkspaceSetupRounds = 2;
export const defaultWorkspaceSetupPresetId = "balanced";

/**
 * The presets a new workspace can start from, with their models. Development presets stay out, and
 * so do the presets with another company's author, which need a key a first run does not ask for.
 */
export function workspaceSetupPresets(): readonly WorkspaceSetupPreset[] {
  return modelProfilePresets.flatMap((preset) => {
    if (isDevelopmentPreset(preset)) return [];
    const side = (reference: { readonly id: string; readonly version: number }) =>
      modelProfileCatalog.find(
        ({ profile }) => profile.id === reference.id && profile.version === reference.version,
      )?.profile;
    const author = side(preset.author);
    const critic = side(preset.critic);
    if (author === undefined || critic === undefined) return [];
    if (author.provider !== "anthropic") return [];
    return [
      {
        id: preset.id,
        label: presetDisplayName(preset.label),
        author: { company: author.provider, model: author.modelId },
        critic: { company: critic.provider, model: critic.modelId },
        tiers: [author.tier, critic.tier],
      },
    ];
  });
}

/**
 * The presets a plan's model tiers allow, so a new workspace never starts on a pair its first run
 * refuses (#2864). Without known tiers, every preset stays.
 */
export function presetsWithinTiers(
  presets: readonly WorkspaceSetupPreset[],
  allowed: readonly string[] | undefined,
): readonly WorkspaceSetupPreset[] {
  if (allowed === undefined) return presets;
  return presets.filter(({ tiers }) => (tiers ?? []).every((tier) => allowed.includes(tier)));
}

/** The preset a setup screen selects first: the default when offered, else the first one. */
export function initialSetupPresetId(presets: readonly WorkspaceSetupPreset[]): string {
  return presets.some(({ id }) => id === defaultWorkspaceSetupPresetId)
    ? defaultWorkspaceSetupPresetId
    : (presets[0]?.id ?? "");
}
