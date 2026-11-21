import { describe, expect, it } from "vitest";

import {
  type OrganisationMilestones,
  usageFunnel,
  usageFunnelSince,
  weekStartOf,
} from "./usage-funnel.js";

const none = {
  signedIn: null,
  evidence: null,
  briefReviewed: null,
  draftFinished: null,
  approved: null,
  exported: null,
  prepared: null,
} as const;

// Thursday 2026-11-19; its week starts Monday 2026-11-16.
const now = new Date("2026-11-19T12:00:00.000Z");

describe("the usage funnel (#2834)", () => {
  it("starts weeks on Monday, UTC", () => {
    expect(weekStartOf(now).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekStartOf(new Date("2026-11-16T00:00:00.000Z")).toISOString()).toBe(
      "2026-11-16T00:00:00.000Z",
    );
    expect(weekStartOf(new Date("2026-11-22T23:59:59.000Z")).toISOString()).toBe(
      "2026-11-16T00:00:00.000Z",
    );
    expect(usageFunnelSince(now, 8).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("counts each step's first time per week and the cohort's drop-off between steps", () => {
    const keen: OrganisationMilestones = {
      memberSignIns: ["2026-11-09T09:00:00.000Z", "2026-11-17T09:00:00.000Z"],
      firsts: {
        signedIn: "2026-11-09T09:00:00.000Z",
        evidence: "2026-11-09T10:00:00.000Z",
        briefReviewed: "2026-11-10T10:00:00.000Z",
        draftFinished: "2026-11-17T10:00:00.000Z",
        approved: "2026-11-17T11:00:00.000Z",
        exported: null,
        prepared: null,
      },
      activity: [
        "2026-11-09T00:00:00.000Z",
        "2026-11-10T00:00:00.000Z",
        "2026-11-17T00:00:00.000Z",
      ],
    };
    const stalled: OrganisationMilestones = {
      memberSignIns: ["2026-11-17T08:00:00.000Z"],
      firsts: { ...none, signedIn: "2026-11-17T08:00:00.000Z" },
      activity: [],
    };
    // Signed in before the window: it counts in the weeks, not in the cohort.
    const old: OrganisationMilestones = {
      memberSignIns: [],
      firsts: {
        ...none,
        signedIn: "2026-01-05T08:00:00.000Z",
        exported: "2026-11-18T08:00:00.000Z",
      },
      activity: ["2026-11-18T00:00:00.000Z"],
    };

    const funnel = usageFunnel({ organisations: [keen, stalled, old], now, weeks: 2 });

    expect(funnel.organisations).toBe(3);
    expect(funnel.weeks).toEqual([
      {
        weekStart: "2026-11-09",
        signUps: 1,
        firsts: { ...zeros(), signedIn: 1, evidence: 1, briefReviewed: 1 },
        activeOrganisations: 1,
      },
      {
        weekStart: "2026-11-16",
        signUps: 2,
        firsts: { ...zeros(), signedIn: 1, draftFinished: 1, approved: 1, exported: 1 },
        activeOrganisations: 2,
      },
    ]);
    expect(funnel.cohort).toEqual([
      { step: "signedIn", reached: 2, fromPrevious: null },
      { step: "evidence", reached: 1, fromPrevious: 0.5 },
      { step: "briefReviewed", reached: 1, fromPrevious: 1 },
      { step: "draftFinished", reached: 1, fromPrevious: 1 },
      { step: "approved", reached: 1, fromPrevious: 1 },
      { step: "exported", reached: 0, fromPrevious: 0 },
      { step: "prepared", reached: 0, fromPrevious: 0 },
    ]);
  });

  it("reports empty weeks when nobody came, and refuses a window it cannot hold", () => {
    const funnel = usageFunnel({ organisations: [], now, weeks: 8 });
    expect(funnel.weeks).toHaveLength(8);
    expect(funnel.weeks.every((week) => week.signUps === 0 && week.activeOrganisations === 0)).toBe(
      true,
    );
    expect(() => usageFunnel({ organisations: [], now, weeks: 0 })).toThrow();
    expect(() => usageFunnel({ organisations: [], now, weeks: 53 })).toThrow();
  });
});

function zeros() {
  return {
    signedIn: 0,
    evidence: 0,
    briefReviewed: 0,
    draftFinished: 0,
    approved: 0,
    exported: 0,
    prepared: 0,
  };
}
