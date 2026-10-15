/**
 * Two runs of one application side by side, opened from the run switcher's "Compare with…".
 *
 * The chosen run starts on the left and the open run on the right; the reviewer can swap them.
 * The right draft is marked against the left with the same redline as the version compare, so
 * a removal is struck and an addition underlined rather than told apart by colour alone.
 *
 * Above the drafts, a table compares what each run recorded (models, rounds, readiness,
 * coverage, blocking findings and cost) and says in words where the runs' inputs differ, so a
 * model pair is not credited for a better input. "Export comparison" saves that table, the input
 * differences and both drafts as a Markdown file where the reviewer picks.
 *
 * Both drafts are read-only. The other run's draft comes from a read-only load that leaves the
 * review on the open run, and the review stops every change while the comparison is shown.
 * "Close comparison" and Escape return to the open run.
 */
import { type JSX, useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { MarkdownFileSaveResult } from "./bridge.js";
import { BlockRedline, pairDraftSections } from "./draft-redline.js";
import type { DesktopReviewState, ReviewArtifact } from "./model.js";
import {
  comparisonMarkdownFits,
  runComparisonFileName,
  runComparisonMarkdown,
} from "./run-comparison-export.js";
import { type RunComparisonFacts, runComparisonFacts } from "./run-comparison-facts.js";
import {
  type ComparisonSide,
  comparisonSides,
  type RunComparisonState,
  runComparisonActive,
  runComparisonReducer,
} from "./run-comparison-model.js";
import { type ChooseRunDraft, RunDraftChoice, runDraftChoiceOffered } from "./run-draft-choice.js";

export type { ChooseRunDraft };

/** Reads one of the application's runs for comparison without opening it. */
export type LoadRunForComparison = (runId: string) => Promise<DesktopReviewState>;

/** Saves Markdown where the reviewer picks in a save dialog. */
export type SaveMarkdownFile = (
  suggestedName: string,
  content: string,
) => Promise<MarkdownFileSaveResult>;

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
  runs,
  onChooseRun,
}: {
  readonly side: ComparisonSide;
  readonly id: string;
  readonly runs: DesktopReviewState["applicationRuns"];
  readonly onChooseRun: ChooseRunDraft | undefined;
}): JSX.Element {
  const { facts } = side;
  const offered =
    onChooseRun !== undefined &&
    side.draft.status === "loaded" &&
    runDraftChoiceOffered(facts, runs);
  return (
    <div className="pane-heading run-comparison-heading">
      <span className="run-comparison-heading-title" id={id}>
        <strong>{facts.label}</strong>
        {side.open ? <span className="run-comparison-tag">open run</span> : null}
        {facts.latest ? <span className="run-switcher-latest">latest</span> : null}
        {facts.chosen ? <span className="run-switcher-chosen">chosen</span> : null}
      </span>
      <span className="run-comparison-facts">
        <span className="run-switcher-models">{facts.models}</span>
        <span>{facts.round}</span>
        <span>{facts.status}</span>
        {side.draft.status === "loaded" ? <span>v{side.draft.artifact.version}</span> : null}
      </span>
      {offered ? (
        <RunDraftChoice runId={facts.runId} label={facts.label} onChoose={onChooseRun} />
      ) : null}
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

/** What each run recorded, side by side, and where the runs' inputs differ. */
export function RunComparisonFactsTable({
  facts,
}: {
  readonly facts: RunComparisonFacts;
}): JSX.Element {
  return (
    <section className="run-comparison-summary" aria-label="What each run recorded">
      <table className="run-comparison-table">
        <caption className="subtle">Each value is what that run recorded.</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Fact</span>
            </th>
            <th scope="col">{facts.leftLabel}</th>
            <th scope="col">{facts.rightLabel}</th>
          </tr>
        </thead>
        <tbody>
          {facts.facts.map((fact) => (
            <tr key={fact.key} data-fact={fact.key}>
              <th scope="row">
                {fact.label}
                {fact.note === undefined ? null : (
                  <span className="run-comparison-note">{fact.note}</span>
                )}
              </th>
              <td data-run={facts.leftLabel}>{fact.left}</td>
              <td data-run={facts.rightLabel}>{fact.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="run-comparison-inputs">
        <h3>Input differences</h3>
        <ul>
          {facts.inputs.map((input) => (
            <li key={input.key} data-input={input.key} data-status={input.status}>
              {input.message}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type ExportStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly fileName: string | null }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

function ExportStatusLine({ status }: { readonly status: ExportStatus }): JSX.Element | null {
  switch (status.kind) {
    case "idle":
      return null;
    case "saving":
      return (
        <p className="subtle run-comparison-export-status" role="status">
          Saving the comparison…
        </p>
      );
    case "saved":
      return (
        <p className="subtle run-comparison-export-status" role="status">
          Comparison saved{status.fileName === null ? "" : ` as ${status.fileName}`}.
        </p>
      );
    case "cancelled":
      return (
        <p className="subtle run-comparison-export-status" role="status">
          Export cancelled; nothing was saved.
        </p>
      );
    case "failed":
      return (
        <p className="warning-copy run-comparison-export-status" role="alert">
          The comparison could not be saved: {status.message}
        </p>
      );
  }
}

/**
 * The comparison itself: a header with the swap, export and close controls, the runs' recorded
 * facts and input differences, and the two drafts. It carries no edit, decision or approval
 * control; the export only writes the file the reviewer picks, and "Use this run's draft" only
 * records which run the application approves and exports.
 */
export function RunComparisonView({
  comparison,
  state,
  onSwap,
  onClose,
  onSaveMarkdown,
  onChooseRun,
}: {
  readonly comparison: RunComparisonState;
  readonly state: DesktopReviewState;
  readonly onSwap: () => void;
  readonly onClose: () => void;
  /** Saves the exported comparison; absent when the host cannot save a file. */
  readonly onSaveMarkdown?: SaveMarkdownFile;
  /** Uses one side's draft for approval and export; absent offers no choice. */
  readonly onChooseRun?: ChooseRunDraft;
}): JSX.Element {
  const { left, right } = comparisonSides(comparison, state);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ kind: "idle" });
  const closeRef = useRef<HTMLButtonElement>(null);
  // Entering the comparison moves focus into it, so Tab continues from the comparison.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const leftArtifact = left.draft.status === "loaded" ? left.draft.artifact : null;
  const rightArtifact = right.draft.status === "loaded" ? right.draft.artifact : null;
  const facts =
    left.state === null || right.state === null
      ? null
      : runComparisonFacts(left.state, right.state, {
          left: left.facts.label,
          right: right.facts.label,
        });

  const exportComparison = (): void => {
    if (onSaveMarkdown === undefined || facts === null) return;
    const content = runComparisonMarkdown({ facts, left: leftArtifact, right: rightArtifact });
    if (!comparisonMarkdownFits(content)) {
      setExportStatus({
        kind: "failed",
        message: "it is larger than the 2 MB a saved file can be.",
      });
      return;
    }
    setExportStatus({ kind: "saving" });
    void onSaveMarkdown(runComparisonFileName(facts.leftLabel, facts.rightLabel), content).then(
      (result) =>
        setExportStatus(
          result.saved ? { kind: "saved", fileName: result.fileName } : { kind: "cancelled" },
        ),
      (reason: unknown) =>
        setExportStatus({
          kind: "failed",
          message:
            reason instanceof Error && reason.message !== ""
              ? reason.message
              : "The file could not be written.",
        }),
    );
  };

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
          {onSaveMarkdown === undefined ? null : (
            <button
              className="button button-quiet"
              type="button"
              disabled={facts === null || exportStatus.kind === "saving"}
              onClick={exportComparison}
            >
              Export comparison
            </button>
          )}
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
      <ExportStatusLine status={exportStatus} />
      {facts === null ? null : <RunComparisonFactsTable facts={facts} />}
      <div className="run-comparison-grid">
        <div className="diff-column run-comparison-side">
          <SideHeading
            side={left}
            id="run-comparison-left"
            runs={state.applicationRuns}
            onChooseRun={onChooseRun}
          />
          <article className="artifact-pane" aria-labelledby="run-comparison-left">
            {leftArtifact === null ? <DraftUnavailable side={left} /> : null}
            {leftArtifact === null ? null : <PlainDraft artifact={leftArtifact} />}
          </article>
        </div>
        <div className="diff-column run-comparison-side">
          <SideHeading
            side={right}
            id="run-comparison-right"
            runs={state.applicationRuns}
            onChooseRun={onChooseRun}
          />
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
