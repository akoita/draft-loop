import { describe, expect, it } from "vitest";
import { addUtcMonths, creditPeriodAt, startOfUtcDay } from "./credit-periods.js";

const at = (value: string) => new Date(value);

describe("credit period arithmetic", () => {
  it("adds calendar months in UTC and clamps to the end of a short month", () => {
    expect(addUtcMonths(at("2026-10-24T08:30:00.000Z"), 12).toISOString()).toBe(
      "2027-10-24T08:30:00.000Z",
    );
    expect(addUtcMonths(at("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addUtcMonths(at("2028-02-29T10:00:00.000Z"), 12).toISOString()).toBe(
      "2029-02-28T10:00:00.000Z",
    );
    expect(addUtcMonths(at("2026-11-30T00:00:00.000Z"), 3).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(addUtcMonths(at("2026-12-15T00:00:00.000Z"), 1).toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  it("finds the monthly period that holds a moment", () => {
    expect(creditPeriodAt("2026-10-01", 1, at("2026-10-01T00:00:00.000Z"))).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
    });
    expect(creditPeriodAt("2026-10-01", 1, at("2026-10-31T23:59:59.999Z"))).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
    });
    expect(creditPeriodAt("2026-10-01", 1, at("2026-11-01T00:00:00.000Z"))).toEqual({
      start: "2026-11-01",
      end: "2026-12-01",
    });
    expect(creditPeriodAt("2026-10-15", 1, at("2027-03-14T12:00:00.000Z"))).toEqual({
      start: "2027-02-15",
      end: "2027-03-15",
    });
  });

  it("measures every period from the anchor so a short month does not move later ones", () => {
    expect(creditPeriodAt("2026-01-31", 1, at("2026-02-28T00:00:00.000Z"))).toEqual({
      start: "2026-02-28",
      end: "2026-03-31",
    });
    expect(creditPeriodAt("2026-01-31", 1, at("2026-03-30T23:00:00.000Z"))).toEqual({
      start: "2026-02-28",
      end: "2026-03-31",
    });
    expect(creditPeriodAt("2026-01-31", 1, at("2026-03-31T00:00:00.000Z"))).toEqual({
      start: "2026-03-31",
      end: "2026-04-30",
    });
  });

  it("counts a multi-month period from its anchor", () => {
    expect(creditPeriodAt("2026-10-01", 3, at("2026-12-31T23:59:59.000Z"))).toEqual({
      start: "2026-10-01",
      end: "2027-01-01",
    });
    expect(creditPeriodAt("2026-10-01", 3, at("2027-01-01T00:00:00.000Z"))).toEqual({
      start: "2027-01-01",
      end: "2027-04-01",
    });
    expect(creditPeriodAt("2026-10-01", 36, at("2030-01-01T00:00:00.000Z"))).toEqual({
      start: "2029-10-01",
      end: "2032-10-01",
    });
  });

  it("has no period before the anchor and finds the start of a UTC day", () => {
    expect(creditPeriodAt("2026-10-01", 1, at("2026-09-30T23:59:59.999Z"))).toBeUndefined();
    expect(startOfUtcDay(at("2026-10-24T23:59:59.999Z"))).toBe("2026-10-24T00:00:00.000Z");
    expect(startOfUtcDay(at("2026-10-24T00:00:00.000Z"))).toBe("2026-10-24T00:00:00.000Z");
  });
});
