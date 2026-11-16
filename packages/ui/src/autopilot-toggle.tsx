import { t } from "@lingui/core/macro";
import { useId } from "react";

/**
 * Workspace switch for unattended revision. Off by default; when on, a review
 * keeps revising up to the round limit and pauses only for a conflict. Either
 * way a round with only warnings revises on its own (#2812).
 */
export function AutopilotToggle({
  enabled,
  maximumRounds,
  disabled,
  onChange,
}: {
  readonly enabled: boolean;
  readonly maximumRounds: number;
  readonly disabled: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const noteId = useId();
  return (
    <div className="autopilot-toggle">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          aria-describedby={noteId}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />{" "}
        {t`Autopilot: run all`} {maximumRounds} {t`rounds without stopping`}
      </label>
      <p className="setup-note" id={noteId}>
        {enabled
          ? t`The author revises from every critic finding on its own. The review pauses early only when the draft is ready, a claim is disputed, or a blocking finding says the draft contradicts your materials. Final approval stays with you.`
          : t`The review pauses for your decisions after a round with a blocking finding. A round with only warnings revises on its own until the draft is ready or the round limit is reached.`}
      </p>
    </div>
  );
}
