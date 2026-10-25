import {
  firstUnmetStartCondition,
  type StartActionId,
  type StartCondition,
  shownUnmet,
  startJobCardId,
} from "./start-checklist-model.js";

export interface StartChecklistViewProps {
  readonly id: string;
  readonly conditions: readonly StartCondition[];
  /** The last error the host returned, such as a refused start; shown above the conditions. */
  readonly errorMessage?: string | null;
  /** An earlier, read-only run offers no fixing actions. */
  readonly readOnly?: boolean;
  readonly isActionDisabled?: (id: StartActionId) => boolean;
  readonly onAction: (id: StartActionId) => void;
}

function statusText(condition: StartCondition): string {
  if (condition.done) return "Done";
  return condition.checkedAtStart === true ? "Checked when the review starts" : "Not done";
}

/** The start conditions beside the Start button, each with its state and its fixing action. */
export function StartChecklistView({
  id,
  conditions,
  errorMessage = null,
  readOnly = false,
  isActionDisabled,
  onAction,
}: StartChecklistViewProps) {
  const titleId = `${id}-title`;
  const first = firstUnmetStartCondition(conditions);
  const blocked = first !== null;
  return (
    <section
      className={`start-checklist${blocked ? " start-checklist-blocked" : ""}`}
      id={id}
      aria-labelledby={titleId}
    >
      <strong id={titleId}>Before you can start</strong>
      <p className="sr-only" role="status">
        {first === null
          ? "Ready to start the review."
          : `Can't start yet: ${first.detail ?? first.label}`}
      </p>
      {errorMessage ? (
        <div className="error-banner" role="alert">
          <p>{errorMessage}</p>
        </div>
      ) : null}
      <ul aria-labelledby={titleId}>
        {conditions.map((condition) => {
          // A not-done row that leaves the start to the host still reads as not done.
          const tone = condition.done ? "done" : shownUnmet(condition) ? "todo" : "at-start";
          const action = readOnly ? null : condition.action;
          return (
            <li className={`start-check start-check-${tone}`} key={condition.id}>
              <span className="gate-mark" aria-hidden="true">
                {condition.done ? "✓" : shownUnmet(condition) ? "!" : "·"}
              </span>
              <span className="start-check-body">
                <span className="start-check-label">{condition.label}</span>
                <span className="start-check-status">{statusText(condition)}</span>
                {condition.detail === undefined ? null : (
                  <span className="start-check-detail">{condition.detail}</span>
                )}
              </span>
              {action === null ? null : (
                <button
                  className="button button-outline start-check-action"
                  type="button"
                  disabled={isActionDisabled?.(action.id) ?? false}
                  onClick={() => onAction(action.id)}
                >
                  {action.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const focusable = "select:not([disabled]), input:not([disabled]), button:not([disabled]), summary";

/** Scrolls to the first target on the page and focuses its first control. */
export function revealStartTarget(selectors: readonly string[]): void {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) continue;
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    const control = element.matches(focusable)
      ? element
      : element.querySelector<HTMLElement>(focusable);
    control?.focus({ preventScroll: true });
    return;
  }
}

/** Where each checklist action leads, for the actions that only reveal a control on the page. */
export const startActionTargets: Partial<Record<StartActionId, readonly string[]>> = {
  "add-job-description": [`#${startJobCardId}`],
  "review-requirements": ['[data-testid="latest-requirements-brief"] button', `#${startJobCardId}`],
  "choose-profile": [
    "#reviewed-profile-catalog",
    'section[aria-labelledby="application-profile-title"]',
    'section[aria-labelledby="canonical-profile-title"]',
  ],
  "review-data-sent": [
    'section[aria-labelledby="provider-preflight-title"] .preflight-acknowledgement',
    'section[aria-labelledby="provider-preflight-title"]',
  ],
};
