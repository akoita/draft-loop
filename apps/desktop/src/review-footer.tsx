/**
 * The review's footer: the approval gate in one place, always at the window's bottom edge.
 *
 * The footer states what blocks approval in one line above the buttons, so a refused approval
 * explains itself where the reviewer clicked. While a round runs, or a run waits to be resumed,
 * the round's progress with Stop or Resume takes the place of the buttons, so the round a
 * Request revision started reports where it was requested. An override of the final CV checks opens an inline
 * reason field, and the checklist and the longer explanation sit under a compact "Details"
 * disclosure that scrolls on its own and never pushes the buttons off screen.
 */
import { type JSX, type ReactNode, type RefObject, useEffect, useRef } from "react";

import { approvalBlockerId } from "./approval-gate-focus.js";
import {
  type ApprovalReadiness,
  type ApprovalReadinessBlocker,
  formatApprovalReadinessBlocker,
} from "./approval-readiness.js";
import {
  type ExportTemplate,
  exportTemplateDescriptions,
  exportTemplateLabels,
  exportTemplates,
} from "./export-template.js";
import { ExportTemplatePreview } from "./export-template-picker.js";
import { ACCEPT_UNAVAILABLE_NOTE } from "./finding-decision-help.js";
import { type FooterRunningRound, FooterRunningRoundStrip } from "./footer-running-round.js";
import {
  type DesktopReviewState,
  type ExportFormat,
  exportFormatLabels,
  exportFormats,
  reviewFindingSummary,
  roundLimitRecoveryRequired,
} from "./model.js";
import { inProgressStatus, reviewInProgress, uncritiquedStatus } from "./review-run-status.js";
import {
  maximumRevisionDirectionLength,
  revisionDirectionsUnavailableNote,
} from "./revision-direction.js";
import type { SendVerdict } from "./send-verdict.js";
import { CONSENSUS_READY_REASON, PERSISTING_FINDINGS_REASON } from "./stop-reason.js";

export type FooterBlockerKind =
  | "ready"
  | "findings"
  | "final-checks"
  | "approved"
  | "exported"
  | "no-artifact"
  | "waiting";

export interface FooterBlocker {
  readonly kind: FooterBlockerKind;
  /** One plain line naming what stands between the reviewer and approval. */
  readonly text: string;
  readonly tone: "safe" | "warning" | "neutral";
}

export const NO_REVISION_LEFT = "No revision left";

