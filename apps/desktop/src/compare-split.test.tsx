import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CompareSplitHandle,
  clampCompareSplit,
  compareSplitFromPointer,
  compareSplitStep,
  compareSplitStorageKey,
  defaultCompareSplit,
  maximumCompareSplit,
  minimumCompareSplit,
  nextCompareSplitForKey,
  parseCompareSplit,
  readStoredCompareSplit,
  writeStoredCompareSplit,
} from "./compare-split.js";

describe("compare column split", () => {
  it("keeps every fraction inside the range that leaves both panes readable", () => {
    expect(clampCompareSplit(minimumCompareSplit)).toBe(minimumCompareSplit);
    expect(clampCompareSplit(maximumCompareSplit)).toBe(maximumCompareSplit);
    expect(clampCompareSplit(0.4)).toBe(0.4);
    expect(clampCompareSplit(0.1)).toBe(minimumCompareSplit);
    expect(clampCompareSplit(-3)).toBe(minimumCompareSplit);
    expect(clampCompareSplit(0.99)).toBe(maximumCompareSplit);
  });

  it("treats a non-finite fraction as no answer rather than an extreme one", () => {
    expect(clampCompareSplit(Number.NaN)).toBe(defaultCompareSplit);
    expect(clampCompareSplit(Number.POSITIVE_INFINITY)).toBe(defaultCompareSplit);
    expect(clampCompareSplit(Number.NEGATIVE_INFINITY)).toBe(defaultCompareSplit);
  });

  it("keeps a split short enough to store and read back unchanged", () => {
    // Ten arrow-key nudges from the even split, the way the accumulation actually happens.
    let split = defaultCompareSplit;
    for (let press = 0; press < 10; press += 1) {
      split = nextCompareSplitForKey("ArrowRight", split) ?? split;
    }
    expect(split).toBe(0.7);
    expect(String(split)).toBe("0.7");
    expect(clampCompareSplit(1 / 3)).toBe(0.3333);
  });

  it("parses a stored fraction and falls back for anything unusable", () => {
    expect(parseCompareSplit(null)).toBe(defaultCompareSplit);
    expect(parseCompareSplit("garbage")).toBe(defaultCompareSplit);
    expect(parseCompareSplit("0.9")).toBe(maximumCompareSplit);
    expect(parseCompareSplit("0.4")).toBe(0.4);
  });

  it("reads the stored split under the published key", () => {
    const reads: string[] = [];
    const stored = readStoredCompareSplit({
      getItem: (key) => {
        reads.push(key);
        return "0.35";
      },
    });

    expect(stored).toBe(0.35);
    expect(reads).toEqual([compareSplitStorageKey]);
  });

  it("falls back to an even split for every unusable store", () => {
    expect(readStoredCompareSplit()).toBe(defaultCompareSplit);
    expect(readStoredCompareSplit(undefined)).toBe(defaultCompareSplit);
    expect(readStoredCompareSplit({ getItem: () => null })).toBe(defaultCompareSplit);
    expect(readStoredCompareSplit({ getItem: () => "wide" })).toBe(defaultCompareSplit);
    expect(
      readStoredCompareSplit({
        getItem: () => {
          throw new Error("site data is blocked");
        },
      }),
    ).toBe(defaultCompareSplit);
  });

  it("survives a store that refuses the write", () => {
    const written: Array<readonly [string, string]> = [];
    writeStoredCompareSplit({ setItem: (key, value) => void written.push([key, value]) }, 0.4);
    expect(written).toEqual([[compareSplitStorageKey, "0.4"]]);

    expect(() => writeStoredCompareSplit(undefined, 0.4)).not.toThrow();
    expect(() =>
      writeStoredCompareSplit(
        {
          setItem: () => {
            throw new Error("quota exceeded");
          },
        },
        0.4,
      ),
    ).not.toThrow();
  });

  it("maps a pointer across the grid onto a clamped fraction", () => {
    const bounds = { left: 100, width: 1000 };

    expect(compareSplitFromPointer(600, bounds)).toBe(defaultCompareSplit);
    expect(compareSplitFromPointer(500, bounds)).toBe(0.4);
    expect(compareSplitFromPointer(100, bounds)).toBe(minimumCompareSplit);
    expect(compareSplitFromPointer(1100, bounds)).toBe(maximumCompareSplit);
    expect(compareSplitFromPointer(-400, bounds)).toBe(minimumCompareSplit);
    expect(compareSplitFromPointer(9000, bounds)).toBe(maximumCompareSplit);
  });

  it("reports an even split for a grid that has not been laid out", () => {
    expect(compareSplitFromPointer(400, { left: 0, width: 0 })).toBe(defaultCompareSplit);
  });

  it("nudges, jumps and resets from the keyboard", () => {
    expect(nextCompareSplitForKey("ArrowLeft", 0.5)).toBeCloseTo(0.5 - compareSplitStep, 10);
    expect(nextCompareSplitForKey("ArrowRight", 0.5)).toBeCloseTo(0.5 + compareSplitStep, 10);
    expect(nextCompareSplitForKey("Home", 0.5)).toBe(minimumCompareSplit);
    expect(nextCompareSplitForKey("End", 0.5)).toBe(maximumCompareSplit);
    expect(nextCompareSplitForKey("Enter", 0.3)).toBe(defaultCompareSplit);
    expect(nextCompareSplitForKey(" ", 0.7)).toBe(defaultCompareSplit);
  });

  it("stops at the clamps instead of running past them", () => {
    expect(nextCompareSplitForKey("ArrowLeft", minimumCompareSplit)).toBe(minimumCompareSplit);
    expect(nextCompareSplitForKey("ArrowRight", maximumCompareSplit)).toBe(maximumCompareSplit);
  });

  it("leaves keys it does not own to the rest of the desk", () => {
    expect(nextCompareSplitForKey("ArrowUp", 0.5)).toBeNull();
    expect(nextCompareSplitForKey("Tab", 0.5)).toBeNull();
    expect(nextCompareSplitForKey("Escape", 0.5)).toBeNull();
  });

  it("announces itself as a focusable separator carrying its value", () => {
    const gridRef = createRef<HTMLDivElement>();
    const html = renderToStaticMarkup(
      <CompareSplitHandle split={0.35} onSplitChange={() => {}} gridRef={gridRef} />,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Resize the compare columns"');
    expect(html).toContain('aria-valuenow="35"');
    expect(html).toContain('aria-valuemin="25"');
    expect(html).toContain('aria-valuemax="75"');
    expect(html).toContain('aria-valuetext="Previous version 35% of the width"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('class="compare-split-handle"');
  });
});
