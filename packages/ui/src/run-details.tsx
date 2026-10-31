/**
 * Run provenance in a drawer: the review header summarises the run in one line, and **Run
 * details** opens a drawer from the right with the rest.
 *
 * Both name the models the run on screen recorded, read from its row in the application's run
 * list, never the pair configured for new runs; a run with no recorded models says so.
 *
 * The drawer holds the author and critic with their claimed lineages, the data and writing
 * policy, the evidence mode, the author input, the run's event timeline once it is not running,
 * and **Start a new review**. What the reviewer must act on or weigh stays outside it: run
 * progress and Stop while a run executes, Resume for a paused or interrupted run, and the
 * shared-lineage warning, which a person about to approve has to see.
 *
 * The drawer is a modal dialog. It stays mounted and `hidden` while closed, so its content is out
 * of the tab order; open, it traps focus, Escape or Close shuts it, and focus returns to the
 * header button.
 */

import { type JSX, type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import {
  type DesktopReviewState,
  type IndependentReviewView,
  type ReviewEvent,
  type RunWritingPolicyProjection,
  roundLimitRecoveryRequired,
} from "./model.js";
import { effortDisplayName, modelDisplayName } from "./model-profile-presentation.js";
import { useModalFocusTrap } from "./review.js";
import type { FooterBlocker } from "./review-footer.js";
import { RunTimeline } from "./review-panels.js";
import {
  canStartNewReview,
  finishedRunTitle,
  notIndexedRetrievalText,
  reviewFinished,
  reviewInProgress,
} from "./review-run-status.js";
import { runApplicationPlanDisplay } from "./run-application-plan.js";
import { runAuthorInputDisplay } from "./run-author-input.js";
import { runEvidenceModeDisplay } from "./run-evidence-mode.js";
import { plainStopReason } from "./stop-reason.js";

/** The time a direction was given, in the reader's locale; the recorded text when unreadable. */
function formatDirectionTime(createdAt: string): string {
  const time = new Date(createdAt);
  return Number.isNaN(time.getTime()) ? createdAt : time.toLocaleString();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A model's short name for the header line: "Opus 5.5" rather than "claude-opus-5-5". */
export function shortModelName(modelId: string): string {
  return modelDisplayName(modelId).replace(/^Claude /u, "");
}

/** The author and critic model ids the run recorded; an empty id means that role is unknown. */
export interface RecordedRunModels {
  readonly author: string;
  readonly critic: string;
  /** The reasoning level each role ran at, when the run used model profiles. */
  readonly authorEffort?: string;
  readonly criticEffort?: string;
}

/**
 * The models the run on screen recorded, from its row in the application's run list, or null when
 * it recorded none. The configured pair in `providerExposure` follows new runs, so it is never a
 * stand-in for what this run used.
 */
export function recordedRunModels(
  state: Pick<DesktopReviewState, "runId" | "applicationRuns">,
): RecordedRunModels | null {
  const row = state.applicationRuns?.find((run) => run.runId === state.runId);
  if (row === undefined || (row.authorModel === "" && row.criticModel === "")) return null;
  return {
    author: row.authorModel,
    critic: row.criticModel,
    ...(row.authorEffort === undefined ? {} : { authorEffort: row.authorEffort }),
    ...(row.criticEffort === undefined ? {} : { criticEffort: row.criticEffort }),
  };
}

const modelsNotRecorded = "models not recorded";

/** One role's recorded model, or "unknown" when only the other role's was recorded. */
function recordedModelLabel(modelId: string, name: (id: string) => string = (id) => id): string {
  return modelId === "" ? "unknown" : name(modelId);
}

type RunDetailsSummaryInput = Pick<
  DesktopReviewState,
  "runId" | "applicationRuns" | "state" | "setup" | "evidenceMode" | "writingPolicy"
>;

/** The evidence part of the header line, from the mode the run recorded or the setup's excerpts. */
function evidenceSummary(state: RunDetailsSummaryInput): string {
  const mode = state.evidenceMode;
  if (mode?.requestedMode === "full-source" && mode.effectiveMode === "full-source") {
    return `full source, ${plural(mode.chunkCount, "chunk")}`;
  }
  const fallback = runEvidenceModeDisplay(mode)?.kind === "fallback" ? "retrieval, " : "";
  if (state.setup.retrievalStatus === "not-indexed") {
    return `${fallback}${plural(state.setup.evidenceSourceCount, "source")}`;
  }
  return `${fallback}${plural(state.setup.selectedEvidenceChunkCount, "excerpt")}`;
}

/**
 * The run in one line for the header, e.g. "Opus 5.5 → GPT-6.1 Sol · full source, 282 chunks ·
 * policy active". The drawer has the detail behind each part.
 */
export function runDetailsSummary(state: RunDetailsSummaryInput): string {
  const recorded = recordedRunModels(state);
  const models =
    recorded === null
      ? modelsNotRecorded
      : `${recordedModelLabel(recorded.author, shortModelName)} → ${recordedModelLabel(recorded.critic, shortModelName)}`;
  const policy =
    state.writingPolicy === undefined || state.writingPolicy === null
      ? "no policy"
      : state.writingPolicy.lineage.kind === "workspace"
        ? "policy active"
        : "policy override";
  return `${models} · ${evidenceSummary(state)} · ${policy}`;
}

/**
 * Whether the "Next:" line names starting a new review, so it opens the drawer that holds
 * **Start a new review**. It mirrors the branches of `nextStepLine` that name that step.
 */
export function nextStepOpensRunDetails(
  state: DesktopReviewState,
  blocker: FooterBlocker,
): boolean {
  if (blocker.kind !== "no-artifact" && blocker.kind !== "waiting") return false;
  return (
    canStartNewReview(state) &&
    !reviewInProgress(state) &&
    !roundLimitRecoveryRequired(state) &&
    (blocker.kind === "no-artifact" || !state.reviewComplete)
  );
}

export function policyChecksumLabel(checksum: string): string {
  return `${checksum.slice(0, 12)}…`;
}

function policyLineageLabel(policy: RunWritingPolicyProjection): string {
  if (policy.lineage.kind === "workspace") return "Workspace policy";
  return `Base ${policy.base?.version ?? policy.lineage.base.version} → override ${policy.override?.version ?? policy.lineage.override.version}`;
}

/** How the trust facts present a recorded independence claim. */
type IndependenceTone = "independent" | "shared" | "unrecorded";

interface IndependenceSummary {
  readonly tone: IndependenceTone;
  readonly mark: string;
  readonly detail: string;
  readonly overrideRationale: string | null;
}

/**
 * Read the run's recorded independence claim, rather than re-deriving one.
 *
 * This panel used to compare provider companies. That proxy is wrong in both
 * directions, and the damaging direction is that it reports "independent" for
 * two vendors serving one open-weights base model, on the surface a person
 * reads immediately before approving. Independence is now model lineage and it
 * is recorded by the domain (ADR 0005), so the only correct thing to do here is
 * report the record.
 *
 * A lineage is an operator label that nothing verifies, so no branch may read
 * as proof, and no shared lineage may read as independent whatever rationale
 * was recorded against it. An absent record is its own state: it is not
 * evidence of independence and not evidence against it.
 */
function independenceSummary(view: IndependentReviewView | null): IndependenceSummary {
  if (view === null) {
    return {
      tone: "unrecorded",
      mark: "not recorded",
      detail:
        "No lineage claim was recorded. Either no run has started yet, or the run predates independence being recorded.",
      overrideRationale: null,
    };
  }
  if (!view.required) {
    return {
      tone: "unrecorded",
      mark: "not required",
      detail: `Independent review was not required for this run; the claimed lineages ${
        view.lineagesDistinct ? "differ" : "are the same"
      }.`,
      overrideRationale: null,
    };
  }
  if (view.lineagesDistinct) {
    return {
      tone: "independent",
      mark: "lineages differ",
      detail:
        "Author and critic lineages differ, as claimed. A lineage is an operator label that nothing verifies; two labels can name the same weights.",
      overrideRationale: null,
    };
  }
  if (view.overrideRationale !== null) {
    return {
      tone: "shared",
      mark: "overridden",
      detail:
        "Author and critic share one lineage, so this critique was not independent; the run proceeded on a recorded rationale.",
      overrideRationale: view.overrideRationale,
    };
  }
  return {
    tone: "shared",
    mark: "not independent",
    detail:
      "Author and critic share one lineage, and no override rationale was recorded, so this critique was not independent.",
    overrideRationale: null,
  };
}

/** The independence badge, and the override rationale a shared lineage proceeded on. */
function IndependenceBadge({ summary }: { readonly summary: IndependenceSummary }): JSX.Element {
  return (
    <>
      <div className={`trust-badge trust-badge-${summary.tone}`}>
        <span className="trust-badge-mark">{summary.mark}</span>
        <span>{summary.detail}</span>
      </div>
      {/* Operator prose, shown because a person about to approve has to weigh it.
          It is displayed locally and is never part of any provider request. */}
      {summary.overrideRationale === null ? null : (
        <div className="trust-override">
          <span className="trust-override-label">Override rationale</span>
          <p>{summary.overrideRationale}</p>
        </div>
      )}
    </>
  );
}

/**
 * The shared-lineage warning, kept in the side panel rather than the drawer: the critique was
 * not independent, and the reviewer weighs that before approving. Nothing renders otherwise.
 */
export function RunTrustWarning({
  independentReview,
}: {
  readonly independentReview: IndependentReviewView | null;
}): JSX.Element | null {
  const summary = independenceSummary(independentReview);
  if (summary.tone !== "shared") return null;
  return (
    <section className="trust-strip trust-warning" aria-label="independence warning">
      <IndependenceBadge summary={summary} />
    </section>
  );
}

/** The trust and policy facts: identities with lineage, data and writing policy, evidence. */
function RunTrustFacts({ state }: { readonly state: DesktopReviewState }): JSX.Element {
  const evidenceMode = runEvidenceModeDisplay(state.evidenceMode);
  const authorInput = runAuthorInputDisplay(state.authorInput);
  const applicationPlan = runApplicationPlanDisplay(state.applicationPlan);
  // Independence is what the run recorded, never something this renderer infers.
  const independence = independenceSummary(state.providerExposure.independentReview);
  const recorded = recordedRunModels(state);
  const { author: configuredAuthor, critic: configuredCritic } = state.providerExposure;
  const configuredDiffers =
    recorded === null ||
    recorded.author !== configuredAuthor.model ||
    recorded.critic !== configuredCritic.model;
  return (
    <section className="trust-strip" aria-label="trust and policy summary">
      {/* The lineage qualifies the identity it belongs to, so it is read here
          with the company and the model rather than apart from them. */}
      {/* The run's recorded models, never the configured pair. The run list records no company. */}
      <div className="trust-fact">
        <span className="label">Author</span>
        <strong>
          {recorded === null ? modelsNotRecorded : recordedModelLabel(recorded.author)}
        </strong>
        {recorded?.authorEffort === undefined ? null : (
          <span>{effortDisplayName(recorded.authorEffort)} reasoning</span>
        )}
        {state.providerExposure.independentReview === null ? null : (
          <span>claimed lineage {state.providerExposure.independentReview.authorLineage}</span>
        )}
      </div>
      <div className="trust-fact">
        <span className="label">Critic</span>
        <strong>
          {recorded === null ? modelsNotRecorded : recordedModelLabel(recorded.critic)}
        </strong>
        {recorded?.criticEffort === undefined ? null : (
          <span>{effortDisplayName(recorded.criticEffort)} reasoning</span>
        )}
        {state.providerExposure.independentReview === null ? null : (
          <span>claimed lineage {state.providerExposure.independentReview.criticLineage}</span>
        )}
      </div>
      {configuredDiffers ? (
        <p className="setup-note">
          New runs use: {configuredAuthor.model} → {configuredCritic.model}
        </p>
      ) : null}
      {/* A shared lineage is a warning, so the side panel shows it instead (RunTrustWarning). */}
      {independence.tone === "shared" ? null : <IndependenceBadge summary={independence} />}
      <div className="trust-fact">
        <span className="label">Data policy</span>
        <strong>
          {state.providerExposure.transmissionAllowed ? "Transmission approved" : "Local only"}
        </strong>
        <span>
          {state.providerExposure.requestedRetention} · sensitive material{" "}
          {state.providerExposure.sensitiveData ? "present" : "absent"}
        </span>
      </div>
      {state.writingPolicy === undefined || state.writingPolicy === null ? null : (
        <div className="trust-fact">
          <span className="label">Writing policy</span>
          <strong>{state.writingPolicy.effective.version}</strong>
          <span>
            Effective checksum {policyChecksumLabel(state.writingPolicy.effective.checksum)}
          </span>
          <span>{policyLineageLabel(state.writingPolicy)}</span>
        </div>
      )}
      <div className="trust-fact">
        <span className="label">Evidence</span>
        {evidenceMode?.kind === "full-source" ? (
          <>
            <strong className="numeric">{evidenceMode.panelValue}</strong>
            <span>{evidenceMode.panelDetail}</span>
          </>
        ) : state.setup.retrievalStatus === "not-indexed" ? (
          // Setup has not searched the evidence yet, so there are no excerpt counts to show.
          <>
            <strong className="numeric">
              {state.setup.evidenceSourceCount} source
              {state.setup.evidenceSourceCount === 1 ? "" : "s"}
            </strong>
            <span>{notIndexedRetrievalText(state)}</span>
          </>
        ) : (
          <>
            <strong className="numeric">
              {state.setup.selectedEvidenceChunkCount} excerpt
              {state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"}
            </strong>
            {evidenceMode?.kind === "fallback" ? (
              <span>{evidenceMode.panelDetail}</span>
            ) : (
              <span>
                from {state.setup.selectedEvidenceSourceCount} source
                {state.setup.selectedEvidenceSourceCount === 1 ? "" : "s"}
              </span>
            )}
          </>
        )}
      </div>
      {authorInput !== undefined && (
        <div className="trust-fact author-input-fact">
          <span className="label">Author input</span>
          <strong className="numeric">{authorInput.value}</strong>
          <span>{authorInput.detail}</span>
          {authorInput.gapSummary !== undefined && (
            <details className="author-input-gap">
              <summary>{authorInput.gapSummary}</summary>
              <ul>
                {authorInput.unmatchedRequirements.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
          )}
          {authorInput.direction !== undefined && (
            <p className="author-input-direction">
              <span className="label">Your directions for this round</span>
              <q>{authorInput.direction.text}</q>
              <time dateTime={authorInput.direction.createdAt}>
                {formatDirectionTime(authorInput.direction.createdAt)}
              </time>
            </p>
          )}
        </div>
      )}
      {applicationPlan !== undefined && (
        <div className="trust-fact application-plan-fact">
          <span className="label">Application plan</span>
          <span>{applicationPlan.reviewNote}</span>
          <ol className="application-plan-themes" aria-label="central themes">
            {applicationPlan.themes.map((theme) => (
              <li key={theme.title}>
                <strong>{theme.title}</strong> <span>{theme.rationale}</span>{" "}
                <span className="numeric">
                  {theme.proofCount} supporting accomplishment{theme.proofCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
          <p className="application-plan-leads">
            <span className="label">What leads</span>
            <span>{applicationPlan.summaryAngle}</span>
          </p>
          <ul className="application-plan-core-areas" aria-label="core areas">
            {applicationPlan.coreAreas.map((area) => (
              <li key={area}>{area}</li>
            ))}
          </ul>
          {applicationPlan.cuts.length > 0 && (
            <div className="application-plan-cuts">
              <span className="label">What is cut</span>
              <ul>
                {applicationPlan.cuts.map((cut) => (
                  <li key={`${cut.action}:${cut.target}`}>
                    {cut.action === "drop" ? "Drop" : "Compress"}: {cut.target} — {cut.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {applicationPlan.gaps.length > 0 && (
            <div className="application-plan-gaps">
              <span className="label">Gaps: central themes your evidence does not support</span>
              <ul>
                {applicationPlan.gaps.map((gap) => (
                  <li key={gap.title}>
                    <strong>{gap.title}</strong> <span>{gap.rationale}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {applicationPlan.reviewPoints.length > 0 && (
            <details className="application-plan-review">
              <summary>What the critic asked to change</summary>
              <ul>
                {applicationPlan.reviewPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

/** The header control: "Run details" and the run's one-line summary, which may truncate. */
export function RunDetailsButton({
  summary,
  open,
  controls,
  buttonRef,
  onOpen,
}: {
  readonly summary: string;
  readonly open: boolean;
  readonly controls: string;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <button
      className="run-details-button"
      type="button"
      ref={buttonRef}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={controls}
      title={summary}
      onClick={onOpen}
    >
      <span className="run-details-button-label">Run details</span>
      <span className="run-details-button-summary">{summary}</span>
    </button>
  );
}

/** Start a new review, as the drawer offers it once this run has ended. */
export interface RunDetailsStart {
  readonly disabled: boolean;
  readonly pending: boolean;
  /** Why starting is not possible yet; shown under the button. */
  readonly blockedReason: string | null;
  readonly onStart: () => void;
}

export function RunDetailsDrawer({
  id,
  open,
  onClose,
  returnFocusRef,
  state,
  describeState,
  start,
  autopilot,
}: {
  readonly id: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** The header button; focus returns to it when the drawer closes. */
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly state: DesktopReviewState;
  readonly describeState: (state: ReviewEvent["state"]) => string;
  /** Null for a read-only earlier run, which never starts another review. */
  readonly start: RunDetailsStart | null;
  /** The autopilot switch for a run that has not finished; null hides it. */
  readonly autopilot: ReactNode;
}): JSX.Element {
  const headingId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  useModalFocusTrap(open, drawerRef, onClose);

  // Runs after the trap's own cleanup has restored the previous focus, so the header button wins
  // even when the drawer was opened from the "Next:" line.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) returnFocusRef.current?.focus();
    wasOpen.current = open;
  }, [open, returnFocusRef]);

  const runInProgress = reviewInProgress(state);
  const runFinished = reviewFinished(state);
  const startable = start !== null && canStartNewReview(state);
  const stopReason = runInProgress
    ? null
    : plainStopReason(state.evaluation.stopReason, state.approvalReadiness ?? null);

  return (
    <div className="run-details-layer" hidden={!open}>
      <div className="run-details-backdrop" aria-hidden="true" onClick={onClose} />
      <section
        className="run-details-drawer"
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={drawerRef}
      >
        <div className="run-details-head">
          <h2 id={headingId}>Run details</h2>
          <button className="button button-quiet" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="run-details-body">
          <section className="run-details-run" aria-label="run history">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">{runFinished ? "Run history" : "Run progress"}</p>
                <h3>{runFinished ? finishedRunTitle(state) : describeState(state.state)}</h3>
              </div>
              {startable ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={start.disabled}
                  onClick={start.onStart}
                >
                  {start.pending ? "Starting new review…" : "Start a new review"}
                </button>
              ) : null}
            </div>
            {start === null ? null : startable && start.blockedReason !== null ? (
              <p className="setup-note setup-blocker" role="status">
                {start.blockedReason}
              </p>
            ) : runFinished ? (
              <p className="setup-note">
                A new review adds another run with the models set for new runs. This run, its
                approval and its export are kept.
              </p>
            ) : null}
            {stopReason === null ? null : (
              <p className="setup-note" role="status">
                {stopReason}
              </p>
            )}
            {runFinished || runInProgress ? null : autopilot}
            {/* While the run executes, its progress and timeline are in the side panel. */}
            {runInProgress ? (
              <p className="setup-note">The run's progress is in the side panel while it runs.</p>
            ) : (
              <RunTimeline events={state.events} describeState={describeState} />
            )}
          </section>
          <RunTrustFacts state={state} />
        </div>
      </section>
    </div>
  );
}
