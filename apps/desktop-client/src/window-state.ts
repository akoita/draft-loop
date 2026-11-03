import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A rectangle in screen coordinates, such as a window's bounds or a display's work area. */
export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What is remembered of the window between launches. */
export interface SavedWindowBounds extends WindowRect {
  readonly maximized: boolean;
}

/** The smallest window the app lets a person make; the Electron constructor enforces it too. */
export const minimumWindowWidth = 1024;
export const minimumWindowHeight = 720;

/** A first launch opens at this size, a balanced window that shows Home's components in full. */
export const defaultWindowWidth = 1440;
export const defaultWindowHeight = 960;
/** The default is clamped to this share of the display's work area, so it never fills the screen. */
const defaultWorkAreaShare = 0.95;
/** A remembered window is restored only if this much of it is on a connected display. */
const minimumVisibleWidth = 160;
const minimumVisibleHeight = 100;

export const windowStateFilename = "window-state.json";

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** The first-launch window: 1440×960, at most 95% of the work area, centred and not maximized. */
export function defaultWindowBounds(workArea: WindowRect): WindowRect {
  const width = Math.min(defaultWindowWidth, Math.round(workArea.width * defaultWorkAreaShare));
  const height = Math.min(defaultWindowHeight, Math.round(workArea.height * defaultWorkAreaShare));
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

function overlap(a: WindowRect, b: WindowRect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

function overlapArea(a: WindowRect, b: WindowRect): number {
  const { width, height } = overlap(a, b);
  return width > 0 && height > 0 ? width * height : 0;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** Reads remembered bounds from untrusted JSON; anything malformed is not remembered. */
export function parseSavedWindowBounds(value: unknown): SavedWindowBounds | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const x = integer(record.x);
  const y = integer(record.y);
  const width = integer(record.width);
  const height = integer(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height, maximized: record.maximized === true };
}

/**
 * The remembered window, kept only while it is still visible: it must overlap a connected
 * display's work area by a usable amount. It is then clamped to the minimum size and to that work
 * area, so a display that shrank or moved never leaves the window unreachable. Otherwise the
 * caller falls back to the default.
 */
export function restoreWindowBounds(
  saved: unknown,
  workAreas: readonly WindowRect[],
): SavedWindowBounds | undefined {
  const bounds = parseSavedWindowBounds(saved);
  if (bounds === undefined) return undefined;
  let best: WindowRect | undefined;
  let bestArea = 0;
  for (const workArea of workAreas) {
    const { width, height } = overlap(bounds, workArea);
    if (width < minimumVisibleWidth || height < minimumVisibleHeight) continue;
    const area = overlapArea(bounds, workArea);
    if (area > bestArea) {
      best = workArea;
      bestArea = area;
    }
  }
  if (best === undefined) return undefined;
  const width = clamp(bounds.width, Math.min(minimumWindowWidth, best.width), best.width);
  const height = clamp(bounds.height, Math.min(minimumWindowHeight, best.height), best.height);
  return {
    x: clamp(bounds.x, best.x, best.x + best.width - width),
    y: clamp(bounds.y, best.y, best.y + best.height - height),
    width,
    height,
    maximized: bounds.maximized,
  };
}

export interface WindowStateStore {
  read(): unknown;
  write(bounds: SavedWindowBounds): void;
}

/** A small JSON file in the app's user-data folder. Failures to read or write are not fatal. */
export function createWindowStateStore(userDataDirectory: string): WindowStateStore {
  const file = join(userDataDirectory, windowStateFilename);
  return {
    read() {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as unknown;
      } catch {
        return undefined;
      }
    },
    write(bounds) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(bounds)}\n`, "utf8");
        renameSync(temporary, file);
      } catch {
        // The window still works; it just opens at the default size next time.
      }
    },
  };
}
