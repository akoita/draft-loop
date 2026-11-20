import { describe, expect, it } from "vitest";

import {
  createMemoryLiveVoiceUsage,
  defaultLiveMinutesPerDay,
  liveSecondsLeft,
  readLiveMinutesPerDay,
} from "./live-voice-allowance.js";

const day1 = new Date("2026-11-20T10:00:00.000Z");
const day2 = new Date("2026-11-21T00:00:01.000Z");

describe("live voice allowance", () => {
  it("reads whole daily minutes, 30 when unset", () => {
    expect(readLiveMinutesPerDay({})).toBe(defaultLiveMinutesPerDay);
    expect(readLiveMinutesPerDay({ DRAFT_LOOP_LIVE_MINUTES_PER_DAY: " 45 " })).toBe(45);
    for (const value of ["0", "601", "2.5", "ten"]) {
      expect(() => readLiveMinutesPerDay({ DRAFT_LOOP_LIVE_MINUTES_PER_DAY: value })).toThrow(
        /DRAFT_LOOP_LIVE_MINUTES_PER_DAY/u,
      );
    }
  });

  it("counts each member's seconds and gives the rest of the day's allowance", async () => {
    let now = day1;
    const usage = createMemoryLiveVoiceUsage();
    const allowance = { usage, minutesPerDay: 2, now: () => now };
    await usage.addSeconds("m1", 30.2, now);
    await usage.addSeconds("m2", 120, now);
    await usage.addSeconds("m1", -5, now);
    await expect(liveSecondsLeft(allowance, "m1")).resolves.toBe(89);
    await expect(liveSecondsLeft(allowance, "m2")).resolves.toBe(0);
    now = day2;
    await expect(liveSecondsLeft(allowance, "m2")).resolves.toBe(120);
  });
});
