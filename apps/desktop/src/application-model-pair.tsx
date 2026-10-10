import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";

import type { ApplicationModelProfilesView } from "./application-contract.js";
import type { ModelProfileSupportResult } from "./bridge.js";
import type { DesktopReviewState, ProviderTransmissionIdentity } from "./model.js";
import { ModelPresetCards } from "./model-preset-cards.js";
import {
  modelProfileEntryForReference,
  modelProfilePresetReferences,
  modelProfilePresets,
  modelProfileReferencesEqual,
} from "./model-profile-picker-state.js";
import { modelDisplayName, presetDisplayName } from "./model-profile-presentation.js";

/** The choice that keeps the workspace's pair for the application. */
export const workspacePairValue = "workspace";

export interface ModelPairSides {
  readonly author: ProviderTransmissionIdentity;
  readonly critic: ProviderTransmissionIdentity;
}

/** The radio value for an application's pair: the workspace's, a preset's id, or none for a custom pair. */
export function applicationPairValue(pair: ApplicationModelProfilesView | null): string {
  if (pair === null) return workspacePairValue;
  const preset = modelProfilePresets.find((candidate) =>
    modelProfileReferencesEqual(modelProfilePresetReferences(candidate), pair),
  );
  return preset?.id ?? "";
}

/** The pair a radio value stands for: `null` for the workspace's, `undefined` when unknown. */
export function applicationPairForValue(
  value: string,
): ApplicationModelProfilesView | null | undefined {
  if (value === workspacePairValue) return null;
  const preset = modelProfilePresets.find((candidate) => candidate.id === value);
  return preset === undefined ? undefined : (modelProfilePresetReferences(preset) ?? undefined);
}

function sideFor(
  reference: ModelProfileReferences["author"],
  role: "author" | "critic",
  current: ProviderTransmissionIdentity,
): ProviderTransmissionIdentity | undefined {
  const entry = modelProfileEntryForReference(reference, role);
  if (entry === undefined) return undefined;
  return {
    company: entry.profile.provider,
    model: entry.profile.modelId,
    endpoint: entry.profile.provider === current.company ? current.endpoint : "",
  };
}

/**
 * The workspace's own pair. A loaded application with its own pair makes the host report that pair,
 * so the workspace's sides then come from the workspace's applied profiles.
 */
export function workspacePairSides(
  state: DesktopReviewState,
  applicationPair: ApplicationModelProfilesView | null,
  workspaceProfiles: ModelProfileReferences | null,
): ModelPairSides {
  const { author, critic } = state.providerTransmissionPreflight;
  if (applicationPair === null || workspaceProfiles === null) return { author, critic };
  const workspaceAuthor = sideFor(workspaceProfiles.author, "author", author);
  const workspaceCritic = sideFor(workspaceProfiles.critic, "critic", critic);
  return workspaceAuthor === undefined || workspaceCritic === undefined
    ? { author, critic }
    : { author: workspaceAuthor, critic: workspaceCritic };
}

/** The state as the workspace's settings see it, without an application's own pair. */
export function workspaceScopedState(
  state: DesktopReviewState,
  applicationPair: ApplicationModelProfilesView | null,
  workspaceProfiles: ModelProfileReferences | null,
): DesktopReviewState {
  if (applicationPair === null) return state;
  const sides = workspacePairSides(state, applicationPair, workspaceProfiles);
  return {
    ...state,
    providerTransmissionPreflight: { ...state.providerTransmissionPreflight, ...sides },
  };
}

export interface ApplicationModelPairChoiceProps {
  /** The application's own pair, or `null` while it uses the workspace's. */
  readonly pair: ApplicationModelProfilesView | null;
  readonly workspace: ModelPairSides;
  readonly support: ModelProfileSupportResult | undefined;
  readonly saving: boolean;
  readonly errorMessage: string | null;
  readonly onChoose: (pair: ApplicationModelProfilesView | null) => void;
}

/** Keeps the workspace's pair for one application, or picks a preset pair for it alone. */
export function ApplicationModelPairChoice({
  pair,
  workspace,
  support,
  saving,
  errorMessage,
  onChoose,
}: ApplicationModelPairChoiceProps) {
  const checked = applicationPairValue(pair);
  return (
    <details className="flow-model-pair" open={pair !== null}>
      <summary>
        {pair === null
          ? "Use a different model pair for this application"
          : "This application uses its own model pair"}
      </summary>
      <p className="subtle">
        Other applications keep the workspace&apos;s pair. A run records the pair it used, so
        changing it later does not change past reviews.
      </p>
      <ModelPresetCards
        groupName="application-model-pair"
        legend="Model pair for this application"
        checkedValue={checked}
        disabled={saving}
        support={support}
        includeCustom={false}
        leading={
          <label className="model-preset-card">
            <input
              type="radio"
              name="application-model-pair"
              value={workspacePairValue}
              checked={checked === workspacePairValue}
              disabled={saving}
              onChange={() => onChoose(null)}
            />
            <span className="model-preset-card-title">Workspace pair</span>
            <span className="model-preset-card-line">
              {modelDisplayName(workspace.author.model)} writes ·{" "}
              {modelDisplayName(workspace.critic.model)} reviews
            </span>
            <span className="model-preset-card-meta">The pair set on Home. Default.</span>
          </label>
        }
        onSelect={(value) => {
          const chosen = applicationPairForValue(value);
          if (chosen !== undefined) onChoose(chosen);
        }}
      />
      {saving ? (
        <p className="flow-status" role="status">
          Saving the model pair…
        </p>
      ) : null}
      {errorMessage === null ? null : (
        <p className="setup-blocker" role="alert">
          {errorMessage}
        </p>
      )}
    </details>
  );
}

/** One line naming an application's own pair, for summaries. */
export function applicationPairLabel(pair: ApplicationModelProfilesView): string {
  const preset = modelProfilePresets.find(
    (candidate) => candidate.id === applicationPairValue(pair),
  );
  return preset === undefined
    ? `Custom pair ${pair.author.id}@${pair.author.version} and ${pair.critic.id}@${pair.critic.version}`
    : `Preset ${presetDisplayName(preset.label)}`;
}
