/**
 * The round that is running, shown in the review footer in place of the gate's controls.
 *
 * Request revision sits in the footer, so the round it starts reports there too: what the author
 * or critic is doing, the model and elapsed time, the directions the candidate sent, and Stop or
 * Resume. Approve, the directions field and Export cannot be used while a round runs, so the
 * footer hides them until the run needs the person again. Run progress at the top of the side
 * panel keeps the event timeline, and **Show run progress** scrolls to it.
 */
import type { JSX } from "react";

import { executionLimitText } from "./execution-limits.js";
import type { DesktopReviewState, ReviewExecutionView } from "./model.js";
import { reviewInProgress, runActivity } from "./review-run-status.js";

/** The directions the candidate sent with Request revision, and the round they steer. */
export interface SentRevisionDirection {
  readonly runId: string;
  readonly round: number;
  readonly text: string;
}

/** The directions request for the run on screen: they steer the round after the reviewed one. */
export function sentRevisionDirection(
  state: Pick<DesktopReviewState, "runId" | "round">,
  direction: string,
): SentRevisionDirection | null {
  const text = direction.trim();
  return text === "" ? null : { runId: state.runId, round: state.round + 1, text };
}

export interface FooterRunAction {
  readonly label: string;
  readonly primary: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

export interface FooterRunningRound {
  /** What the run is doing now; null while it waits on the person. */
  readonly activity: string | null;
  /** The executing step, model, attempt and elapsed time; null before a step starts. */
  readonly execution: string | null;
  /** The directions the candidate sent for this round, or null. */
  readonly direction: string | null;
  readonly actions: readonly FooterRunAction[];
  readonly onShowProgress: () => void;
}

/** "revision · mistral/mistral-large-4 · attempt 1 · elapsed 113s · no run limit". */
export function executionLine(execution: ReviewExecutionView): string | null {
  if (execution.step === null) return null;
  return `${execution.step} · ${execution.provider}/${execution.model} · attempt ${execution.attempt} · elapsed ${Math.floor(execution.elapsedMs / 1_000)}s${executionLimitText(execution)}`;
}

export interface FooterRunningRoundInput {
  readonly state: Pick<
    DesktopReviewState,
    "runId" | "state" | "execution" | "round" | "artifact" | "setup" | "reviewComplete"
  >;
  readonly sentDirection: SentRevisionDirection | null;
  /** Another review action is pending. */
  readonly busy: boolean;
  readonly stopping: boolean;
  readonly transmissionReady: boolean;
  readonly onStop: () => void;
  readonly onResume: () => void;
  readonly onShowProgress: () => void;
}

/**
 * The footer's view of a running, paused or interrupted run, or null when the run waits on the
 * gate's decisions (or has ended) and the footer shows Approve, Request revision and Export.
 */
export function footerRunningRound(input: FooterRunningRoundInput): FooterRunningRound | null {
  const { state } = input;
  const interrupted = state.execution.status === "interrupted";
  const paused = state.state === "paused";
  const running = reviewInProgress(state);
  if (!running && !paused && !interrupted) return null;
  const actions: FooterRunAction[] = interrupted
    ? [
        {
          label: "Resume interrupted review",
          primary: true,
          disabled: input.busy || !input.transmissionReady,
          onClick: input.onResume,
        },
        { label: "Stop review", primary: false, disabled: input.busy, onClick: input.onStop },
      ]
    : paused
      ? [
          {
            label: "Resume review",
            primary: true,
            disabled: input.busy || !input.transmissionReady,
            onClick: input.onResume,
          },
        ]
      : state.execution.status === "running"
        ? [
            {
              label: input.stopping ? "Stopping…" : "Stop review",
              primary: false,
              disabled: input.busy,
              onClick: input.onStop,
            },
          ]
        : [];
  const sent = input.sentDirection;
  return {
    activity: running ? runActivity(state) : null,
    execution: running ? executionLine(state.execution) : null,
    direction:
      sent !== null && sent.runId === state.runId && sent.round === state.round ? sent.text : null,
    actions,
    onShowProgress: input.onShowProgress,
  };
}

/** The running round's strip: what runs, the directions it was given, and Stop or Resume. */
export function FooterRunningRoundStrip({ round }: { round: FooterRunningRound }): JSX.Element {
  return (
    <section className="footer-running-round" aria-label="current round">
      {round.activity === null ? null : <p className="footer-running-activity">{round.activity}</p>}
      {round.execution === null ? null : (
        <p className="footer-running-execution">{round.execution}</p>
      )}
      {round.direction === null ? null : (
        <p className="author-input-direction footer-running-direction">
          <span className="label">Your directions for this round</span>
          <q>{round.direction}</q>
        </p>
      )}
      <div className="approval-actions">
        {round.actions.map((action) => (
          <button
            key={action.label}
            className={`button ${action.primary ? "button-primary" : "button-quiet"}`}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
        <button className="next-step-action" type="button" onClick={round.onShowProgress}>
          Show run progress
        </button>
      </div>
    </section>
  );
}
