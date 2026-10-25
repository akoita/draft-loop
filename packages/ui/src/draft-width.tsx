/**
 * Single-draft sheet width.
 *
 * When the review shows one document, the sheet is set at a fixed reading measure with the
 * critique in its right margin. On a wide window that leaves much of the main column empty, so the
 * sheet's right edge is a control the reader can move, the same way the side panel's edge and the
 * compare split are. Compare view keeps its own split and ignores this width.
 *
 * The width is stored app-wide in `localStorage`: it is a preference about the reader's screen,
 * not a property of a workspace. Nothing is stored until the reader moves the edge, so an
 * untouched desk keeps the stylesheet's own measure. A stored width is a wish, not a promise: it
 * is clamped on every render against the room the sheet actually has, which always leaves the
 * margin-note gutter beside the paper.
 *
 * The handle is keyboard-operable: arrow keys nudge (Shift for a larger step), Home/End jump to the
 * bounds, and a double-click restores the default.
 */
import {
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** `localStorage` key holding the sheet width in CSS pixels. */
export const draftWidthStorageKey = "draft-loop.review.draftWidth";

/** The stylesheet's measure for the sheet when the reader has not chosen one. */
export const defaultDraftWidth = 608;

/** Narrower than this and the sheet stops reading as a page of prose. */
export const minimumDraftWidth = 480;

/** Past this a line is too long to read, whatever the monitor. */
export const maximumDraftWidth = 1200;

/** Room always kept beside the sheet for the margin notes and the gap that carries their elbows. */
export const minimumDraftGutter = 240;

/** One arrow-key nudge, and the Shift-held nudge. */
export const draftWidthStep = 16;
export const draftWidthLargeStep = 64;

/**
 * The widest the sheet may be when its stage is `availableWidth` wide: everything but the gutter,
 * capped at the absolute maximum and never below the minimum. An unmeasured stage (server
 * rendering, or before the first layout) gets the absolute maximum.
 */
export function maximumDraftWidthFor(availableWidth: number | null, gutter = 0): number {
  if (availableWidth === null || !Number.isFinite(availableWidth)) return maximumDraftWidth;
  const room = Math.floor(availableWidth - Math.max(minimumDraftGutter, gutter));
  return Math.max(minimumDraftWidth, Math.min(maximumDraftWidth, room));
}

/**
 * Force a width into `[minimum, maximum]`, in whole pixels. A non-finite width is an absence of an
 * answer rather than an extreme one, so it falls back to the default.
 */
export function clampDraftWidth(width: number, maximum: number = maximumDraftWidth): number {
  const upper = Math.max(minimumDraftWidth, maximum);
  if (!Number.isFinite(width)) return Math.min(defaultDraftWidth, upper);
  if (width < minimumDraftWidth) return minimumDraftWidth;
  if (width > upper) return upper;
  return Math.round(width);
}

/**
 * Read a stored width back out of its string form. Anything that is not a plain finite number of
 * pixels means "no choice". The stored value is kept inside the absolute bounds here; the
 * room-relative bound is applied at render time.
 */
export function parseDraftWidth(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clampDraftWidth(value);
}

/** Read the stored width; a blocked store is never worth failing the review for. */
export function readStoredDraftWidth(storage?: Pick<Storage, "getItem">): number | null {
  if (storage === undefined) return null;
  try {
    return parseDraftWidth(storage.getItem(draftWidthStorageKey));
  } catch {
    return null;
  }
}

/** Persist the width, or forget it when the reader resets to the default. */
export function writeStoredDraftWidth(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  width: number | null,
): void {
  if (storage === undefined) return;
  try {
    if (width === null) storage.removeItem(draftWidthStorageKey);
    else storage.setItem(draftWidthStorageKey, String(width));
  } catch {
    // A blocked or full store costs the user persistence, not the session.
  }
}

/**
 * The width a drag asks for. The sheet and its margin are centred on the desk, so widening the
 * sheet moves its right edge by only half the change; doubling the pointer's travel keeps the edge
 * under the pointer. Pure, so the drag arithmetic is testable.
 */
export function draftWidthFromDrag(
  startWidth: number,
  startX: number,
  pointerX: number,
  maximum: number,
): number {
  return clampDraftWidth(startWidth + 2 * (pointerX - startX), maximum);
}

/**
 * The keyboard rule. The handle sits on the sheet's right edge, so ArrowRight moves it right and
 * widens the sheet. `null` means the key is not ours and the event must be left alone.
 */
export function nextDraftWidthForKey(
  key: string,
  shiftKey: boolean,
  current: number,
  maximum: number,
): number | null {
  const step = shiftKey ? draftWidthLargeStep : draftWidthStep;
  switch (key) {
    case "ArrowRight":
      return clampDraftWidth(current + step, maximum);
    case "ArrowLeft":
      return clampDraftWidth(current - step, maximum);
    case "Home":
      return minimumDraftWidth;
    case "End":
      return clampDraftWidth(maximum, maximum);
    default:
      return null;
  }
}

/**
 * The inline custom property for the document grid. Only the single-document view carries it;
 * Compare keeps its own split, so a chosen sheet width never leaks into it.
 */
export function draftWidthStyle(
  width: number | null,
  compareVisible: boolean,
): Record<string, string> {
  return width === null || compareVisible ? {} : { "--draft-width": `${width}px` };
}

function browserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export interface DraftWidth {
  /** The width to apply, clamped to the room the sheet has, or `null` for the stylesheet default. */
  readonly width: number | null;
  /** The width the handle reports, which is the default (within the room) when none is chosen. */
  readonly reportedWidth: number;
  /** The widest the sheet may be right now, leaving the margin-note gutter. */
  readonly maximum: number;
  readonly choose: (next: number) => void;
  readonly reset: () => void;
  /** Called by the handle whenever it measures the sheet's stage. */
  readonly measure: (maximum: number) => void;
}

/** Hold the chosen width, persist every change, and re-clamp it to the measured room. */
export function useDraftWidth(): DraftWidth {
  const [stored, setStored] = useState<number | null>(() => readStoredDraftWidth(browserStorage()));
  const [maximum, setMaximum] = useState<number>(maximumDraftWidth);
  const maximumRef = useRef(maximum);

  const measure = useCallback((next: number) => {
    maximumRef.current = next;
    setMaximum((current) => (current === next ? current : next));
  }, []);

  const choose = useCallback((next: number) => {
    const clamped = clampDraftWidth(next, maximumRef.current);
    setStored(clamped);
    writeStoredDraftWidth(browserStorage(), clamped);
  }, []);

  const reset = useCallback(() => {
    setStored(null);
    writeStoredDraftWidth(browserStorage(), null);
  }, []);

  const width = stored === null ? null : clampDraftWidth(stored, maximum);
  const reportedWidth = width ?? clampDraftWidth(defaultDraftWidth, maximum);
  return { width, reportedWidth, maximum, choose, reset, measure };
}

/**
 * The stage's room for the sheet: its own width less the margin-note gutter (the margin column and
 * the gap before it), never less than the minimum gutter. `null` while the handle is hidden, which
 * is the narrow layout where the margin is gone and the width does not apply.
 */
function measureMaximum(handle: HTMLElement): number | null {
  const stage = handle.parentElement;
  if (stage === null || handle.offsetParent === null) return null;
  const gap = Number.parseFloat(getComputedStyle(stage).columnGap) || 0;
  const margin = handle.nextElementSibling;
  const marginWidth = margin instanceof HTMLElement ? margin.offsetWidth : 0;
  return maximumDraftWidthFor(stage.clientWidth, gap + marginWidth);
}

function releasePointer(event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

/**
 * The divider on the sheet's right edge: a focusable `separator` carrying the width in pixels. It
 * measures its stage whenever the stage resizes, so the bound follows the window and the side
 * panel.
 */
export function DraftWidthHandle({
  width,
  maximum,
  onWidthChange,
  onReset,
  onMeasure,
}: {
  readonly width: number;
  readonly maximum: number;
  readonly onWidthChange: (next: number) => void;
  readonly onReset: () => void;
  readonly onMeasure: (maximum: number) => void;
}): JSX.Element {
  const handleRef = useRef<HTMLDivElement | null>(null);
  // Where the drag started, so the edge follows the pointer's travel rather than jumping to it.
  const dragStart = useRef<{ readonly x: number; readonly width: number } | null>(null);

  useEffect(() => {
    const handle = handleRef.current;
    const stage = handle?.parentElement;
    if (handle === null || handle === undefined || stage === null || stage === undefined) {
      return undefined;
    }
    const update = () => {
      const next = measureMaximum(handle);
      if (next !== null) onMeasure(next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [onMeasure]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: `hr` is a thematic break in the content, not a window splitter; this is the ARIA split-pane pattern, a focusable separator carrying a value.
    <div
      className="draft-width-handle"
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize draft"
      aria-valuenow={width}
      aria-valuemin={minimumDraftWidth}
      aria-valuemax={maximum}
      aria-valuetext={`Draft ${width} pixels wide`}
      tabIndex={0}
      onKeyDown={(event) => {
        const next = nextDraftWidthForKey(event.key, event.shiftKey, width, maximum);
        if (next === null) return;
        event.preventDefault();
        onWidthChange(next);
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const current = measureMaximum(event.currentTarget);
        if (current !== null) onMeasure(current);
        const sheet = event.currentTarget.previousElementSibling;
        dragStart.current = {
          x: event.clientX,
          width: sheet instanceof HTMLElement ? sheet.getBoundingClientRect().width : width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = dragStart.current;
        if (start === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onWidthChange(draftWidthFromDrag(start.width, start.x, event.clientX, maximum));
      }}
      onPointerUp={(event) => {
        dragStart.current = null;
        releasePointer(event);
      }}
      onPointerCancel={(event) => {
        dragStart.current = null;
        releasePointer(event);
      }}
      onDoubleClick={onReset}
    />
  );
}
