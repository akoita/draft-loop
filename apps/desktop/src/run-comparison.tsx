/**
 * Two runs of one application side by side, opened from the run switcher's "Compare with…".
 *
 * The chosen run starts on the left and the open run on the right; the reviewer can swap them.
 * The right draft is marked against the left with the same redline as the version compare, so
 * a removal is struck and an addition underlined rather than told apart by colour alone.
 *
 * Both drafts are read-only. The other run's draft comes from a read-only load that leaves the
 * review on the open run, and the review stops every change while the comparison is shown.
 * "Close comparison" and Escape return to the open run.
 */
import { type JSX, useCallback, useEffect, useReducer, useRef } from "react";

import { BlockRedline, pairDraftSections } from "./draft-redline.js";
import type { DesktopReviewState, ReviewArtifact } from "./model.js";
import {
  type ComparisonSide,
  comparisonSides,
  type RunComparisonState,
  runComparisonActive,
  runComparisonReducer,
} from "./run-comparison-model.js";

/** Reads one of the application's runs for comparison without opening it. */
export type LoadRunForComparison = (runId: string) => Promise<DesktopReviewState>;

export interface RunComparisonControls {
  /** The comparison shown over the open run, or null when there is none. */
  readonly active: RunComparisonState | null;
  /** Compares the open run with another run; absent when runs cannot be read for comparison. */
  readonly compareWith: ((runId: string) => void) | undefined;
  readonly swap: () => void;
  readonly close: () => void;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error && reason.message !== ""
    ? reason.message
    : "The run could not be read.";
}

/**
 * Holds the comparison for the review. Opening another run or workspace leaves it, and Escape
 * leaves it unless something on the page already answered the key.
 */
export function useRunComparison(
  state: DesktopReviewState,
  loadRun: LoadRunForComparison | undefined,
  initial: RunComparisonState | null = null,
): RunComparisonControls {
  const [comparison, dispatch] = useReducer(runComparisonReducer, initial);
  const active = runComparisonActive(comparison, state) ? comparison : null;
  const workspaceId = state.workspaceId;
  const openRunId = state.runId;

  // A comparison left behind by opening another run must not reappear when that run is left.
  useEffect(() => {
    if (comparison !== null && active === null) dispatch({ type: "close" });
  }, [comparison, active]);

  const compareWith = useCallback(
    (runId: string) => {
      if (loadRun === undefined) return;
      dispatch({ type: "choose", workspaceId, openRunId, otherRunId: runId });
      void loadRun(runId).then(
        (loaded) => dispatch({ type: "loaded", state: loaded }),
        (reason: unknown) => dispatch({ type: "failed", runId, message: messageOf(reason) }),
      );
    },
    [loadRun, openRunId, workspaceId],
  );
  const swap = useCallback(() => dispatch({ type: "swap" }), []);
  const close = useCallback(() => {
    dispatch({ type: "close" });
    // Back on the open run, focus lands on its draft rather than on a control that is gone.
    setTimeout(() => document.getElementById("artifact-review")?.focus(), 0);
  }, []);

  const shown = active !== null;
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shown, close]);

  return { active, compareWith: loadRun === undefined ? undefined : compareWith, swap, close };
}

function SideHeading({
  side,
  id,
}: {
  readonly side: ComparisonSide;
  readonly id: string;
}): JSX.Element {
  const { facts } = side;
  return (
    <div className="pane-heading run-comparison-heading">
      <span className="run-comparison-heading-title" id={id}>
        <strong>{facts.label}</strong>
        {side.open ? <span className="run-comparison-tag">open run</span> : null}
        {facts.latest ? <span className="run-switcher-latest">latest</span> : null}
      </span>
      <span className="run-comparison-facts">
        <span className="run-switcher-models">{facts.models}</span>
        <span>{facts.round}</span>
        <span>{facts.status}</span>
        {side.draft.status === "loaded" ? <span>v{side.draft.artifact.version}</span> : null}
      </span>
    </div>
  );
}

function DraftUnavailable({ side }: { readonly side: ComparisonSide }): JSX.Element | null {
  if (side.draft.status === "loading") {
    return (
      <p className="empty-state" role="status">
        Reading the draft of {side.facts.label}…
      </p>
    );
  }
  if (side.draft.status === "failed") {
    return (
      <p className="warning-copy" role="alert">
        {side.facts.label} could not be read for comparison: {side.draft.message}
      </p>
    );
  }
  return null;
}

