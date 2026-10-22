import { CliUserError } from "./cli-user-error.js";

export type RunActionErrorCode =
  /** The run does not exist in the workspace. */
  | "run_not_found"
  /** The run is not awaiting review, so its findings and draft can no longer be decided. */
  | "review_closed"
  /** The finding or block is not part of the run's current draft. */
  | "review_target_not_found";

/**
 * Why the hosted service refused an action on a run. Its message is safe to show, and its code
 * lets an adapter choose the answer, such as 404 or 409.
 */
export class RunActionError extends CliUserError {
  readonly code: RunActionErrorCode;

  constructor(code: RunActionErrorCode, message: string) {
    super(message);
    this.name = "RunActionError";
    this.code = code;
  }
}
