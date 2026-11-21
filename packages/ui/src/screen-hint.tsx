import type { HelpSectionId } from "@draft-loop/user-guide";
import { t } from "@lingui/core/macro";

import { useDisplayPreference } from "./display-preference.js";
import { useHelpSection } from "./help-context.js";

export type HintedScreen =
  | "home"
  | "evidence"
  | "profile"
  | "new-application"
  | "review"
  | "approved";

function hintText(screen: HintedScreen): string {
  switch (screen) {
    case "home":
      return t`Open an application to review or download its CV, or select New application for your next job.`;
    case "evidence":
      return t`Add your CV or other documents here. When they are in, go to Career profile.`;
    case "profile":
      return t`Read each fact and confirm or fix it. Your CVs use only the facts you keep.`;
    case "new-application":
      return t`Give the job a name, paste its description or link, then select Create application.`;
    case "review":
      return t`Read the draft and each finding. Accept or reject each one, then select Approve artifact.`;
    case "approved":
      return t`This CV is approved. Pick a template, then export it to download your CV.`;
  }
}

/** The guide section Quick help opens on while the screen is shown. */
function hintSection(screen: HintedScreen | undefined): HelpSectionId | null {
  switch (screen) {
    case "evidence":
    case "profile":
      return "evidence";
    case "new-application":
      return "job";
    case "review":
    case "approved":
      return "review";
    default:
      return null;
  }
}

/**
 * One line at the top of a screen that says what to do there (#2792), for people who chose
 * Guided. Everyone else sees nothing new.
 */
export function ScreenHint({
  screen,
  text,
  onOpenGuide,
}: {
  readonly screen?: HintedScreen;
  /** A sentence worked out from the record, such as Home's next step, in place of the screen's. */
  readonly text?: string;
  /** Opens Home, where the Getting started list is; absent where Home is not one step away. */
  readonly onOpenGuide?: (() => void) | undefined;
}) {
  const { preference } = useDisplayPreference();
  // Every view claims the screen's guide section, not only Guided: Quick help opens on it.
  useHelpSection(hintSection(screen));
  if (preference.mode !== "guided") return null;
  const sentence = text ?? (screen === undefined ? undefined : hintText(screen));
  if (sentence === undefined) return null;
  return (
    <p className="screen-hint">
      <span>{sentence}</span>
      {onOpenGuide === undefined ? null : (
        <button type="button" className="link-action" onClick={onOpenGuide}>
          {t`Back to Getting started`}
        </button>
      )}
    </p>
  );
}
