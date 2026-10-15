import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWindowStateStore,
  defaultWindowBounds,
  restoreWindowBounds,
  windowStateFilename,
} from "./window-state.js";

const laptop = { x: 0, y: 0, width: 1536, height: 816 };
const second = { x: 1536, y: 0, width: 2560, height: 1400 };

describe("default window bounds", () => {
  it("fills about 90% of the work area, centred", () => {
    expect(defaultWindowBounds({ x: 0, y: 0, width: 2560, height: 1400 })).toEqual({
      x: 128,
      y: 70,
      width: 2304,
      height: 1260,
    });
  });

  it("is never below 1280x800 when the work area allows it", () => {
    const bounds = defaultWindowBounds(laptop);
    expect(bounds.width).toBe(1382);
    expect(bounds.height).toBe(800);
    expect(bounds.y).toBe(8);
  });

  it("uses the whole work area when it is smaller than 1280x800", () => {
    expect(defaultWindowBounds({ x: 10, y: 20, width: 1100, height: 700 })).toEqual({
      x: 10,
      y: 20,
      width: 1100,
      height: 700,
    });
  });

  it("is placed within a work area that does not start at the origin", () => {
    const bounds = defaultWindowBounds({ x: -1920, y: 40, width: 1920, height: 1040 });
    expect(bounds).toEqual({ x: -1920 + 96, y: 40 + 52, width: 1728, height: 936 });
  });
});

describe("restoring window bounds", () => {
  it("restores bounds that are on a connected display", () => {
    const saved = { x: 100, y: 50, width: 1300, height: 760, maximized: false };
    expect(restoreWindowBounds(saved, [laptop])).toEqual(saved);
    expect(restoreWindowBounds({ ...saved, maximized: true }, [laptop])?.maximized).toBe(true);
  });

  it("falls back when the window is on a display that is gone", () => {
    const saved = { x: 2000, y: 100, width: 1400, height: 800, maximized: false };
    expect(restoreWindowBounds(saved, [laptop])).toBeUndefined();
    expect(restoreWindowBounds(saved, [laptop, second])).toEqual(saved);
  });

  it("falls back when only a sliver of the window is still visible", () => {
    const saved = { x: 1500, y: 0, width: 1400, height: 800, maximized: false };
    expect(restoreWindowBounds(saved, [laptop])).toBeUndefined();
  });

  it("clamps a window larger than the work area, and one hanging off its edge", () => {
    expect(
      restoreWindowBounds({ x: -300, y: -40, width: 3000, height: 2000, maximized: false }, [
        laptop,
      ]),
    ).toEqual({ x: 0, y: 0, width: 1536, height: 816, maximized: false });
    expect(
      restoreWindowBounds({ x: 800, y: 300, width: 1300, height: 720, maximized: false }, [laptop]),
    ).toEqual({ x: 236, y: 96, width: 1300, height: 720, maximized: false });
  });

  it("raises a window smaller than the minimum size", () => {
    expect(
      restoreWindowBounds({ x: 0, y: 0, width: 300, height: 200, maximized: false }, [laptop]),
    ).toMatchObject({ width: 1024, height: 720 });
  });

  it("restores onto the display it overlaps most", () => {
    const saved = { x: 1400, y: 100, width: 1800, height: 900, maximized: false };
    expect(restoreWindowBounds(saved, [laptop, second])).toMatchObject({ x: 1536, width: 1800 });
  });

  it.each([
    undefined,
    null,
    "bounds",
    {},
    { x: 0, y: 0, width: 0, height: 800 },
    { x: 0, y: 0, width: "1300", height: 800 },
    { x: 0.5, y: 0, width: 1300, height: 800 },
    { x: Number.NaN, y: 0, width: 1300, height: 800 },
  ])("ignores malformed bounds %j", (saved) => {
    expect(restoreWindowBounds(saved, [laptop])).toBeUndefined();
  });
});

describe("window state file", () => {
  let directory: string | undefined;
  afterEach(() => {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("round-trips bounds through the user-data folder", () => {
    directory = mkdtempSync(join(tmpdir(), "draftloop-window-"));
    const store = createWindowStateStore(directory);
    expect(store.read()).toBeUndefined();
    const bounds = { x: 10, y: 8, width: 1300, height: 800, maximized: true };
    store.write(bounds);
    expect(JSON.parse(readFileSync(join(directory, windowStateFilename), "utf8"))).toEqual(bounds);
    expect(restoreWindowBounds(store.read(), [laptop])).toEqual(bounds);
  });

  it("treats a corrupt file as nothing remembered", () => {
    directory = mkdtempSync(join(tmpdir(), "draftloop-window-"));
    writeFileSync(join(directory, windowStateFilename), "{not json", "utf8");
    expect(restoreWindowBounds(createWindowStateStore(directory).read(), [laptop])).toBeUndefined();
  });

  it("does not throw when the folder cannot be written", () => {
    directory = mkdtempSync(join(tmpdir(), "draftloop-window-"));
    writeFileSync(join(directory, "blocked"), "file", "utf8");
    const store = createWindowStateStore(join(directory, "blocked"));
    expect(() =>
      store.write({ x: 0, y: 0, width: 1300, height: 800, maximized: false }),
    ).not.toThrow();
  });
});
