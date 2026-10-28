import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ApplicationJobResult } from "./application-job-contract.js";
import {
  ApplicationJobStep,
  ApplicationStepsView,
  JobDescriptionInputs,
  OpportunityOverrideDisclosure,
} from "./application-steps.js";
import { applicationStepStates, jobStepOffersExtraction } from "./application-steps-model.js";
import { approvalAttemptNeedsGate, useApprovalGateFocus } from "./approval-gate-focus.js";
import { approvalReadinessForArtifact, approvalReadinessGuidance } from "./approval-readiness.js";
import { AutopilotToggle } from "./autopilot-toggle.js";
import { CompareSplitHandle, useCompareSplit } from "./compare-split.js";
import { RequirementCoveragePanel } from "./coverage-panel.js";
import { BlockRedline, type DraftBlockPair, pairDraftSections } from "./draft-redline.js";
import { DraftWidthHandle, draftWidthStyle, useDraftWidth } from "./draft-width.js";
import {
  chosenRunAllowsAction,
  chosenRunRefusal,
  earlierRunAllowsAction,
  earlierRunRefusal,
  isChosenEarlierRun,
} from "./earlier-run.js";
import { EarlierRunNotice } from "./earlier-run-view.js";
import { formatElapsedDuration } from "./elapsed-duration.js";
import {
  defaultExportTemplate,
  type ExportTemplate,
  exportTemplateApplicationKey,
} from "./export-template.js";
import { useExportTemplate } from "./export-template-picker.js";
import {
  ACCEPT_UNAVAILABLE_NOTE,
  ACCEPTED_WITHOUT_REVISION_NUDGE,
  acceptedWithoutRevision,
  acceptUnavailable,
  BULK_ACCEPT_SKIPS_WORD_MATCH_NOTE,
  bulkBlockingSkipNote,
  bulkDecisionTargetsForDecision,
  bulkWordMatchWarning,
} from "./finding-decision-help.js";
import {
  FindingDecisionHint,
  findingAcceptGuardId,
  findingDecisionHintId,
} from "./finding-decision-hint.js";
import { findingProgressLine } from "./finding-progress.js";
import { findingTitle } from "./finding-title.js";
import {
  executionLine,
  footerRunningRound,
  type SentRevisionDirection,
  sentRevisionDirection,
} from "./footer-running-round.js";
import { JobDescriptionPanel } from "./job-description-panel.js";
import {
  briefOperationsOf,
  JobRequirementsExtraction,
  type JobRequirementsExtractionBinding,
} from "./job-requirements-extraction.js";
import {
  knownGapReadinessOverride,
  MARK_KNOWN_GAPS_NOTE,
  markKnownGapsLabel,
  pendingConfirmedGapIds,
} from "./known-gaps.js";
import {
  type DesktopReviewState,
  type ExportFormat,
  exportFormatLabels,
  type FindingDecision,
  type IndependentReviewView,
  isUnresolvedFinding,
  type ProviderFailureView,
  type ReviewAction,
  type ReviewArtifact,
  type ReviewFinding,
  reviewFindingSummary,
  roundLimitRecoveryRequired,
} from "./model.js";
import { OpportunityBriefReviewAction } from "./opportunity-brief-review.js";
import type { ProviderSignInReadiness } from "./provider-sign-in-readiness.js";
import { formatReadinessBlockers } from "./readiness-blocker-groups.js";
import type { PendingReviewAction } from "./review-dispatch.js";
import {
  footerBlocker,
  MISSING_EXPORT_LABEL,
  ReviewFooter,
  revisionUnavailableReason,
} from "./review-footer.js";
import { PanelToggle, RunTimeline, useCollapsedReviewPanels } from "./review-panels.js";
import {
  canStartNewReview,
  inProgressStatus,
  notIndexedRetrievalText,
  reviewInProgress,
  uncritiquedStatus,
} from "./review-run-status.js";
import {
  availableReviewWorkTab,
  coverageTabLabel,
  defaultReviewWorkTab,
  findingsTabLabel,
  jobTabLabel,
  nextStepLine,
  nextStepTarget,
  ReviewWorkTabs,
  reviewWorkPanelProps,
  useReviewWorkTab,
} from "./review-work-tabs.js";
import { sendRevisionRequest } from "./revision-direction.js";
import {
  type ChooseRunDraft,
  type LoadRunForComparison,
  RunComparisonView,
  type SaveMarkdownFile,
  useRunComparison,
} from "./run-comparison.js";
import { comparingRunsBlocker, type RunComparisonState } from "./run-comparison-model.js";
import { runCostLabel } from "./run-cost.js";
import {
  nextStepOpensRunDetails,
  policyChecksumLabel,
  RunDetailsButton,
  RunDetailsDrawer,
  RunTrustWarning,
  runDetailsSummary,
} from "./run-details.js";
import { type RunEvidenceModeView, runEvidenceModeDisplay } from "./run-evidence-mode.js";
import { RunSwitcher } from "./run-switcher.js";
import { sendVerdict } from "./send-verdict.js";
import { SidePanelHandle, useSidePanelWidth } from "./side-panel-width.js";
import { revealStartTarget, StartChecklistView, startActionTargets } from "./start-checklist.js";
import {
  type StartActionId,
  startButtonLabel,
  startChecklist,
  startChecklistId,
  startChecklistTooltip,
  startJobCardId,
} from "./start-checklist-model.js";
import {
  type StartCandidateProfile,
  StartConfirmation,
  type StartModelProfiles,
  type StartReviewAction,
  startConfirmationHandlers,
  startConfirmationSummary,
  useStartEvidencePreview,
} from "./start-confirmation.js";
import {
  LatestRequirementsBriefView,
  StartFromJobDescriptionChoice,
  StartRequirementsSourceView,
  useLatestOpportunity,
  withLatestBriefRefresh,
} from "./start-requirements.js";
import {
  briefReviewActionKey,
  jobRequirementsExtractionId,
  offersRequirementsExtraction,
  requirementRefusalAction,
  reviewedRequirementsSelection,
  startRequirementsChoice,
} from "./start-requirements-model.js";
import { submitOnEnter } from "./submit-on-enter.js";
import { ThemeToggle } from "./theme.js";
import { usageLimitText } from "./usage-limit.js";

interface ReviewWorkspaceProps {
  readonly state: DesktopReviewState;
  readonly onAction: (action: ReviewAction) => void;
  /** Opens one of the application's runs from the run list; `null` returns to the latest run. */
  readonly onOpenRun?: (runId: string | null) => void;
  /** Reads another run for the run comparison without opening it; absent offers no comparison. */
  readonly onLoadRunForComparison?: LoadRunForComparison;
  /** Saves an exported run comparison where the reviewer picks; absent offers no export. */
  readonly onSaveMarkdownFile?: SaveMarkdownFile;
  /** The host downloads exports in the browser instead of writing them to a chosen file. */
  readonly exportsDownload?: boolean;
  /**
   * Uses a run's draft for approval and export, with an optional reason, and opens that run;
   * absent offers no choice in the run comparison.
   */
  readonly onChooseRun?: ChooseRunDraft;
  /** The run comparison to start on; for static rendering in tests. */
  readonly initialRunComparison?: RunComparisonState | null;
  readonly onBulkFindingDecision?: (
    findingIds: readonly string[],
    decision: DirectFindingDecision,
  ) => void;
  /** Overrides every listed confirmed coverage gap with the known-gap reason (#1873). */
  readonly onMarkKnownGaps?: (findingIds: readonly string[]) => void;
  readonly pendingBulkFindingCount?: number | null;
  readonly pendingReviewAction?: PendingReviewAction | null;
  readonly onSelectFiles?: (
    target: "evidence" | "job-description" | "writing-policy" | "writing-policy-override",
  ) => void;
  readonly onAddUrl?: (target: "evidence" | "job-description", url: string) => void;
  /** Lets the Target job description card extract requirements into a draft opportunity brief. */
  readonly jobRequirements?: JobRequirementsExtractionBinding;
  /** Reads the application's job description back for the Job tab; without it there is no tab. */
  readonly onReadJob?: () => Promise<ApplicationJobResult>;
  readonly errorMessage?: string | null;
  /** Optional exact-profile gate shared by every new-run trigger. */
  readonly startDisabledReason?: string | null;
  /** Optional native model-settings action shown in the workspace header. */
  readonly modelSettingsAction?: ReactNode;
  /** The career profile a new run pins, for the start confirmation; `null` when none is pinned. */
  readonly startCandidateProfile?: StartCandidateProfile | null;
  /** The model profiles a new run applies, for the tier the start confirmation shows. */
  readonly startModelProfiles?: StartModelProfiles;
  /** What evidence a new run would send, asked for when the start confirmation opens. */
  readonly previewStartEvidence?: () => Promise<RunEvidenceModeView | null>;
  /** Replaces the plain workspace heading, e.g. with one that can be renamed. */
  readonly workspaceTitle?: ReactNode;
  /** Optional workspace navigation shown in the workspace header. */
  readonly workspaceNavigationAction?: ReactNode;
  /** Profile controls rendered in the collecting/setup workspace. */
  readonly profilePanel?: ReactNode;
  /** The "Edit policy" action for the Writing policy setup card. */
  readonly writingPolicyAction?: ReactNode;
  /** Opens Home, where workspace-level setup (provider authentication) lives. */
  readonly onOpenHome?: () => void;
  /** The run pair's provider sign-in as the host's status reads report it, for the checklist. */
  readonly providerSignInReadiness?: ProviderSignInReadiness;
  /**
   * Compact cards for the inputs that have their own screens (career evidence, career profile,
   * workspace settings). When set, the setup screen shows them in place of the full panels and
   * keeps only what starting a review needs.
   */
  readonly setupSummary?: ReactNode;
  /**
   * The application's own model pair choice, shown first in the Review step. It is told to hold
   * while a start is pending or an earlier run is open.
   */
  readonly modelPairChoice?: (disabled: boolean) => ReactNode;
  /** The flow strip linking the workspace's other pages, shown above the header. */
  readonly pageNavigation?: ReactNode;
  /** A notice under the run header, such as the request to name the application. */
  readonly headerNotice?: ReactNode;
}

const decisionLabels: Readonly<Record<FindingDecision, string>> = {
  pending: "Pending",
  accepted: "Accept",
  rejected: "Reject",
  deferred: "Defer",
  overridden: "Override",
};

export type FindingQueueFilter = "needs-action" | "blocking" | "warnings" | "resolved";

export interface FindingQueueCounts {
  readonly needsAction: number;
  readonly blocking: number;
  readonly warnings: number;
  readonly resolved: number;
}

export interface InitialFindingQueueState {
  readonly filter: FindingQueueFilter;
  readonly expandedFindingId: string | null;
}

/** The export action; Markdown and Modern, the defaults, are sent without a field. */
export function exportReviewAction(format: ExportFormat, template: ExportTemplate): ReviewAction {
  return {
    type: "export",
    ...(format === "markdown" ? {} : { format }),
    ...(template === defaultExportTemplate ? {} : { template }),
  };
}

export function canExportReview(
  state: Pick<DesktopReviewState, "state" | "reviewComplete">,
  pendingReviewAction: PendingReviewAction | null,
): boolean {
  // An exported run can be exported again, for example after its file was moved or deleted.
  return (
    (state.state === "approved" || state.state === "exported") &&
    state.reviewComplete &&
    pendingReviewAction === null
  );
}

const findingQueueFilters: ReadonlyArray<{
  readonly id: FindingQueueFilter;
  readonly label: string;
}> = [
  { id: "needs-action", label: "Needs action" },
  { id: "blocking", label: "Blocking" },
  { id: "warnings", label: "Warnings" },
  { id: "resolved", label: "Resolved" },
];

export type DirectFindingDecision = Exclude<FindingDecision, "pending" | "overridden">;

const directFindingDecisions: readonly DirectFindingDecision[] = [
  "accepted",
  "rejected",
  "deferred",
];

/** One key, one decision. Bare letters, because deciding is the repetitive act here. */
const findingDecisionKeys: Readonly<
  Record<string, Exclude<FindingDecision, "pending" | "overridden">>
> = {
  a: "accepted",
  r: "rejected",
  d: "deferred",
};

/** One entry in the command palette: an action of this workspace, reachable by its name. */
interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  /** What the command does, or the shortcut it mirrors. */
  readonly note: string;
  /** Why the command cannot run right now, or null when it can. */
  readonly disabledReason: string | null;
  readonly run: () => void;
}

/** Narrows the palette by a plain substring of the command's own words. */
function matchPaletteCommands(
  commands: readonly PaletteCommand[],
  query: string,
): readonly PaletteCommand[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return commands;
  return commands.filter((command) =>
    `${command.label} ${command.note}`.toLowerCase().includes(needle),
  );
}

export function findingQueueCounts(findings: readonly ReviewFinding[]): FindingQueueCounts {
  let needsAction = 0;
  let blocking = 0;
  let warnings = 0;
  let resolved = 0;

  for (const finding of findings) {
    if (!isUnresolvedFinding(finding)) {
      resolved += 1;
    } else if (finding.severity === "error") {
      needsAction += 1;
      blocking += 1;
    } else {
      needsAction += 1;
      warnings += 1;
    }
  }

  return { needsAction, blocking, warnings, resolved };
}

export function defaultFindingQueueFilter(findings: readonly ReviewFinding[]): FindingQueueFilter {
  return findingQueueCounts(findings).needsAction > 0 ? "needs-action" : "resolved";
}

export function filterFindingQueue(
  findings: readonly ReviewFinding[],
  filter: FindingQueueFilter,
): readonly ReviewFinding[] {
  switch (filter) {
    case "needs-action":
      return findings.filter(isUnresolvedFinding);
    case "blocking":
      return findings.filter(
        (finding) => isUnresolvedFinding(finding) && finding.severity === "error",
      );
    case "warnings":
      return findings.filter(
        (finding) => isUnresolvedFinding(finding) && finding.severity === "warning",
      );
    case "resolved":
      return findings.filter((finding) => !isUnresolvedFinding(finding));
  }
}

/** Findings a bulk action may change: unresolved, visible in the active filter, and not already set. */
export function bulkFindingDecisionTargets(
  findings: readonly ReviewFinding[],
  filter: FindingQueueFilter,
  decision: DirectFindingDecision,
): readonly string[] {
  return filterFindingQueue(findings, filter)
    .filter((finding) => isUnresolvedFinding(finding) && finding.decision !== decision)
    .map((finding) => finding.id);
}

export function findingQueueFilterCount(
  counts: FindingQueueCounts,
  filter: FindingQueueFilter,
): number {
  switch (filter) {
    case "needs-action":
      return counts.needsAction;
    case "blocking":
      return counts.blocking;
    case "warnings":
      return counts.warnings;
    case "resolved":
      return counts.resolved;
  }
}

export function initialFindingQueueState(
  findings: readonly ReviewFinding[],
): InitialFindingQueueState {
  const filter = defaultFindingQueueFilter(findings);
  return {
    filter,
    expandedFindingId:
      filter === "needs-action" ? (filterFindingQueue(findings, filter)[0]?.id ?? null) : null,
  };
}

export function nextActionableFindingId(
  findings: readonly ReviewFinding[],
  currentFindingId: string,
): string | null {
  const actionable = findings.filter(isUnresolvedFinding);
  if (actionable.length === 0) return null;

  const currentIndex = findings.findIndex((finding) => finding.id === currentFindingId);
  const following = actionable.filter(
    (finding) =>
      finding.id !== currentFindingId &&
      (currentIndex < 0 ||
        findings.findIndex((candidate) => candidate.id === finding.id) > currentIndex),
  );
  return (
    following[0]?.id ??
    actionable.find((finding) => finding.id !== currentFindingId)?.id ??
    currentFindingId
  );
}

export function findingQueueEmptyMessage(
  filter: FindingQueueFilter,
  counts: FindingQueueCounts,
): string {
  if (filter === "needs-action" && counts.needsAction === 0) {
    return counts.resolved > 0 ? "All findings are resolved." : "No findings need action yet.";
  }
  if (filter === "blocking" && counts.blocking === 0) return "No blocking findings need action.";
  if (filter === "warnings" && counts.warnings === 0) return "No warnings need action.";
  if (filter === "resolved" && counts.resolved === 0) return "No findings have been resolved yet.";
  return "No findings match this filter.";
}

export function isOverrideEditorVisible(
  editingFindingId: string | null,
  findingId: string,
): boolean {
  return editingFindingId === findingId;
}

