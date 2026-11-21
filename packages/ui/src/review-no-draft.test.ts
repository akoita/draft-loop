import { describe, expect, it } from "vitest";

import { runEndedBeforeApproval } from "./application-run-order.js";
import { noDraftGuidance } from "./review-no-draft.js";

describe("the review without a draft", () => {
  it.each([
    ["stopped", "ended", "Next: start a new review from Run details"],
    ["budget-exhausted", "ended", "Next: start a new review from Run details"],
    ["paused", "paused", "Next: resume the review"],
    ["collecting", "retry", "Next: resume or start a review to get a draft"],
  ] as const)("reads a %s run as %s", (runState, kind, next) => {
    const guidance = noDraftGuidance(runState);
    expect(guidance.kind).toBe(kind);
    expect(guidance.next).toBe(next);
    // The banner names the same way on as the Next line.
    if (kind === "ended") expect(guidance.detail).toContain("Start a new review from Run details");
    if (kind === "paused") expect(guidance.detail).toContain("Resume the review");
  });

  it("treats exactly the runs Home calls ended as ended", () => {
    for (const state of ["stopped", "budget-exhausted", "paused", "reviewing", "approved"]) {
      expect(noDraftGuidance(state).kind === "ended").toBe(runEndedBeforeApproval(state));
    }
  });
});
