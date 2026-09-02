import { describe, expect, it } from "vitest";

import {
  activateDurationAccounting,
  createDurationAccounting,
  currentActiveDurationMs,
  inspectDurationAccounting,
  settleDurationAccounting,
} from "./duration-accounting.js";

const startedAt = "2026-08-12T10:00:00.000Z";
const at250 = "2026-08-12T10:00:00.250Z";
const at1000 = "2026-08-12T10:00:01.000Z";

describe("duration accounting", () => {
  it("starts a new run as active at its start timestamp", () => {
    expect(createDurationAccounting(startedAt)).toEqual({
      activeDurationMs: 0,
      activeSince: startedAt,
    });
    expect(currentActiveDurationMs(createDurationAccounting(startedAt), startedAt, at250)).toBe(
      250,
    );
  });

  it("settles active time and excludes a subsequent human-wait interval", () => {
    const settled = settleDurationAccounting(createDurationAccounting(startedAt), startedAt, at250);
    expect(settled).toEqual({ activeDurationMs: 250, activeSince: null });
    expect(currentActiveDurationMs(settled, startedAt, at1000)).toBe(250);
  });

  it("resumes from a settled segment without resetting accumulated time", () => {
    const settled = { activeDurationMs: 250, activeSince: null };
    const resumed = activateDurationAccounting(settled, startedAt, at1000);
    expect(resumed).toEqual({ activeDurationMs: 250, activeSince: at1000 });
    expect(currentActiveDurationMs(resumed, startedAt, at1000)).toBe(250);
    expect(currentActiveDurationMs(resumed, startedAt, "2026-08-12T10:00:01.100Z")).toBe(350);
  });

  it("clamps clock regressions rather than subtracting active time", () => {
    const accounting = { activeDurationMs: 250, activeSince: at1000 };
    expect(currentActiveDurationMs(accounting, startedAt, at250)).toBe(250);
    expect(settleDurationAccounting(accounting, startedAt, at250)).toEqual({
      activeDurationMs: 250,
      activeSince: null,
    });
  });

  it("uses conservative wall time for legacy snapshots and migrates it", () => {
    expect(inspectDurationAccounting(undefined, startedAt, at250)).toEqual({
      valid: true,
      legacy: true,
      activeDurationMs: 250,
    });
    expect(settleDurationAccounting(undefined, startedAt, at250)).toEqual({
      activeDurationMs: 250,
      activeSince: null,
    });
    expect(activateDurationAccounting(undefined, startedAt, at1000)).toEqual({
      activeDurationMs: 1000,
      activeSince: at1000,
    });
  });

  it("marks malformed persisted accounting invalid and throws on use", () => {
    const malformed = { activeDurationMs: -1, activeSince: null };
    expect(inspectDurationAccounting(malformed, startedAt, at250)).toMatchObject({
      valid: false,
      legacy: false,
    });
    expect(() => currentActiveDurationMs(malformed, startedAt, at250)).toThrow(/invalid/i);
    expect(() => settleDurationAccounting(malformed, startedAt, at250)).toThrow(/invalid/i);
    expect(() => activateDurationAccounting(malformed, startedAt, at250)).toThrow(/invalid/i);
  });
});
