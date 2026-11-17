import { t } from "@lingui/core/macro";
import { createContext, type ReactNode, useContext } from "react";

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

/**
 * The two choices a person makes between, with what each does. The first-run question words the
 * second one for a person deciding how familiar they are; settings name the mode itself.
 */
export function displayChoices(wording: "settings" | "first-run" = "settings"): readonly {
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
    wording === "first-run"
      ? {
          mode: "everything",
          label: t`I know apps like this`,
          effect: t`We show every screen and option, including advanced ones.`,
        }
      : {
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
  wording = "settings",
}: {
  readonly wording?: "settings" | "first-run";
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
        {displayChoices(wording).map((choice) => (
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

/** The three ways of working Workspace settings offers, from most help to most shown. */
export function displaySettingChoices(): readonly {
  readonly mode: DisplayMode;
  readonly label: string;
  readonly effect: string;
}[] {
  const [guided, everything] = displayChoices("settings");
  return [
    guided!,
    {
      mode: "standard",
      label: t`Simple`,
      effect: t`Each screen shows the basic path. Technical choices stay folded under Advanced options.`,
    },
    everything!,
  ];
}

/** Where the current way of working shows, so a switch never looks like it did nothing. */
export function displayModeWhere(mode: DisplayMode): string {
  switch (mode) {
    case "guided":
      return t`Where you see it: the Getting started list on Home, and a one-line hint at the top of Career evidence, Career profile, New application and the review.`;
    case "standard":
      return t`Where you see it: every Advanced options section is folded, and Home offers the step-by-step guide until you decline it.`;
    case "everything":
      return t`Where you see it: every Advanced options section is open, on this screen too, and so is the Prepare panel under each draft.`;
  }
}

/**
 * The Display setting in Workspace settings (#2789): visible, never inside Advanced options. All
 * three ways of working sit side by side as choice cards, the current one marked, and a click
 * switches at once. Never a bare checkbox. Renders nothing when the host keeps no preference.
 */
export function DisplaySetting() {
  const { preference, choose } = useDisplayPreference();
  if (choose === undefined) return null;
  const current: DisplayMode = preference.mode ?? "standard";
  return (
    <section className="display-setting" aria-labelledby="display-setting-heading">
      <h3 id="display-setting-heading">{t`Display`}</h3>
      <p className="subtle">{t`How much each screen shows at once. The change applies right away.`}</p>
      <div className="display-choice-options display-setting-options">
        {displaySettingChoices().map((choice) => {
          const selected = current === choice.mode;
          return (
            <button
              key={choice.mode}
              type="button"
              className="display-choice-option"
              aria-pressed={selected}
              onClick={() => {
                if (!selected) choose({ ...preference, mode: choice.mode });
              }}
            >
              <span className="display-choice-option-title">
                <strong>{choice.label}</strong>
                {selected ? <span className="meta-chip">{t`Current`}</span> : null}
              </span>
              <span>{choice.effect}</span>
            </button>
          );
        })}
      </div>
      <p className="subtle display-setting-where" aria-live="polite">
        {displayModeWhere(current)}
      </p>
    </section>
  );
}
