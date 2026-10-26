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
}

/** What the person chose on the first-run setup screen. */
export interface WorkspaceSetupChoice {
  readonly language: string;
  readonly maxRounds: number;
  readonly preset: WorkspaceSetupPreset;
  readonly fixtureMode: boolean;
}

export const workspaceSetupLanguages: readonly { readonly code: string; readonly label: string }[] =
  [
    { code: "en", label: "English" },
    { code: "fr", label: "French" },
    { code: "de", label: "German" },
    { code: "es", label: "Spanish" },
    { code: "it", label: "Italian" },
    { code: "nl", label: "Dutch" },
    { code: "pt", label: "Portuguese" },
  ];

export const workspaceSetupRoundLimits = [1, 2, 3, 4, 5] as const;
export const defaultWorkspaceSetupRounds = 2;
export const defaultWorkspaceSetupPresetId = "balanced";

/** The presets a new workspace can start from, with their models; development presets stay out. */
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
    return [
      {
        id: preset.id,
        label: presetDisplayName(preset.label),
        author: { company: author.provider, model: author.modelId },
        critic: { company: critic.provider, model: critic.modelId },
      },
    ];
  });
}
