/**
 * Comparing two runs of one application: the state behind the review's run comparison.
 *
 * The run that was open stays the review's run. The other run's draft is read for comparison
 * only and is never sent a change, so nothing in this state can target it. Leaving the
 * comparison drops this state and the review shows the open run as it was.
 */
import type { ApplicationRunRowView } from "./application-run-list.js";
import type { DesktopReviewState, ReviewArtifact } from "./model.js";
import type { FooterBlocker } from "./review-footer.js";
import { runModelsLabel, runNumber } from "./run-switcher.js";

/** The other run's draft as far as it has been read. */
export type ComparedRunDraft =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly artifact: ReviewArtifact }
  | { readonly status: "failed"; readonly message: string };

export interface RunComparisonState {
  /** The workspace and run that were open when the comparison began; leaving returns to them. */
  readonly workspaceId: string;
  readonly openRunId: string;
  /** The run chosen to compare with. */
  readonly otherRunId: string;
  /** Which side the chosen run sits on. It starts on the left, with the open run on the right. */
  readonly otherSide: "left" | "right";
  readonly other: ComparedRunDraft;
  /** The chosen run's review state once read, for the facts it recorded; null until then. */
  readonly otherState?: DesktopReviewState | null;
}

export type RunComparisonEvent =
  | {
      readonly type: "choose";
      readonly workspaceId: string;
      readonly openRunId: string;
      readonly otherRunId: string;
    }
  | { readonly type: "loaded"; readonly state: DesktopReviewState }
  | { readonly type: "failed"; readonly runId: string; readonly message: string }
  | { readonly type: "swap" }
  | { readonly type: "close" };

/** The footer's line while two runs are compared: nothing can be approved or exported here. */
export const comparingRunsNotice = "Comparing runs — read-only";

/** The footer's blocker line while comparing; the footer's actions are hidden meanwhile. */
export const comparingRunsBlocker: FooterBlocker = {
  kind: "waiting",
  text: comparingRunsNotice,
  tone: "neutral",
};

export function runComparisonReducer(
  current: RunComparisonState | null,
  event: RunComparisonEvent,
): RunComparisonState | null {
  switch (event.type) {
    case "choose":
      if (event.otherRunId === event.openRunId) return current;
      return {
        workspaceId: event.workspaceId,
        openRunId: event.openRunId,
        otherRunId: event.otherRunId,
        otherSide: "left",
        other: { status: "loading" },
      };
    case "loaded":
      // A read that arrives after another run was chosen, or from another workspace, is stale.
      if (
        current === null ||
        event.state.runId !== current.otherRunId ||
        event.state.workspaceId !== current.workspaceId
      ) {
        return current;
      }
      return {
        ...current,
        other: { status: "loaded", artifact: event.state.artifact },
        otherState: event.state,
      };
    case "failed":
      if (current === null || event.runId !== current.otherRunId) return current;
      return { ...current, other: { status: "failed", message: event.message } };
    case "swap":
      if (current === null) return current;
      return { ...current, otherSide: current.otherSide === "left" ? "right" : "left" };
    case "close":
      return null;
  }
}

/**
 * Whether the comparison still belongs to the review on screen. Opening another run or
 * workspace leaves the comparison, so it never reappears over a different run.
 */
export function runComparisonActive(
  comparison: RunComparisonState | null,
  state: Pick<DesktopReviewState, "workspaceId" | "runId">,
): comparison is RunComparisonState {
  return (
    comparison !== null &&
    comparison.workspaceId === state.workspaceId &&
    comparison.openRunId === state.runId
  );
}

/** The facts each side's header reads: run number, recorded models, round and status. */
export interface ComparedRunFacts {
  readonly runId: string;
  readonly label: string;
  readonly models: string;
  readonly round: string;
  readonly status: string;
  readonly latest: boolean;
}

/** A run's facts from the run list; a run missing from the list still names itself. */
export function comparedRunFacts(
  runs: readonly ApplicationRunRowView[] | null | undefined,
  runId: string,
): ComparedRunFacts {
  const list = runs ?? [];
  const index = list.findIndex((run) => run.runId === runId);
  const run = list[index];
  if (run === undefined) {
    return {
      runId,
      label: "Run",
      models: "models not recorded",
      round: "round unknown",
      status: "status unknown",
      latest: false,
    };
  }
  return {
    runId,
    label: `Run ${runNumber(index, list.length)}`,
    models: runModelsLabel(run),
    round: `round ${run.round}`,
    status: run.state.replaceAll("-", " "),
    latest: run.latest,
  };
}

/** One side of the comparison: whose draft it is, and the draft once it has been read. */
export interface ComparisonSide {
  readonly facts: ComparedRunFacts;
  readonly open: boolean;
  readonly draft: ComparedRunDraft;
  /** The run's review state, with what it recorded; null while the other run is being read. */
  readonly state: DesktopReviewState | null;
}

/**
 * The two sides in reading order. The open run's draft is the live review's, so it never waits
 * for a read; the redline marks the right side against the left.
 */
export function comparisonSides(
  comparison: RunComparisonState,
  state: DesktopReviewState,
): { readonly left: ComparisonSide; readonly right: ComparisonSide } {
  const open: ComparisonSide = {
    facts: comparedRunFacts(state.applicationRuns, comparison.openRunId),
    open: true,
    draft: { status: "loaded", artifact: state.artifact },
    state,
  };
  const other: ComparisonSide = {
    facts: comparedRunFacts(state.applicationRuns, comparison.otherRunId),
    open: false,
    draft: comparison.other,
    state: comparison.other.status === "loaded" ? (comparison.otherState ?? null) : null,
  };
  return comparison.otherSide === "left"
    ? { left: other, right: open }
    : { left: open, right: other };
}
