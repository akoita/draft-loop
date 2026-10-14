import { describe, expect, it } from "vitest";

import { notBefore, notBeforeWithinClockStep } from "./causal-timestamp.js";

describe("causal timestamps", () => {
  const artifactCreatedAt = "2026-08-12T10:00:01.200Z";

  it("keeps a requested stamp that does not precede any floor", () => {
    expect(notBefore("2026-08-12T10:00:02.000Z", artifactCreatedAt)).toBe(
      "2026-08-12T10:00:02.000Z",
    );
    expect(notBefore(artifactCreatedAt, artifactCreatedAt)).toBe(artifactCreatedAt);
    expect(notBefore(artifactCreatedAt)).toBe(artifactCreatedAt);
  });

  it("raises a stamp from a backward clock step to the latest floor", () => {
    expect(
      notBefore(
        "2026-08-12T10:00:00.000Z",
        "2026-08-12T09:59:00.000Z",
        artifactCreatedAt,
        "2026-08-12T10:00:00.500Z",
      ),
    ).toBe(artifactCreatedAt);
  });

  it("ignores missing and unparseable floors", () => {
    expect(notBefore("2026-08-12T10:00:00.000Z", undefined, "not a date")).toBe(
      "2026-08-12T10:00:00.000Z",
    );
  });

  it("returns an unparseable requested stamp unchanged for validators to reject", () => {
    expect(notBefore("not a date", artifactCreatedAt)).toBe("not a date");
  });

  it("raises a stamp to a caller-supplied floor only within the clock-step tolerance", () => {
    const now = "2026-08-12T10:00:00.000Z";
    expect(notBeforeWithinClockStep(now, artifactCreatedAt)).toBe(artifactCreatedAt);
    expect(notBeforeWithinClockStep(now, "2026-08-12T10:05:00.000Z")).toBe(
      "2026-08-12T10:05:00.000Z",
    );
    expect(notBeforeWithinClockStep(now, "2026-08-12T10:05:00.001Z")).toBe(now);
    expect(notBeforeWithinClockStep(now, "2026-08-12T09:59:00.000Z")).toBe(now);
  });
});
