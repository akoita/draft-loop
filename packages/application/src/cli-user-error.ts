/** A failure whose message is safe and actionable to show a user as-is. */
export class CliUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUserError";
  }
}
