import { t } from "@lingui/core/macro";
import { type FormEvent, useState } from "react";
import { AdvancedOption, AdvancedOptions } from "./advanced-options.js";
import { countedNouns } from "./counted-nouns.js";
import { useScreenLocale } from "./i18n.js";
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
 * The CV language a new workspace proposes (#2774): the screen language when CVs can be written
 * in it, else English.
 */
export function proposedCvLanguage(screenLocale: string): string {
  return workspaceSetupLanguages.some(({ code }) => code === screenLocale) ? screenLocale : "en";
}

/** What differs from the defaults under Advanced options, for its folded line. */
export function workspaceSetupAdvancedNote(choice: {
  readonly maxRounds: number;
  readonly preset: WorkspaceSetupPreset | undefined;
  readonly fixtureMode: boolean;
}): string | null {
  const notes: string[] = [];
  if (choice.preset !== undefined && choice.preset.id !== defaultWorkspaceSetupPresetId) {
    notes.push(choice.preset.label);
  }
  if (choice.maxRounds !== defaultWorkspaceSetupRounds) {
    notes.push(countedNouns.round(choice.maxRounds));
  }
  if (choice.fixtureMode) notes.push(t`Demo mode on`);
  return notes.length === 0 ? null : notes.join(" · ");
}

/**
 * The first screen of a workspace that does not exist yet: the CV's language, which follows the
 * screen language, and under Advanced options how many rounds a run may take, the model preset
 * and demo mode. The rest is set from Home once it exists.
 */
export function WorkspaceSetupScreen({
  presets = workspaceSetupPresets(),
  busy = false,
  problem = null,
  onCreate,
}: WorkspaceSetupScreenProps) {
  const { locale } = useScreenLocale();
  const [language, setLanguage] = useState(() => proposedCvLanguage(locale));
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
        <p className="eyebrow">{t`New workspace`}</p>
        <h1>{t`Set up your workspace`}</h1>
        <p className="workspace-setup-intro">{t`Choose how your CVs are written. You can change the models later from Home.`}</p>
        <label className="workspace-setup-field">
          <span>{t`CV language`}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {workspaceSetupLanguages.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <AdvancedOptions note={workspaceSetupAdvancedNote({ maxRounds, preset, fixtureMode })}>
          <label className="workspace-setup-field">
            <span>{t`Rounds at most`}</span>
            <select
              value={maxRounds}
              onChange={(event) => setMaxRounds(Number(event.target.value))}
            >
              {workspaceSetupRoundLimits.map((rounds) => (
                <option key={rounds} value={rounds}>
                  {countedNouns.round(rounds)}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="workspace-setup-presets">
            <legend>{t`Models`}</legend>
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
                    {t`Writer`} {modelLine(option.author)} {t`· Reviewer`}{" "}
                    {modelLine(option.critic)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <AdvancedOption
            title={t`Demo mode`}
            state={fixtureMode ? t`On` : t`Off`}
            effect={t`Runs use fixtures and call no model.`}
          >
            <button
              className="button button-outline"
              type="button"
              aria-pressed={fixtureMode}
              onClick={() => setFixtureMode(!fixtureMode)}
            >
              {fixtureMode ? t`Turn demo mode off` : t`Turn demo mode on`}
            </button>
          </AdvancedOption>
        </AdvancedOptions>
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
          {busy ? t`Creating…` : t`Create workspace`}
        </button>
      </form>
    </main>
  );
}
