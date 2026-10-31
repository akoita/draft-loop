import { describe, expect, it } from "vitest";

import { approvalReadinessStopReasons } from "./approval-readiness.js";
import {
  APPLICATION_READY_REASON,
  AUTOPILOT_CONFLICT_REASON,
  BUDGET_REASON,
  CANCELLED_REASON,
  CONSENSUS_READY_REASON,
  PERSISTING_FINDINGS_REASON,
  plainStopReason,
  ROUND_LIMIT_REASON,
  STABLE_SCORES_REASON,
} from "./stop-reason.js";

describe("plainStopReason (#1110)", () => {
  it("words every stop reason the stopping decision records, and none for a continuing loop", () => {
    const worded = Object.fromEntries(
      approvalReadinessStopReasons.map((stopReason) => [
        stopReason,
        plainStopReason("continue", { stopReason }),
      ]),
    );
    expect(worded).toEqual({
      "application-ready": APPLICATION_READY_REASON,
      "stable-convergence": STABLE_SCORES_REASON,
      "max-rounds": ROUND_LIMIT_REASON,
      "autopilot-conflict": AUTOPILOT_CONFLICT_REASON,
      "budget-exhausted": BUDGET_REASON,
      cancelled: CANCELLED_REASON,
      continue: null,
    });
    for (const sentence of Object.values(worded)) {
      if (sentence !== null) expect(sentence).toMatch(/^(?:Stopped|Paused): /u);
    }
  });

  it("lets the finding-based pauses of the evaluation win over the recorded decision", () => {
    expect(plainStopReason("consensus-ready", { stopReason: "max-rounds" })).toBe(
      CONSENSUS_READY_REASON,
    );
    expect(plainStopReason("persisting-findings", { stopReason: "application-ready" })).toBe(
      PERSISTING_FINDINGS_REASON,
    );
  });

  it("words autopilot's conflict pause over the evaluation's continuable reasons (#2013)", () => {
    expect(plainStopReason("blocked-findings", { stopReason: "autopilot-conflict" })).toBe(
      AUTOPILOT_CONFLICT_REASON,
    );
    expect(plainStopReason("stable-convergence", { stopReason: "autopilot-conflict" })).toBe(
      AUTOPILOT_CONFLICT_REASON,
    );
  });

  it("falls back to the evaluation's limit reasons when the decision carries none", () => {
    expect(plainStopReason("max-rounds")).toBe(ROUND_LIMIT_REASON);
    expect(plainStopReason("stable-convergence", {})).toBe(STABLE_SCORES_REASON);
    expect(plainStopReason("blocked-findings", null)).toBeNull();
    expect(plainStopReason("ready")).toBeNull();
    expect(plainStopReason("continue", { stopReason: "continue" })).toBeNull();
  });
});
