import { describe, expect, it } from "vitest";

import { startReviewBlockedTooltip, startReviewBlockers } from "./start-review-blockers.js";

const ready = {
  setupReady: true,
  nextSteps: [],
  transmissionReady: true,
  startDisabledReason: null,
} as const;

describe("startReviewBlockers", () => {
  it("is empty when nothing blocks the review", () => {
    expect(startReviewBlockers(ready)).toEqual([]);
    expect(startReviewBlockedTooltip([])).toBeUndefined();
  });

  it("lists the setup next steps, transmission, and profile reasons together", () => {
    const blockers = startReviewBlockers({
      setupReady: false,
      nextSteps: ["Add a target job description.", "Add at least one candidate evidence source."],
      transmissionReady: false,
      startDisabledReason: "Select an exact reviewed candidate profile before starting a review.",
    });

    expect(blockers).toEqual([
      "Add a target job description.",
      "Add at least one candidate evidence source.",
      "Acknowledge provider transmission above.",
      "Select an exact reviewed candidate profile before starting a review.",
    ]);
    expect(startReviewBlockedTooltip(blockers)).toBe(
      "Can't start yet: Add a target job description. Add at least one candidate evidence source. Acknowledge provider transmission above. Select an exact reviewed candidate profile before starting a review.",
    );
  });

  it("never leaves an unready setup without a stated reason", () => {
    expect(startReviewBlockers({ ...ready, setupReady: false })).toEqual([
      "Finish the workspace setup above.",
    ]);
  });
});
