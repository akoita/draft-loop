import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampDraftWidth,
  DraftWidthHandle,
  defaultDraftWidth,
  draftWidthFromDrag,
  draftWidthLargeStep,
  draftWidthStep,
  draftWidthStorageKey,
  draftWidthStyle,
  maximumDraftWidth,
  maximumDraftWidthFor,
  minimumDraftGutter,
  minimumDraftWidth,
  nextDraftWidthForKey,
  parseDraftWidth,
  readStoredDraftWidth,
  writeStoredDraftWidth,
} from "./draft-width.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

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

describe("draft width", () => {
  it("keeps the sheet readable and always leaves the margin-note gutter", () => {
    expect(clampDraftWidth(700)).toBe(700);
    expect(clampDraftWidth(100)).toBe(minimumDraftWidth);
    expect(clampDraftWidth(5000)).toBe(maximumDraftWidth);
    expect(clampDraftWidth(700.6, 900)).toBe(701);
    expect(clampDraftWidth(950, 900)).toBe(900);
    expect(clampDraftWidth(Number.NaN)).toBe(defaultDraftWidth);
    expect(clampDraftWidth(Number.NaN, 500)).toBe(500);

    // The gutter is the larger of the minimum and what the margin actually occupies.
    expect(maximumDraftWidthFor(1000, 220)).toBe(1000 - minimumDraftGutter);
    expect(maximumDraftWidthFor(1000, 272)).toBe(728);
    expect(maximumDraftWidthFor(600, 272)).toBe(minimumDraftWidth);
    expect(maximumDraftWidthFor(3000, 272)).toBe(maximumDraftWidth);
    expect(maximumDraftWidthFor(null)).toBe(maximumDraftWidth);
  });

  it("reads a stored width and treats anything unusable as no choice", () => {
    expect(parseDraftWidth(null)).toBeNull();
    expect(parseDraftWidth("")).toBeNull();
    expect(parseDraftWidth("wide")).toBeNull();
    expect(parseDraftWidth("Infinity")).toBeNull();
    expect(parseDraftWidth("720")).toBe(720);
    expect(parseDraftWidth("100")).toBe(minimumDraftWidth);
    expect(parseDraftWidth("9000")).toBe(maximumDraftWidth);

    expect(readStoredDraftWidth(undefined)).toBeNull();
    expect(readStoredDraftWidth(memoryStorage({ [draftWidthStorageKey]: "640" }))).toBe(640);
    expect(
      readStoredDraftWidth({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
  });

  it("stores a chosen width and forgets it on reset, surviving a blocked store", () => {
    const storage = memoryStorage();
    writeStoredDraftWidth(storage, 700);
    expect(storage.values.get(draftWidthStorageKey)).toBe("700");
    writeStoredDraftWidth(storage, null);
    expect(storage.values.has(draftWidthStorageKey)).toBe(false);
    expect(() =>
      writeStoredDraftWidth(
        {
          setItem: () => {
            throw new Error("full");
          },
          removeItem: () => {
            throw new Error("blocked");
          },
        },
        700,
      ),
    ).not.toThrow();
    expect(() => writeStoredDraftWidth(undefined, 700)).not.toThrow();
  });

  it("doubles the pointer's travel because the centred sheet grows on both sides", () => {
    expect(draftWidthFromDrag(608, 900, 950, 1000)).toBe(708);
    expect(draftWidthFromDrag(608, 900, 850, 1000)).toBe(508);
    expect(draftWidthFromDrag(608, 900, 2000, 900)).toBe(900);
    expect(draftWidthFromDrag(608, 900, 0, 900)).toBe(minimumDraftWidth);
  });

  it("nudges with the arrows, jumps with Home and End, and leaves other keys alone", () => {
    expect(nextDraftWidthForKey("ArrowRight", false, 608, 900)).toBe(608 + draftWidthStep);
    expect(nextDraftWidthForKey("ArrowLeft", false, 608, 900)).toBe(608 - draftWidthStep);
    expect(nextDraftWidthForKey("ArrowRight", true, 608, 900)).toBe(608 + draftWidthLargeStep);
    expect(nextDraftWidthForKey("ArrowLeft", true, 608, 900)).toBe(608 - draftWidthLargeStep);
    expect(nextDraftWidthForKey("ArrowRight", true, 880, 900)).toBe(900);
    expect(nextDraftWidthForKey("ArrowLeft", true, 500, 900)).toBe(minimumDraftWidth);
    expect(nextDraftWidthForKey("Home", false, 700, 900)).toBe(minimumDraftWidth);
    expect(nextDraftWidthForKey("End", false, 700, 900)).toBe(900);
    expect(nextDraftWidthForKey("Enter", false, 700, 900)).toBeNull();
  });

  it("only gives the single-document grid a width, never Compare", () => {
    expect(draftWidthStyle(720, false)).toEqual({ "--draft-width": "720px" });
    expect(draftWidthStyle(720, true)).toEqual({});
    expect(draftWidthStyle(null, false)).toEqual({});
  });

  it("renders the handle as a labelled vertical separator carrying its width", () => {
    const html = renderToStaticMarkup(
      <DraftWidthHandle
        width={720}
        maximum={900}
        onWidthChange={() => undefined}
        onReset={() => undefined}
        onMeasure={() => undefined}
      />,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Resize draft"');
    expect(html).toContain('aria-valuenow="720"');
    expect(html).toContain(`aria-valuemin="${minimumDraftWidth}"`);
    expect(html).toContain('aria-valuemax="900"');
    expect(html).toContain('tabindex="0"');
  });

  it("shows the handle on the single draft and keeps the stylesheet measure until a width is chosen", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    expect(html).toContain('class="draft-width-handle"');
    expect(html).toContain('aria-label="Resize draft"');
    expect(html).toContain(`aria-valuenow="${defaultDraftWidth}"`);
    expect(html).not.toContain("--draft-width");
  });

  it("applies a stored width to the single-document grid through the custom property", () => {
    vi.stubGlobal("localStorage", memoryStorage({ [draftWidthStorageKey]: "760" }));
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    expect(html).toContain("--draft-width:760px");
    expect(html).toContain('aria-valuenow="760"');
  });
});
