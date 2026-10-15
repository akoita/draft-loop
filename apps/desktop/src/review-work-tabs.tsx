/**
 * The review's work area: a one-line "Next:" status over two tabs, Findings and Coverage.
 *
 * The "Next:" line reads the footer's blocker kind, so it can never name a different step than
 * the gate below it enforces. Findings and Coverage share the side panel as tabs instead of
 * stacking, and coverage verdicts, which never block approval, fold to one summary line until
 * the reviewer asks for every card.
 *
 * The chosen tab is a reading preference held in `sessionStorage` for the app session; it never
 * reaches the main process and changes nothing about the run.
 */
import { type JSX, type KeyboardEvent, useCallback, useRef, useState } from "react";

import type { ApprovalReadiness, ApprovalReadinessBlocker } from "./approval-readiness.js";
import type { ReviewCoverageView } from "./coverage-contract.js";
import {
  type DesktopReviewState,
  reviewFindingSummary,
  roundLimitRecoveryRequired,
} from "./model.js";
import { compactReadinessBlocker, type FooterBlocker } from "./review-footer.js";
import { reviewInProgress } from "./review-run-status.js";

export type ReviewWorkTabId = "findings" | "coverage";

const reviewWorkTabIds: readonly ReviewWorkTabId[] = Object.freeze([
  "findings",
  "coverage",
] as const);

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A final-check blocker as short as the "Next:" line needs, e.g. "relevance 22%". */
function shortReadinessBlocker(blocker: ApprovalReadinessBlocker): string {
  if (
    blocker.code === "unmet-rubric-threshold" &&
    blocker.dimension !== undefined &&
    blocker.score !== undefined
  ) {
    return `${blocker.dimension} ${(blocker.score * 100).toFixed(0)}%`;
  }
  return compactReadinessBlocker(blocker);
}

/**
 * The one step the reviewer takes next, derived from the footer's blocker so the two agree.
 * `readiness` names the failing final check when the footer reports one.
 */
export function nextStepLine(
  state: DesktopReviewState,
  blocker: FooterBlocker,
  readiness: ApprovalReadiness | null = null,
): string {
  switch (blocker.kind) {
    case "no-artifact":
      return reviewInProgress(state)
        ? "Next: wait for the review"
        : "Next: resume or start a review to get a draft";
    case "exported":
      return "Next: nothing left · the CV is exported";
    case "approved":
      return "Next: export";
    case "waiting":
      if (roundLimitRecoveryRequired(state)) {
        return `Next: return to reviewed Round ${state.round - 1}`;
      }
      if (reviewInProgress(state)) return "Next: wait for the review";
      if (!state.reviewComplete) {
        if (state.state === "paused") return "Next: resume the review";
        if (state.state === "stopped") return "Next: start a new review";
        return "Next: resume or retry the review";
      }
      return "Next: recover from the provider error";
    case "findings": {
      const revisionLeft = state.round < state.providerTransmissionPreflight.budget.maxRounds;
      const { blocking } = reviewFindingSummary(state);
      const undecided = blocking.filter((finding) => finding.decision !== "accepted").length;
      if (revisionLeft && undecided === 0) return "Next: request a revision";
      return `Next: decide ${plural(revisionLeft ? undecided : blocking.length, "blocking finding")}`;
    }
    case "final-checks": {
      const blockers = readiness?.blockers ?? [];
      const first = blockers[0];
      if (first === undefined) return "Next: approve or override";
      const more = blockers.length > 1 ? ` and ${blockers.length - 1} more` : "";
      return `Next: approve or override (${shortReadinessBlocker(first)}${more})`;
    }
    case "ready":
      return blocker.tone === "safe" ? "Next: approve" : "Next: check the warnings, then approve";
  }
}

/** How many requirements the critic found covered, out of every assessed requirement. */
export interface CoverageTally {
  readonly covered: number;
  readonly total: number;
  readonly notCovered: number;
}

export function coverageTally(coverage: ReviewCoverageView): CoverageTally {
  const total = coverage.assessments.length;
  const covered = coverage.assessments.filter(
    (assessment) => assessment.status === "covered",
  ).length;
  return { covered, total, notCovered: total - covered };
}

/** The folded coverage list in one line, e.g. "8 of 17 covered · 9 not covered". */
export function coverageCollapsedSummary(coverage: ReviewCoverageView): string {
  const { covered, total, notCovered } = coverageTally(coverage);
  if (total === 0) return "No requirements assessed";
  return notCovered === 0
    ? `${covered} of ${total} covered`
    : `${covered} of ${total} covered · ${notCovered} not covered`;
}

/** A tab's short visible text, and the full wording screen readers hear instead. */
export interface ReviewWorkTabLabel {
  readonly id: ReviewWorkTabId;
  readonly label: string;
  readonly ariaLabel: string;
}

/** "Findings · 2", read as "Findings, 2 need action". */
export function findingsTabLabel(needsAction: number): ReviewWorkTabLabel {
  return {
    id: "findings",
    label: `Findings · ${needsAction}`,
    ariaLabel: `Findings, ${needsAction} need action`,
  };
}

/** "Coverage · 8/17", read as "Coverage, 8 of 17 covered". */
export function coverageTabLabel(coverage: ReviewCoverageView): ReviewWorkTabLabel {
  const { covered, total } = coverageTally(coverage);
  return {
    id: "coverage",
    label: `Coverage · ${covered}/${total}`,
    ariaLabel: `Coverage, ${covered} of ${total} covered`,
  };
}

/**
 * Where the "Next:" line can take the reviewer: the findings queue, the footer's approval gate,
 * or nowhere when the step happens elsewhere (waiting, approving, exporting).
 */
export type NextStepTarget = "findings" | "approval-gate";

