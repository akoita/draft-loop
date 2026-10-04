import type { ModelProfilePreset } from "@draft-loop/application/model-profile-catalog";
import type { ModelProfileSupportResult } from "./bridge.js";
import {
  modelProfileEntryForReference,
  modelProfilePresets,
  modelProfileRouteIsSupported,
} from "./model-profile-picker-state.js";
import {
  formatUsdPerMillion,
  isDevelopmentPreset,
  modelDisplayName,
  presetDisplayName,
  providerDisplayName,
} from "./model-profile-presentation.js";

export const customPresetValue = "custom";
export const unsupportedSignInBadge = "Not available with your current sign-in";

interface ModelPresetCardsProps {
  readonly groupName: string;
  readonly checkedValue: string;
  readonly disabled: boolean;
  readonly support: ModelProfileSupportResult | undefined;
  readonly onSelect: (value: string) => void;
}

function PresetCard({
  preset,
  groupName,
  checked,
  disabled,
  support,
  onSelect,
}: {
  readonly preset: ModelProfilePreset;
  readonly groupName: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly support: ModelProfileSupportResult | undefined;
  readonly onSelect: (value: string) => void;
}) {
  const author = modelProfileEntryForReference(preset.author, "author");
  const critic = modelProfileEntryForReference(preset.critic, "critic");
  if (author === undefined || critic === undefined) return null;
  const unsupported =
    support !== undefined &&
    (!modelProfileRouteIsSupported(preset.author, support) ||
      !modelProfileRouteIsSupported(preset.critic, support));
  const authorName = modelDisplayName(author.profile.modelId);
  const criticName = modelDisplayName(critic.profile.modelId);
  const unvalidated =
    author.qualityStatus === "unvalidated" || critic.qualityStatus === "unvalidated";
  const writer = author.apiPricing;
  const reviewer = critic.apiPricing;
  return (
    <label className="model-preset-card">
      <input
        type="radio"
        name={groupName}
        value={preset.id}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(preset.id)}
      />
      <span className="model-preset-card-title">{presetDisplayName(preset.label)}</span>
      <span className="model-preset-card-line">
        {authorName} writes · {criticName} reviews
      </span>
      <span className="model-preset-card-meta">
        {providerDisplayName(author.profile.provider)} +{" "}
        {providerDisplayName(critic.profile.provider)}
      </span>
      <span className="model-preset-card-meta model-preset-card-price">
        Writer {formatUsdPerMillion(writer.inputUsdPerMillion)} /{" "}
        {formatUsdPerMillion(writer.outputUsdPerMillion)} · Reviewer{" "}
        {formatUsdPerMillion(reviewer.inputUsdPerMillion)} /{" "}
        {formatUsdPerMillion(reviewer.outputUsdPerMillion)} per million tokens (input / output)
      </span>
      <span className="model-preset-card-badges">
        {unvalidated ? <span className="model-preset-badge">Unvalidated</span> : null}
        {isDevelopmentPreset(preset) ? (
          <span className="model-preset-badge model-preset-badge-development">Development</span>
        ) : null}
        {unsupported ? (
          <span className="model-preset-badge model-preset-badge-unsupported">
            {unsupportedSignInBadge}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function ModelPresetCards({
  groupName,
  checkedValue,
  disabled,
  support,
  onSelect,
}: ModelPresetCardsProps) {
  return (
    <fieldset className="model-preset-cards">
      <legend>Choose a model pair</legend>
      <div className="model-preset-card-grid">
        {modelProfilePresets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            groupName={groupName}
            checked={checkedValue === preset.id}
            disabled={disabled}
            support={support}
            onSelect={onSelect}
          />
        ))}
        <label className="model-preset-card model-preset-card-custom">
          <input
            type="radio"
            name={groupName}
            value={customPresetValue}
            checked={checkedValue === customPresetValue}
            disabled={disabled}
            onChange={() => onSelect(customPresetValue)}
          />
          <span className="model-preset-card-title">Custom pair</span>
          <span className="model-preset-card-line">Pick the writer and reviewer yourself.</span>
        </label>
      </div>
    </fieldset>
  );
}
