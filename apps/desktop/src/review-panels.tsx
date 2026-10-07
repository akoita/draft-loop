/**
 * Review panel disclosure and the run timeline.
 *
 * The right-hand review panel stacks the run progress, the critique queue and the human gate.
 * Each of those can grow without bound on a long run, so each one folds to its heading. Which
 * panels are folded is a reading preference, stored app-wide in `localStorage` like the theme
 * and the compare split: it never reaches the main process and changes nothing about the run.
 *
 * The run timeline folds twice more on its own: consecutive identical events (one per recorded
 * finding decision, one per retried provider call) collapse into one row with a count, and only
 * the most recent rows show until the reviewer asks for the earlier ones.
 */
import { type JSX, useCallback, useState } from "react";

import type { ReviewEvent } from "./model.js";

/** The review panels a reviewer can fold. The trust strip is a fixed-height summary and stays. */
export type ReviewPanelId = "progress" | "findings" | "coverage" | "gate";

export const reviewPanelIds: readonly ReviewPanelId[] = Object.freeze([
  "progress",
  "findings",
  "coverage",
  "gate",
] as const);

/** `localStorage` key holding the folded panels, as a JSON array of panel ids. */
export const collapsedReviewPanelsStorageKey = "draft-loop.review-panels.collapsed";

function isReviewPanelId(value: unknown): value is ReviewPanelId {
  return typeof value === "string" && reviewPanelIds.includes(value as ReviewPanelId);
}

/** Read a stored value; anything unusable means "nothing folded". */
export function parseCollapsedReviewPanels(raw: string | null): ReadonlySet<ReviewPanelId> {
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter(isReviewPanelId) : []);
  } catch {
    return new Set();
  }
}

type PanelStorage = Pick<Storage, "getItem" | "setItem">;

export function readStoredCollapsedReviewPanels(
  storage: PanelStorage | undefined,
): ReadonlySet<ReviewPanelId> {
  try {
    return parseCollapsedReviewPanels(storage?.getItem(collapsedReviewPanelsStorageKey) ?? null);
  } catch {
    return new Set();
  }
}

export function writeStoredCollapsedReviewPanels(
  storage: PanelStorage | undefined,
  collapsed: ReadonlySet<ReviewPanelId>,
): void {
  try {
    storage?.setItem(
      collapsedReviewPanelsStorageKey,
      JSON.stringify(reviewPanelIds.filter((id) => collapsed.has(id))),
    );
  } catch {
    // A blocked or full store only costs the preference, never the review.
  }
}

function browserStorage(): PanelStorage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export interface CollapsedReviewPanels {
  readonly collapsed: ReadonlySet<ReviewPanelId>;
  readonly toggle: (panel: ReviewPanelId) => void;
  /** Unfold a panel that something else is about to reveal, such as a jump to a finding. */
  readonly expand: (panel: ReviewPanelId) => void;
}

/** Hold the folded panels and persist every change. */
export function useCollapsedReviewPanels(): CollapsedReviewPanels {
  const [collapsed, setCollapsed] = useState<ReadonlySet<ReviewPanelId>>(() =>
    readStoredCollapsedReviewPanels(browserStorage()),
  );

  const update = useCallback((panel: ReviewPanelId, fold: (isFolded: boolean) => boolean) => {
    setCollapsed((current) => {
      const nextFolded = fold(current.has(panel));
      if (nextFolded === current.has(panel)) return current;
      const next = new Set(current);
      if (nextFolded) next.add(panel);
      else next.delete(panel);
      writeStoredCollapsedReviewPanels(browserStorage(), next);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (panel: ReviewPanelId) => update(panel, (isFolded) => !isFolded),
    [update],
  );
  const expand = useCallback((panel: ReviewPanelId) => update(panel, () => false), [update]);

  return { collapsed, toggle, expand };
}

/**
 * The panel's eyebrow, made into its disclosure button. The heading under it stays visible
 * when the panel folds, so a folded panel still says where the run, the queue or the gate is.
 */
export function PanelToggle({
  label,
  collapsed,
  controls,
  onToggle,
}: {
  readonly label: string;
  readonly collapsed: boolean;
  readonly controls: string;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button
      className="eyebrow panel-toggle"
      type="button"
      aria-expanded={!collapsed}
      aria-controls={controls}
      title={collapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
      onClick={onToggle}
    >
      <svg
        className="panel-toggle-chevron"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="m4.5 6.5 3.5 3.5 3.5-3.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}

/** One timeline row: an event, or a run of identical consecutive events. */
export interface ReviewEventGroup {
  readonly id: string;
  readonly label: string;
  readonly state: ReviewEvent["state"];
  readonly count: number;
}

/**
 * Fold consecutive events that read the same. Only neighbours fold, so the timeline still shows
 * the order things happened in: a failure between two successes stays between them.
 */
export function groupRepeatedReviewEvents(
  events: readonly ReviewEvent[],
): readonly ReviewEventGroup[] {
  const groups: ReviewEventGroup[] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    if (
      previous !== undefined &&
      previous.label === event.label &&
      previous.state === event.state
    ) {
      groups[groups.length - 1] = { ...previous, count: previous.count + 1 };
    } else {
      groups.push({ id: event.id, label: event.label, state: event.state, count: 1 });
    }
  }
  return groups;
}

/** How many of the latest timeline rows show before the reviewer asks for the rest. */
export const recentReviewEventRowLimit = 6;

export function RunTimeline({
  events,
  describeState,
}: {
  readonly events: readonly ReviewEvent[];
  readonly describeState: (state: ReviewEvent["state"]) => string;
}): JSX.Element {
  const [showEarlier, setShowEarlier] = useState(false);
  const groups = groupRepeatedReviewEvents(events);
  const hiddenCount = showEarlier ? 0 : Math.max(0, groups.length - recentReviewEventRowLimit);
  const visible = groups.slice(hiddenCount);
  const canFold = groups.length > recentReviewEventRowLimit;

  return (
    <>
      {canFold ? (
        <button
          className="event-list-more"
          type="button"
          aria-expanded={showEarlier}
          onClick={() => setShowEarlier((current) => !current)}
        >
          {showEarlier
            ? "Show only recent events"
            : `Show ${hiddenCount} earlier event${hiddenCount === 1 ? "" : "s"}`}
        </button>
      ) : null}
      <ol className="event-list">
        {visible.map((group) => (
          <li key={group.id}>
            <span className={`event-dot state-${group.state}`} />
            <span>
              <strong>
                {group.label}
                {group.count > 1 ? (
                  <span className="event-count">
                    <span aria-hidden="true">×{group.count}</span>
                    <span className="sr-only">, {group.count} times</span>
                  </span>
                ) : null}
              </strong>
              <small>{describeState(group.state)}</small>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
