/**
 * Review side panel width.
 *
 * The side panel carries run history, the runs list, findings, coverage and the gate. How much of
 * the window it deserves depends on the reader's monitor and on what they are doing, so the edge
 * between the main column and the panel is a control the reader can move, like the compare split.
 *
 * The chosen width is stored app-wide in `localStorage`, the same way the compare split and the
 * folded panels are: it is a preference about the reader's screen, not a property of a workspace.
 * Nothing is stored until the reader moves the edge, so an untouched desk keeps the stylesheet's
 * own responsive default (`--panel-width`). A stored width is a wish, not a promise: it is clamped
 * against the current window on every render, so shrinking the window narrows the panel without
 * forgetting what the reader chose.
 *
 * The handle is keyboard-operable for the same reason the compare split is: arrow keys nudge
 * (Shift for a larger step), Home/End jump to the bounds, and a double-click restores the default.
 */
import {
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** `localStorage` key holding the side panel width in CSS pixels. */
export const sidePanelWidthStorageKey = "draft-loop.review.sidePanelWidth";

/** The stylesheet's `--panel-width`: 430px, and 400px at or below the 1280px breakpoint. */
export const defaultSidePanelWidth = 430;
export const compactSidePanelWidth = 400;
export const compactSidePanelBreakpoint = 1280;

/** Narrower than this and the finding cards and the gate stop being readable. */
export const minimumSidePanelWidth = 320;

/** Wider than this and the panel is no longer a side panel; it is also never more than half the window. */
export const maximumSidePanelWidth = 720;

/** One arrow-key nudge, and the Shift-held nudge. */
export const sidePanelWidthStep = 16;
export const sidePanelWidthLargeStep = 64;

/** The width the stylesheet gives the panel when the reader has not chosen one. */
export function defaultSidePanelWidthFor(viewportWidth: number): number {
  return viewportWidth <= compactSidePanelBreakpoint
    ? compactSidePanelWidth
    : defaultSidePanelWidth;
}

/**
 * The widest the panel may be in this window: half of it, capped at the absolute maximum, and
 * never below the minimum. An unknown window (server rendering) gets the absolute maximum.
 */
export function maximumSidePanelWidthFor(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return maximumSidePanelWidth;
  return Math.max(
    minimumSidePanelWidth,
    Math.min(maximumSidePanelWidth, Math.floor(viewportWidth / 2)),
  );
}

/**
 * Force a width into the range this window supports, in whole pixels. A non-finite width is an
 * absence of an answer rather than an extreme one, so it falls back to the default.
 */
export function clampSidePanelWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return defaultSidePanelWidthFor(viewportWidth);
  const maximum = maximumSidePanelWidthFor(viewportWidth);
  if (width < minimumSidePanelWidth) return minimumSidePanelWidth;
  if (width > maximum) return maximum;
  return Math.round(width);
}

/**
 * Read a stored width back out of its string form. Anything that is not a plain finite number of
 * pixels means "no choice", so the default applies. The stored value is kept inside the absolute
 * bounds here; the window-relative bound is applied at render time.
 */
export function parseSidePanelWidth(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clampSidePanelWidth(value, Number.POSITIVE_INFINITY);
}

/** Read the stored width; a blocked store is never worth failing the review for. */
export function readStoredSidePanelWidth(storage?: Pick<Storage, "getItem">): number | null {
  if (storage === undefined) return null;
  try {
    return parseSidePanelWidth(storage.getItem(sidePanelWidthStorageKey));
  } catch {
    return null;
  }
}

/** Persist the width, or forget it when the reader resets to the default. */
export function writeStoredSidePanelWidth(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  width: number | null,
): void {
  if (storage === undefined) return;
  try {
    if (width === null) storage.removeItem(sidePanelWidthStorageKey);
    else storage.setItem(sidePanelWidthStorageKey, String(width));
  } catch {
    // A blocked or full store costs the user persistence, not the session.
  }
}

/**
 * The width a pointer asks for. The panel is the right-hand track, so its width is the distance
 * from the pointer to the layout's right edge. Pure, so the drag arithmetic is testable.
 */
