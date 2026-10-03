import { describe, expect, it } from "vitest";

import {
  planCanonicalProfileExtractionBoundedTextWindows,
  planCanonicalProfileExtractionCalls,
} from "./canonical-profile-extraction-plan.js";

function source(id: string, textLength: number) {
  return { id, text: "x".repeat(textLength) };
}

function expectCompleteWindows(
  text: string,
  windows: readonly { readonly start: number; readonly end: number; readonly text: string }[],
) {
  expect(windows.map((window) => window.text).join("")).toBe(text);

  let priorEnd = 0;
  for (const window of windows) {
    expect(window.start).toBe(priorEnd);
    expect(window.end).toBeGreaterThan(window.start);
    expect(window.end - window.start).toBeLessThanOrEqual(8_192);
    expect(window.text).toBe(text.slice(window.start, window.end));
    for (const offset of [window.start, window.end]) {
      if (offset === 0 || offset === text.length) continue;
      const previous = text.charCodeAt(offset - 1);
      const current = text.charCodeAt(offset);
      expect(previous < 0xd800 || previous > 0xdbff || current < 0xdc00 || current > 0xdfff).toBe(
        true,
      );
    }
    priorEnd = window.end;
  }
  expect(priorEnd).toBe(text.length);
}

describe("canonical profile extraction proactive plan", () => {
  it("keeps large-corpus eligibility strictly above 65,536 UTF-16 units", () => {
    expect(planCanonicalProfileExtractionCalls([source("source-a", 65_536)])).toBeNull();

    const calls = planCanonicalProfileExtractionCalls([source("source-a", 65_537)]);
    expect(calls).toHaveLength(9);
    expect(calls?.every((call) => call.sourceId === "source-a" && call.window !== undefined)).toBe(
      true,
    );
    const windows = calls?.flatMap((call) => (call.window === undefined ? [] : [call.window]));
    expect(windows?.every((window) => window.end - window.start <= 8_192)).toBe(true);
  });

  it("uses one call through 8,192 units and bounded windows starting at 8,193", () => {
    const calls = planCanonicalProfileExtractionCalls([
      source("source-a", 8_192),
      source("source-b", 8_193),
      source("source-c", 24_576),
      source("source-d", 24_576),
    ]);

    expect(calls).toHaveLength(9);
    expect(calls?.[0]).toEqual({ sourceId: "source-a" });
    expect(
      calls
        ?.slice(1, 3)
        .map((call) => (call.window === undefined ? null : call.window.end - call.window.start)),
    ).toEqual([8_192, 1]);
    expect(calls?.slice(3).every((call) => call.window !== undefined)).toBe(true);
  });

  it("plans 22 calls for two synthetic sources of about 83,000 units each", () => {
    const calls = planCanonicalProfileExtractionCalls([
      source("source-a", 83_000),
      source("source-b", 83_000),
    ]);

    expect(calls).toHaveLength(22);
    expect(calls?.filter((call) => call.sourceId === "source-a")).toHaveLength(11);
    expect(calls?.filter((call) => call.sourceId === "source-b")).toHaveLength(11);
  });

  it("caps four 128-KiB sources at 64 complete calls", () => {
    const calls = planCanonicalProfileExtractionCalls(
      ["a", "b", "c", "d"].map((id) => source(id, 128 * 1_024)),
    );

    expect(calls).toHaveLength(64);
    expect(
      calls?.every(
        (call) => call.window !== undefined && call.window.end - call.window.start === 8_192,
      ),
    ).toBe(true);
  });

  it("declines duplicate, over-four-source, and over-cap plans without partial output", () => {
    expect(
      planCanonicalProfileExtractionCalls([
        source("duplicate", 32_769),
        source("duplicate", 32_769),
      ]),
    ).toBeNull();
    expect(
      planCanonicalProfileExtractionCalls(
        ["a", "b", "c", "d", "e"].map((id) => source(id, 16_384)),
      ),
    ).toBeNull();

    const newlineHeavySource = `${"x".repeat(6_999)}\n`.repeat(18);
    expect(newlineHeavySource.length).toBeLessThanOrEqual(128 * 1_024);
    expect(
      planCanonicalProfileExtractionCalls(
        ["a", "b", "c", "d"].map((id) => ({ id, text: newlineHeavySource })),
      ),
    ).toBeNull();
  });

  it("preserves newline boundaries, emoji pairs, and exact original offsets", () => {
    const line = `${"x".repeat(6_997)}😀\n`;
    const newlineText = line.repeat(12);
    const newlineWindows = planCanonicalProfileExtractionBoundedTextWindows(newlineText);

    expect(newlineWindows).toHaveLength(12);
    expectCompleteWindows(newlineText, newlineWindows ?? []);
    expect(newlineWindows?.slice(0, -1).every((window) => window.text.endsWith("\n"))).toBe(true);

    const surrogateBoundaryText = `${"x".repeat(8_191)}😀${"y".repeat(8_192)}`;
    const surrogateWindows =
      planCanonicalProfileExtractionBoundedTextWindows(surrogateBoundaryText);
    expect(surrogateWindows?.[0]?.end).toBe(8_191);
    expectCompleteWindows(surrogateBoundaryText, surrogateWindows ?? []);
  });
});
