import { type FormEvent, useState } from "react";

import { modelDisplayName, providerDisplayName } from "./model-profile-presentation.js";
import {
  defaultWorkspaceSetupPresetId,
  defaultWorkspaceSetupRounds,
  type WorkspaceSetupChoice,
  type WorkspaceSetupModel,
  type WorkspaceSetupPreset,
  workspaceSetupLanguages,
  workspaceSetupPresets,
  workspaceSetupRoundLimits,
} from "./workspace-setup-model.js";

export * from "./workspace-setup-model.js";

export interface WorkspaceSetupScreenProps {
  readonly presets?: readonly WorkspaceSetupPreset[];
  readonly busy?: boolean;
  /** Why the last attempt failed, in words. */
  readonly problem?: string | null;
  readonly onCreate: (choice: WorkspaceSetupChoice) => void;
}

function modelLine({ company, model }: WorkspaceSetupModel): string {
  return `${modelDisplayName(model)} (${providerDisplayName(company)})`;
}

/**
 * The first screen of a workspace that does not exist yet: the CV's language, how many rounds a
 * run may take, the model preset and demo mode. The rest is set from Home once it exists.
 */
export function WorkspaceSetupScreen({
  presets = workspaceSetupPresets(),
  busy = false,
  problem = null,
  onCreate,
}: WorkspaceSetupScreenProps) {
  const [language, setLanguage] = useState("en");
  const [maxRounds, setMaxRounds] = useState<number>(defaultWorkspaceSetupRounds);
  const [presetId, setPresetId] = useState(
    presets.some(({ id }) => id === defaultWorkspaceSetupPresetId)
      ? defaultWorkspaceSetupPresetId
      : (presets[0]?.id ?? ""),
  );
  const [fixtureMode, setFixtureMode] = useState(false);
  const preset = presets.find(({ id }) => id === presetId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preset === undefined || busy) return;
    onCreate({ language, maxRounds, preset, fixtureMode });
  }

  return (
    <main className="workspace-setup">
      <form className="panel workspace-setup-card" onSubmit={submit}>
        <p className="eyebrow">New workspace</p>
        <h1>Set up your workspace</h1>
        <p className="workspace-setup-intro">
          Choose how your CVs are written. You can change the models later from Home.
        </p>
        <label className="workspace-setup-field">
          <span>CV language</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {workspaceSetupLanguages.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="workspace-setup-field">
          <span>Rounds at most</span>
          <select value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))}>
            {workspaceSetupRoundLimits.map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds === 1 ? "1 round" : `${rounds} rounds`}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="workspace-setup-presets">
          <legend>Models</legend>
          {presets.map((option) => (
            <label key={option.id} className="workspace-setup-preset">
              <input
                type="radio"
                name="workspace-setup-preset"
                value={option.id}
                checked={option.id === presetId}
                onChange={() => setPresetId(option.id)}
              />
              <span>
                <strong>{option.label}</strong>
                <span className="workspace-setup-preset-models">
                  Writer {modelLine(option.author)} · Reviewer {modelLine(option.critic)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="workspace-setup-toggle">
          <input
            type="checkbox"
            checked={fixtureMode}
            onChange={(event) => setFixtureMode(event.target.checked)}
          />
          <span>Demo mode: runs use fixtures and call no model</span>
        </label>
        {problem === null ? null : (
          <p className="setup-blocker" role="alert">
            {problem}
          </p>
        )}
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || preset === undefined}
        >
          {busy ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </main>
  );
}
