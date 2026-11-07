import type { RunSnapshot, RunState } from "./index.js";
import { RunTransitionError } from "./run-transition-error.js";

/** States only the person's own action puts a run in; an engine step never leaves them on its own. */
const personHeldStates: ReadonlySet<RunState> = new Set(["stopped", "paused"]);

/**
 * What one engine last read or wrote for a run. A stored run that no longer matches it was changed
 * by someone else, such as the person stopping it from another process while a step ran.
 */
export function runVersion(snapshot: Pick<RunSnapshot, "state" | "updatedAt">): string {
  return `${snapshot.state}@${snapshot.updatedAt}`;
}

/**
 * Refuses a save that would overwrite a stop or a pause the person made while this engine was
 * busy, as when a worker's provider call returns after the person pressed Stop. Its message is
 * safe to show, and the engine answers the run as the person left it.
 */
export class RunHeldByPersonError extends RunTransitionError {
  readonly held: RunSnapshot;

  constructor(held: RunSnapshot) {
    super(
      held.state === "stopped"
        ? "The run was stopped while a step was running; the step's result was not applied."
        : "The run was paused while a step was running; the step's result was not applied.",
    );
    this.name = "RunHeldByPersonError";
    this.held = held;
  }
}

/**
 * The person's hold this engine has not seen, if any: a stored stop or pause newer than what the
 * engine last read or wrote for the run. A hold the engine already read, as when it resumes a
 * paused run, is the engine's own starting point and is not refused.
 */
export function unseenPersonHold(
  stored: RunSnapshot | undefined,
  seenVersion: string | undefined,
): RunSnapshot | undefined {
  if (stored === undefined || !personHeldStates.has(stored.state)) return undefined;
  return runVersion(stored) === seenVersion ? undefined : stored;
}
