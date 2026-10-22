export type RunTransitionErrorCode =
  /** The run's state, round or budget does not allow the action. */
  | "run_state_conflict"
  /** Approval needs a reason because the final CV checks fail. */
  | "readiness_blocked";

/**
 * A person's action on a run that the run cannot take as it stands, such as approving a run that
 * is still drafting. Its message is safe to show; adapters answer it as a conflict, not a fault.
 */
export class RunTransitionError extends Error {
  readonly code: RunTransitionErrorCode;

  constructor(message: string, code: RunTransitionErrorCode = "run_state_conflict") {
    super(message);
    this.name = "RunTransitionError";
    this.code = code;
  }
}