/** The export line for an exported run whose recorded export file is no longer readable. */
export const MISSING_EXPORT_LABEL =
  "The previous export can't be found. Export again to save a new copy.";

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/** A final-check blocker short enough for the footer line, e.g. "relevance 22% (80% needed)". */
export function compactReadinessBlocker(blocker: ApprovalReadinessBlocker): string {
  if (
    blocker.code === "unmet-rubric-threshold" &&
    blocker.dimension !== undefined &&
    blocker.score !== undefined &&
    blocker.threshold !== undefined
  ) {
    return `${blocker.dimension} ${percent(blocker.score)} (${percent(blocker.threshold)} needed)`;
  }
  const label = formatApprovalReadinessBlocker(blocker);
  return `${label[0]?.toLowerCase() ?? ""}${label.slice(1)}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The footer's one-line blocker for the current draft. It reads the same decisions the gate
 * enforces: the draft, the run's progress, blocking findings, the final CV checks, and the send
 * verdict for a draft that can be approved.
 */
export function footerBlocker(
  state: DesktopReviewState,
  readiness: ApprovalReadiness | null,
  verdict: SendVerdict | null,
): FooterBlocker {
  if (state.artifact.version <= 0) {
    return {
      kind: "no-artifact",
      text: "No draft yet: approval opens once the author produces a valid draft",
      tone: "neutral",
    };
  }
  if (state.exportPath !== null) {
    return { kind: "exported", text: `Exported to ${state.exportPath}`, tone: "safe" };
  }
  // A moved or deleted export file, or a workspace opened on another machine.
  if (state.state === "exported") {
    return {
      kind: "exported",
      text: "Exported · the previous export can't be found",
      tone: "warning",
    };
  }
  if (state.approval === "approved") {
    return {
      kind: "approved",
      text:
        readiness?.overridden === true
          ? "Approved past the final CV checks with a recorded reason · ready to export"
          : "Approved · ready to export",
      tone: "safe",
    };
  }
  if (roundLimitRecoveryRequired(state)) {
    return {
      kind: "waiting",
      text: `Round limit recovery required: return to reviewed Round ${state.round - 1}`,
      tone: "warning",
    };
  }
  if (reviewInProgress(state)) {
    return { kind: "waiting", text: inProgressStatus(state).label, tone: "neutral" };
  }
  if (!state.reviewComplete) {
    return {
      kind: "waiting",
      text: `${uncritiquedStatus(state).label}: approval needs a finished critique`,
      tone: "warning",
    };
  }
  const revisionLeft = state.round < state.providerTransmissionPreflight.budget.maxRounds;
  const noRevision = revisionLeft ? "" : ` · ${NO_REVISION_LEFT}`;
  const { blocking } = reviewFindingSummary(state);
  if (blocking.length > 0) {
    const accepted = blocking.filter((finding) => finding.decision === "accepted").length;
    const text =
      revisionLeft && accepted === blocking.length
        ? `${plural(accepted, "accepted blocking finding")} ${accepted === 1 ? "needs" : "need"} a revision`
        : `${plural(blocking.length, "blocking finding")} ${blocking.length === 1 ? "needs" : "need"} a decision`;
    // The run paused because the same finding came back; say so until the reviewer decides it.
    const undecided = blocking.some((finding) => finding.decision === "pending");
    if (undecided && state.evaluation.stopReason === "persisting-findings") {
      return { kind: "findings", text: PERSISTING_FINDINGS_REASON, tone: "warning" };
    }
    return {
      kind: "findings",
      text: revisionLeft ? text : `${text} · ${ACCEPT_UNAVAILABLE_NOTE}`,
      tone: "warning",
    };
  }
  if (readiness?.applicationReady === false) {
    return {
      kind: "final-checks",
      text: `Not ready: ${readiness.blockers.map(compactReadinessBlocker).join("; ")}${noRevision}`,
      tone: "warning",
    };
  }
  if (state.state === "provider-error") {
    return { kind: "waiting", text: "Provider recovery remains before approval", tone: "warning" };
  }
  if (verdict === null || verdict.ready) {
    const agreed = state.evaluation.stopReason === "consensus-ready";
    return {
      kind: "ready",
      text: `${agreed ? CONSENSUS_READY_REASON : "Ready to send"}${noRevision}`,
      tone: "safe",
    };
  }
  return {
    kind: "ready",
    text: `${verdict.headline}: ${verdict.reasons.join("; ")}${noRevision}`,
    tone: "warning",
  };
}

/**
 * Why this run can take no further revision, for the footer to show in place of the directions
 * field, or null while one is possible or only briefly blocked (a pending action, a critique
 * still running, an unacknowledged transmission).
 */
export function revisionUnavailableReason(
  state: Pick<DesktopReviewState, "state" | "approval" | "round" | "reviewComplete">,
  maximumRounds: number,
): string | null {
  if (state.approval === "approved" || state.state === "approved" || state.state === "exported") {
    return "The draft is approved, so this run takes no more revisions.";
  }
  if (state.state === "stopped" || state.state === "budget-exhausted") {
    return "This review has ended. Start a new review from Run details to revise again.";
  }
  if (state.reviewComplete && state.round >= maximumRounds) {
    return `${NO_REVISION_LEFT}: this run has used all ${maximumRounds} rounds.`;
  }
  return null;
}

export interface GateCondition {
  readonly id: string;
  readonly label: string;
  readonly met: boolean;
}

export const approvalOverrideFormId = "approval-override-form";
export const approvalDetailsId = "approval-details";

export interface ReviewFooterProps {
  readonly blocker: FooterBlocker;
  readonly readOnly: boolean;
  /** The running, paused or interrupted round shown in place of the buttons, or null. */
  readonly runningRound?: FooterRunningRound | null;
  /** An approval or export error to show above the buttons, or null. */
  readonly errorMessage: string | null;
  /** "Artifact … · Export … · Validation …" for the Details disclosure. */
  readonly statusLine: string;
  /** The longer explanation of the gate's state, shown under Details. */
  readonly detail: ReactNode;
  readonly conditions: readonly GateCondition[];
  readonly editNote: string | null;
  readonly detailsOpen: boolean;
  readonly onDetailsOpenChange: (open: boolean) => void;
  /** The round-limit repair, when the run opened a round past its limit. */
  readonly recovery: {
    readonly round: number;
    readonly disabled: boolean;
    readonly onRecover: () => void;
  } | null;
  readonly approve: { readonly disabled: boolean; readonly onApprove: () => void };
  /** Approving past failing final CV checks with a recorded reason, when that is possible. */
  readonly override: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly reason: string;
    readonly onReasonChange: (reason: string) => void;
    readonly disabled: boolean;
    readonly onSubmit: (reason: string) => void;
  } | null;
  readonly revision: {
    readonly disabled: boolean;
    readonly onRequest: () => void;
    /** The candidate's directions for the author, typed beside the button; sent with the request. */
    readonly direction: string;
    readonly onDirectionChange: (direction: string) => void;
    /** The run's author prompt cannot take directions: the field is disabled with a note. */
    readonly directionsUnavailable?: boolean;
    /**
     * Why this run cannot take another revision for now, e.g. because the draft is approved. The
     * directions field is then left out and the reason shown beside the disabled button; null
     * while a revision is possible or only briefly blocked.
     */
    readonly unavailableReason?: string | null;
  };
  readonly exportAction: {
    readonly disabled: boolean;
    readonly pathLabel: string;
    /** The run is already exported, so the button offers to export again. */
    readonly again: boolean;
    /** Elapsed seconds while an export is pending, or null. */
    readonly pendingSeconds: number | null;
    /** The format the next export is saved in. */
    readonly format: ExportFormat;
    readonly onFormatChange: (format: ExportFormat) => void;
    /** The rendering template the next export is drawn with. */
    readonly template: ExportTemplate;
    readonly onTemplateChange: (template: ExportTemplate) => void;
    /** An estimated-length warning from the export just made, or null. */
    readonly note: string | null;
    readonly onExport: () => void;
  };
}

/** CSS variable holding the footer's rendered height, for the room the page keeps below it. */
export const gateBarHeightVariable = "--gate-bar-height";

/**
 * Publish the footer's height on the document root while it is mounted. In the stacked layout
 * the footer is fixed to the window's bottom edge, and the page keeps this much room under its
 * last content so nothing stays hidden behind the bar.
 */
function usePublishedHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(
        gateBarHeightVariable,
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(gateBarHeightVariable);
    };
  }, [ref]);
}

/**
 * The footer at the foot of the review's side panel: below the panel's scroll area in the two-column desk,
 * and fixed to the window's bottom edge in the stacked layout.
 */
export function ReviewFooter({
  blocker,
  readOnly,
  runningRound = null,
  errorMessage,
  statusLine,
  detail,
  conditions,
  editNote,
  detailsOpen,
  onDetailsOpenChange,
  recovery,
  approve,
  override,
  revision,
  exportAction,
}: ReviewFooterProps): JSX.Element {
  const exportPending = exportAction.pendingSeconds !== null;
  const barRef = useRef<HTMLElement>(null);
  usePublishedHeight(barRef);
  const errorBanner =
    errorMessage === null ? null : (
      <div className="error-banner approval-action-error" role="alert">
        <p>{errorMessage}</p>
      </div>
    );
  return (
    <section className="gate-action-bar" aria-label="approval and export" ref={barRef}>
      <p
        id={approvalBlockerId}
        className={`gate-blocker gate-blocker-${blocker.tone}`}
        tabIndex={-1}
        role="status"
      >
        {blocker.text}
      </p>
      {recovery === null ? null : (
        <div className="round-limit-recovery-action">
          <button
            className="button button-primary"
            type="button"
            disabled={readOnly || recovery.disabled}
            onClick={recovery.onRecover}
          >
            Return to reviewed Round {recovery.round}
          </button>
        </div>
      )}
      {readOnly || runningRound === null ? null : (
        <>
          {errorBanner}
          <FooterRunningRoundStrip round={runningRound} />
        </>
      )}
      <fieldset
        className="gate-actions"
        aria-label="approval actions"
        hidden={readOnly || runningRound !== null}
      >
        {runningRound === null ? errorBanner : null}
        <div className="approval-actions">
          <button
            className="button button-primary"
            type="button"
            aria-keyshortcuts="Alt+A"
            title="Approve artifact (Alt+A)"
            disabled={approve.disabled}
            onClick={approve.onApprove}
          >
            Approve artifact
            <kbd>Alt+A</kbd>
          </button>
          {override === null ? null : (
            <button
              className="button button-outline"
              type="button"
              aria-expanded={override.open}
              aria-controls={approvalOverrideFormId}
              disabled={override.disabled}
              onClick={() => override.onOpenChange(!override.open)}
            >
              Approve with override…
            </button>
          )}
        </div>
        {override === null || !override.open ? null : (
          <section
            className="override-editor footer-override"
            id={approvalOverrideFormId}
            aria-label="Approve past final CV checks"
          >
            <label className="rationale-input-label">
              <span>Reason for approving anyway (required)</span>
              <input
                className="rationale-input"
                type="text"
                maxLength={500}
                value={override.reason}
                disabled={override.disabled}
                onChange={(event) => override.onReasonChange(event.target.value)}
                aria-label="Reason for approving past final CV checks"
              />
            </label>
            <div className="override-editor-actions">
              <button
                className="button button-quiet"
                type="button"
                onClick={() => override.onOpenChange(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={override.disabled || override.reason.trim() === ""}
                onClick={() => {
                  const reason = override.reason.trim();
                  if (reason === "") return;
                  override.onSubmit(reason);
                }}
              >
                Approve with override
              </button>
            </div>
          </section>
        )}
        <div className="revision-request">
          {revision.unavailableReason == null ? (
            <label className="revision-direction">
              <span>Directions for the author (optional)</span>
              <textarea
                className="revision-direction-input"
                rows={2}
                maxLength={maximumRevisionDirectionLength}
                value={revision.direction}
                disabled={revision.disabled || revision.directionsUnavailable === true}
                placeholder="e.g. lead with tokenisation; drop certification dates"
                onChange={(event) => revision.onDirectionChange(event.target.value)}
              />
            </label>
          ) : null}
          <div className="revision-request-row">
            <span className="revision-direction-note">
              {revision.unavailableReason != null
                ? revision.unavailableReason
                : revision.directionsUnavailable === true
                  ? revisionDirectionsUnavailableNote
                  : `Steers selection and framing for the next round. It is not evidence: the author still uses only your approved sources.${
                      revision.direction.length === 0
                        ? ""
                        : ` ${revision.direction.length}/${maximumRevisionDirectionLength}`
                    }`}
            </span>
            <button
              className="button button-quiet"
              type="button"
              aria-keyshortcuts="Alt+R"
              title="Request revision (Alt+R)"
              disabled={revision.disabled}
              onClick={revision.onRequest}
            >
              Request revision
              <kbd>Alt+R</kbd>
            </button>
          </div>
        </div>
        <div className="export-action">
          <div>
            <strong>Export locally</strong>
            <span className="export-path" aria-live="polite">
              {exportAction.pathLabel}
            </span>
          </div>
          <label className="export-format">
            <span className="sr-only">Export format</span>
            <select
              value={exportAction.format}
              disabled={exportAction.disabled}
              aria-label="Export format"
              onChange={(event) => {
                const chosen = exportFormats.find((format) => format === event.target.value);
                if (chosen !== undefined) exportAction.onFormatChange(chosen);
              }}
            >
              {exportFormats.map((format) => (
                <option key={format} value={format}>
                  {exportFormatLabels[format]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-outline"
            type="button"
            aria-keyshortcuts="Alt+E"
            title={
              exportAction.again
                ? `Export as ${exportFormatLabels[exportAction.format]} again (Alt+E)`
                : `Export as ${exportFormatLabels[exportAction.format]} (Alt+E)`
            }
            disabled={exportAction.disabled}
            onClick={exportAction.onExport}
          >
            {exportPending ? (
              `Exporting ${exportFormatLabels[exportAction.format]}…`
            ) : (
              <>
                {exportAction.again ? "Export again…" : "Export…"}
                <kbd>Alt+E</kbd>
              </>
            )}
          </button>
        </div>
        <fieldset className="export-templates" disabled={exportAction.disabled}>
          <legend>Template</legend>
          {exportTemplates.map((template) => (
            <label className="export-template-option" key={template}>
              <input
                type="radio"
                name="export-template"
                value={template}
                checked={exportAction.template === template}
                onChange={() => exportAction.onTemplateChange(template)}
              />
              <ExportTemplatePreview template={template} />
              <span className="export-template-text">
                <strong>{exportTemplateLabels[template]}</strong>
                <span>{exportTemplateDescriptions[template]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {exportAction.note === null ? null : (
          <p className="export-note" role="status">
            {exportAction.note}
          </p>
        )}
        {exportAction.pendingSeconds === null ? null : (
          <p className="pending-action-status" role="status" aria-live="polite">
            Exporting {exportFormatLabels[exportAction.format]}… Elapsed{" "}
            {exportAction.pendingSeconds} second
            {exportAction.pendingSeconds === 1 ? "" : "s"}. Choose a destination in the Save As
            dialog; the approved artifact will be written after you confirm.
          </p>
        )}
      </fieldset>
      <details
        className="gate-details"
        id={approvalDetailsId}
        open={detailsOpen}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          if (open !== detailsOpen) onDetailsOpenChange(open);
        }}
      >
        <summary>Details</summary>
        <div className="gate-details-body">
          <p className="subtle approval-status">{statusLine}</p>
          {detail}
          <ul className="gate-checklist">
            {conditions.map((condition) => (
              <li
                className={`gate-item ${condition.met ? "gate-met" : "gate-blocked"}`}
                key={condition.id}
              >
                <span className="gate-mark" aria-hidden="true">
                  {condition.met ? "✓" : "!"}
                </span>
                <span>
                  {condition.label}
                  <span className="sr-only">{condition.met ? " — met" : " — not met"}</span>
                </span>
              </li>
            ))}
          </ul>
          {editNote === null ? null : <p className="gate-edit-note">{editNote}</p>}
        </div>
      </details>
    </section>
  );
}