/** The left draft as it stands, without marks. */
function PlainDraft({ artifact }: { readonly artifact: ReviewArtifact }): JSX.Element {
  return (
    <>
      {artifact.sections.map((section) => (
        <section className="artifact-section" key={section.id}>
          <h3>{section.title}</h3>
          {section.blocks.map((block) => (
            <p className={block.type === "bullet" ? "bullet" : ""} key={block.id}>
              {block.text}
            </p>
          ))}
        </section>
      ))}
    </>
  );
}

/** The right draft, marked against the left one line by line. */
function MarkedDraft({
  artifact,
  against,
}: {
  readonly artifact: ReviewArtifact;
  readonly against: ReviewArtifact;
}): JSX.Element {
  const sections = pairDraftSections(artifact, against);
  return (
    <>
      {sections.map((section) => (
        <section
          className={`artifact-section${section.removed ? " artifact-section-removed" : ""}`}
          key={section.key}
        >
          <h3>{section.title}</h3>
          {section.blocks.map((pair) => {
            const className = pair.block?.type === "bullet" ? "bullet" : "";
            return pair.block === null ? (
              <p key={pair.key}>
                <del className="redline-del">{pair.text}</del>
              </p>
            ) : (
              <p className={className} key={pair.key}>
                <BlockRedline previousText={pair.previousText} text={pair.text} showChanges />
              </p>
            );
          })}
        </section>
      ))}
    </>
  );
}

/**
 * The comparison itself: a header with the swap and close controls, room for what later
 * compares the runs' facts, and the two drafts. It carries no edit, decision, approval or
 * export control.
 */
export function RunComparisonView({
  comparison,
  state,
  onSwap,
  onClose,
}: {
  readonly comparison: RunComparisonState;
  readonly state: DesktopReviewState;
  readonly onSwap: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const { left, right } = comparisonSides(comparison, state);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Entering the comparison moves focus into it, so Tab continues from the comparison.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const leftArtifact = left.draft.status === "loaded" ? left.draft.artifact : null;
  const rightArtifact = right.draft.status === "loaded" ? right.draft.artifact : null;

  return (
    <section className="run-comparison" aria-label="Run comparison">
      <header className="run-comparison-header">
        <div>
          <p className="eyebrow">Comparing runs · read-only</p>
          <h2>
            {left.facts.label} and {right.facts.label}
          </h2>
          <p className="subtle run-comparison-legend">
            {right.facts.label} is marked against {left.facts.label}: struck text is only in{" "}
            {left.facts.label}, underlined text only in {right.facts.label}.
          </p>
        </div>
        <div className="run-comparison-actions">
          <button
            className="button button-quiet"
            type="button"
            aria-label={`Swap sides: show ${right.facts.label} on the left`}
            onClick={onSwap}
          >
            Swap sides
          </button>
          <button
            className="button button-outline"
            type="button"
            ref={closeRef}
            aria-keyshortcuts="Escape"
            onClick={onClose}
          >
            Close comparison
          </button>
        </div>
      </header>
      <div className="run-comparison-grid">
        <div className="diff-column run-comparison-side">
          <SideHeading side={left} id="run-comparison-left" />
          <article className="artifact-pane" aria-labelledby="run-comparison-left">
            {leftArtifact === null ? <DraftUnavailable side={left} /> : null}
            {leftArtifact === null ? null : <PlainDraft artifact={leftArtifact} />}
          </article>
        </div>
        <div className="diff-column run-comparison-side">
          <SideHeading side={right} id="run-comparison-right" />
          <article className="artifact-pane" aria-labelledby="run-comparison-right">
            {rightArtifact === null ? <DraftUnavailable side={right} /> : null}
            {rightArtifact !== null && leftArtifact !== null ? (
              <MarkedDraft artifact={rightArtifact} against={leftArtifact} />
            ) : null}
            {rightArtifact !== null && leftArtifact === null ? (
              <PlainDraft artifact={rightArtifact} />
            ) : null}
          </article>
        </div>
      </div>
    </section>
  );
}