function findingDomId(prefix: string, findingId: string): string {
  return `${prefix}-${findingId.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
}

function stateLabel(value: DesktopReviewState["state"]): string {
  return value.replaceAll("-", " ");
}

const loopSteps = ["Draft", "Critique", "Revise", "Approve"] as const;

/** Where the run currently sits on the author–critic loop, for the rail readout. */
export function loopStageIndex(state: DesktopReviewState): number {
  switch (state.state) {
    case "collecting":
      return -1;
    case "drafting":
      return 0;
    case "reviewing":
      return 1;
    case "revising":
      return 2;
    case "awaiting-approval":
      return 3;
    case "approved":
    case "exported":
      return loopSteps.length;
    default:
      if (state.execution.step === "author") return 0;
      if (state.execution.step === "critic") return 1;
      if (state.execution.step === "revision") return 2;
      return state.reviewComplete ? 3 : 1;
  }
}

/** DraftLoop mark: the author–critic loop, drawn as a returning spiral. */
export function BrandMark({ className = "rail-mark" }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M21 12a9 9 0 1 1-3.6-7.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.6 12a4.4 4.4 0 1 0 4.4-4.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 1 0-5.1-5.1l-1.2 1.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 1 0 5.1 5.1l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M8.5 6.5 17 12l-8.5 5.5V6.5Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The row above the spine: the career flow on the left and the workspace-level actions on the
 * right, where Home and the career pages keep them too. The spine stays about the run.
 */
function PageToolbar({
  navigation,
  children,
}: {
  readonly navigation: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="page-toolbar">
      {navigation}
      <div className="page-toolbar-actions">{children}</div>
    </div>
  );
}

/**
 * The rail is a table of contents for the workspace, not a toolbar: four destinations, each
 * one place a reviewer actually goes. It carries no section-in-view state, because the draft
 * and the queue scroll in two independent columns and are almost always both on screen —
 * an "active" mark there would be decoration that lies. `onOpenSources` is null before a run
 * exists, when there is no document, no queue and no traceability to reach.
 */
function SideRail({
  onOpenSources,
  onOpenFindings,
}: {
  readonly onOpenSources: (() => void) | null;
  /** Bring the Findings tab forward and move to the queue. */
  readonly onOpenFindings?: () => void;
}) {
  return (
    <nav className="side-rail" aria-label="Workspace sections">
      <BrandMark />
      {onOpenSources === null ? null : (
        <>
          <a className="rail-button" href="#artifact-review" title="Document — the draft">
            <span className="sr-only">Document — the draft</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <rect
                x="4.5"
                y="3"
                width="15"
                height="18"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M8.5 8h7M8.5 12h7M8.5 16h4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </a>
          <button
            className="rail-button"
            type="button"
            title="Findings — the queue"
            onClick={onOpenFindings}
          >
            <span className="sr-only">Findings — the queue</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path
                d="M4 6h16M4 12h16M4 18h10"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className="rail-button"
            type="button"
            title="Sources — claim traceability"
            onClick={onOpenSources}
          >
            <span className="sr-only">Sources — claim traceability</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path
                d="M12 4.5 3.8 8.2 12 11.9l8.2-3.7L12 4.5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M4.4 12.2 12 15.6l7.6-3.4M4.4 16.1 12 19.5l7.6-3.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      )}
      <span className="rail-spacer" />
      <ThemeToggle />
    </nav>
  );
}

function LoopRail({
  activeIndex,
  round,
}: {
  readonly activeIndex: number;
  readonly round: number;
}) {
  return (
    <div className="loop-rail">
      <ol className="loop-steps" aria-label="Author–critic loop stage">
        {loopSteps.map((label, index) => (
          <li
            className={`loop-step${index < activeIndex ? " loop-step-done" : ""}${
              index === activeIndex ? " loop-step-active" : ""
            }`}
            key={label}
            {...(index === activeIndex ? { "aria-current": "step" as const } : {})}
          >
            <span className="loop-node" aria-hidden="true">
              {index < activeIndex ? "✓" : ""}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <svg
        className="loop-arc"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M97 1C97 11 3 11 3 1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="loop-round">↺ round {round}</span>
    </div>
  );
}

/**
 * The approval-gate label for the recorded independence claim.
 *
 * The gate states what the run recorded. A shared lineage that proceeded on a
 * rationale is reported as overridden rather than met, so the checklist never
 * reads as though an independent critique happened when the record says it did
 * not.
 */
function independenceGateLabel(view: IndependentReviewView | null): string {
  if (view === null) return "Independence claim recorded";
  if (!view.required) return "Independent review not required for this run";
  if (view.lineagesDistinct) return "Author and critic lineages differ, as claimed";
  if (view.overrideRationale !== null) {
    return "Shared lineage overridden on a recorded rationale; critique was not independent";
  }
  return "Author and critic share one lineage; critique was not independent";
}

/** The failed call's step, and its role when another role's call failed that step. */
function failedCallLabel({ step, role }: Pick<ProviderFailureView, "step" | "role">): string {
  const stepRole = step === "critic" ? "critic" : "author";
  return role === stepRole ? step : `${role} call in the ${step} step`;
}

function retryWaitMs(retryNotBefore: string | null, nowMs: number): number {
  if (retryNotBefore === null) return 0;
  const retryAt = Date.parse(retryNotBefore);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : 0;
}

function retryWaitLabel(waitMs: number): string {
  const seconds = Math.max(1, Math.ceil(waitMs / 1_000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/**
 * A modal owns the focus ring while it is open: focus moves in, Tab cycles inside it, Escape
 * closes it from anywhere, and focus returns to wherever the reviewer was. One implementation,
 * so the credential dialog and the command palette cannot drift apart.
 */
export function useModalFocusTrap(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  // The close callback is read at event time, so a new closure each render does not
  // re-run the trap and steal focus back to the top of the dialog.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableElements = (): readonly HTMLElement[] =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusableElements()[0]?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (first === undefined || last === undefined) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [dialogRef, open]);
}

// Measuring a textarea needs a layout, and the server render has none.
const useSheetLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function claimSectionTitle(
  artifact: DesktopReviewState["artifact"],
  claimId: string,
): string | null {
  for (const section of artifact.sections) {
    if (section.blocks.some((block) => block.claimIds.includes(claimId))) return section.title;
  }
  return null;
}

function claimBlockId(artifact: DesktopReviewState["artifact"], claimId: string): string | null {
  for (const section of artifact.sections) {
    for (const block of section.blocks) {
      if (block.claimIds.includes(claimId)) return block.id;
    }
  }
  return null;
}

/** A draft line is "sourced" only when every claim it asserts links to candidate material. */
function blockSourceState(
  block: DesktopReviewState["artifact"]["sections"][number]["blocks"][number],
  claimById: ReadonlyMap<string, DesktopReviewState["artifact"]["claims"][number]>,
): "none" | "sourced" | "unsourced" {
  if (block.claimIds.length === 0) return "none";
  return block.claimIds
    .map((id) => claimById.get(id))
    .every(
      (claim) => claim !== undefined && claim.status !== "disputed" && claim.evidence.length > 0,
    )
    ? "sourced"
    : "unsourced";
}

/** One unresolved finding, tied to the draft line whose wording it judges. */
interface MarginNote {
  readonly finding: ReviewFinding;
  readonly blockId: string;
}

/** Where each margin note sits beside the paper, once the sheet has been measured. */
interface MarginNotePlacement {
  /** Note top, in pixels from the top of the paper, after collision avoidance. */
  readonly tops: ReadonlyMap<string, number>;
  /** The line the note actually judges, so a pushed note keeps a slanted connector. */
  readonly anchors: ReadonlyMap<string, number>;
  /** Notes pushed clear off the foot of the page; they collapse into the "more" affordance. */
  readonly overflow: readonly string[];
  /** Foot of the lowest placed note, so the margin column can be given a real height. */
  readonly contentBottom: number;
}

interface MarginNoteLayout extends MarginNotePlacement {
  readonly columnHeight: number;
}

/** Clear space between two stacked notes. */
const MARGIN_NOTE_GUTTER = 10;
/** Space kept free at the foot of the margin for the "+N more" affordance. */
const MARGIN_MORE_RESERVE = 44;
/** Where the connector meets the note, measured from the note's own top edge. */
const MARGIN_NOTE_ATTACH = 13;

interface MarginNoteBox {
  readonly id: string;
  readonly anchor: number;
  readonly height: number;
}

/**
 * Stacks the notes down the margin. A note sits beside its own line whenever there is room;
 * otherwise it is pushed just clear of the note above, and its connector slants to say so.
 * A note may hang past the foot of the paper, the way marginalia does; a note pushed so far
 * that it no longer starts beside any line is reported as overflow instead.
 */
export function placeMarginNotes(
  boxes: readonly MarginNoteBox[],
  available: number,
): MarginNotePlacement {
  const ordered = [...boxes].sort((left, right) => left.anchor - right.anchor);
  const tops = new Map<string, number>();
  const anchors = new Map<string, number>();
  const overflow: string[] = [];
  let cursor = 0;
  let contentBottom = 0;
  let spilled = false;

  for (const box of ordered) {
    const top = Math.max(box.anchor, cursor);
    if (spilled || top > available) {
      spilled = true;
      overflow.push(box.id);
      continue;
    }
    tops.set(box.id, top);
    anchors.set(box.id, box.anchor);
    contentBottom = Math.max(contentBottom, top + box.height);
    cursor = top + box.height + MARGIN_NOTE_GUTTER;
  }

  return { tops, anchors, overflow, contentBottom };
}

function sameMarginLayout(left: MarginNoteLayout | null, right: MarginNoteLayout): boolean {
  if (left === null) return false;
  if (left.tops.size !== right.tops.size) return false;
  if (left.columnHeight !== right.columnHeight) return false;
  if (left.overflow.length !== right.overflow.length) return false;
  if (left.overflow.some((id, index) => right.overflow[index] !== id)) return false;
  for (const [id, top] of right.tops) {
    if (left.tops.get(id) !== top) return false;
    if (left.anchors.get(id) !== right.anchors.get(id)) return false;
  }
  return true;
}

function claimSourceLabel(claim: DesktopReviewState["artifact"]["claims"][number]): string {
  if (claim.status === "disputed") return "source conflict";
  return claim.evidence.length > 0 ? "source linked" : "not linked to candidate materials";
}

/**
 * What approving does with the candidate's edits (#1901): it makes the next version carrying
 * them, which the critic has not reviewed. Null without edits.
 */
export function approvalEditNote(
  artifact: Pick<ReviewArtifact, "version" | "sections">,
  editedThisSession: ReadonlySet<string>,
): string | null {
  const edited = new Set(editedThisSession);
  for (const section of artifact.sections)
    for (const block of section.blocks) if (block.edited === true) edited.add(block.id);
  if (edited.size === 0) return null;
  const edits = `your ${edited.size} edit${edited.size === 1 ? "" : "s"}`;
  return `Approving makes v${artifact.version + 1} with ${edits}; the critic has not reviewed them.`;
}

export function ReviewWorkspace({
  state,
  onAction: dispatchReviewAction,
  onOpenRun,
  onLoadRunForComparison,
  onSaveMarkdownFile,
  exportsDownload = false,
  onChooseRun,
  initialRunComparison = null,
  onBulkFindingDecision,
  onMarkKnownGaps,
  pendingBulkFindingCount = null,
  pendingReviewAction = null,
  onSelectFiles,
  onAddUrl,
  jobRequirements,
  onReadJob,
  errorMessage,
  startDisabledReason = null,
  modelSettingsAction,
  startCandidateProfile,
  startModelProfiles,
  previewStartEvidence,
  workspaceNavigationAction,
  workspaceTitle,
  profilePanel,
  writingPolicyAction,
  onOpenHome,
  providerSignInReadiness,
  setupSummary,
  modelPairChoice,
  pageNavigation,
  headerNotice,
}: ReviewWorkspaceProps) {
  const workspaceLabel = state.workspaceName ?? state.workspaceId;
  // An earlier run is read-only: its controls are hidden or disabled, every change it would send
  // stops here, and the host refuses one that gets through. So is a run comparison.
  const runComparison = useRunComparison(state, onLoadRunForComparison, initialRunComparison);
  // The comparison takes the desk: the side panel and the open run's banners step aside.
  const comparing = runComparison.active !== null;
  const readOnly = (state.earlierRun !== undefined && state.earlierRun !== null) || comparing;
  // The earlier run the person chose stays read-only but for approval, export and the finding
  // decisions approval needs; revision and new rounds stay on the latest run.
  const chosenRunOpen = !comparing && isChosenEarlierRun(state.earlierRun);
  const approvalOpen = !readOnly || chosenRunOpen;
  const onAction = useCallback(
    (action: ReviewAction): void => {
      const allowed = chosenRunOpen ? chosenRunAllowsAction : earlierRunAllowsAction;
      if (readOnly && !allowed(action.type)) return;
      dispatchReviewAction(action);
    },
    [readOnly, chosenRunOpen, dispatchReviewAction],
  );
  const { latest: latestBrief, refresh: refreshLatestBrief } = useLatestOpportunity(
    jobRequirements?.getLatestOpportunity,
    state.workspaceId,
    `${state.setup.reviewedOpportunity?.briefId ?? ""}:${state.setup.reviewedOpportunity?.version ?? 0}`,
  );
  const requirementsBinding =
    jobRequirements === undefined
      ? undefined
      : withLatestBriefRefresh(jobRequirements, refreshLatestBrief);
  const briefOperations =
    requirementsBinding === undefined ? undefined : briefOperationsOf(requirementsBinding);
  const [rawJobChoice, setRawJobChoice] = useState<string | null>(null);
  const [extractionSignal, setExtractionSignal] = useState(0);
  const findingSummary = reviewFindingSummary(state);
  const evidenceMode = runEvidenceModeDisplay(state.evidenceMode);
  const { blocking: blockingFindings, warnings } = findingSummary;
  const acceptedBlockingFindings = blockingFindings.filter(
    (finding) => finding.decision === "accepted",
  );
  const hasArtifact = state.artifact.version > 0;
  const approvalReadiness = approvalReadinessForArtifact(state.approvalReadiness, state.artifact);
  const maximumRounds = state.providerTransmissionPreflight.budget.maxRounds;
  const roundLimitRecovery = roundLimitRecoveryRequired(state);
  const roundLimitReached = state.round >= maximumRounds;
  // The same signal that disables Request revision: at the round limit no revision can fix an
  // accepted finding, so Accept stops being a way to resolve a blocking one.
  const decisionContext = useMemo(
    () => ({ revisionAvailable: !roundLimitReached }),
    [roundLimitReached],
  );
  const claimById = useMemo(
    () => new Map(state.artifact.claims.map((claim) => [claim.id, claim])),
    [state.artifact.claims],
  );
  // Which draft lines this reviewer changed in this session. Session-local UI
  // state: it says what a signature would cover, and is not part of the run.
  const [editedBlockIds, setEditedBlockIds] = useState<ReadonlySet<string>>(() => new Set());
  // Settled known gaps are the override for the word-match checks they fail (#1903), and edits
  // change the version the host checks again at approval (#1902), so neither waits for a
  // separate override.
  const knownGapOverride = knownGapReadinessOverride(approvalReadiness, state.findings);
  const editNote = approvalEditNote(state.artifact, editedBlockIds);
  const readinessSettled =
    approvalReadiness?.applicationReady !== false || knownGapOverride !== null || editNote !== null;
  const canApprove =
    approvalOpen &&
    hasArtifact &&
    state.state === "awaiting-approval" &&
    state.reviewComplete &&
    blockingFindings.length === 0 &&
    readinessSettled;
  // Final CV checks are heuristics, so a person who has reviewed the draft can
  // approve past them with a recorded reason, as with blocking findings.
  const canOverrideReadiness =
    approvalOpen &&
    hasArtifact &&
    state.state === "awaiting-approval" &&
    state.reviewComplete &&
    blockingFindings.length === 0 &&
    approvalReadiness?.applicationReady === false &&
    knownGapOverride === null;
  const canExport = approvalOpen && canExportReview(state, pendingReviewAction);
  const exportPending = pendingReviewAction?.action === "export";
  const approvalExportErrorVisible =
    errorMessage !== undefined && errorMessage !== null && state.state !== "collecting";
  const runInProgress = reviewInProgress(state);
  // Only a reviewed, still unapproved draft gets a verdict; elsewhere the gate explains the state.
  const verdict =
    hasArtifact &&
    state.reviewComplete &&
    !runInProgress &&
    !roundLimitRecovery &&
    state.approval !== "approved"
      ? sendVerdict({ blocking: blockingFindings, warnings, readiness: approvalReadiness })
      : null;
  const runStatusLine = runInProgress
    ? inProgressStatus(state)
    : !state.reviewComplete
      ? uncritiquedStatus(state)
      : null;
  const validationLabel = runInProgress
    ? (runStatusLine?.label ?? "")
    : !hasArtifact
      ? "No draft artifact available"
      : knownGapOverride !== null && state.approval !== "approved"
        ? "Final CV checks fail only on known gaps"
        : approvalReadiness?.applicationReady === false && state.approval !== "approved"
          ? "Final CV checks block approval"
          : roundLimitRecovery
            ? "Round limit recovery required"
            : !state.reviewComplete
              ? (runStatusLine?.label ?? "")
              : state.state === "provider-error"
                ? "Provider recovery remains before approval"
                : findingSummary.status === "blocked"
                  ? `${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? "" : "s"}`
                  : findingSummary.status === "warnings"
                    ? `${warnings.length} unresolved warning${warnings.length === 1 ? "" : "s"}`
                    : "No unresolved findings";
  const [jobUrl, setJobUrl] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [exportTemplate, setExportTemplate] = useExportTemplate(
    exportTemplateApplicationKey(state),
  );
  const [overrideReasons, setOverrideReasons] = useState<Readonly<Record<string, string>>>({});
  const readinessOverrideKey = `${state.runId}:${state.artifact.id}:${state.artifact.version}`;
  const [readinessOverrideDraft, setReadinessOverrideDraft] = useState({
    key: readinessOverrideKey,
    reason: "",
  });
  const readinessOverrideReason =
    readinessOverrideDraft.key === readinessOverrideKey ? readinessOverrideDraft.reason : "";
  // The directions belong to the round they were typed for; a new round starts with none.
  const revisionDirectionKey = `${state.runId}:${state.round}`;
  const [revisionDirectionDraft, setRevisionDirectionDraft] = useState({
    key: revisionDirectionKey,
    text: "",
  });
  const revisionDirection =
    revisionDirectionDraft.key === revisionDirectionKey ? revisionDirectionDraft.text : "";
  // A run whose recorded author prompt predates directions cannot take them.
  const directionsUnavailable = state.runInputs?.authorDirections === false;
  // The footer quotes the directions sent while the round they steer runs.
  const [sentDirection, setSentDirection] = useState<SentRevisionDirection | null>(null);
  const runPanelRef = useRef<HTMLElement>(null);
  const revealRunPanelRequested = useRef(false);
  // Every way to request a revision sends the typed directions, then clears them.
  const requestRevision = useCallback((): void => {
    const direction = directionsUnavailable ? "" : revisionDirection;
    setSentDirection(sentRevisionDirection(state, direction));
    revealRunPanelRequested.current = true;
    sendRevisionRequest(direction, onAction, () =>
      setRevisionDirectionDraft({ key: revisionDirectionKey, text: "" }),
    );
  }, [directionsUnavailable, onAction, revisionDirection, revisionDirectionKey, state]);
  const showRunPanel = useCallback((): void => {
    runPanelRef.current?.scrollIntoView({ block: "nearest" });
  }, []);
  // The side panel may be scrolled down to the findings; once the requested round runs, bring
  // Run progress back into view.
  useEffect(() => {
    if (!runInProgress || !revealRunPanelRequested.current) return;
    revealRunPanelRequested.current = false;
    showRunPanel();
  }, [runInProgress, showRunPanel]);
  const initialQueueState = useMemo(
    () => initialFindingQueueState(state.findings),
    [state.findings],
  );
  const [findingFilter, setFindingFilter] = useState<FindingQueueFilter>(
    () => initialQueueState.filter,
  );
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(
    () => initialQueueState.expandedFindingId,
  );
  const [overrideEditingFindingId, setOverrideEditingFindingId] = useState<string | null>(null);
  const findingDecisionRequest = useRef<{
    readonly findingId: string;
    readonly decision: Exclude<FindingDecision, "pending">;
  } | null>(null);
  const findingSummaryButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const findingQueueContext = useRef(`${state.workspaceId}:${state.runId}`);
  const overrideInputRefs = useRef(new Map<string, HTMLInputElement>());
  const [linkedClaimId, setLinkedClaimId] = useState<string | null>(null);
  const draftBlockRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const draftBlockShellRefs = useRef(new Map<string, HTMLDivElement>());
  // The margin: findings drawn beside the line they judge, the way a proof-reader marks a
  // manuscript. Position is measured, never guessed, so a note never drifts off its sentence.
  const sheetRef = useRef<HTMLElement | null>(null);
  const marginColumnRef = useRef<HTMLDivElement | null>(null);
  const docGridRef = useRef<HTMLDivElement | null>(null);
  const marginNoteRefs = useRef(new Map<string, HTMLLIElement>());
  const [marginLayout, setMarginLayout] = useState<MarginNoteLayout | null>(null);
  // Which finding the reviewer is pointing at, wherever they are pointing at it from.
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const queueFocusRequest = useRef<{
    readonly findingId: string;
    readonly target: "summary" | "override";
  } | null>(null);
  // A draft line is a two-state cell: a marked-up reading view, or the editor. Only one line
  // is open at a time, and which one is session-local UI state, not part of the run.
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftView, setDraftView] = useState<"changes" | "full">("changes");
  const [compareOpen, setCompareOpen] = useState(false);
  // The command palette: every action in this workspace reachable by name, with the reason
  // written on any action that cannot run yet.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const paletteDialogRef = useRef<HTMLDivElement | null>(null);
  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  // The start a person is confirming: every Start trigger opens the check first, and only its
  // Start button sends the trigger's own action.
  const [pendingStart, setPendingStart] = useState<StartReviewAction | null>(null);
  const startConfirmationRef = useRef<HTMLDivElement | null>(null);
  // Where a palette command wants focus to land. Applied after the palette has returned focus
  // to wherever the reviewer was, so the destination wins.
  const paletteFocusRequest = useRef<HTMLElement | null>(null);
  const traceabilityRef = useRef<HTMLDetailsElement | null>(null);
  const traceabilitySummaryRef = useRef<HTMLElement | null>(null);
  const reviewColumnRef = useRef<HTMLElement | null>(null);
  const findingQueueRef = useRef<HTMLElement | null>(null);
  const hasPreviousArtifact = state.previousArtifact !== null;
  // Nothing to compare against on a first version, so the redline is unavailable, not empty.
  const showChanges = hasPreviousArtifact && draftView === "changes";
  const draftPaneMode = `${showChanges ? "redline · " : ""}${readOnly ? "read-only" : "editable"}`;
  const compareVisible = hasPreviousArtifact && compareOpen;
  const [compareSplit, setCompareSplit] = useCompareSplit();
  const sidePanel = useSidePanelWidth();
  const draftWidth = useDraftWidth();
  const { collapsed: collapsedPanels, toggle: togglePanel } = useCollapsedReviewPanels();
  // The footer's Details hold the checklist; a refused approval opens them.
  const [gateDetailsOpen, setGateDetailsOpen] = useState(false);
  const expandGate = useCallback(() => setGateDetailsOpen(true), []);
  const [readinessOverrideOpen, setReadinessOverrideOpen] = useState(false);
  const { revealGate: revealApprovalGate, attemptApproval } = useApprovalGateFocus({
    state,
    needsGate: approvalAttemptNeedsGate(approvalReadiness, state.approval),
    pending: pendingReviewAction !== null,
    expandGate,
  });
  const approveArtifact = useCallback((): void => {
    attemptApproval();
    onAction(
      knownGapOverride === null
        ? { type: "approve" }
        : { type: "approve", readinessOverrideRationale: knownGapOverride },
    );
  }, [attemptApproval, knownGapOverride, onAction]);
  const locateDraftBlock = (blockId: string): void => {
    draftBlockShellRefs.current
      .get(blockId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Opening the line moves the caret into it.
    setEditingBlockId(blockId);
    draftBlockRefs.current.get(blockId)?.focus();
  };
  const draftSections = useMemo(
    () => pairDraftSections(state.artifact, state.previousArtifact),
    [state.artifact, state.previousArtifact],
  );
  // A finding earns a place in the margin only when it names a claim that resolves to a line
  // on the page. Everything else stays in the queue, which remains the complete list.
  const marginNotes = useMemo<readonly MarginNote[]>(() => {
    const notes: MarginNote[] = [];
    for (const finding of state.findings) {
      if (!isUnresolvedFinding(finding) || finding.claimId === undefined) continue;
      const blockId = claimBlockId(state.artifact, finding.claimId);
      if (blockId === null) continue;
      notes.push({ finding, blockId });
    }
    return notes;
  }, [state.artifact, state.findings]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmedPolicyFingerprint, setConfirmedPolicyFingerprint] = useState<string | null>(null);
  const queueCounts = findingQueueCounts(state.findings);
  // Whether a critique has judged the current draft; before it, there is nothing to resolve.
  const critiqued = hasArtifact && state.reviewComplete;
  const { selected: chosenWorkTab, select: selectWorkTab } = useReviewWorkTab(
    defaultReviewWorkTab(queueCounts.needsAction),
  );
  const workTabs = [
    findingsTabLabel(queueCounts.needsAction),
    ...(state.coverage === undefined || state.coverage === null
      ? []
      : [coverageTabLabel(state.coverage)]),
    ...(onReadJob === undefined ? [] : [jobTabLabel]),
  ];
  const workTab = availableReviewWorkTab(chosenWorkTab, workTabs);
  const tabbedWork = workTabs.length > 1;
  // Under another tab the queue shows no current finding, as a folded queue did before.
  const findingsCollapsed = tabbedWork && workTab !== "findings";
  const expandFindings = useCallback(() => selectWorkTab("findings"), [selectWorkTab]);
  const [coverageCardsShown, setCoverageCardsShown] = useState(false);
  const filteredFindings = filterFindingQueue(state.findings, findingFilter);
  const findingDecisionPending = pendingReviewAction?.action === "finding-decision";
  // An approved run shows its finding decisions as they were recorded; the host refuses new ones.
  const findingDecisionsOpen =
    approvalOpen && state.state !== "approved" && state.state !== "exported";
  const findingDecisionsLocked = !findingDecisionsOpen || findingDecisionPending;
  const bulkDecisionAvailable =
    findingDecisionsOpen &&
    onBulkFindingDecision !== undefined &&
    findingFilter !== "resolved" &&
    filteredFindings.some(isUnresolvedFinding);
  const bulkWordMatchNote = bulkWordMatchWarning(filteredFindings.filter(isUnresolvedFinding));
  const bulkBlockingNote = bulkBlockingSkipNote(
    filteredFindings.filter(isUnresolvedFinding),
    decisionContext,
  );
  const knownGapIds =
    findingDecisionsOpen && onMarkKnownGaps !== undefined
      ? pendingConfirmedGapIds(state.findings)
      : [];
  const knownGapsLabel = markKnownGapsLabel(knownGapIds.length);
  const previousNeedsActionCount = useRef(queueCounts.needsAction);
  const policyConfirmed =
    confirmedPolicyFingerprint === state.providerTransmissionPreflight.fingerprint;
  const transmissionReady =
    !state.providerTransmissionPreflight.required ||
    state.providerTransmissionPreflight.acknowledged;
  const retryRemainingMs = retryWaitMs(state.providerFailure?.retryNotBefore ?? null, nowMs);
  const gateConditions: readonly { id: string; label: string; met: boolean }[] = [
    { id: "draft", label: "Draft artifact produced", met: hasArtifact },
    // `reviewComplete` measures that a critique finished, not that it was
    // independent. Calling it "independent" here would restate the over-claim
    // the trust strip was corrected to avoid: an overridden shared-lineage run
    // completes a critique that was, by its own record, not independent.
    { id: "critique", label: "Critique completed", met: state.reviewComplete },
    {
      id: "independence",
      label: independenceGateLabel(state.providerExposure.independentReview),
      met: state.providerExposure.independentReview?.lineagesDistinct === true,
    },
    {
      id: "blocking",
      label: "Blocking findings resolved or overridden",
      met: hasArtifact && blockingFindings.length === 0,
    },
    ...(approvalReadiness !== null &&
    (state.approval !== "approved" || approvalReadiness.overridden === true)
      ? [
          {
            id: "application-readiness",
            label:
              approvalReadiness.overridden === true
                ? "Final CV checks overridden with a recorded reason"
                : "Final CV checks passed",
            met: approvalReadiness.applicationReady || approvalReadiness.overridden === true,
          },
        ]
      : []),
    ...(state.providerTransmissionPreflight.required
      ? [
          {
            id: "transmission",
            label: "Provider transmission acknowledged",
            met: state.providerTransmissionPreflight.acknowledged,
          },
        ]
      : []),
  ];
  const costLabel = runCostLabel(state);
  const budgetRatio =
    state.budgetUsd === null || state.budgetUsd <= 0
      ? null
      : Math.min(1, state.totalCostUsd / state.budgetUsd);

  useEffect(() => {
    const nextContext = `${state.workspaceId}:${state.runId}`;
    if (findingQueueContext.current === nextContext) return;

    findingQueueContext.current = nextContext;
    previousNeedsActionCount.current = queueCounts.needsAction;
    const nextQueueState = initialFindingQueueState(state.findings);
    setFindingFilter(nextQueueState.filter);
    setExpandedFindingId(nextQueueState.expandedFindingId);
    setOverrideEditingFindingId(null);
    setEditedBlockIds(new Set());
    setEditingBlockId(null);
    findingDecisionRequest.current = null;
  }, [queueCounts.needsAction, state.findings, state.runId, state.workspaceId]);

  useEffect(() => {
    const previousCount = previousNeedsActionCount.current;
    previousNeedsActionCount.current = queueCounts.needsAction;
    if (previousCount !== 0 || queueCounts.needsAction === 0) return;

    setFindingFilter("needs-action");
    setExpandedFindingId(filterFindingQueue(state.findings, "needs-action")[0]?.id ?? null);
    setOverrideEditingFindingId(null);
  }, [queueCounts.needsAction, state.findings]);

  useEffect(() => {
    if (!findingDecisionPending && findingDecisionRequest.current !== null) {
      const request = findingDecisionRequest.current;
      const updatedFinding = state.findings.find((finding) => finding.id === request.findingId);
      findingDecisionRequest.current = null;
      if (updatedFinding?.decision !== request.decision) return;

      const visibleFindings = filterFindingQueue(state.findings, findingFilter);
      const nextFindingId = nextActionableFindingId(visibleFindings, request.findingId);
      setExpandedFindingId(nextFindingId);
      setOverrideEditingFindingId(null);
      if (nextFindingId !== null) {
        findingSummaryButtonRefs.current.get(nextFindingId)?.focus();
      }
    }
  }, [findingDecisionPending, findingFilter, state.findings]);

  useEffect(() => {
    if (findingFilter === "needs-action" && queueCounts.needsAction === 0) {
      setFindingFilter("resolved");
      setExpandedFindingId(null);
    }
  }, [findingFilter, queueCounts.needsAction]);

  useEffect(() => {
    setNowMs(Date.now());
    if (state.providerFailure?.retryNotBefore === null || state.providerFailure === null) {
      return undefined;
    }
    const retryAt = Date.parse(state.providerFailure.retryNotBefore);
    if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNowMs(currentTime);
      if (currentTime >= retryAt) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state.providerFailure?.retryNotBefore, state.providerFailure]);

  // A draft line takes exactly the height of its own text, so the sheet shows
  // no blank filler under a short summary.
  const draftBlockText = state.artifact.sections
    .flatMap((section) => section.blocks.map((block) => block.text))
    .join("\u001f");

  useSheetLayoutEffect(() => {
    for (const textarea of draftBlockRefs.current.values()) {
      // A hidden editor has no layout to measure; it is sized when its line opens.
      if (textarea.hidden) continue;
      textarea.style.height = "auto";
      // These boxes are border-box, and scrollHeight excludes the border.
      const frame = textarea.offsetHeight - textarea.clientHeight;
      textarea.style.height = `${textarea.scrollHeight + frame}px`;
    }
  }, [draftBlockText, editingBlockId]);

  // Opening a line moves the caret into it, however the line was opened.
  useEffect(() => {
    if (editingBlockId === null) return;
    draftBlockRefs.current.get(editingBlockId)?.focus();
  }, [editingBlockId]);

  // The margin is measured, not laid out by the flow: a note has to line up with a sentence
  // inside the paper, and only the browser knows where that sentence ended up.
  useSheetLayoutEffect(() => {
    const sheet = sheetRef.current;
    const column = marginColumnRef.current;
    if (sheet === null || column === null || marginNotes.length === 0) {
      setMarginLayout(null);
      return undefined;
    }

    const measure = (): void => {
      // Below the narrow breakpoint the margin is removed altogether and the queue is the
      // only view of findings, so there is nothing to place.
      if (column.offsetParent === null) {
        setMarginLayout(null);
        return;
      }
      const sheetTop = sheet.getBoundingClientRect().top;
      const boxes: MarginNoteBox[] = [];
      for (const note of marginNotes) {
        const shell = draftBlockShellRefs.current.get(note.blockId);
        const element = marginNoteRefs.current.get(note.finding.id);
        if (shell === undefined || element === undefined) continue;
        boxes.push({
          id: note.finding.id,
          anchor: shell.getBoundingClientRect().top - sheetTop,
          height: element.offsetHeight,
        });
      }

      const height = sheet.offsetHeight;
      const placement = placeMarginNotes(boxes, height);
      // The margin grows to hold its notes, so a short page still shows them beside the
      // sentence; only once something has spilled is room kept for the "more" affordance.
      const next: MarginNoteLayout = {
        ...placement,
        columnHeight: Math.max(
          height,
          placement.contentBottom + (placement.overflow.length > 0 ? MARGIN_MORE_RESERVE : 0),
        ),
      };
      setMarginLayout((current) => (sameMarginLayout(current, next) ? current : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    observer.observe(column);
    return () => observer.disconnect();
  }, [compareVisible, draftBlockText, editingBlockId, editedBlockIds, marginNotes, showChanges]);

  // Reaching the queue from the margin: the row is expanded first, then focused, because the
  // control being focused may only have been rendered by that expansion.
  useEffect(() => {
    const request = queueFocusRequest.current;
    if (request === null) return;
    const element =
      request.target === "override"
        ? overrideInputRefs.current.get(request.findingId)
        : findingSummaryButtonRefs.current.get(request.findingId);
    if (element === undefined) return;
    queueFocusRequest.current = null;
    element.scrollIntoView({ block: "nearest" });
    element.focus();
  });

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  useModalFocusTrap(paletteOpen, paletteDialogRef, closePalette);
  const closeStartConfirmation = useCallback(() => setPendingStart(null), []);
  useModalFocusTrap(pendingStart !== null, startConfirmationRef, closeStartConfirmation);
  const startEvidence = useStartEvidencePreview(pendingStart !== null, previewStartEvidence);
  const requestStart = useCallback(
    (action: StartReviewAction): void => {
      if (readOnly && !earlierRunAllowsAction(action.type)) return;
      setPendingStart(action);
    },
    [readOnly],
  );
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const runDetailsButtonRef = useRef<HTMLButtonElement>(null);
  const runDetailsId = `${useId()}-run-details`;
  const openRunDetails = useCallback(() => setRunDetailsOpen(true), []);
  const closeRunDetails = useCallback(() => setRunDetailsOpen(false), []);

  const submitUrl = (target: "job-description"): void => {
    const value = jobUrl.trim();
    if (value === "" || onAddUrl === undefined) return;
    onAddUrl(target, value);
    setJobUrl("");
  };

  // The margin and the queue are two views of one set of objects, so every route into a
  // finding runs through the same three calls and lands the reviewer in the same place.
  const revealFindingInQueue = useCallback(
    (findingId: string, target: "summary" | "override" = "summary"): void => {
      const visible = filterFindingQueue(state.findings, findingFilter).some(
        (finding) => finding.id === findingId,
      );
      if (!visible) setFindingFilter("needs-action");
      expandFindings();
      setExpandedFindingId(findingId);
      setActiveFindingId(findingId);
      queueFocusRequest.current = { findingId, target };
    },
    [expandFindings, findingFilter, state.findings],
  );

  // One decision path for both views: the same action, the same "advance to the next
  // actionable finding" bookkeeping, whichever control the reviewer reached for.
  const decideFinding = useCallback(
    (findingId: string, decision: Exclude<FindingDecision, "pending" | "overridden">): void => {
      findingDecisionRequest.current = { findingId, decision };
      onAction({ type: "finding-decision", findingId, decision });
    },
    [onAction],
  );

  const beginOverride = useCallback((finding: ReviewFinding): void => {
    setOverrideReasons((current) =>
      current[finding.id] === undefined
        ? { ...current, [finding.id]: finding.rationale ?? "" }
        : current,
    );
    setOverrideEditingFindingId(finding.id);
  }, []);

  // The palette belongs to a run: before one exists there is no draft, no queue and no
  // traceability, and a list of commands that cannot run is not a command list.
  const paletteAvailable = state.state !== "collecting";

  const openPalette = useCallback((): void => {
    setPaletteQuery("");
    setPaletteOpen(true);
  }, []);

  // The rail's Findings button: under the Coverage tab the queue appears on the next render,
  // where the palette's focus effect lands; otherwise it is already on screen.
  const gateBlocker = footerBlocker(state, approvalReadiness, verdict);
  const openFindings = (): void => {
    const queue = findingQueueRef.current;
    if (findingsCollapsed) {
      paletteFocusRequest.current = queue;
      expandFindings();
      return;
    }
    queue?.scrollIntoView({ block: "start" });
    queue?.focus();
  };
  const openTraceability = (): void => {
    const details = traceabilityRef.current;
    if (details === null) return;
    details.open = true;
    const summary = traceabilitySummaryRef.current;
    // The bar is docked at the column's foot, so this only scrolls in the narrow layout.
    summary?.scrollIntoView({ block: "nearest" });
    summary?.focus();
  };

  // Triage from the keyboard. The bare letters act on the finding the queue is on; the
  // artifact gate keeps its Alt chords, so approving is never one keystroke away.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // A key a modal already answered (Escape closing it) must not also act on the page, or it
      // would pull focus away from the control the modal hands it back to.
      if (paletteOpen || pendingStart !== null || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;

      // Escape leaves the override editor even from inside its own input: that is the one
      // place a reviewer is typing and still expects a key to answer.
      if (event.key === "Escape" && overrideEditingFindingId !== null) {
        event.preventDefault();
        const editingFindingId = overrideEditingFindingId;
        setOverrideEditingFindingId(null);
        findingSummaryButtonRefs.current.get(editingFindingId)?.focus();
        return;
      }

      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true ||
        editingBlockId !== null;
      if (typing) return;

      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        if (!paletteAvailable) return;
        event.preventDefault();
        openPalette();
        return;
      }

      if (event.altKey || event.metaKey) {
        if (event.key === "a" || event.key === "A") {
          if (canApprove) {
            event.preventDefault();
            approveArtifact();
          } else if (approvalAttemptNeedsGate(approvalReadiness, state.approval)) {
            event.preventDefault();
            revealApprovalGate();
          }
        } else if (event.key === "r" || event.key === "R") {
          if (
            state.state === "awaiting-approval" &&
            state.reviewComplete &&
            !roundLimitReached &&
            transmissionReady
          ) {
            event.preventDefault();
            requestRevision();
          }
        } else if (event.key === "e" || event.key === "E") {
          if (canExport) {
            event.preventDefault();
            onAction(exportReviewAction(exportFormat, exportTemplate));
          }
        }
        return;
      }

      // A half-typed rationale owns the queue until it is saved or abandoned.
      if (event.ctrlKey || event.shiftKey || overrideEditingFindingId !== null) return;

      const queue = filterFindingQueue(state.findings, findingFilter);
      if (queue.length === 0) return;
      // A folded queue shows no current finding, so no letter may decide one. Moving through
      // the queue unfolds it instead; the next move lands on a finding the reviewer can see.
      if (findingsCollapsed) {
        const moves = ["j", "J", "k", "K", "ArrowDown", "ArrowUp"];
        if (moves.includes(event.key)) {
          event.preventDefault();
          expandFindings();
        }
        return;
      }
      const active = document.activeElement;
      const focusedId =
        queue.find((finding) => findingSummaryButtonRefs.current.get(finding.id) === active)?.id ??
        null;
      // Selection follows the expanded row, and falls back to the summary button that holds
      // focus, so a row collapsed with Enter can still be decided where it stands.
      const currentId =
        expandedFindingId !== null && queue.some((finding) => finding.id === expandedFindingId)
          ? expandedFindingId
          : focusedId;
      const currentIndex =
        currentId === null ? -1 : queue.findIndex((finding) => finding.id === currentId);

      const step = (delta: number): void => {
        const nextIndex =
          currentIndex === -1
            ? delta > 0
              ? 0
              : queue.length - 1
            : Math.min(queue.length - 1, Math.max(0, currentIndex + delta));
        const next = queue[nextIndex];
        if (next === undefined) return;
        setExpandedFindingId(next.id);
        setActiveFindingId(next.id);
        setLinkedClaimId(next.claimId ?? null);
        const button = findingSummaryButtonRefs.current.get(next.id);
        button?.scrollIntoView({ block: "nearest" });
        button?.focus();
      };

      if (event.key === "j" || event.key === "J" || event.key === "ArrowDown") {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === "k" || event.key === "K" || event.key === "ArrowUp") {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key === "Enter") {
        // A focused control already answers Enter itself; only the page-level case is ours.
        const nativeTarget =
          target?.tagName === "BUTTON" || target?.tagName === "A" || target?.tagName === "SUMMARY";
        if (nativeTarget || currentId === null) return;
        event.preventDefault();
        setExpandedFindingId((current) => (current === currentId ? null : currentId));
        findingSummaryButtonRefs.current.get(currentId)?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (expandedFindingId === null) return;
        event.preventDefault();
        const collapsedId = expandedFindingId;
        setExpandedFindingId(null);
        findingSummaryButtonRefs.current.get(collapsedId)?.focus();
        return;
      }

      const finding = currentIndex === -1 ? undefined : queue[currentIndex];
      if (finding === undefined || findingDecisionsLocked) return;

      if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        beginOverride(finding);
        revealFindingInQueue(finding.id, "override");
        return;
      }
      const decision = findingDecisionKeys[event.key.toLowerCase()];
      if (decision === undefined) return;
      if (decision === "accepted" && acceptUnavailable(finding, decisionContext)) return;
      event.preventDefault();
      decideFinding(finding.id, decision);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    beginOverride,
    approvalReadiness,
    approveArtifact,
    canApprove,
    canExport,
    exportFormat,
    exportTemplate,
    decideFinding,
    decisionContext,
    editingBlockId,
    expandFindings,
    expandedFindingId,
    findingDecisionsLocked,
    findingFilter,
    findingsCollapsed,
    onAction,
    openPalette,
    overrideEditingFindingId,
    paletteAvailable,
    paletteOpen,
    pendingStart,
    requestRevision,
    revealApprovalGate,
    revealFindingInQueue,
    state.approval,
    state.findings,
    state.reviewComplete,
    roundLimitReached,
    state.state,
    transmissionReady,
  ]);

  // A palette command that moves focus lands after the dialog has handed focus back to
  // wherever the reviewer was, so the destination wins over the restore.
  useEffect(() => {
    const target = paletteFocusRequest.current;
    if (target === null) return;
    paletteFocusRequest.current = null;
    target.scrollIntoView({ block: "start" });
    target.focus();
  });

  const renderAutopilotToggle = () =>
    state.setup.autopilot === undefined ? null : (
      <AutopilotToggle
        enabled={state.setup.autopilot}
        maximumRounds={maximumRounds}
        disabled={pendingReviewAction !== null}
        onChange={(enabled) => onAction({ type: "set-autopilot", enabled })}
      />
    );
  const resumeButton = (
    <button
      className="button button-primary"
      type="button"
      disabled={!transmissionReady}
      onClick={() => onAction({ type: "resume" })}
    >
      <PlayIcon />
      Resume review
    </button>
  );
  const pendingActionReason =
    readOnly && !chosenRunOpen
      ? earlierRunRefusal
      : pendingReviewAction === null
        ? null
        : "Another review action is already running.";
  // On the chosen earlier run, approval and export are open but every other change is not.
  const runChangeReason = chosenRunOpen ? chosenRunRefusal : pendingActionReason;
  const revisionReason = !hasArtifact
    ? "No draft artifact available yet."
    : roundLimitRecovery
      ? "Return to the last fully reviewed round before requesting another revision."
      : !state.reviewComplete
        ? "Independent critique has not completed."
        : roundLimitReached
          ? `Maximum of ${maximumRounds} rounds reached. Create a workspace with a higher limit to continue.`
          : state.state !== "awaiting-approval"
            ? `The run is ${stateLabel(state.state)}, not awaiting approval.`
            : !transmissionReady
              ? "Provider transmission has not been acknowledged."
              : runChangeReason;
  // A revision that cannot happen in this run at all folds the directions field away, so a
  // greyed-out field never looks usable; a briefly blocked one keeps the field and its text.
  const lastingRevisionBlock = revisionUnavailableReason(state, maximumRounds);
  const comparisonReason = hasPreviousArtifact
    ? null
    : "There is no previous version to compare with.";
  const paletteCommands: readonly PaletteCommand[] = [
    {
      id: "approve",
      label: "Approve artifact",
      note: "Alt+A",
      disabledReason: !hasArtifact
        ? "No draft artifact available yet."
        : !state.reviewComplete
          ? "Independent critique has not completed."
          : blockingFindings.length > 0
            ? `${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? " still needs" : "s still need"} a decision.`
            : state.state !== "awaiting-approval"
              ? `The run is ${stateLabel(state.state)}, not awaiting approval.`
              : pendingActionReason,
      run: approveArtifact,
    },
    {
      id: "recover-round-limit",
      label: `Return to reviewed Round ${Math.max(1, state.round - 1)}`,
      note: "Undo an empty round opened after the configured limit",
      disabledReason: roundLimitRecovery ? runChangeReason : "Round-limit recovery is not needed.",
      run: () => onAction({ type: "recover-round-limit" }),
    },
    {
      id: "request-revision",
      label: "Request revision",
      note: "Alt+R",
      disabledReason: revisionReason,
      run: requestRevision,
    },
    {
      id: "export",
      label: `Export ${exportFormatLabels[exportFormat]}…`,
      note: "Alt+E",
      disabledReason: canExport
        ? null
        : !state.reviewComplete
          ? "Independent critique has not completed."
          : state.state !== "approved" && state.state !== "exported"
            ? "The artifact has not been approved."
            : (pendingActionReason ?? "Export is unavailable right now."),
      run: () => onAction(exportReviewAction(exportFormat, exportTemplate)),
    },
    {
      id: "resume",
      label: "Resume",
      note: "Continue this run from its durable step",
      disabledReason:
        state.execution.status !== "interrupted" && state.state !== "paused"
          ? "This run is neither paused nor interrupted."
          : !transmissionReady
            ? "Provider transmission has not been acknowledged."
            : runChangeReason,
      run: () => onAction({ type: "resume" }),
    },
    {
      id: "stop",
      label: "Stop",
      note: "End this run without losing its history",
      disabledReason:
        state.execution.status !== "running" && state.execution.status !== "interrupted"
          ? "Nothing is running to stop."
          : runChangeReason,
      run: () => onAction({ type: "stop" }),
    },
    {
      id: "start",
      label: "Start a new review",
      note: "Run the author–critic loop again",
      disabledReason: !canStartNewReview(state)
        ? "A review is already under way."
        : !transmissionReady
          ? "Provider transmission has not been acknowledged."
          : startDisabledReason
            ? startDisabledReason
            : pendingActionReason,
      run: () => requestStart({ type: "start" }),
    },
    {
      id: "draft-view",
      label: showChanges ? "Read the full draft" : "Read changes only",
      note: showChanges
        ? "Drop the change marks and read the draft as it stands"
        : "Mark every word that changed since the previous version",
      disabledReason: comparisonReason,
      run: () => setDraftView(showChanges ? "full" : "changes"),
    },
    {
      id: "compare",
      label:
        state.previousArtifact === null
          ? "Compare with the previous version"
          : `Compare with v${state.previousArtifact.version}`,
      note: compareVisible
        ? "Close the previous version beside the draft"
        : "Open the previous version beside the draft",
      disabledReason: comparisonReason,
      run: () => setCompareOpen((current) => !current),
    },
    {
      id: "sources",
      label: "Open claim traceability",
      note: "Show where each claim's wording came from",
      disabledReason: null,
      run: () => openTraceability(),
    },
    {
      id: "keys",
      label: "Open provider authentication",
      note: "Provider sign-in lives in Home, under Workspace settings",
      disabledReason:
        onOpenHome === undefined ? "This host has no Home to open provider sign-in from." : null,
      run: () => onOpenHome?.(),
    },
    {
      id: "go-draft",
      label: "Go to the draft",
      note: "Move to the document under review",
      disabledReason: null,
      run: () => {
        paletteFocusRequest.current = reviewColumnRef.current;
      },
    },
    {
      id: "go-findings",
      label: "Go to the findings queue",
      note: "Move to critique triage",
      disabledReason: null,
      run: () => {
        expandFindings();
        const first = filteredFindings[0];
        const summary =
          first === undefined ? undefined : findingSummaryButtonRefs.current.get(first.id);
        paletteFocusRequest.current = summary ?? findingQueueRef.current;
      },
    },
  ];
  const paletteMatches = matchPaletteCommands(paletteCommands, paletteQuery);

  const runPaletteCommand = (command: PaletteCommand): void => {
    if (command.disabledReason !== null) return;
    command.run();
    setPaletteOpen(false);
  };

  const focusPaletteCommand = (index: number): void => {
    const elements = Array.from(
      paletteDialogRef.current?.querySelectorAll<HTMLButtonElement>(".palette-command") ?? [],
    );
    if (elements.length === 0) return;
    elements[Math.min(elements.length - 1, Math.max(0, index))]?.focus();
  };

  // One critique finding, written beside the sentence it judges. The four decision controls
  // dispatch exactly what the queue dispatches; Override hands off to the queue, which is
  // where the required rationale is typed.
  const renderMarginNote = (note: MarginNote) => {
    const finding = note.finding;
    const top = marginLayout?.tops.get(finding.id);
    const anchor = marginLayout?.anchors.get(finding.id);
    const hidden = marginLayout !== null && top === undefined;
    const active = activeFindingId === finding.id || expandedFindingId === finding.id;
    const highlight = () => {
      setActiveFindingId(finding.id);
      setLinkedClaimId(finding.claimId ?? null);
    };
    const clearHighlight = () => {
      setActiveFindingId((current) => (current === finding.id ? null : current));
      setLinkedClaimId(null);
    };

    return (
      <li
        className={`margin-note margin-note-${finding.severity}${active ? " margin-note-active" : ""}${
          hidden ? " margin-note-spilled" : ""
        }`}
        key={finding.id}
        {...(top === undefined ? {} : { style: { top: `${top}px` } })}
        ref={(element) => {
          if (element === null) marginNoteRefs.current.delete(finding.id);
          else marginNoteRefs.current.set(finding.id, element);
        }}
      >
        {top === undefined || anchor === undefined ? null : (
          <span
            className="margin-note-elbow"
            aria-hidden="true"
            style={{
              top: `${anchor - top}px`,
              height: `${Math.max(0, MARGIN_NOTE_ATTACH - (anchor - top))}px`,
            }}
          />
        )}
        <button
          className="margin-note-head"
          type="button"
          onClick={() => revealFindingInQueue(finding.id)}
          onMouseEnter={highlight}
          onMouseLeave={clearHighlight}
          onFocus={highlight}
          onBlur={clearHighlight}
        >
          <span className="margin-note-kind">
            <span className="margin-note-severity">
              {finding.severity === "error" ? "Blocking" : "Warning"}
            </span>
            <span className="margin-note-category">{finding.category}</span>
          </span>
          <span className="margin-note-message">{findingTitle(finding)}</span>
        </button>
        <span className="margin-note-actions">
          {directFindingDecisions.map((decision) => (
            <button
              className="margin-note-action"
              type="button"
              key={decision}
              disabled={
                findingDecisionsLocked ||
                (decision === "accepted" && acceptUnavailable(finding, decisionContext))
              }
              {...(decision === "accepted" && acceptUnavailable(finding, decisionContext)
                ? { title: ACCEPT_UNAVAILABLE_NOTE }
                : {})}
              onFocus={highlight}
              onBlur={clearHighlight}
              onClick={() => decideFinding(finding.id, decision)}
            >
              {decisionLabels[decision]}
            </button>
          ))}
          <button
            className="margin-note-action"
            type="button"
            disabled={findingDecisionsLocked}
            onFocus={highlight}
            onBlur={clearHighlight}
            onClick={() => {
              beginOverride(finding);
              revealFindingInQueue(finding.id, "override");
            }}
          >
            Override
          </button>
        </span>
      </li>
    );
  };

  // One draft line on the sheet. The reading view carries the marks; the editor is present in
  // the markup at all times and revealed when the line is opened, so the line keeps its label.
  const renderDraftBlock = (sectionTitle: string, pair: DraftBlockPair) => {
    const block = pair.block;
    if (block === null) {
      return (
        <div className="editable-block editable-block-removed" key={pair.key}>
          <div className="block-view block-view-removed">
            <del className="redline-del">{pair.text}</del>
          </div>
        </div>
      );
    }

    const sourceState = blockSourceState(block, claimById);
    const isLinked = linkedClaimId !== null && block.claimIds.includes(linkedClaimId);
    const isEditing = editingBlockId === block.id;
    const isEdited = editedBlockIds.has(block.id) || block.edited === true;
    const highlightClaim = () => setLinkedClaimId(block.claimIds[0] ?? null);
    const openLine = () => {
      highlightClaim();
      setEditingBlockId(block.id);
    };

    return (
      <div
        className={`editable-block editable-block-${sourceState}${
          isLinked ? " editable-block-linked" : ""
        }`}
        key={pair.key}
        ref={(element) => {
          if (element === null) draftBlockShellRefs.current.delete(block.id);
          else draftBlockShellRefs.current.set(block.id, element);
        }}
      >
        {sourceState === "unsourced" || isEdited ? (
          <span className="block-margin">
            {sourceState === "unsourced" ? (
              <span className="block-margin-dot" aria-hidden="true" />
            ) : null}
            {isEdited ? <span className="block-edited-flag">edited</span> : null}
          </span>
        ) : null}
        <div className="block-view" hidden={isEditing}>
          <BlockRedline
            previousText={pair.previousText}
            showChanges={showChanges}
            text={block.text}
          />
        </div>
        {/* The whole line is the affordance. A real control carries the keyboard and pointer
            behaviour, which leaves the marked-up text above it as ordinary document text: a
            button labelled with the line would have flattened the change marks away. */}
        <button
          className="block-open"
          type="button"
          aria-label={`Edit ${sectionTitle} text`}
          title={`Edit ${sectionTitle} text`}
          hidden={isEditing || readOnly}
          onClick={openLine}
          onFocus={openLine}
          onMouseEnter={highlightClaim}
          onMouseLeave={() => setLinkedClaimId(null)}
        />
        {sourceState === "none" ? null : (
          <span className="sr-only">
            {sourceState === "sourced" ? "source linked" : "not linked to candidate materials"}
          </span>
        )}
        <textarea
          aria-label={`Edit ${sectionTitle}`}
          hidden={!isEditing}
          value={block.text}
          // One row is the floor; the layout effect grows it to its text.
          rows={1}
          ref={(element) => {
            if (element === null) draftBlockRefs.current.delete(block.id);
            else draftBlockRefs.current.set(block.id, element);
          }}
          onFocus={highlightClaim}
          onBlur={() => {
            setLinkedClaimId(null);
            setEditingBlockId((current) => (current === block.id ? null : current));
          }}
          onMouseEnter={highlightClaim}
          onMouseLeave={() => setLinkedClaimId(null)}
          onChange={(event) => {
            setEditedBlockIds((current) =>
              current.has(block.id) ? current : new Set(current).add(block.id),
            );
            onAction({
              type: "edit-block",
              blockId: block.id,
              text: event.target.value,
            });
          }}
        />
      </div>
    );
  };

  const renderStartConfirmation = () => {
    if (pendingStart === null) return null;
    const action = pendingStart;
    const { onStart, onCancel } = startConfirmationHandlers(
      action,
      onAction,
      closeStartConfirmation,
    );
    return (
      <StartConfirmation
        summary={startConfirmationSummary(state, {
          action,
          reviewedRequirements: reviewedRequirementsSelection(
            latestBrief,
            state.setup.reviewedOpportunity,
          ),
          ...(startCandidateProfile === undefined
            ? {}
            : { candidateProfile: startCandidateProfile }),
          ...(startModelProfiles === undefined ? {} : { modelProfiles: startModelProfiles }),
          evidencePreview: startEvidence,
        })}
        dialogRef={startConfirmationRef}
        onStart={onStart}
        onCancel={onCancel}
        changeModelsAction={modelSettingsAction}
      />
    );
  };

  // Every action of this workspace, reachable by its name. A command that cannot run stays in
  // the list and says why, because "the button is missing" is not an explanation.
  const renderCommandPalette = () => {
    if (!paletteOpen) return null;
    return (
      <div className="modal-backdrop">
        <div
          className="modal-card palette-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-palette-title"
          ref={paletteDialogRef}
        >
          <div className="palette-header">
            <h2 id="command-palette-title">Commands</h2>
            <span className="subtle">
              Type to narrow · ↑↓ to move · Enter to run · Esc to close
            </span>
          </div>
          <label className="palette-search">
            <span className="sr-only">Filter commands</span>
            <input
              className="url-input palette-input"
              type="text"
              placeholder="Search commands…"
              value={paletteQuery}
              autoComplete="off"
              spellCheck={false}
              ref={paletteInputRef}
              onChange={(event) => setPaletteQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusPaletteCommand(0);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusPaletteCommand(paletteMatches.length - 1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const first = paletteMatches[0];
                  if (first !== undefined) runPaletteCommand(first);
                }
              }}
            />
          </label>
          {paletteMatches.length === 0 ? (
            <p className="palette-empty" role="status">
              No command matches that search.
            </p>
          ) : (
            <ul className="palette-list">
              {paletteMatches.map((command, index) => (
                <li key={command.id}>
                  <button
                    className="palette-command"
                    type="button"
                    aria-disabled={command.disabledReason !== null}
                    onClick={() => runPaletteCommand(command)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        focusPaletteCommand(index + 1);
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        if (index === 0) paletteInputRef.current?.focus();
                        else focusPaletteCommand(index - 1);
                      }
                    }}
                  >
                    <span className="palette-command-label">{command.label}</span>
                    <span className="palette-command-note">
                      {command.disabledReason ?? command.note}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const renderProviderTransmissionPreflight = (compact = false) => {
    const preflight = state.providerTransmissionPreflight;
    const details = (
      <>
        <dl className="preflight-policy-grid">
          <div>
            <dt>Data class</dt>
            <dd>{preflight.dataClass}</dd>
          </div>
          <div>
            <dt>Retention preference</dt>
            <dd>{preflight.retentionPreference}</dd>
          </div>
          <div>
            <dt>Author destination</dt>
            <dd>
              {preflight.author.company} · {preflight.author.model}
              <br />
              <span>{preflight.author.endpoint}</span>
            </dd>
          </div>
          <div>
            <dt>Critic destination</dt>
            <dd>
              {preflight.critic.company} · {preflight.critic.model}
              <br />
              <span>{preflight.critic.endpoint}</span>
            </dd>
          </div>
          <div>
            <dt>Maximum run budget</dt>
            <dd>
              {preflight.budget.maxRounds} rounds ·{" "}
              {preflight.budget.maxCostUsd === null
                ? "no cost cap"
                : `$${preflight.budget.maxCostUsd.toFixed(2)}`}{" "}
              ·{" "}
              {preflight.budget.maxDurationMs === null
                ? "no duration cap"
                : `${preflight.budget.maxDurationMs} ms`}
            </dd>
          </div>
          <div>
            <dt>Policy fingerprint</dt>
            <dd className="policy-fingerprint">{preflight.fingerprint}</dd>
          </div>
        </dl>
        <div className="preflight-scope">
          <strong>Exactly what may be transmitted</strong>
          <ul>
            {preflight.transmissionScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <strong>Never included</strong>
          <ul>
            {preflight.excludedScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </>
    );
    return (
      <section
        className={`provider-preflight${preflight.required && !preflight.acknowledged ? " provider-preflight-required" : ""}`}
        aria-labelledby="provider-preflight-title"
      >
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Provider transmission preflight</p>
            <h2 id="provider-preflight-title">
              {preflight.required ? "Review data leaving this workspace" : "Demo remains local"}
            </h2>
          </div>
          <span className="status-tag">
            {preflight.required
              ? preflight.acknowledged
                ? "Acknowledged"
                : "Acknowledgement required"
              : "No network transmission"}
          </span>
        </div>
        {compact ? (
          <>
            {preflight.required ? (
              <p className="preflight-summary">
                The review sends the job, your profile and selected evidence excerpts to{" "}
                {preflight.author.company} · {preflight.author.model} (writer) and{" "}
                {preflight.critic.company} · {preflight.critic.model} (reviewer), for at most{" "}
                {preflight.budget.maxRounds} rounds. Your complete evidence is never sent.
              </p>
            ) : null}
            <details className="setup-details">
              <summary>See exactly what is sent</summary>
              {details}
            </details>
          </>
        ) : (
          details
        )}
        {preflight.required && !preflight.acknowledged ? (
          <div className="preflight-acknowledgement">
            <label>
              <input
                type="checkbox"
                checked={policyConfirmed}
                onChange={(event) =>
                  setConfirmedPolicyFingerprint(event.target.checked ? preflight.fingerprint : null)
                }
              />
              <span>
                I reviewed these destinations, data categories, retention preference, and limits.
              </span>
            </label>
            <button
              className={`button ${compact ? "button-outline" : "button-primary"}`}
              type="button"
              disabled={!policyConfirmed}
              onClick={() =>
                onAction({
                  type: "acknowledge-provider-transmission",
                  fingerprint: preflight.fingerprint,
                })
              }
            >
              Acknowledge provider transmission
            </button>
          </div>
        ) : preflight.acknowledgedAt === null ? null : (
          <p className="safe-copy">Acknowledged at {preflight.acknowledgedAt}</p>
        )}
      </section>
    );
  };

  if (state.state === "collecting") {
    const reviewedRequirements = reviewedRequirementsSelection(
      latestBrief,
      state.setup.reviewedOpportunity,
    );
    // A draft waits for its review; only the explicit Advanced choice starts from the job text.
    const { draftBrief, rawJobKey } = startRequirementsChoice(
      state.workspaceId,
      latestBrief,
      reviewedRequirements,
      state.setup,
    );
    const startFromJobDescription = rawJobKey !== null && rawJobChoice === rawJobKey;
    const jobSource = requirementsBinding?.jobFromUrl === true ? "approved-page" : "document";
    const startConditions = startChecklist({
      setup: state.setup,
      startFromJobDescription,
      requirementAction: requirementRefusalAction(
        latestBrief,
        reviewedRequirements,
        requirementsBinding?.createOpportunity !== undefined,
      ),
      candidateProfile: startCandidateProfile,
      transmission: state.providerTransmissionPreflight,
      startDisabledReason,
      canOpenProviderSignIn: onOpenHome !== undefined,
      ...(providerSignInReadiness === undefined ? {} : { providerSignIn: providerSignInReadiness }),
      jobSource,
      draftBrief,
    });
    const startPending = pendingReviewAction?.action === "start";
    const startTooltip = startChecklistTooltip(startConditions);
    const extractRequirements = () => {
      setExtractionSignal((value) => value + 1);
      document
        .getElementById(jobRequirementsExtractionId)
        ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    };
    const compact = setupSummary !== undefined;
    const jobDescriptionInputs = (
      <JobDescriptionInputs
        ready={jobStepOffersExtraction(jobSource, state.setup.jobDescriptionReady)}
        url={jobUrl}
        onUrlChange={setJobUrl}
        {...(onSelectFiles === undefined
          ? {}
          : { onChooseFile: () => onSelectFiles("job-description") })}
        {...(onAddUrl === undefined ? {} : { onFetchUrl: () => submitUrl("job-description") })}
      />
    );
    const requirementsControls = (
      <>
        {latestBrief != null && requirementsBinding !== undefined ? (
          <LatestRequirementsBriefView
            latest={latestBrief}
            action={
              briefOperations === undefined ? null : (
                <OpportunityBriefReviewAction
                  key={briefReviewActionKey(requirementsBinding.workspaceId, latestBrief.briefId)}
                  briefId={latestBrief.briefId}
                  operations={briefOperations}
                  disabled={requirementsBinding.disabled}
                  label={
                    latestBrief.status === "draft" ? "Review requirements" : "View requirements"
                  }
                  {...(requirementsBinding.onBriefChanged === undefined
                    ? {}
                    : { onBriefChanged: requirementsBinding.onBriefChanged })}
                />
              )
            }
          />
        ) : null}
        {offersRequirementsExtraction(latestBrief) &&
        jobStepOffersExtraction(jobSource, state.setup.jobDescriptionReady) &&
        !state.setup.reviewedOpportunity &&
        requirementsBinding?.createOpportunity !== undefined ? (
          <div id={jobRequirementsExtractionId}>
            <JobRequirementsExtraction
              key={requirementsBinding.workspaceId}
              binding={requirementsBinding}
              openSignal={extractionSignal}
            />
          </div>
        ) : null}
        {latestBrief == null &&
        state.setup.reviewedOpportunity != null &&
        requirementsBinding !== undefined &&
        briefOperations !== undefined ? (
          <div className="job-extraction">
            <p className="setup-note">
              Requirements reviewed (version {state.setup.reviewedOpportunity.version}).
            </p>
            <OpportunityBriefReviewAction
              key={briefReviewActionKey(
                requirementsBinding.workspaceId,
                state.setup.reviewedOpportunity.briefId,
              )}
              briefId={state.setup.reviewedOpportunity.briefId}
              operations={briefOperations}
              disabled={requirementsBinding.disabled}
              label="View requirements"
              {...(requirementsBinding.onBriefChanged === undefined
                ? {}
                : { onBriefChanged: requirementsBinding.onBriefChanged })}
            />
          </div>
        ) : null}
      </>
    );
    const runStartAction = (id: StartActionId) => {
      if (id === "extract-requirements") extractRequirements();
      else if (id === "use-reviewed-requirements") setRawJobChoice(null);
      else if (id === "open-provider-sign-in") onOpenHome?.();
      else revealStartTarget(startActionTargets[id] ?? []);
    };
    const requirementsSource =
      rawJobKey === null ? null : reviewedRequirements === null ? (
        <StartFromJobDescriptionChoice
          chosen={startFromJobDescription}
          disabled={readOnly || startPending}
          onChange={(chosen) => setRawJobChoice(chosen ? rawJobKey : null)}
        />
      ) : (
        <StartRequirementsSourceView
          selection={reviewedRequirements}
          useJobDescription={startFromJobDescription}
          disabled={startPending}
          onUseJobDescription={() => setRawJobChoice(rawJobKey)}
          onUseReviewed={() => setRawJobChoice(null)}
        />
      );
    const startControls = (
      <>
        <div className="onboarding-footer">
          <span>{state.setup.fixtureMode ? "Demo workspace" : "Real workspace"}</span>
          <span>
            {state.setup.requiredSections.length > 0
              ? `Required sections: ${state.setup.requiredSections.join(", ")}`
              : "No required sections"}
          </span>
          {renderAutopilotToggle()}
          <button
            className="button button-primary"
            type="button"
            disabled={startTooltip !== undefined || startPending}
            title={startTooltip}
            aria-describedby={startChecklistId}
            onClick={() =>
              requestStart(
                startFromJobDescription
                  ? { type: "start", requirementsSource: "job-description" }
                  : { type: "start" },
              )
            }
          >
            {startButtonLabel(startConditions, startPending)}
          </button>
        </div>
        <StartChecklistView
          id={startChecklistId}
          conditions={startConditions}
          errorMessage={errorMessage ?? null}
          readOnly={readOnly}
          isActionDisabled={(id) =>
            id === "extract-requirements" && requirementsBinding?.disabled === true
          }
          onAction={runStartAction}
        />
        {startPending ? (
          <p className="pending-action-status" role="status" aria-live="polite">
            Starting review… Elapsed{" "}
            {formatElapsedDuration(pendingReviewAction.elapsedSeconds * 1_000)}. Keep this window
            open while the review starts.
          </p>
        ) : null}
      </>
    );
    const pendingOverride = state.setup.pendingWritingPolicyOverride;
    const jobReady = state.setup.jobDescriptionReady;
    return (
      <div className="app-frame">
        <SideRail onOpenSources={null} />
        <main className="app-shell app-shell-single">
          <div className="main-column">
            <PageToolbar navigation={pageNavigation}>
              {modelSettingsAction}
              {workspaceNavigationAction}
            </PageToolbar>
            <header className="spine">
              <div className="spine-identity">
                {workspaceTitle ?? <h1 title={workspaceLabel}>{workspaceLabel}</h1>}
                <div className="spine-identity-meta">
                  <span className="state-pill state-collecting">Collecting inputs</span>
                </div>
              </div>
              <div className="spine-loop" />
              <div className="spine-meta" />
            </header>
            {headerNotice}
            <section className="panel onboarding-panel" aria-labelledby="onboarding-title">
              {compact ? (
                <>
                  <p className="eyebrow">Before the review</p>
                  <h2 id="onboarding-title">Start the review</h2>
                  <p className="onboarding-copy">
                    Finish the three steps in order. Career evidence, models, writing policy and
                    sign-in are workspace settings with their own pages.
                  </p>
                  <ApplicationStepsView
                    steps={applicationStepStates(startConditions)}
                    content={{
                      job: (
                        <ApplicationJobStep id={startJobCardId} ready={jobReady} source={jobSource}>
                          {jobDescriptionInputs}
                          {requirementsControls}
                        </ApplicationJobStep>
                      ),
                      profile: setupSummary,
                      review: (
                        <>
                          {modelPairChoice?.(
                            readOnly || pendingStart !== null || pendingReviewAction !== null,
                          )}
                          {renderProviderTransmissionPreflight(true)}
                          {requirementsSource}
                          <OpportunityOverrideDisclosure
                            reviewed={state.setup.reviewedOpportunity != null}
                            pending={
                              pendingOverride == null
                                ? null
                                : {
                                    version: pendingOverride.version,
                                    checksumLabel: policyChecksumLabel(pendingOverride.checksum),
                                  }
                            }
                            disabled={onSelectFiles === undefined}
                            onImport={() => onSelectFiles?.("writing-policy-override")}
                          />
                          {startControls}
                        </>
                      ),
                    }}
                  />
                </>
              ) : (
                <>
                  <p className="eyebrow">Before the first run</p>
                  <h2 id="onboarding-title">Bring your career evidence into the loop</h2>
                  <p className="onboarding-copy">
                    Add the career evidence DraftLoop is allowed to use. Your files stay in this
                    workspace. DraftLoop will not invent missing experience or start an agent run
                    until the target job and career evidence are present.
                  </p>
                  <div className="setup-grid">
                    <article
                      id={startJobCardId}
                      className={`setup-card${jobReady ? " setup-card-ready" : ""}`}
                    >
                      <div className="setup-card-head">
                        <span className={`setup-state${jobReady ? " setup-state-ready" : ""}`}>
                          {jobReady ? "Ready" : "Required"}
                        </span>
                      </div>
                      <strong>Target job description</strong>
                      <span>{jobReady ? "Ready for review" : "Required input missing"}</span>
                      {jobDescriptionInputs}
                      {requirementsControls}
                    </article>
                    <article
                      className={`setup-card${state.setup.writingPolicyStatus === "active" ? " setup-card-ready" : ""}`}
                    >
                      <div className="setup-card-head">
                        <span
                          className={`setup-state${state.setup.writingPolicyStatus === "active" ? " setup-state-ready" : ""}`}
                        >
                          {state.setup.writingPolicyStatus === "active"
                            ? "Active"
                            : state.setup.writingPolicyStatus === "unavailable"
                              ? "Needs attention"
                              : "Optional"}
                        </span>
                      </div>
                      <strong>Writing policy</strong>
                      <span>
                        {state.setup.writingPolicyStatus === "unavailable"
                          ? "The configured policy cannot be read; replace it before starting"
                          : state.setup.writingPolicy === null
                            ? "Add explicit rules for both author and critic"
                            : `Applied as ${state.setup.writingPolicy.version}`}
                      </span>
                      <span className="setup-note">
                        Policy content stays local to this workspace and is kept separate from
                        career evidence. Runs record only its version and checksum in ordinary
                        review status.
                      </span>
                      {state.setup.writingPolicy === null ? null : (
                        <span className="setup-retrieval-status" role="status">
                          Current checksum {policyChecksumLabel(state.setup.writingPolicy.checksum)}
                        </span>
                      )}
                      {(state.setup.writingPolicyHistory?.length ?? 0) > 0 ? (
                        <span className="setup-retrieval-status" role="status">
                          History:{" "}
                          {state.setup.writingPolicyHistory
                            ?.map(
                              (policy) =>
                                `${policy.version} (${policyChecksumLabel(policy.checksum)})`,
                            )
                            .join(" · ")}
                        </span>
                      ) : null}
                      <button
                        className="button button-quiet"
                        type="button"
                        disabled={onSelectFiles === undefined}
                        onClick={() => onSelectFiles?.("writing-policy")}
                      >
                        {state.setup.writingPolicyStatus === "none"
                          ? "Choose policy file"
                          : "Replace policy"}
                      </button>
                      {writingPolicyAction}
                      <button
                        className="button button-outline"
                        type="button"
                        disabled={
                          onSelectFiles === undefined || state.setup.reviewedOpportunity == null
                        }
                        title={
                          state.setup.reviewedOpportunity == null
                            ? "Review an opportunity before importing an override."
                            : "Import a policy version for this reviewed opportunity without changing the global policy."
                        }
                        onClick={() => onSelectFiles?.("writing-policy-override")}
                      >
                        Import opportunity override
                      </button>
                      {state.setup.reviewedOpportunity == null ? (
                        <span className="setup-retrieval-status">
                          Review an opportunity before importing an override.
                        </span>
                      ) : null}
                      {state.setup.pendingWritingPolicyOverride == null ? null : (
                        <span className="setup-retrieval-status" role="status">
                          Selected override {state.setup.pendingWritingPolicyOverride.version} (
                          {policyChecksumLabel(state.setup.pendingWritingPolicyOverride.checksum)})
                          bound to brief{" "}
                          {state.setup.pendingWritingPolicyOverride.opportunityBrief.briefId} v
                          {state.setup.pendingWritingPolicyOverride.opportunityBrief.version}.
                        </span>
                      )}
                      <span className="setup-note">
                        Importing an opportunity override does not change the global policy.
                      </span>
                    </article>
                  </div>
                  {renderProviderTransmissionPreflight()}
                  {profilePanel}
                  {requirementsSource}
                  {startControls}
                </>
              )}
            </section>
          </div>
        </main>
        {renderStartConfirmation()}
      </div>
    );
  }

  return (
    <div className="app-frame">
      <SideRail onOpenSources={openTraceability} onOpenFindings={openFindings} />
      <main
        className={`app-shell app-shell-resizable${comparing ? " app-shell-comparing" : ""}`}
        style={
          sidePanel.width === null
            ? undefined
            : ({ "--side-panel-width": `${sidePanel.width}px` } as CSSProperties)
        }
      >
        {renderCommandPalette()}
        {renderStartConfirmation()}
        <RunDetailsDrawer
          id={runDetailsId}
          open={runDetailsOpen}
          onClose={closeRunDetails}
          returnFocusRef={runDetailsButtonRef}
          state={state}
          describeState={stateLabel}
          start={
            readOnly
              ? null
              : {
                  disabled:
                    !transmissionReady ||
                    startDisabledReason !== null ||
                    pendingReviewAction !== null,
                  pending: pendingReviewAction?.action === "start",
                  blockedReason: startDisabledReason,
                  onStart: () => {
                    // The start confirmation is its own dialog, so this one closes first.
                    closeRunDetails();
                    requestStart({ type: "start" });
                  },
                }
          }
          autopilot={renderAutopilotToggle()}
        />
        <div className="main-column">
          <PageToolbar navigation={pageNavigation}>
            {modelSettingsAction}
            {workspaceNavigationAction}
          </PageToolbar>
          <header className="spine">
            <div className="spine-identity">
              {workspaceTitle ?? <h1 title={workspaceLabel}>{workspaceLabel}</h1>}
              <div className="spine-identity-meta">
                <span className={`state-pill state-${state.state}`}>{stateLabel(state.state)}</span>
                <span className="meta-chip">Round {state.round}</span>
              </div>
            </div>
            <div className="spine-loop">
              <LoopRail activeIndex={loopStageIndex(state)} round={state.round} />
            </div>
            <div className="spine-meta">
              <RunSwitcher
                runs={state.applicationRuns}
                viewedRunId={state.runId}
                onOpenRun={onOpenRun}
                onCompareRun={runComparison.compareWith}
              />
              <RunDetailsButton
                summary={runDetailsSummary(state)}
                open={runDetailsOpen}
                controls={runDetailsId}
                buttonRef={runDetailsButtonRef}
                onOpen={openRunDetails}
              />
              <div className="spine-versions">
                {state.previousArtifact === null ? null : (
                  <span className="spine-version">v{state.previousArtifact.version}</span>
                )}
                <span className="spine-version spine-version-current">
                  v{state.artifact.version}
                </span>
              </div>
              <div className="spine-cost">
                <span className="numeric" title={costLabel.explanation}>
                  {costLabel.text}
                  {state.budgetUsd === null ? "" : ` / $${state.budgetUsd.toFixed(2)}`}
                </span>
                {budgetRatio === null ? null : (
                  <span
                    className={`cost-meter${budgetRatio > 0.75 ? " cost-meter-high" : ""}`}
                    aria-hidden="true"
                  >
                    <span style={{ width: `${Math.round(budgetRatio * 100)}%` }} />
                  </span>
                )}
              </div>
            </div>
          </header>
          {headerNotice}
          <EarlierRunNotice
            earlierRun={state.earlierRun}
            onBackToLatest={onOpenRun === undefined ? undefined : () => onOpenRun(null)}
          />

          {state.state === "stopped" && !readOnly ? (setupSummary ?? profilePanel) : null}

          {errorMessage ? (
            <div className="error-banner" role="alert">
              <p>{errorMessage}</p>
            </div>
          ) : null}

          {state.state === "provider-error" && state.providerFailure !== null ? (
            <section
              className="panel provider-failure-panel"
              role="alert"
              aria-label="provider failure"
            >
              <p className="eyebrow">Provider request failed</p>
              <h2>{state.providerFailure.explanation}</h2>
              <p className="subtle">
                {state.providerFailure.provider} · {state.providerFailure.model} ·{" "}
                {failedCallLabel(state.providerFailure)} · attempt {state.providerFailure.attempt}{" "}
                of {state.providerFailure.maxAttempts}
              </p>
              {state.providerFailure.diagnostics.length > 0 ? (
                <div className="provider-diagnostics">
                  <strong>Validation details</strong>
                  <ul>
                    {state.providerFailure.diagnostics.map((diagnostic) => (
                      <li key={`${diagnostic.code}:${diagnostic.path}`}>
                        {diagnostic.path === "" ? "response" : diagnostic.path}: {diagnostic.code}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {readOnly ? null : (
                <div className="approval-actions">
                  {state.providerFailure.availableActions.includes("retry") ? (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={
                        !transmissionReady || retryRemainingMs > 0 || pendingReviewAction !== null
                      }
                      onClick={() => onAction({ type: "resume" })}
                    >
                      {retryRemainingMs > 0
                        ? `Retry ${state.providerFailure.step} in ${retryWaitLabel(retryRemainingMs)}`
                        : `Retry ${state.providerFailure.step}`}
                    </button>
                  ) : null}
                  {state.providerFailure.availableActions.includes("return-to-review") ? (
                    <button
                      className="button button-outline"
                      type="button"
                      onClick={() => onAction({ type: "recover-to-review" })}
                    >
                      Return to review
                    </button>
                  ) : null}
                  {state.providerFailure.availableActions.includes("stop") ? (
                    <button
                      className="button button-quiet"
                      type="button"
                      onClick={() => onAction({ type: "stop" })}
                    >
                      Stop run
                    </button>
                  ) : null}
                </div>
              )}
              {state.providerFailure.automaticRetry ? (
                <p className="pending-action-status" role="status" aria-live="polite">
                  {retryRemainingMs > 0
                    ? `DraftLoop retries the ${state.providerFailure.step} automatically in ${retryWaitLabel(retryRemainingMs)}.`
                    : `DraftLoop retries the ${state.providerFailure.step} automatically.`}
                </p>
              ) : retryRemainingMs > 0 && state.providerFailure.retryAvailable ? (
                <p className="pending-action-status" role="status" aria-live="polite">
                  Retry is paused until the provider retry window opens (
                  {retryWaitLabel(retryRemainingMs)}).
                </p>
              ) : !state.providerFailure.availableActions.some((action) => action !== "stop") ? (
                <p className="subtle">This run has no retry left. Stop it, then start a new run.</p>
              ) : null}
            </section>
          ) : null}

          {state.providerTransmissionPreflight.required &&
          !state.providerTransmissionPreflight.acknowledged
            ? renderProviderTransmissionPreflight()
            : null}

          <section
            hidden={comparing}
            className={`validation-banner validation-${runInProgress ? "in-progress" : findingSummary.status}`}
            aria-label="validation status"
            role="status"
            aria-live="polite"
          >
            <strong>{validationLabel}</strong>
            <span>
              {runInProgress
                ? runStatusLine?.detail
                : !hasArtifact
                  ? "Complete or recover the author step before reviewing findings or approving an artifact."
                  : roundLimitRecovery
                    ? `Round ${state.round} exceeded the ${maximumRounds}-round limit before any provider work began. Return to reviewed Round ${state.round - 1}; its draft and critique remain intact.`
                    : approvalReadiness?.applicationReady === false && state.approval !== "approved"
                      ? "Final CV checks for this artifact are not met. This score does not confirm a candidate gap; token matching can miss equivalent phrasing. Review the requirements and coverage evidence, then revise or approve it with a recorded reason."
                      : !state.reviewComplete
                        ? runStatusLine?.detail
                        : findingSummary.status === "blocked"
                          ? "Approval is unavailable until every blocking finding is resolved or explicitly overridden."
                          : findingSummary.status === "warnings"
                            ? "Approval remains your decision; unresolved warnings will stay visible in the review history."
                            : "All findings have a recorded decision."}
            </span>
          </section>

          {runComparison.active === null ? null : (
            <RunComparisonView
              comparison={runComparison.active}
              state={state}
              onSwap={runComparison.swap}
              onClose={runComparison.close}
              {...(onSaveMarkdownFile === undefined ? {} : { onSaveMarkdown: onSaveMarkdownFile })}
              {...(onChooseRun === undefined ? {} : { onChooseRun })}
            />
          )}
          {/* A jump target, so "go to the draft" can land focus here and not only scroll. */}
          <section
            hidden={comparing}
            className="review-column"
            aria-label="artifact review"
            id="artifact-review"
            tabIndex={-1}
            ref={reviewColumnRef}
          >
            <div className="doc-toolbar">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Draft under review</p>
                  <h2>Version {state.artifact.version}</h2>
                </div>
              </div>
              {/* The job inputs leave the screen once a run starts; the Job tab keeps the job
                  beside the draft, and this says where it is (#1832). */}
              {onReadJob === undefined ? null : (
                <button
                  className="button button-outline doc-toolbar-job"
                  type="button"
                  title="The job this draft is written for, under the Job tab. A different job needs a new application."
                  onClick={() => selectWorkTab("job")}
                >
                  Read the job
                </button>
              )}
              <section className="retrieval-strip" aria-label="evidence retrieval status">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                  <path
                    d="M4 7h16M4 12h16M4 17h9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <strong>
                  {evidenceMode?.kind === "full-source" ? "Full source" : "Evidence retrieval"}
                </strong>
                <span role="status">
                  {evidenceMode !== undefined
                    ? evidenceMode.stripStatus
                    : state.setup.retrievalStatus === "matched"
                      ? `${state.setup.selectedEvidenceChunkCount} relevant excerpt${state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"} selected from ${state.setup.selectedEvidenceSourceCount} career-evidence source${state.setup.selectedEvidenceSourceCount === 1 ? "" : "s"}`
                      : state.setup.retrievalStatus === "fallback"
                        ? `No lexical match; using ${state.setup.selectedEvidenceChunkCount} bounded fallback excerpt${state.setup.selectedEvidenceChunkCount === 1 ? "" : "s"} from career evidence`
                        : state.setup.retrievalStatus === "not-indexed"
                          ? notIndexedRetrievalText(state)
                          : state.setup.retrievalStatus === "no-query"
                            ? "The job description has no searchable role terms"
                            : "Retrieval readiness is unavailable"}
                </span>
              </section>
              <div className="doc-toolbar-views">
                <fieldset className="view-toggle">
                  <legend className="sr-only">Draft view</legend>
                  <button
                    className="view-toggle-option"
                    type="button"
                    aria-pressed={showChanges}
                    disabled={!hasPreviousArtifact}
                    title={
                      hasPreviousArtifact
                        ? "Mark every word that changed since the previous version"
                        : "There is no previous version to compare with."
                    }
                    onClick={() => setDraftView("changes")}
                  >
                    Changes only
                  </button>
                  <button
                    className="view-toggle-option"
                    type="button"
                    aria-pressed={!showChanges}
                    title="Read the draft as it stands, without change marks"
                    onClick={() => setDraftView("full")}
                  >
                    Full draft
                  </button>
                </fieldset>
                {state.previousArtifact === null ? (
                  <span className="empty-state doc-toolbar-empty">
                    This is the first artifact version.
                  </span>
                ) : (
                  <button
                    className="button button-quiet doc-compare-toggle"
                    type="button"
                    aria-pressed={compareVisible}
                    onClick={() => setCompareOpen((current) => !current)}
                  >
                    Compare with v{state.previousArtifact.version}
                  </button>
                )}
              </div>
              <span className="subtle doc-toolbar-note">
                {chosenRunOpen
                  ? "This draft is approved and exported as it is."
                  : readOnly
                    ? "This run is read-only."
                    : "Edits you make here are applied when you approve; the critic has not reviewed them."}
              </span>
            </div>

            <div
              className={`doc-grid${compareVisible ? " doc-grid-compare" : ""}`}
              ref={docGridRef}
              style={
                {
                  "--compare-split": compareSplit,
                  ...draftWidthStyle(draftWidth.width, compareVisible),
                } as CSSProperties
              }
            >
              {compareVisible && state.previousArtifact !== null ? (
                <div className="diff-column">
                  <div className="pane-heading">
                    <span>Previous version</span>
                    <span>v{state.previousArtifact.version}</span>
                  </div>
                  <article className="artifact-pane previous-pane">
                    {state.previousArtifact.sections.map((section) => (
                      <section className="artifact-section" key={section.id}>
                        <h3>{section.title}</h3>
                        {section.blocks.map((block) => (
                          <p className={block.type === "bullet" ? "bullet" : ""} key={block.id}>
                            {block.text}
                          </p>
                        ))}
                      </section>
                    ))}
                  </article>
                </div>
              ) : null}
              {compareVisible && state.previousArtifact !== null ? (
                <CompareSplitHandle
                  split={compareSplit}
                  onSplitChange={setCompareSplit}
                  gridRef={docGridRef}
                />
              ) : null}
              <div className="diff-column diff-column-current">
                <div className="pane-heading">
                  <span>Current draft</span>
                  <span>
                    v{state.artifact.version} · {draftPaneMode}
                  </span>
                </div>
                {/* The sheet: the document itself, on the desk, with the critique written in
                    its right margin. The margin follows the paper in DOM order on purpose —
                    reading down the draft must not tab through five controls per finding
                    before reaching the next sentence. */}
                <div className="sheet-stage">
                  <article className="artifact-pane current-pane sheet" ref={sheetRef}>
                    {draftSections.map((section) => {
                      // The full draft is what stands now, so removed lines belong to the redline.
                      const blocks = showChanges
                        ? section.blocks
                        : section.blocks.filter((pair) => pair.block !== null);
                      if (blocks.length === 0) return null;
                      return (
                        <section
                          className={`artifact-section${
                            section.removed ? " artifact-section-removed" : ""
                          }`}
                          key={section.key}
                        >
                          <h3>{section.title}</h3>
                          {blocks.map((pair) => renderDraftBlock(section.title, pair))}
                        </section>
                      );
                    })}
                  </article>
                  {compareVisible ? null : (
                    <DraftWidthHandle
                      width={draftWidth.reportedWidth}
                      maximum={draftWidth.maximum}
                      onWidthChange={draftWidth.choose}
                      onReset={draftWidth.reset}
                      onMeasure={draftWidth.measure}
                    />
                  )}
                  <div
                    className="sheet-margin"
                    ref={marginColumnRef}
                    {...(marginLayout === null
                      ? {}
                      : { style: { height: `${marginLayout.columnHeight}px` } })}
                  >
                    <ul
                      className={`margin-notes${marginLayout === null ? "" : " margin-notes-placed"}`}
                      aria-label="Findings in the draft margin"
                    >
                      {marginNotes.map((note) => renderMarginNote(note))}
                    </ul>
                    {marginLayout !== null && marginLayout.overflow.length > 0 ? (
                      <button
                        className="margin-more"
                        type="button"
                        onClick={() => {
                          const first = marginLayout.overflow[0];
                          if (first !== undefined) revealFindingInQueue(first);
                        }}
                      >
                        +{marginLayout.overflow.length} more in the queue
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* Traceability is an inspection, not a third copy of the draft: it stays one
                disclosure away, closed until a reviewer asks where wording came from. */}
            <section className="claims-panel" aria-label="claim to source inspection">
              <details className="claims-disclosure" ref={traceabilityRef}>
                <summary className="claims-disclosure-summary" ref={traceabilitySummaryRef}>
                  <span className="claims-disclosure-title">
                    <span className="eyebrow">Traceability</span>
                    <h2>Claims and career evidence</h2>
                  </span>
                  <span className="subtle">
                    Source links show where wording came from; they do not independently verify it.
                  </span>
                </summary>
                <div className="claim-list">
                  {state.artifact.claims.map((claim) => {
                    const draftBlockId = claimBlockId(state.artifact, claim.id);
                    return (
                      <article
                        className={`claim-card claim-${claim.status}${
                          linkedClaimId === claim.id ? " claim-linked" : ""
                        }`}
                        key={claim.id}
                      >
                        <div className="claim-heading">
                          <strong>{claim.text}</strong>
                          <span className="claim-heading-actions">
                            {draftBlockId === null ? null : (
                              <button
                                className="claim-locate"
                                type="button"
                                title="Show the draft line this claim comes from"
                                onMouseEnter={() => setLinkedClaimId(claim.id)}
                                onMouseLeave={() => setLinkedClaimId(null)}
                                onFocus={() => setLinkedClaimId(claim.id)}
                                onBlur={() => setLinkedClaimId(null)}
                                onClick={() => {
                                  draftBlockShellRefs.current
                                    .get(draftBlockId)
                                    ?.scrollIntoView({ block: "center", behavior: "smooth" });
                                  // Opening the line moves the caret into it.
                                  setEditingBlockId(draftBlockId);
                                  draftBlockRefs.current.get(draftBlockId)?.focus();
                                }}
                              >
                                <LinkIcon />
                                <span className="sr-only">
                                  Show the draft line for: {claim.text}
                                </span>
                              </button>
                            )}
                            <span className="status-tag">{claimSourceLabel(claim)}</span>
                          </span>
                        </div>
                        {claimSectionTitle(state.artifact, claim.id) === null ? null : (
                          <span className="claim-section-tag">
                            {claimSectionTitle(state.artifact, claim.id)}
                          </span>
                        )}
                        {claim.evidence.length === 0 ? (
                          <p className="warning-copy">
                            This claim is not linked to the candidate materials supplied to
                            DraftLoop.
                          </p>
                        ) : (
                          claim.evidence.map((reference) => (
                            <div
                              className={`evidence-row evidence-${reference.status}`}
                              key={`${reference.sourcePath}-${reference.locator}`}
                            >
                              <span aria-hidden="true">↳</span>
                              <span>
                                <strong>{reference.sourcePath}</strong> · {reference.locator}
                                <br />
                                {reference.excerpt}
                              </span>
                              <span className="status-tag">{reference.status}</span>
                            </div>
                          ))
                        )}
                      </article>
                    );
                  })}
                </div>
              </details>
            </section>
          </section>
        </div>

        <SidePanelHandle
          width={sidePanel.reportedWidth}
          viewportWidth={sidePanel.viewportWidth}
          onWidthChange={sidePanel.choose}
          onReset={sidePanel.reset}
        />
        <aside className="side-column">
          {/* The panel scrolls above the footer, never under it: a growing footer shrinks this
              area instead of covering its tabs. */}
          <div className="side-scroll" hidden={comparing}>
            {/* Run progress sits here only while the run executes; afterwards its timeline is in
              Run details, and only a paused or interrupted run keeps its way back in. */}
            {runInProgress ? (
              <section className="panel progress-panel" aria-label="run progress" ref={runPanelRef}>
                <div className="section-heading compact">
                  <div>
                    <PanelToggle
                      label="Run progress"
                      collapsed={collapsedPanels.has("progress")}
                      controls="run-progress-events"
                      onToggle={() => togglePanel("progress")}
                    />
                    <h2>{stateLabel(state.state)}</h2>
                  </div>
                  {readOnly ? null : state.state === "paused" ? (
                    resumeButton
                  ) : state.execution.status === "running" ? (
                    <button
                      className="button button-quiet"
                      type="button"
                      disabled={pendingReviewAction !== null}
                      onClick={() => onAction({ type: "stop" })}
                    >
                      {pendingReviewAction?.action === "stop" ? "Stopping…" : "Stop review"}
                    </button>
                  ) : null}
                </div>
                {state.execution.step === null ? null : (
                  <p className="pending-action-status" role="status" aria-live="polite">
                    {executionLine(state.execution)}
                  </p>
                )}
                {readOnly ? null : renderAutopilotToggle()}
                <div id="run-progress-events" hidden={collapsedPanels.has("progress")}>
                  <RunTimeline events={state.events} describeState={stateLabel} />
                </div>
              </section>
            ) : readOnly ||
              (state.execution.status !== "interrupted" && state.state !== "paused") ? null : (
              <section
                className="panel run-recovery-panel"
                aria-label="run recovery"
                ref={runPanelRef}
              >
                <div className="section-heading compact">
                  <h2>{stateLabel(state.state)}</h2>
                  {state.execution.status === "interrupted" ? (
                    <div className="approval-actions">
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={pendingReviewAction !== null || !transmissionReady}
                        onClick={() => onAction({ type: "resume" })}
                      >
                        Resume interrupted review
                      </button>
                      <button
                        className="button button-quiet"
                        type="button"
                        disabled={pendingReviewAction !== null}
                        onClick={() => onAction({ type: "stop" })}
                      >
                        Stop review
                      </button>
                    </div>
                  ) : (
                    resumeButton
                  )}
                </div>
                {state.state !== "paused" || state.usageLimit == null ? null : (
                  <p className="pending-action-status" role="status">
                    {usageLimitText(state.usageLimit)}. Nothing is lost: Resume retries the{" "}
                    {state.usageLimit.step} step where it stopped.
                  </p>
                )}
                {state.execution.status !== "interrupted" ? null : state.execution.failure !==
                  undefined ? (
                  <p className="pending-action-status setup-blocker" role="alert">
                    The review could not continue: {state.execution.failure} Fix this, then resume
                    the review, or stop it without losing history.
                  </p>
                ) : (
                  <p className="pending-action-status" role="status">
                    This review was interrupted when the previous app session ended. Resume it to
                    continue from the durable step, or stop it without losing history.
                  </p>
                )}
              </section>
            )}
            <RunTrustWarning independentReview={state.providerExposure.independentReview} />

            <ReviewWorkTabs
              next={nextStepLine(state, gateBlocker, approvalReadiness)}
              onNext={
                !readOnly && nextStepOpensRunDetails(state, gateBlocker)
                  ? openRunDetails
                  : { findings: openFindings, "approval-gate": revealApprovalGate, none: null }[
                      nextStepTarget(gateBlocker) ?? "none"
                    ]
              }
              selected={workTab}
              onSelect={selectWorkTab}
              tabs={workTabs}
            />
            <section
              className="panel findings-panel"
              id="findings-panel"
              aria-label="critique findings"
              tabIndex={-1}
              {...reviewWorkPanelProps("findings", workTab, tabbedWork)}
            >
              <div className="findings-queue-header">
                <div className="section-heading compact">
                  <div>
                    <h2>Findings</h2>
                    <p className="finding-progress" role="status" aria-live="polite">
                      {findingProgressLine({
                        resolved: queueCounts.resolved,
                        total: state.findings.length,
                        needsAction: queueCounts.needsAction,
                        runInProgress,
                        critiqued,
                      })}
                    </p>
                    {runInProgress && queueCounts.needsAction > 0 ? (
                      <p className="setup-note">
                        The review is still running, so nothing here needs you yet. It pauses when
                        it needs your decisions.
                      </p>
                    ) : null}
                  </div>
                  <span className="count-badge">
                    {!hasArtifact || (!critiqued && state.findings.length === 0)
                      ? "Not evaluated"
                      : queueCounts.needsAction === 0
                        ? "All resolved"
                        : `${queueCounts.blocking} blocking · ${queueCounts.warnings} warning${queueCounts.warnings === 1 ? "" : "s"}`}
                  </span>
                </div>
                <fieldset className="finding-filters">
                  <legend className="sr-only">Finding filters</legend>
                  {findingQueueFilters.map((filter) => {
                    const count = findingQueueFilterCount(queueCounts, filter.id);
                    const isSelected = findingFilter === filter.id;
                    return (
                      <button
                        className={`finding-filter${isSelected ? " finding-filter-selected" : ""}`}
                        type="button"
                        aria-pressed={isSelected}
                        aria-controls="finding-queue-list"
                        key={filter.id}
                        onClick={() => {
                          setFindingFilter(filter.id);
                          setExpandedFindingId(null);
                          setOverrideEditingFindingId(null);
                        }}
                      >
                        <span>{filter.label}</span>
                        <span className="finding-filter-count">{count}</span>
                      </button>
                    );
                  })}
                </fieldset>
              </div>
              <div id="findings-panel-body">
                {findingDecisionPending ? (
                  <p className="pending-action-status" role="status" aria-live="polite">
                    Saving{" "}
                    {pendingBulkFindingCount === null
                      ? "finding decision"
                      : `${pendingBulkFindingCount} finding decisions`}
                    … Elapsed {formatElapsedDuration(pendingReviewAction.elapsedSeconds * 1_000)}.
                    Keep this window open while
                    {pendingBulkFindingCount === null ? " the decision is" : " the decisions are"}{" "}
                    saved.
                  </p>
                ) : null}
                {knownGapsLabel === null || onMarkKnownGaps === undefined ? null : (
                  <div className="finding-bulk-actions finding-known-gaps">
                    <button
                      className="button button-quiet"
                      type="button"
                      disabled={pendingReviewAction !== null}
                      onClick={() => onMarkKnownGaps(knownGapIds)}
                    >
                      {knownGapsLabel}
                    </button>
                    <p className="finding-bulk-note">{MARK_KNOWN_GAPS_NOTE}</p>
                  </div>
                )}
                {bulkDecisionAvailable ? (
                  <fieldset className="finding-bulk-actions">
                    <legend>
                      Apply to all {filteredFindings.filter(isUnresolvedFinding).length} shown
                    </legend>
                    {directFindingDecisions.map((decision) => {
                      const targetIds = bulkDecisionTargetsForDecision(
                        state.findings,
                        bulkFindingDecisionTargets(state.findings, findingFilter, decision),
                        decision,
                        decisionContext,
                      );
                      return (
                        <button
                          className="button button-quiet"
                          type="button"
                          key={decision}
                          disabled={pendingReviewAction !== null || targetIds.length === 0}
                          onClick={() => onBulkFindingDecision(targetIds, decision)}
                        >
                          {decisionLabels[decision]} all
                        </button>
                      );
                    })}
                    {bulkWordMatchNote === null ? null : (
                      <p className="finding-bulk-note">
                        {bulkWordMatchNote} {BULK_ACCEPT_SKIPS_WORD_MATCH_NOTE}.
                      </p>
                    )}
                    {bulkBlockingNote === null ? null : (
                      <p className="finding-bulk-note">{bulkBlockingNote}</p>
                    )}
                  </fieldset>
                ) : null}
                <section
                  className="findings-queue-scroll"
                  id="finding-queue-list"
                  aria-label="Findings queue"
                  tabIndex={-1}
                  ref={findingQueueRef}
                >
                  {filteredFindings.length === 0 ? (
                    <p className="finding-empty-state" role="status">
                      {findingQueueEmptyMessage(findingFilter, queueCounts)}
                    </p>
                  ) : null}
                  {filteredFindings.map((finding) => {
                    const claim =
                      finding.claimId === undefined ? undefined : claimById.get(finding.claimId);
                    const isExpanded = expandedFindingId === finding.id;
                    const summaryId = findingDomId("finding-summary", finding.id);
                    const detailsId = findingDomId("finding-details", finding.id);
                    const isEditingOverride = isOverrideEditorVisible(
                      overrideEditingFindingId,
                      finding.id,
                    );
                    const rationale = overrideReasons[finding.id] ?? finding.rationale ?? "";
                    const saveOverride = () => {
                      const trimmedRationale = rationale.trim();
                      if (findingDecisionsLocked || trimmedRationale === "") return;
                      findingDecisionRequest.current = {
                        findingId: finding.id,
                        decision: "overridden",
                      };
                      onAction({
                        type: "finding-decision",
                        findingId: finding.id,
                        decision: "overridden",
                        rationale: trimmedRationale,
                      });
                      setOverrideEditingFindingId(null);
                    };

                    return (
                      <article
                        className={`finding-row finding-${finding.severity}${
                          isUnresolvedFinding(finding) ? "" : " finding-resolved"
                        }${activeFindingId === finding.id ? " finding-row-active" : ""}`}
                        key={finding.id}
                      >
                        <button
                          className="finding-summary"
                          type="button"
                          id={summaryId}
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          ref={(element) => {
                            if (element === null)
                              findingSummaryButtonRefs.current.delete(finding.id);
                            else findingSummaryButtonRefs.current.set(finding.id, element);
                          }}
                          onMouseEnter={() => {
                            setActiveFindingId(finding.id);
                            setLinkedClaimId(finding.claimId ?? null);
                          }}
                          onMouseLeave={() => {
                            setActiveFindingId((current) =>
                              current === finding.id ? null : current,
                            );
                            setLinkedClaimId(null);
                          }}
                          onFocus={() => {
                            setActiveFindingId(finding.id);
                            setLinkedClaimId(finding.claimId ?? null);
                          }}
                          onBlur={() => {
                            setActiveFindingId((current) =>
                              current === finding.id ? null : current,
                            );
                            setLinkedClaimId(null);
                          }}
                          onClick={() => {
                            setExpandedFindingId((current) =>
                              current === finding.id ? null : finding.id,
                            );
                            setOverrideEditingFindingId(null);
                          }}
                        >
                          <span className={`severity severity-${finding.severity}`}>
                            {finding.severity === "error" ? "blocking" : "warning"}
                          </span>
                          <span className="finding-summary-content">
                            <span className="finding-summary-message">{findingTitle(finding)}</span>
                          </span>
                          <span className="finding-summary-footer">
                            <span
                              className={`finding-summary-status resolution-${finding.decision}`}
                            >
                              {acceptedWithoutRevision(finding, decisionContext)
                                ? "Accepted · no revision left"
                                : finding.severity === "error" && finding.decision === "accepted"
                                  ? "Accepted · revision required"
                                  : decisionLabels[finding.decision]}
                              <span className="finding-summary-chevron" aria-hidden="true">
                                {isExpanded ? "⌃" : "⌄"}
                              </span>
                            </span>
                            <span className="finding-summary-meta">
                              {finding.category} · {finding.code}
                            </span>
                          </span>
                        </button>
                        {acceptedWithoutRevision(finding, decisionContext) ? (
                          <p className="finding-nudge">{ACCEPTED_WITHOUT_REVISION_NUDGE}</p>
                        ) : null}
                        {isExpanded ? (
                          <section
                            className="finding-details"
                            id={detailsId}
                            aria-labelledby={summaryId}
                          >
                            {finding.agreement !== "author-and-critic" ? (
                              <p className="disagreement">
                                Disagreement · {finding.agreement} finding
                              </p>
                            ) : null}
                            {claim === undefined ? (
                              <p className="linked-claim">No linked claim for this finding.</p>
                            ) : (
                              <p className="linked-claim">Linked claim: {claim.text}</p>
                            )}
                            <fieldset className="finding-actions">
                              <legend className="sr-only">Decision for {finding.code}</legend>
                              {directFindingDecisions.map((decision) => (
                                <button
                                  className={
                                    finding.decision === decision
                                      ? "button button-selected"
                                      : "button button-quiet"
                                  }
                                  type="button"
                                  key={decision}
                                  aria-describedby={
                                    decision === "accepted" &&
                                    acceptUnavailable(finding, decisionContext)
                                      ? `${findingAcceptGuardId(detailsId)} ${findingDecisionHintId(detailsId, decision)}`
                                      : findingDecisionHintId(detailsId, decision)
                                  }
                                  disabled={
                                    findingDecisionsLocked ||
                                    (decision === "accepted" &&
                                      acceptUnavailable(finding, decisionContext))
                                  }
                                  onClick={() => decideFinding(finding.id, decision)}
                                >
                                  {decisionLabels[decision]}
                                </button>
                              ))}
                              <button
                                className={
                                  isEditingOverride || finding.decision === "overridden"
                                    ? "button button-selected"
                                    : "button button-quiet"
                                }
                                type="button"
                                aria-describedby={findingDecisionHintId(detailsId, "overridden")}
                                disabled={findingDecisionsLocked}
                                onClick={() => beginOverride(finding)}
                              >
                                Override
                              </button>
                            </fieldset>
                            <FindingDecisionHint
                              finding={finding}
                              context={decisionContext}
                              baseId={detailsId}
                            />
                            {isEditingOverride ? (
                              <section
                                className="override-editor"
                                aria-label={`Override ${finding.code}`}
                              >
                                <label className="rationale-input-label">
                                  <span>Override rationale (required)</span>
                                  <input
                                    className="rationale-input"
                                    type="text"
                                    value={rationale}
                                    disabled={findingDecisionsLocked}
                                    ref={(element) => {
                                      if (element === null)
                                        overrideInputRefs.current.delete(finding.id);
                                      else overrideInputRefs.current.set(finding.id, element);
                                    }}
                                    onChange={(event) =>
                                      setOverrideReasons((current) => ({
                                        ...current,
                                        [finding.id]: event.target.value,
                                      }))
                                    }
                                    onKeyDown={submitOnEnter(saveOverride)}
                                    aria-label={`Override rationale for ${finding.code}`}
                                  />
                                </label>
                                <div className="override-editor-actions">
                                  <button
                                    className="button button-quiet"
                                    type="button"
                                    disabled={findingDecisionsLocked}
                                    onClick={() => {
                                      setOverrideEditingFindingId(null);
                                      setOverrideReasons((current) => {
                                        const next = { ...current };
                                        delete next[finding.id];
                                        return next;
                                      });
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="button button-primary"
                                    type="button"
                                    disabled={findingDecisionsLocked || rationale.trim() === ""}
                                    onClick={saveOverride}
                                  >
                                    Save override
                                  </button>
                                </div>
                              </section>
                            ) : null}
                          </section>
                        ) : null}
                      </article>
                    );
                  })}
                </section>
                {/* The keys, written down. A shortcut nobody can see is a shortcut nobody uses. */}
                <footer className="finding-hints">
                  <span className="finding-hint">
                    <kbd>J</kbd>
                    <kbd>K</kbd> move
                  </span>
                  <span className="finding-hint">
                    <kbd>Enter</kbd> open
                  </span>
                  <span className="finding-hint">
                    <kbd>A</kbd> accept
                  </span>
                  <span className="finding-hint">
                    <kbd>R</kbd> reject
                  </span>
                  <span className="finding-hint">
                    <kbd>D</kbd> defer
                  </span>
                  <span className="finding-hint">
                    <kbd>O</kbd> override
                  </span>
                  <span className="finding-hint">
                    <kbd>Esc</kbd> close
                  </span>
                  <button
                    className="finding-hint finding-hint-command"
                    type="button"
                    aria-keyshortcuts="Control+K Meta+K"
                    title="Open the command palette"
                    onClick={openPalette}
                  >
                    <kbd>Ctrl/⌘</kbd>
                    <kbd>K</kbd> commands
                  </button>
                </footer>
              </div>
            </section>

            {state.coverage === undefined || state.coverage === null ? null : (
              <RequirementCoveragePanel
                coverage={state.coverage}
                sections={state.artifact.sections}
                collapsed={!coverageCardsShown}
                onToggle={() => setCoverageCardsShown((shown) => !shown)}
                onLocateBlock={locateDraftBlock}
                tabPanel={reviewWorkPanelProps("coverage", workTab, true)}
              />
            )}
            {onReadJob === undefined ? null : (
              <JobDescriptionPanel
                readJob={onReadJob}
                reloadKey={`${state.workspaceId}:${state.runId}`}
                tabPanel={reviewWorkPanelProps("job", workTab, true)}
              />
            )}
          </div>

          {/* The gate lives in the footer: its blocker line, actions and Details stay on screen
              however long the queue above them grows. */}
          <ReviewFooter
            blocker={comparing ? comparingRunsBlocker : gateBlocker}
            readOnly={!approvalOpen}
            runningRound={
              comparing
                ? null
                : footerRunningRound({
                    state,
                    sentDirection,
                    busy: pendingReviewAction !== null,
                    stopping: pendingReviewAction?.action === "stop",
                    transmissionReady,
                    onStop: () => onAction({ type: "stop" }),
                    onResume: () => onAction({ type: "resume" }),
                    onShowProgress: showRunPanel,
                  })
            }
            errorMessage={approvalExportErrorVisible ? (errorMessage ?? null) : null}
            statusLine={`Artifact: ${state.approval === "approved" ? "approved" : "not approved"} · Export: ${state.exportPath !== null ? "exported" : state.state === "exported" ? "exported, file not found" : "not exported"} · Validation: ${validationLabel}`}
            detail={
              !hasArtifact ? (
                <p className="warning-copy">
                  Approval and export are unavailable until the author produces a valid draft.
                </p>
              ) : roundLimitRecovery ? (
                <p className="warning-copy">
                  Round {state.round} was opened after the configured maximum of {maximumRounds},
                  before any new draft or critique was produced. Version {state.artifact.version}{" "}
                  and its completed Round {state.round - 1} critique are still intact.
                </p>
              ) : runInProgress ? (
                <p className="setup-note">Approval opens when the review pauses for you.</p>
              ) : !state.reviewComplete ? (
                <p className="warning-copy">
                  {runStatusLine?.label}. {runStatusLine?.detail}
                </p>
              ) : blockingFindings.length > 0 ? (
                <p className="warning-copy">
                  {state.approval === "approved"
                    ? `${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? " remains" : "s remain"} unresolved after approval.`
                    : acceptedBlockingFindings.length > 0
                      ? `Request a revision for ${acceptedBlockingFindings.length} accepted blocking finding${acceptedBlockingFindings.length === 1 ? "" : "s"}, or reject or override the finding if it does not apply.`
                      : `Resolve or override ${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? "" : "s"} before approval.`}
                </p>
              ) : knownGapOverride !== null && state.approval !== "approved" ? (
                <p className="warning-copy">
                  The final CV checks fail only on the gaps you marked as known. Approving records
                  your reasons as the override.
                </p>
              ) : approvalReadiness?.applicationReady === false && state.approval !== "approved" ? (
                <div className="warning-copy">
                  <p>
                    Final CV checks block approval:{" "}
                    {formatReadinessBlockers(approvalReadiness.blockers).join("; ")}.
                  </p>
                  <p>{approvalReadinessGuidance}</p>
                </div>
              ) : warnings.length > 0 ? (
                <p className="warning-copy">
                  Approval is available with {warnings.length} unresolved non-blocking warning
                  {warnings.length === 1 ? "" : "s"}. They remain visible after approval.
                </p>
              ) : state.state === "provider-error" ? (
                <p className="warning-copy">
                  No unresolved blocking findings; provider recovery remains before approval.
                </p>
              ) : (
                <p className="safe-copy">
                  No unresolved blocking findings. The final decision remains yours.
                </p>
              )
            }
            conditions={gateConditions}
            editNote={editNote}
            detailsOpen={gateDetailsOpen}
            onDetailsOpenChange={setGateDetailsOpen}
            recovery={
              roundLimitRecovery
                ? {
                    round: state.round - 1,
                    disabled: chosenRunOpen || pendingReviewAction !== null,
                    onRecover: () => onAction({ type: "recover-round-limit" }),
                  }
                : null
            }
            approve={{
              disabled: !canApprove || pendingReviewAction !== null,
              onApprove: approveArtifact,
            }}
            override={
              canOverrideReadiness
                ? {
                    open: readinessOverrideOpen,
                    onOpenChange: setReadinessOverrideOpen,
                    reason: readinessOverrideReason,
                    onReasonChange: (reason) =>
                      setReadinessOverrideDraft({ key: readinessOverrideKey, reason }),
                    disabled: pendingReviewAction !== null,
                    onSubmit: (reason) =>
                      onAction({ type: "approve", readinessOverrideRationale: reason }),
                  }
                : null
            }
            revision={{
              disabled:
                chosenRunOpen ||
                state.state !== "awaiting-approval" ||
                !state.reviewComplete ||
                roundLimitReached ||
                !transmissionReady ||
                pendingReviewAction !== null,
              onRequest: requestRevision,
              direction: revisionDirection,
              directionsUnavailable,
              unavailableReason: lastingRevisionBlock,
              onDirectionChange: (text) =>
                setRevisionDirectionDraft({ key: revisionDirectionKey, text }),
            }}
            exportAction={{
              disabled: !canExport,
              again: state.state === "exported",
              pathLabel:
                state.exportPath ??
                (!state.reviewComplete
                  ? "Unavailable until independent critique completes"
                  : state.state === "exported"
                    ? MISSING_EXPORT_LABEL
                    : canExport
                      ? "Available now"
                      : state.state === "approved"
                        ? "Unavailable while another action is pending"
                        : "Available after approval"),
              pendingSeconds: exportPending ? pendingReviewAction.elapsedSeconds : null,
              format: exportFormat,
              onFormatChange: setExportFormat,
              template: exportTemplate,
              onTemplateChange: setExportTemplate,
              note: state.exportNote ?? null,
              downloads: exportsDownload,
              onExport: () => onAction(exportReviewAction(exportFormat, exportTemplate)),
            }}
          />
        </aside>
      </main>
    </div>
  );
}
