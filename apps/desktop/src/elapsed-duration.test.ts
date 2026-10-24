import { describe, expect, it } from "vitest";

import { formatElapsedDuration } from "./elapsed-duration.js";

describe("formatElapsedDuration", () => {
  it.each([
    [0, "0 s"],
    [999, "0 s"],
    [59_000, "59 s"],
    [60_000, "1 min 00 s"],
    [276_000, "4 min 36 s"],
    [276_900, "4 min 36 s"],
    [3_599_000, "59 min 59 s"],
    [3_600_000, "1 h 00 min"],
    [3_900_000, "1 h 05 min"],
    [-5_000, "0 s"],
    [Number.NaN, "0 s"],
    [Number.POSITIVE_INFINITY, "0 s"],
  ])("formats %s ms as %s", (ms, expected) => {
    expect(formatElapsedDuration(ms)).toBe(expected);
  });
});