export function nextStepTarget(blocker: FooterBlocker): NextStepTarget | null {
  if (blocker.kind === "findings") return "findings";
  if (blocker.kind === "final-checks") return "approval-gate";
  return null;
}

/** Findings when any finding needs the reviewer, otherwise Coverage. */
export function defaultReviewWorkTab(needsAction: number): ReviewWorkTabId {
  return needsAction > 0 ? "findings" : "coverage";
}

/** `sessionStorage` key holding the reviewer's chosen tab. */
export const reviewWorkTabStorageKey = "draft-loop.review-work-tab";

type TabStorage = Pick<Storage, "getItem" | "setItem">;

export function readStoredReviewWorkTab(storage: TabStorage | undefined): ReviewWorkTabId | null {
  try {
    const raw = storage?.getItem(reviewWorkTabStorageKey) ?? null;
    return reviewWorkTabIds.includes(raw as ReviewWorkTabId) ? (raw as ReviewWorkTabId) : null;
  } catch {
    return null;
  }
}

export function writeStoredReviewWorkTab(
  storage: TabStorage | undefined,
  tab: ReviewWorkTabId,
): void {
  try {
    storage?.setItem(reviewWorkTabStorageKey, tab);
  } catch {
    // A blocked store only costs the preference, never the review.
  }
}

function sessionTabStorage(): TabStorage | undefined {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? undefined : globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export interface ReviewWorkTab {
  readonly selected: ReviewWorkTabId;
  readonly select: (tab: ReviewWorkTabId) => void;
}

/**
 * The selected tab: the reviewer's choice for this session, or else the default. Without a choice
 * the tab follows new findings into Findings but never leaves it on its own, so deciding the last
 * finding does not pull the queue out from under the reviewer's focus.
 */
export function useReviewWorkTab(preferred: ReviewWorkTabId): ReviewWorkTab {
  const [chosen, setChosen] = useState<ReviewWorkTabId | null>(() =>
    readStoredReviewWorkTab(sessionTabStorage()),
  );
  const [held, setHeld] = useState<ReviewWorkTabId>(preferred);
  if (chosen === null && preferred === "findings" && held !== "findings") setHeld("findings");

  const select = useCallback((tab: ReviewWorkTabId) => {
    setChosen(tab);
    writeStoredReviewWorkTab(sessionTabStorage(), tab);
  }, []);

  return { selected: chosen ?? held, select };
}

export function reviewWorkTabDomId(tab: ReviewWorkTabId): string {
  return `review-work-tab-${tab}`;
}

/** The panels keep their existing ids, so links and focus targets into them still resolve. */
export function reviewWorkPanelDomId(tab: ReviewWorkTabId): string {
  return tab === "findings" ? "findings-panel" : "coverage-panel";
}

/** The ARIA a panel carries while it sits under a tab. */
export interface ReviewWorkPanelProps {
  readonly role: "tabpanel";
  readonly id: string;
  readonly "aria-labelledby": string;
  /** The tab names the panel, so the panel's own landmark label steps aside. */
  readonly "aria-label": undefined;
  readonly hidden: boolean;
}

/**
 * Spread onto a panel's root element. Every panel stays mounted and is only hidden, so the
 * finding queue keeps its refs and the keyboard queue and the command palette can switch back.
 * Null when the panel stands alone and keeps its own landmark.
 */
export function reviewWorkPanelProps(
  tab: ReviewWorkTabId,
  selected: ReviewWorkTabId,
  tabbed: boolean,
): ReviewWorkPanelProps | null {
  if (!tabbed) return null;
  return {
    role: "tabpanel",
    id: reviewWorkPanelDomId(tab),
    "aria-labelledby": reviewWorkTabDomId(tab),
    "aria-label": undefined,
    hidden: tab !== selected,
  };
}

/**
 * The "Next:" line and the tablist over the panels. With a single tab, such as a run without
 * coverage, there is no tablist: a tablist of one is a control that does nothing.
 */
export function ReviewWorkTabs({
  next,
  onNext = null,
  tabs,
  selected,
  onSelect,
}: {
  readonly next: string;
  /** Go to the place the next step happens; null keeps the line plain text. */
  readonly onNext?: (() => void) | null;
  readonly tabs: readonly ReviewWorkTabLabel[];
  readonly selected: ReviewWorkTabId;
  readonly onSelect: (tab: ReviewWorkTabId) => void;
}): JSX.Element {
  const tabRefs = useRef(new Map<ReviewWorkTabId, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1;
    const keyTargets: Readonly<Record<string, number>> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const target = keyTargets[event.key];
    const tab = target === undefined ? undefined : tabs[target];
    if (tab === undefined) return;
    event.preventDefault();
    onSelect(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  return (
    <div className="review-work">
      <p className="next-step-line">
        {onNext === null ? (
          next
        ) : (
          <button className="next-step-action" type="button" onClick={onNext}>
            {next}
          </button>
        )}
      </p>
      {tabs.length < 2 ? null : (
        <div className="review-work-tablist" role="tablist" aria-label="Review work">
          {tabs.map((tab, index) => {
            const isSelected = tab.id === selected;
            return (
              <button
                className={`review-work-tab${isSelected ? " review-work-tab-selected" : ""}`}
                type="button"
                role="tab"
                id={reviewWorkTabDomId(tab.id)}
                aria-selected={isSelected}
                aria-controls={reviewWorkPanelDomId(tab.id)}
                aria-label={tab.ariaLabel}
                tabIndex={isSelected ? 0 : -1}
                key={tab.id}
                ref={(element) => {
                  if (element === null) tabRefs.current.delete(tab.id);
                  else tabRefs.current.set(tab.id, element);
                }}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
