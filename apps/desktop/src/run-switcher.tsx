/**
 * The run switcher in the review header: "Run 2 of 5 ▾" opens a menu of the application's runs.
 *
 * Choosing the latest run returns to the live run, and choosing any other run opens it read-only
 * through the same callback the earlier-run notice uses to lead back. "Compare with…" turns the
 * menu into a list of the other runs, and choosing one compares it with the shown run. The menu
 * follows the ARIA
 * menu-button pattern: arrow keys, Home and End move focus, Enter or Space chooses, and Escape or
 * a click outside closes it and returns focus to the button.
 */

import type { ApplicationRunRowView } from "@draft-loop/ui/application-run-list";
import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/** The start time as a fixed UTC minute, so every reader sees the same order. */
export function runStartedLabel(startedAt: string): string {
  const time = Date.parse(startedAt);
  if (Number.isNaN(time)) return startedAt;
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "author → critic", or a plain statement when the run recorded no models. */
export function runModelsLabel(run: ApplicationRunRowView): string {
  return run.authorModel === "" && run.criticModel === ""
    ? "models not recorded"
    : `${run.authorModel || "unknown"} → ${run.criticModel || "unknown"}`;
}

/** Where the shown run sits among the runs, which arrive newest first and are numbered oldest = 1. */
export interface RunSwitcherPosition {
  /** Index of the shown run in the newest-first list. */
  readonly index: number;
  readonly number: number;
  readonly total: number;
}

/**
 * The shown run: `viewedRunId` when it is listed, otherwise the latest run. Null with fewer than
 * two runs, where there is nothing to switch to and the header shows no control.
 */
export function runSwitcherPosition(
  runs: readonly ApplicationRunRowView[] | null | undefined,
  viewedRunId: string | undefined,
): RunSwitcherPosition | null {
  if (runs === undefined || runs === null || runs.length < 2) return null;
  const viewed = runs.findIndex((run) => run.runId === viewedRunId);
  const latest = runs.findIndex((run) => run.latest);
  const index = viewed >= 0 ? viewed : Math.max(latest, 0);
  return { index, number: runs.length - index, total: runs.length };
}

/** The run's number, oldest = 1, from its index in the newest-first list. */
export function runNumber(index: number, total: number): number {
  return total - index;
}

/** One run the shown run can be compared with, as the "Compare with…" menu lists it. */
export interface ComparisonCandidate {
  readonly run: ApplicationRunRowView;
  readonly number: number;
}

/** Every listed run except the one shown, newest first, with its number (oldest = 1). */
export function comparisonCandidates(
  runs: readonly ApplicationRunRowView[] | null | undefined,
  shownRunId: string | undefined,
): readonly ComparisonCandidate[] {
  if (runs === null || runs === undefined || runs.length < 2) return [];
  return runs.flatMap((run, index) =>
    run.runId === shownRunId ? [] : [{ run, number: runNumber(index, runs.length) }],
  );
}

/**
 * What choosing a run does: nothing for the run already shown, `null` (back to the live run) for
 * the latest run, and the run id for an earlier run, which opens read-only.
 */
export function runSwitcherChoice(
  run: ApplicationRunRowView,
  shownRunId: string | undefined,
): { readonly openRunId: string | null } | null {
  if (run.runId === shownRunId) return null;
  return { openRunId: run.latest ? null : run.runId };
}

/**
 * The item a key moves focus to inside the open menu, or `undefined` when the key does not move
 * focus. Arrow keys wrap; Home and End go to the ends.
 */
export function runSwitcherKeyTarget(
  key: string,
  index: number,
  count: number,
): number | undefined {
  if (count === 0) return undefined;
  const last = count - 1;
  switch (key) {
    case "ArrowDown":
      return index >= last ? 0 : index + 1;
    case "ArrowUp":
      return index <= 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return undefined;
  }
}

/**
 * The item a key on the closed button opens the menu at, or `undefined` when the key does not
 * open it: Enter, Space and Arrow Down start at the run shown, Arrow Up at the oldest run.
 */
export function runSwitcherOpenTarget(
  key: string,
  shownIndex: number,
  count: number,
): number | undefined {
  if (key === "Enter" || key === " " || key === "ArrowDown") return shownIndex;
  if (key === "ArrowUp") return count - 1;
  return undefined;
}

/** The facts of one run, as its menu item reads them. */
function RunFacts({
  run,
  number,
}: {
  readonly run: ApplicationRunRowView;
  readonly number: number;
}): JSX.Element {
  return (
    <>
      <span className="run-switcher-item-head">
        <strong>Run {number}</strong>
        <time dateTime={run.startedAt}>{runStartedLabel(run.startedAt)}</time>
        {run.latest ? <span className="run-switcher-latest">latest</span> : null}
        {run.chosen === true ? <span className="run-switcher-chosen">chosen</span> : null}
      </span>
      <span className="run-switcher-item-facts">
        <span className="run-switcher-models">{runModelsLabel(run)}</span>
        <span>round {run.round}</span>
        <span className="run-switcher-state">{run.state.replaceAll("-", " ")}</span>
        {run.score === undefined ? null : (
          <span className="numeric" title="Mean of the latest evaluation's readiness dimensions">
            mean score {run.score.toFixed(2)}
          </span>
        )}
      </span>
    </>
  );
}

/**
 * The header control over the application's runs, newest first. Nothing renders with fewer than
 * two runs. `viewedRunId` is the run the review shows; without `onOpenRun` the menu only lists
 * the runs and its items are disabled. Without `onCompareRun` the menu offers no comparison.
 */
export function RunSwitcher({
  runs,
  viewedRunId,
  onOpenRun,
  onCompareRun,
  initiallyOpen = false,
  initialMenu = "runs",
}: {
  readonly runs: readonly ApplicationRunRowView[] | null | undefined;
  readonly viewedRunId?: string | undefined;
  readonly onOpenRun?: ((runId: string | null) => void) | undefined;
  /** Compares the chosen run with the shown run. */
  readonly onCompareRun?: ((runId: string) => void) | undefined;
  /** Render with the menu open; for static rendering in tests. */
  readonly initiallyOpen?: boolean;
  /** Which list the open menu starts on; for static rendering in tests. */
  readonly initialMenu?: "runs" | "compare";
}): JSX.Element | null {
  const position = runSwitcherPosition(runs, viewedRunId);
  const [open, setOpen] = useState(initiallyOpen);
  const [menu, setMenu] = useState<"runs" | "compare">(initialMenu);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef(new Map<number, HTMLElement>());
  const id = useId();
  const buttonId = `${id}-button`;
  const menuId = `${id}-menu`;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setMenu("runs");
    setFocusIndex(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Moves focus to the item it names once the menu is shown.
  useEffect(() => {
    if (!open || focusIndex === null) return;
    itemRefs.current.get(focusIndex)?.focus();
  }, [open, focusIndex]);

  // A click outside closes the menu and returns focus to the button, unless the click landed on
  // another control in the tab order, which keeps the reviewer's own choice of where to go next.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root === null || (event.target instanceof Node && root.contains(event.target))) return;
      setOpen(false);
      setMenu("runs");
      setFocusIndex(null);
      // The click moves focus after this handler, so the check waits for it.
      setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active.tabIndex < 0 || root.contains(active)) {
          buttonRef.current?.focus();
        }
      }, 0);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (position === null || runs === null || runs === undefined) return null;
  const shownRunId = runs[position.index]?.runId;
  const label = `Run ${position.number} of ${position.total}`;
  const candidates = onCompareRun === undefined ? [] : comparisonCandidates(runs, shownRunId);
  const comparing = menu === "compare" && candidates.length > 0;
  // The runs list ends with "Compare with…"; the compare list holds only the other runs.
  const itemCount = comparing ? candidates.length : runs.length + (candidates.length > 0 ? 1 : 0);
  const compareItemIndex = runs.length;

  const choose = (run: ApplicationRunRowView): void => {
    if (onOpenRun === undefined) return;
    close(true);
    const choice = runSwitcherChoice(run, shownRunId);
    if (choice !== null) onOpenRun(choice.openRunId);
  };

  const showCompareList = (): void => {
    setMenu("compare");
    setFocusIndex(0);
  };

  const compareWith = (runId: string): void => {
    if (onCompareRun === undefined) return;
    close(true);
    onCompareRun(runId);
  };

  const itemRef =
    (index: number) =>
    (element: HTMLElement | null): void => {
      if (element === null) itemRefs.current.delete(index);
      else itemRefs.current.set(index, element);
    };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
      return;
    }
    const target = runSwitcherOpenTarget(event.key, position.index, runs.length);
    if (target === undefined) return;
    event.preventDefault();
    setOpen(true);
    setFocusIndex(target);
  };

  const onItemKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    choose: () => void,
    index: number,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose();
      return;
    }
    const target = runSwitcherKeyTarget(event.key, index, itemCount);
    if (target === undefined) return;
    event.preventDefault();
    setFocusIndex(target);
  };

  return (
    <div className="run-switcher" ref={rootRef}>
      <button
        className="run-switcher-button"
        type="button"
        id={buttonId}
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => {
          if (open) {
            close(true);
          } else {
            setOpen(true);
            setFocusIndex(position.index);
          }
        }}
        onKeyDown={onButtonKeyDown}
      >
        <span className="run-switcher-label-full" aria-hidden="true">
          {label}
        </span>
        <span className="run-switcher-label-short" aria-hidden="true">
          Run {position.number}/{position.total}
        </span>
        <span className="run-switcher-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <div
        className="run-switcher-menu"
        role="menu"
        id={menuId}
        aria-labelledby={buttonId}
        hidden={!open}
        // A press inside the menu never drops focus to the page; choosing returns it to the button.
        onMouseDown={(event) => event.preventDefault()}
      >
        {comparing ? (
          <>
            <div className="run-switcher-menu-title" role="presentation">
              Compare Run {position.number} with…
            </div>
            {candidates.map((candidate, index) => (
              <div
                key={candidate.run.runId}
                className="run-switcher-item"
                role="menuitem"
                tabIndex={-1}
                ref={itemRef(index)}
                onClick={() => compareWith(candidate.run.runId)}
                onKeyDown={(event) =>
                  onItemKeyDown(event, () => compareWith(candidate.run.runId), index)
                }
              >
                <span className="run-switcher-check" aria-hidden="true" />
                <span className="run-switcher-item-body">
                  <RunFacts run={candidate.run} number={candidate.number} />
                </span>
              </div>
            ))}
          </>
        ) : null}
        {comparing
          ? null
          : runs.map((run, index) => {
              const checked = index === position.index;
              return (
                <div
                  key={run.runId}
                  className={`run-switcher-item${checked ? " run-switcher-item-checked" : ""}`}
                  role="menuitemradio"
                  aria-checked={checked}
                  aria-disabled={onOpenRun === undefined ? true : undefined}
                  tabIndex={-1}
                  ref={itemRef(index)}
                  onClick={() => choose(run)}
                  onKeyDown={(event) => onItemKeyDown(event, () => choose(run), index)}
                >
                  <span className="run-switcher-check" aria-hidden="true">
                    {checked ? "✓" : ""}
                  </span>
                  <span className="run-switcher-item-body">
                    <RunFacts run={run} number={runNumber(index, runs.length)} />
                  </span>
                </div>
              );
            })}
        {comparing || candidates.length === 0 ? null : (
          <>
            <hr className="run-switcher-separator" />
            <div
              className="run-switcher-item run-switcher-compare"
              role="menuitem"
              tabIndex={-1}
              ref={itemRef(compareItemIndex)}
              onClick={showCompareList}
              onKeyDown={(event) => onItemKeyDown(event, showCompareList, compareItemIndex)}
            >
              <span className="run-switcher-check" aria-hidden="true" />
              <span className="run-switcher-item-body">Compare with…</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
