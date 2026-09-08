/**
 * Compare-view column split.
 *
 * Comparing two versions is not one reading task. A reviewer reading mostly the new draft wants a
 * wide right side; one auditing what was removed wants a wide left. A fixed 50/50 grid serves
 * neither well, so the divider between the columns is a control the reader can move.
 *
 * The split is stored app-wide in `localStorage` rather than per workspace: it is a preference
 * about the reader's monitor, not a property of the document. The stored number is the fraction of
 * the *first* column — the previous version — and it is clamped so neither pane can be dragged
 * away to nothing.
 *
 * The handle is operable from the keyboard, which is not decoration here: the rest of this desk
 * carries `aria-keyshortcuts` and complete keyboard paths, and a mouse-only splitter would be its
 * one inaccessible control. Arrow keys nudge, Home/End jump to the clamps, and Enter, Space or a
 * double-click restores the even split.
 *
 * Like the theme preference, this never reaches the main process: it changes nothing the main
 * process owns, and the desktop bridge's runtime command allowlist is not worth the drift for a
 * column width.
 */
import {
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useState,
} from "react";

/** `localStorage` key holding the fraction of the width given to the previous version. */
export const compareSplitStorageKey = "draft-loop.compare-split";

/** An even read of both versions, and the reset target. */
export const defaultCompareSplit = 0.5;

/** Neither pane may be dragged to nothing, so the fraction stays inside these bounds. */
export const minimumCompareSplit = 0.25;
export const maximumCompareSplit = 0.75;

/** One arrow-key nudge: fine enough to aim, coarse enough to cross the range in a few presses. */
export const compareSplitStep = 0.02;

/**
 * Force a fraction into the supported range. Non-finite input — `NaN` from a failed parse,
 * `Infinity` from arithmetic on one — is not a small mistake to be clamped but an absence of an
 * answer, so it falls back to the even split.
 */
export function clampCompareSplit(value: number): number {
  if (!Number.isFinite(value)) return defaultCompareSplit;
  if (value < minimumCompareSplit) return minimumCompareSplit;
  if (value > maximumCompareSplit) return maximumCompareSplit;
  // Every split passes through here, so this is also where the arithmetic is tidied. Ten
  // nudges of 0.02 land on 0.7000000000000002 and a drag lands on whatever the pointer
  // divided into, and that is what would be written to storage and read back next session.
  // Four places is finer than a pixel on any monitor this runs on.
  return Math.round(value * 10_000) / 10_000;
}

/** Read a stored fraction back out of its string form, defaulting for anything unusable. */
export function parseCompareSplit(raw: string | null): number {
  if (raw === null) return defaultCompareSplit;
  return clampCompareSplit(Number.parseFloat(raw));
}

/**
 * Read the stored split. A browser with site data blocked throws from `getItem` rather than
 * returning null, and a column width is never worth failing the boot for.
 */
export function readStoredCompareSplit(storage?: Pick<Storage, "getItem">): number {
  if (storage === undefined) return defaultCompareSplit;
  try {
    return parseCompareSplit(storage.getItem(compareSplitStorageKey));
  } catch {
    return defaultCompareSplit;
  }
}

/** Persist the split, ignoring quota and security failures for the same reason. */
export function writeStoredCompareSplit(
  storage: Pick<Storage, "setItem"> | undefined,
  split: number,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(compareSplitStorageKey, String(split));
  } catch {
    // A blocked or full store costs the user persistence, not the session.
  }
}

/**
 * Where a pointer sits across the grid, as a clamped fraction. Pure, so the drag arithmetic is
 * testable without a DOM. A zero-width grid has not been laid out yet and yields no position.
 */
export function compareSplitFromPointer(
  pointerX: number,
  bounds: { readonly left: number; readonly width: number },
): number {
  if (bounds.width <= 0) return defaultCompareSplit;
  return clampCompareSplit((pointerX - bounds.left) / bounds.width);
}

/**
 * The keyboard rule, kept pure and separate so the handler only has to apply it. `null` means the
 * key is not ours: the caller must leave the event alone rather than swallowing it.
 */
export function nextCompareSplitForKey(key: string, current: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampCompareSplit(current - compareSplitStep);
    case "ArrowRight":
      return clampCompareSplit(current + compareSplitStep);
    case "Home":
      return minimumCompareSplit;
    case "End":
      return maximumCompareSplit;
    case "Enter":
    case " ":
      return defaultCompareSplit;
    default:
      return null;
  }
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Hold the split and persist every change, so the next session opens on the same desk. */
export function useCompareSplit(): readonly [number, (next: number) => void] {
  const [split, setSplit] = useState<number>(() => readStoredCompareSplit(browserStorage()));

  const choose = useCallback((next: number) => {
    const clamped = clampCompareSplit(next);
    setSplit(clamped);
    writeStoredCompareSplit(browserStorage(), clamped);
  }, []);

  return [split, choose] as const;
}

/**
 * The divider itself: a `separator` with a value, which is what assistive technology needs to
 * report a resizable split. It reads the live grid box on every move rather than caching one,
 * because the window can be resized mid-drag.
 */
export function CompareSplitHandle({
  split,
  onSplitChange,
  gridRef,
}: {
  readonly split: number;
  readonly onSplitChange: (next: number) => void;
  readonly gridRef: RefObject<HTMLDivElement | null>;
}): JSX.Element {
  const percent = Math.round(split * 100);

  const trackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (grid === null) return;
    const box = grid.getBoundingClientRect();
    onSplitChange(compareSplitFromPointer(event.clientX, box));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: `hr` is a thematic break in the content, not a window splitter; this is the ARIA split-pane pattern, a focusable separator carrying a value.
    <div
      className="compare-split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the compare columns"
      aria-valuenow={percent}
      aria-valuemin={Math.round(minimumCompareSplit * 100)}
      aria-valuemax={Math.round(maximumCompareSplit * 100)}
      aria-valuetext={`Previous version ${percent}% of the width`}
      tabIndex={0}
      onKeyDown={(event) => {
        const next = nextCompareSplitForKey(event.key, split);
        if (next === null) return;
        event.preventDefault();
        onSplitChange(next);
      }}
      onPointerDown={(event) => {
        if (gridRef.current === null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        trackPointer(event);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        trackPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onDoubleClick={() => onSplitChange(defaultCompareSplit)}
    />
  );
}
