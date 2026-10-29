import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  clampSidePanelWidth,
  compactSidePanelWidth,
  defaultSidePanelWidth,
  defaultSidePanelWidthFor,
  maximumSidePanelWidth,
  maximumSidePanelWidthFor,
  minimumSidePanelWidth,
  nextSidePanelWidthForKey,
  parseSidePanelWidth,
  readStoredSidePanelCollapsed,
  readStoredSidePanelWidth,
  SidePanelHandle,
  SidePanelToggle,
  sidePanelCollapsedStorageKey,
  sidePanelWidthFromPointer,
  sidePanelWidthLargeStep,
  sidePanelWidthStep,
  sidePanelWidthStorageKey,
  writeStoredSidePanelCollapsed,
  writeStoredSidePanelWidth,
} from "./side-panel-width.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("side panel width", () => {
  it("keeps the panel between 320px and the smaller of half the window and 720px", () => {
    expect(clampSidePanelWidth(500, 1700)).toBe(500);
    expect(clampSidePanelWidth(100, 1700)).toBe(minimumSidePanelWidth);
    expect(clampSidePanelWidth(900, 1700)).toBe(720);
    expect(clampSidePanelWidth(900, 2400)).toBe(maximumSidePanelWidth);
    expect(clampSidePanelWidth(700, 1280)).toBe(640);
    expect(clampSidePanelWidth(450.6, 1700)).toBe(451);
    expect(maximumSidePanelWidthFor(1280)).toBe(640);
    expect(maximumSidePanelWidthFor(500)).toBe(minimumSidePanelWidth);
    expect(maximumSidePanelWidthFor(Number.POSITIVE_INFINITY)).toBe(maximumSidePanelWidth);
  });

  it("treats a non-finite width as no choice and matches the stylesheet default", () => {
    expect(clampSidePanelWidth(Number.NaN, 1700)).toBe(defaultSidePanelWidth);
    expect(clampSidePanelWidth(Number.NaN, 1200)).toBe(compactSidePanelWidth);
    expect(defaultSidePanelWidthFor(1280)).toBe(compactSidePanelWidth);
    expect(defaultSidePanelWidthFor(1281)).toBe(defaultSidePanelWidth);
  });

  it("reads a stored width and falls back to the default for anything unusable", () => {
    expect(parseSidePanelWidth("512")).toBe(512);
    expect(parseSidePanelWidth("5000")).toBe(maximumSidePanelWidth);
    expect(parseSidePanelWidth("12")).toBe(minimumSidePanelWidth);
    expect(parseSidePanelWidth(null)).toBeNull();
    expect(parseSidePanelWidth("")).toBeNull();
    expect(parseSidePanelWidth("wide")).toBeNull();
    expect(parseSidePanelWidth("512px")).toBeNull();
    expect(parseSidePanelWidth("Infinity")).toBeNull();

    expect(readStoredSidePanelWidth(memoryStorage({ [sidePanelWidthStorageKey]: "480" }))).toBe(
      480,
    );
    expect(readStoredSidePanelWidth(memoryStorage({ [sidePanelWidthStorageKey]: "NaN" }))).toBe(
      null,
    );
    expect(readStoredSidePanelWidth(undefined)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredSidePanelWidth(blocked)).toBeNull();
  });

  it("stores a chosen width and forgets it on reset, surviving a blocked store", () => {
    const storage = memoryStorage();
    writeStoredSidePanelWidth(storage, 512);
    expect(storage.values.get(sidePanelWidthStorageKey)).toBe("512");
    writeStoredSidePanelWidth(storage, null);
    expect(storage.values.has(sidePanelWidthStorageKey)).toBe(false);

    const blocked = {
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeStoredSidePanelWidth(blocked, 512)).not.toThrow();
    expect(() => writeStoredSidePanelWidth(blocked, null)).not.toThrow();
    expect(() => writeStoredSidePanelWidth(undefined, 512)).not.toThrow();
  });

  it("measures a drag from the pointer to the layout's right edge", () => {
    expect(sidePanelWidthFromPointer(1200, 1700, 1700)).toBe(500);
    expect(sidePanelWidthFromPointer(1650, 1700, 1700)).toBe(minimumSidePanelWidth);
    expect(sidePanelWidthFromPointer(100, 1700, 1700)).toBe(720);
  });

  it("nudges with the arrows, jumps with Home and End, and leaves other keys alone", () => {
    expect(nextSidePanelWidthForKey("ArrowLeft", false, 430, 1700)).toBe(430 + sidePanelWidthStep);
    expect(nextSidePanelWidthForKey("ArrowRight", false, 430, 1700)).toBe(430 - sidePanelWidthStep);
    expect(nextSidePanelWidthForKey("ArrowLeft", true, 430, 1700)).toBe(
      430 + sidePanelWidthLargeStep,
    );
    expect(nextSidePanelWidthForKey("ArrowRight", true, 340, 1700)).toBe(minimumSidePanelWidth);
    expect(nextSidePanelWidthForKey("Home", false, 430, 1700)).toBe(minimumSidePanelWidth);
    expect(nextSidePanelWidthForKey("End", false, 430, 1700)).toBe(720);
    expect(nextSidePanelWidthForKey("End", false, 430, 1280)).toBe(640);
    expect(nextSidePanelWidthForKey("a", false, 430, 1700)).toBeNull();
    expect(nextSidePanelWidthForKey("Enter", false, 430, 1700)).toBeNull();
  });

  it("renders the handle as a labelled vertical separator carrying its width", () => {
    const html = renderToStaticMarkup(
      <SidePanelHandle
        width={480}
        viewportWidth={1280}
        onWidthChange={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Resize side panel"');
    expect(html).toContain('aria-valuenow="480"');
    expect(html).toContain(`aria-valuemin="${minimumSidePanelWidth}"`);
    expect(html).toContain('aria-valuemax="640"');
    expect(html).toContain('tabindex="0"');
  });

  it("leaves the stylesheet default in place on the review desk until a width is chosen", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    expect(html).toContain('class="app-shell app-shell-resizable"');
    expect(html).not.toContain("--side-panel-width");
    expect(html).toContain('aria-label="Resize side panel"');
    expect(html).toContain(`aria-valuenow="${defaultSidePanelWidth}"`);
  });

  it("applies a stored width to the review desk through the custom property", () => {
    vi.stubGlobal("localStorage", memoryStorage({ [sidePanelWidthStorageKey]: "520" }));
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    expect(html).toContain('style="--side-panel-width:520px"');
    expect(html).toContain('aria-valuenow="520"');
  });
});

