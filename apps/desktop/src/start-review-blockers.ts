/** What still stands between workspace setup and the first author–critic review. */
export interface StartReviewBlockerInput {
  readonly setupReady: boolean;
  readonly nextSteps: readonly string[];
  readonly transmissionReady: boolean;
  readonly startDisabledReason: string | null;
  /**
   * The local parser's refusal of the raw job description, while the person has chosen to start
   * from it. A reviewed brief makes the refusal moot, so it is passed only for that choice.
   */
  readonly rawJobRequirementProblem?: string | null;
}

export const startReviewBlockersId = "start-review-blockers";

const setupIncompleteFallback = "Finish the workspace setup above.";
const transmissionBlocker = "Acknowledge provider transmission above.";

/**
 * Every reason the start button is disabled, in the order a person can act on them.
 * An empty list means only an in-flight start (or nothing) can disable the button.
 */
export function startReviewBlockers(input: StartReviewBlockerInput): readonly string[] {
  const blockers: string[] = [];
  if (!input.setupReady) {
    blockers.push(...(input.nextSteps.length > 0 ? input.nextSteps : [setupIncompleteFallback]));
  }
  const rawProblem = input.rawJobRequirementProblem;
  if (rawProblem !== null && rawProblem !== undefined && !blockers.includes(rawProblem)) {
    blockers.push(rawProblem);
  }
  if (!input.transmissionReady) blockers.push(transmissionBlocker);
  if (input.startDisabledReason !== null) blockers.push(input.startDisabledReason);
  return blockers;
}

/** Hover text for the disabled start button; undefined once nothing blocks it. */
export function startReviewBlockedTooltip(blockers: readonly string[]): string | undefined {
  return blockers.length === 0 ? undefined : `Can't start yet: ${blockers.join(" ")}`;
}
