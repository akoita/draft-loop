import { CliUserError } from "./cli-user-error.js";

export type RunActionErrorCode =
  /** The run does not exist in the workspace. */
  | "run_not_found"
  /** The run is not awaiting review, so its findings and draft can no longer be decided. */
  | "review_closed"
  /** The finding or block is not part of the run's current draft. */
  | "review_target_not_found"
  /** The run has no completed export by that id. */
  | "export_not_found"
  /** The stored document is missing or no longer matches the checksum its export recorded. */
  | "export_integrity";

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

/** The refusal for a run id the workspace (and so the caller's tenant) does not have. */
export function runNotFound(runId: string): RunActionError {
  return new RunActionError("run_not_found", `Run ${runId} was not found.`);
}
