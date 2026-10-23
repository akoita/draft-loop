/** A failure whose message is safe and actionable to show a user as-is. */
export class CliUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUserError";
  }
}

/** No workspace at the root: the CLI asks for `draft-loop init`, the API answers 404. */
export class WorkspaceNotFoundError extends CliUserError {
  constructor(root: string) {
    super(`No DraftLoop workspace found at ${root}. Run draft-loop init first.`);
    this.name = "WorkspaceNotFoundError";
  }
}
