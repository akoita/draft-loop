import { describe, expect, it } from "vitest";

import { autopilotConflicts, autopilotDecision } from "./autopilot.js";

const none = { disputedClaims: 0, factualityErrors: 0 };

describe("autopilot decision", () => {
  it("continues through blocking findings and stalled scores below the round limit", () => {
    for (const stopReason of ["blocked-findings", "stable-convergence"] as const) {
      expect(autopilotDecision({ stopReason, round: 1, maxRounds: 3, conflicts: none })).toBe(
        "continue",
      );
    }
  });

  it("stops at the round limit and for other stop reasons", () => {
    expect(
      autopilotDecision({
        stopReason: "blocked-findings",
        round: 3,
        maxRounds: 3,
        conflicts: none,
      }),
    ).toBe("stop");
    expect(
      autopilotDecision({ stopReason: "max-rounds", round: 2, maxRounds: 3, conflicts: none }),
    ).toBe("stop");
  });

  it("pauses on a conflict that would otherwise have continued", () => {
    expect(
      autopilotDecision({
        stopReason: "blocked-findings",
        round: 1,
        maxRounds: 3,
        conflicts: { disputedClaims: 1, factualityErrors: 0 },
      }),
    ).toBe("pause-on-conflict");
  });

  it("counts disputed claims and blocking factuality findings only", () => {
    expect(
      autopilotConflicts({ claims: [{ status: "disputed" }, { status: "verified" }] as never }, [
        { severity: "error", category: "factuality" },
        { severity: "warning", category: "factuality" },
        { severity: "error", category: "coverage" },
        { severity: "error" },
      ]),
    ).toEqual({ disputedClaims: 1, factualityErrors: 1 });
    expect(autopilotConflicts(null, [])).toEqual(none);
  });
});