export function sidePanelWidthFromPointer(
  pointerX: number,
  layoutRight: number,
  viewportWidth: number,
): number {
  return clampSidePanelWidth(layoutRight - pointerX, viewportWidth);
}

/**
 * The keyboard rule. The handle sits on the panel's left edge, so ArrowLeft moves it left and
 * widens the panel. `null` means the key is not ours and the event must be left alone.
 */
export function nextSidePanelWidthForKey(
  key: string,
  shiftKey: boolean,
  current: number,
  viewportWidth: number,
): number | null {
  const step = shiftKey ? sidePanelWidthLargeStep : sidePanelWidthStep;
  switch (key) {
    case "ArrowLeft":
      return clampSidePanelWidth(current + step, viewportWidth);
    case "ArrowRight":
      return clampSidePanelWidth(current - step, viewportWidth);
    case "Home":
      return minimumSidePanelWidth;
    case "End":
      return maximumSidePanelWidthFor(viewportWidth);
    default:
      return null;
  }
}

function browserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function currentViewportWidth(): number {
  return typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth;
}

export interface SidePanelWidth {
  /** The width to apply, clamped to the current window, or `null` for the stylesheet default. */
  readonly width: number | null;
  /** The width the handle reports, which is the default for this window when none is chosen. */
  readonly reportedWidth: number;
  readonly viewportWidth: number;
  readonly choose: (next: number) => void;
  readonly reset: () => void;
}

/** Hold the chosen width, persist every change, and re-clamp it when the window resizes. */
export function useSidePanelWidth(): SidePanelWidth {
  const [stored, setStored] = useState<number | null>(() =>
    readStoredSidePanelWidth(browserStorage()),
  );
  const [viewportWidth, setViewportWidth] = useState<number>(currentViewportWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(currentViewportWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const choose = useCallback((next: number) => {
    const clamped = clampSidePanelWidth(next, currentViewportWidth());
    setStored(clamped);
    writeStoredSidePanelWidth(browserStorage(), clamped);
  }, []);

  const reset = useCallback(() => {
    setStored(null);
    writeStoredSidePanelWidth(browserStorage(), null);
  }, []);

  const width = stored === null ? null : clampSidePanelWidth(stored, viewportWidth);
  const reportedWidth = width ?? defaultSidePanelWidthFor(viewportWidth);
  return { width, reportedWidth, viewportWidth, choose, reset };
}

function releasePointer(event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

/**
 * The divider on the panel's left edge: a focusable `separator` carrying the width in pixels. It
 * reads its layout's live box on every move, because the window can be resized mid-drag.
 */
export function SidePanelHandle({
  width,
  viewportWidth,
  onWidthChange,
  onReset,
}: {
  readonly width: number;
  readonly viewportWidth: number;
  readonly onWidthChange: (next: number) => void;
  readonly onReset: () => void;
}): JSX.Element {
  // Where inside the handle the pointer took hold, so grabbing it does not make the edge jump.
  const grabOffset = useRef(0);

  const trackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const layout = event.currentTarget.parentElement;
    if (layout === null) return;
    onWidthChange(
      sidePanelWidthFromPointer(
        event.clientX - grabOffset.current,
        layout.getBoundingClientRect().right,
        currentViewportWidth(),
      ),
    );
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: `hr` is a thematic break in the content, not a window splitter; this is the ARIA split-pane pattern, a focusable separator carrying a value.
    <div
      className="side-panel-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      aria-valuenow={width}
      aria-valuemin={minimumSidePanelWidth}
      aria-valuemax={maximumSidePanelWidthFor(viewportWidth)}
      aria-valuetext={`Side panel ${width} pixels wide`}
      tabIndex={0}
      onKeyDown={(event) => {
        const next = nextSidePanelWidthForKey(event.key, event.shiftKey, width, viewportWidth);
        if (next === null) return;
        event.preventDefault();
        onWidthChange(next);
      }}
      onPointerDown={(event) => {
        if (event.currentTarget.parentElement === null) return;
        event.preventDefault();
        grabOffset.current = event.clientX - event.currentTarget.getBoundingClientRect().left;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        trackPointer(event);
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onDoubleClick={onReset}
    />
  );
}
