import { useId } from "react";

/**
 * Workspace switch for unattended revision. Off by default; when on, a review
 * keeps revising up to the round limit and pauses only for a conflict.
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
        Autopilot: run all {maximumRounds} rounds without stopping
      </label>
      <p className="setup-note" id={noteId}>
        The author revises from every critic finding on its own. The review pauses early only when
        the draft is ready, a claim is disputed, or a blocking finding says the draft contradicts
        your materials. Final approval stays with you.
      </p>
    </div>
  );
}
