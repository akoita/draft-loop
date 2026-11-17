import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import type { PlanPresetChoice } from "./plan-preset-model.js";

export interface PlanPresetChoiceViewProps {
  readonly choice: PlanPresetChoice;
  readonly busy: boolean;
  readonly problem: string | null;
  /** Absent when the screens cannot change models from the dialog; Settings is then the way. */
  readonly onApply?: ((presetId: string) => void) | undefined;
}

/**
 * The presets the plan allows, inline in the start confirmation (#2864): the best one selected,
 * applied without leaving the dialog. The dialog's model lines follow once it is applied.
 */
export function PlanPresetChoiceView({
  choice,
  busy,
  problem,
  onApply,
}: PlanPresetChoiceViewProps) {
  const [selected, setSelected] = useState(choice.initialId);
  useEffect(() => setSelected(choice.initialId), [choice.initialId]);
  return (
    <fieldset className="start-plan-presets">
      <legend>{t`Choose a preset your plan includes`}</legend>
      {choice.presets.map((preset) => (
        <label key={preset.id}>
          <input
            type="radio"
            name="start-plan-preset"
            value={preset.id}
            checked={selected === preset.id}
            disabled={busy || onApply === undefined}
            onChange={() => setSelected(preset.id)}
          />
          {preset.label}
        </label>
      ))}
      {onApply === undefined ? (
        <p className="start-confirmation-note">{t`Change the models in Settings, then start again.`}</p>
      ) : (
        <button className="button" type="button" disabled={busy} onClick={() => onApply(selected)}>
          {busy ? t`Applying…` : t`Use this preset`}
        </button>
      )}
      {problem === null ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
