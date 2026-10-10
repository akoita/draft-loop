import type { DesktopReviewState } from "./model.js";

/** The next-action line above the draft: a short label and what it means for the person. */
export interface ReviewStatusLine {
  readonly label: string;
  readonly detail: string;
}

type RunStatusInput = Pick<
  DesktopReviewState,
  "state" | "execution" | "round" | "artifact" | "setup" | "reviewComplete"
>;

/**
 * Whether the author–critic loop is working right now. While it is, a missing critique is
 * expected, not a failure, and the person has nothing to do until the run pauses.
 */
export function reviewInProgress(state: Pick<DesktopReviewState, "state" | "execution">): boolean {
  if (state.execution.status === "interrupted") return false;
  return (
    state.execution.status === "running" ||
    state.state === "drafting" ||
    state.state === "reviewing" ||
    state.state === "revising"
  );
}

/** What the running review is doing, and when it will need the person. */
export function inProgressStatus(state: RunStatusInput): ReviewStatusLine {
  const step =
    state.execution.step ??
    (state.state === "drafting"
      ? "author"
      : state.state === "reviewing"
        ? "critic"
        : state.state === "revising"
          ? "revision"
          : null);
  const version = state.artifact.version;
  const doing =
    step === "author"
      ? "The author is writing the draft."
      : step === "critic"
        ? `The critic is checking version ${version}.`
        : step === "revision"
          ? `The author is revising version ${version} for round ${state.round}.`
          : "The review is running.";
  const until =
    state.setup.autopilot === true
      ? "Autopilot keeps going until the draft is ready, a claim needs your call, or the round limit is reached."
      : "The review pauses here when it needs your decision.";
  return {
    label: "Review in progress · nothing to do yet",
    detail: `${doing} ${until} Approval and export open after that.`,
  };
}

/** Why approval waits when the run has stopped without a critique of the current draft. */
export function uncritiquedStatus(state: RunStatusInput): ReviewStatusLine {
  const label = `Version ${state.artifact.version} has not been critiqued yet`;
  switch (state.state) {
    case "paused":
      return {
        label,
        detail:
          "Resume the review so the critic can check it. Approval and export need a finished critique.",
      };
    case "stopped":
      return {
        label,
        detail:
          "The review stopped before the critic checked it. Start a new review to get a critiqued draft you can approve or export.",
      };
    default:
      return {
        label,
        detail:
          "The critic did not finish checking it. Resume or retry the review; approval and export need a finished critique.",
      };
  }
}

/**
 * The evidence-retrieval readout for an index that setup has not inspected. Runs index the
 * candidate's evidence when they start, so this is a note about timing, not a missing input.
 */
export function notIndexedRetrievalText(state: Pick<DesktopReviewState, "state">): string {
  return state.state === "collecting"
    ? "Evidence will be indexed when the review starts"
    : "Your career evidence is indexed and searched as the review runs";
}
