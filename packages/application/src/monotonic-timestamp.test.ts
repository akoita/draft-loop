import { describe, expect, it } from "vitest";

import { monotonicTimestamp } from "./monotonic-timestamp.js";

describe("monotonicTimestamp", () => {
  it("keeps the latest valid value when the wall clock moves backward", () => {
    const values = [
      "2026-09-15T01:00:00.000Z",
      "2026-09-15T02:00:00.000Z",
      "2026-09-15T01:30:00.000Z",
    ];
    const now = monotonicTimestamp(() => values.shift() as string);

    expect([now(), now(), now()]).toEqual([
      "2026-09-15T01:00:00.000Z",
      "2026-09-15T02:00:00.000Z",
      "2026-09-15T02:00:00.000Z",
    ]);
  });

  it("passes invalid values through for the existing validation boundary", () => {
    const values = ["2026-09-15T01:00:00.000Z", "not-a-time"];
    const now = monotonicTimestamp(() => values.shift() as string);

    expect(now()).toBe("2026-09-15T01:00:00.000Z");
    expect(now()).toBe("not-a-time");
  });
});
