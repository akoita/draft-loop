import { t } from "@lingui/core/macro";
import { createContext, type ReactNode, useContext, useState } from "react";

/**
 * How the screens show themselves (#2789): `guided` walks a newcomer one step at a time,
 * `standard` is the simple view with folded Advanced options, and `everything` opens every
 * Advanced options section. `null` means the person never answered the first-run question.
 */
export type DisplayMode = "guided" | "standard" | "everything";

export interface DisplayPreference {
  readonly mode: DisplayMode | null;
  /** True once the person hid the Getting started guide on Home. */
  readonly guideHidden: boolean;
}

export interface DisplayPreferenceValue {
  readonly preference: DisplayPreference;
  /** Saves a new preference; absent when the host keeps none, and the screens offer no choice. */
  readonly choose?: (preference: DisplayPreference) => void;
}

const fallback: DisplayPreferenceValue = {
  preference: { mode: null, guideHidden: false },
};

const DisplayPreferenceContext = createContext<DisplayPreferenceValue>(fallback);

/** The host's display preference for every screen below it. */
export function DisplayPreferenceProvider({
  value,
  children,
}: {
  readonly value: DisplayPreferenceValue;
  readonly children: ReactNode;
}) {
  return (
    <DisplayPreferenceContext.Provider value={value}>{children}</DisplayPreferenceContext.Provider>
  );
}

export function useDisplayPreference(): DisplayPreferenceValue {
  return useContext(DisplayPreferenceContext);
}

/** True when Show everything is on, so folded sections start open. */
export function useShowEverything(): boolean {
  return useDisplayPreference().preference.mode === "everything";
}

/** The two choices a person makes between, with what each does. */
export function displayChoices(): readonly {
  readonly mode: "guided" | "everything";
  readonly label: string;
  readonly effect: string;
}[] {
  return [
    {
      mode: "guided",
      label: t`Guide me step by step`,
      effect: t`We show one thing to do at a time and explain each screen.`,
    },
    {
      mode: "everything",
      label: t`Show everything`,
      effect: t`Every Advanced options section starts open, so nothing is a click away.`,
    },
  ];
}

export function displayModeName(mode: DisplayMode | null): string {
  if (mode === "guided") return t`Guided`;
  if (mode === "everything") return t`Show everything`;
  return t`Simple`;
}

/**
 * The two-choice card (#2789, #2790): one button per way of working, each with its one-sentence
 * effect, and a quiet way back to the simple view. Never a bare checkbox.
 */
export function DisplayChoiceCard({
  current,
  onChoose,
  quietLabel,
  headingLevel = 3,
  heading,
}: {
  readonly current: DisplayMode | null;
  readonly onChoose: (mode: DisplayMode) => void;
  /** The quiet link that keeps the simple view, such as "Decide later". */
  readonly quietLabel: string;
  readonly headingLevel?: 2 | 3;
  readonly heading: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="display-choice" aria-label={heading}>
      <Heading>{heading}</Heading>
      <div className="display-choice-options">
        {displayChoices().map((choice) => (
          <button
            key={choice.mode}
            type="button"
            className="display-choice-option"
            aria-pressed={current === choice.mode}
            onClick={() => onChoose(choice.mode)}
          >
            <strong>{choice.label}</strong>
            <span>{choice.effect}</span>
          </button>
        ))}
      </div>
      <button type="button" className="link-action" onClick={() => onChoose("standard")}>
        {quietLabel}
      </button>
    </section>
  );
}

/**
 * The Display row in Workspace settings (#2789): visible, never inside Advanced options. It names
 * the current way of working and opens the two-choice card to change it. Renders nothing when the
 * host keeps no preference.
 */
export function DisplaySetting() {
  const { preference, choose } = useDisplayPreference();
  const [changing, setChanging] = useState(false);
  if (choose === undefined) return null;
  return (
    <div className="display-setting">
      <div className="display-setting-row">
        <strong>{t`Display`}</strong>
        <span className="meta-chip">{displayModeName(preference.mode)}</span>
        <button type="button" onClick={() => setChanging((open) => !open)} aria-expanded={changing}>
          {changing ? t`Keep as it is` : t`Change`}
        </button>
      </div>
      <p className="subtle">
        {t`Guided shows one step at a time. Show everything opens every Advanced options section.`}
      </p>
      {changing ? (
        <DisplayChoiceCard
          heading={t`How would you like DraftLoop to look?`}
          current={preference.mode}
          quietLabel={t`Use the simple view`}
          onChoose={(mode) => {
            choose({ ...preference, mode });
            setChanging(false);
          }}
        />
      ) : null}
    </div>
  );
}