describe("folding the side panel away (#1939)", () => {
  it("stores the folded panel, forgets it when opened, and survives a blocked store", () => {
    const storage = memoryStorage();
    expect(readStoredSidePanelCollapsed(storage)).toBe(false);
    writeStoredSidePanelCollapsed(storage, true);
    expect(storage.values.get(sidePanelCollapsedStorageKey)).toBe("1");
    expect(readStoredSidePanelCollapsed(storage)).toBe(true);
    writeStoredSidePanelCollapsed(storage, false);
    expect(storage.values.has(sidePanelCollapsedStorageKey)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredSidePanelCollapsed(blocked)).toBe(false);
    expect(() => writeStoredSidePanelCollapsed(blocked, true)).not.toThrow();
  });

  it("labels the edge button by what it does and the panel it controls", () => {
    const open = renderToStaticMarkup(
      <SidePanelToggle collapsed={false} controls="panel" onToggle={() => undefined} />,
    );
    expect(open).toContain('aria-label="Hide side panel"');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-controls="panel"');
    const folded = renderToStaticMarkup(
      <SidePanelToggle collapsed={true} controls="panel" onToggle={() => undefined} />,
    );
    expect(folded).toContain('aria-label="Show side panel"');
    expect(folded).toContain('aria-expanded="false"');
  });

  it("opens the review desk with the panel folded when the reader left it so", () => {
    vi.stubGlobal("localStorage", memoryStorage({ [sidePanelCollapsedStorageKey]: "1" }));
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    expect(html).toContain('class="app-shell app-shell-resizable app-shell-side-collapsed"');
    expect(html).toContain('aria-label="Show side panel"');
  });

  it("keeps the panel open on a fresh desk", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    expect(html).not.toContain("app-shell-side-collapsed");
    expect(html).toContain('aria-label="Hide side panel"');
  });
});
