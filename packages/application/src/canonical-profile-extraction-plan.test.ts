import { describe, expect, it } from "vitest";

import { planCanonicalProfileExtractionCalls } from "./canonical-profile-extraction-plan.js";

function source(id: string, textLength: number) {
  return { id, text: "x".repeat(textLength) };
}

describe("canonical profile extraction proactive plan", () => {
  it("does not plan at the total-text threshold and plans a single larger source", () => {
    expect(planCanonicalProfileExtractionCalls([source("source-a", 65_536)])).toBeNull();

    const calls = planCanonicalProfileExtractionCalls([source("source-a", 65_537)]);
    expect(calls).toHaveLength(4);
    expect(calls?.every((call) => call.sourceId === "source-a" && call.window !== undefined)).toBe(
      true,
    );
  });

  it("uses one focused call at the per-source threshold and four above it", () => {
    const calls = planCanonicalProfileExtractionCalls([
      source("source-a", 16_384),
      source("source-b", 16_384),
      source("source-c", 32_769),
    ]);

    expect(calls).toHaveLength(6);
    expect(calls?.slice(0, 2)).toEqual([{ sourceId: "source-a" }, { sourceId: "source-b" }]);
    expect(calls?.slice(2).every((call) => call.sourceId === "source-c" && call.window)).toBe(true);
  });

  it("caps four large sources at sixteen calls", () => {
    const calls = planCanonicalProfileExtractionCalls(
      ["a", "b", "c", "d"].map((id) => source(id, 16_385)),
    );

    expect(calls).toHaveLength(16);
    expect(calls?.map((call) => call.sourceId)).toEqual([
      "a",
      "a",
      "a",
      "a",
      "b",
      "b",
      "b",
      "b",
      "c",
      "c",
      "c",
      "c",
      "d",
      "d",
      "d",
      "d",
    ]);
  });

  it("declines unsupported duplicate or over-four-source inputs", () => {
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
  });

  it("covers emoji and newline text with contiguous original UTF-16 offsets", () => {
    const text = "😀alpha\n".repeat(8_200);
    const calls = planCanonicalProfileExtractionCalls([{ id: "source-a", text }]);
    const windows = calls?.flatMap((call) => (call.window === undefined ? [] : [call.window]));

    expect(windows).toHaveLength(4);
    expect(windows?.map((window) => window.text).join("")).toBe(text);
    for (const window of windows ?? []) {
      expect(window.text).toBe(text.slice(window.start, window.end));
      for (const offset of [window.start, window.end]) {
        if (offset === 0 || offset === text.length) continue;
        const previous = text.charCodeAt(offset - 1);
        const next = text.charCodeAt(offset);
        expect(previous < 0xd800 || previous > 0xdbff || next < 0xdc00 || next > 0xdfff).toBe(true);
      }
    }
    expect(windows?.slice(0, -1).every((window) => window.text.endsWith("\n"))).toBe(true);
  });
});
