import { t } from "@lingui/core/macro";

import { useDisplayPreference } from "./display-preference.js";

export type HintedScreen = "evidence" | "profile" | "new-application" | "review";

function hintText(screen: HintedScreen): string {
  switch (screen) {
    case "evidence":
      return t`Add your CV or other documents here. When they are in, go to Career profile.`;
    case "profile":
      return t`Read each fact and confirm or fix it. Your CVs use only the facts you keep.`;
    case "new-application":
      return t`Give the job a name, paste its description or link, then select Create application.`;
    case "review":
      return t`Read the draft and each finding. Accept or reject each one, then select Approve artifact.`;
  }
}

/**
 * One line at the top of a screen that says what to do there (#2792), for people who chose
 * Guided. Everyone else sees nothing new.
 */
export function ScreenHint({
  screen,
  onOpenGuide,
}: {
  readonly screen: HintedScreen;
  /** Opens Home, where the Getting started list is; absent where Home is not one step away. */
  readonly onOpenGuide?: (() => void) | undefined;
}) {
  const { preference } = useDisplayPreference();
  if (preference.mode !== "guided") return null;
  return (
    <p className="screen-hint">
      <span>{hintText(screen)}</span>
      {onOpenGuide === undefined ? null : (
        <button type="button" className="link-action" onClick={onOpenGuide}>
          {t`Back to Getting started`}
        </button>
      )}
    </p>
  );
}
