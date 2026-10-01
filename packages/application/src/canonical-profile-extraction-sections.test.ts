import { describe, expect, it } from "vitest";

import {
  canonicalProfileExtractionSectionFocus,
  planCanonicalProfileExtractionTextWindows,
} from "./canonical-profile-extraction-sections.js";

describe("canonical profile extraction section planning", () => {
  it("covers multiline Unicode text exactly with contiguous surrogate-safe offsets", () => {
    const text = "Summary 🌐\nBuilt a tool 🚀\nReduced latency\nTypeScript and SQL\n";
    const windows = planCanonicalProfileExtractionTextWindows(text);
    expect(windows).toHaveLength(4);
    expect(windows?.map((window) => window.text).join("")).toBe(text);

    let priorEnd = 0;
    for (const window of windows ?? []) {
      expect(window.start).toBe(priorEnd);
      expect(window.end).toBeGreaterThan(window.start);
      expect(window.text).toBe(text.slice(window.start, window.end));
      const beforeStart = text.charCodeAt(window.start - 1);
      const atStart = text.charCodeAt(window.start);
      const beforeEnd = text.charCodeAt(window.end - 1);
      const atEnd = text.charCodeAt(window.end);
      expect(
        !(beforeStart >= 0xd800 && beforeStart <= 0xdbff && atStart >= 0xdc00 && atStart <= 0xdfff),
      ).toBe(true);
      expect(
        !(beforeEnd >= 0xd800 && beforeEnd <= 0xdbff && atEnd >= 0xdc00 && atEnd <= 0xdfff),
      ).toBe(true);
      priorEnd = window.end;
    }
    expect(priorEnd).toBe(text.length);
  });

  it("prefers nearby newline boundaries and balances text without line breaks", () => {
    const lines = "aaaaaa\nbbbbbb\ncccccc\ndddddd";
    const lineWindows = planCanonicalProfileExtractionTextWindows(lines);
    expect(lineWindows?.map((window) => window.text)).toEqual([
      "aaaaaa\n",
      "bbbbbb\n",
      "cccccc\n",
      "dddddd",
    ]);

    const plainWindows = planCanonicalProfileExtractionTextWindows("abcdefghijklmnop");
    expect(plainWindows?.map((window) => window.text)).toEqual(["abcd", "efgh", "ijkl", "mnop"]);
  });

  it("rejects text too small for four non-empty windows and builds exact focus input fields", () => {
    expect(planCanonicalProfileExtractionTextWindows("abc")).toBeNull();
    expect(planCanonicalProfileExtractionTextWindows("😀a😀")).toBeNull();

    const [window] = planCanonicalProfileExtractionTextWindows("abcdefgh") ?? [];
    expect(window).toBeDefined();
    if (window === undefined) throw new Error("Expected a section window.");
    expect(canonicalProfileExtractionSectionFocus("source-safe-id", window)).toEqual({
      extractionFocusSourceId: "source-safe-id",
      extractionFocusWindow: { start: 0, end: 2, text: "ab" },
    });
  });
});
