import { describe, expect, it } from "vitest";
import { runCostLabel } from "./run-cost.js";

describe("run cost label", () => {
  it("shows the total when every call was priced", () => {
    expect(runCostLabel({ totalCostUsd: 0.0421, unpricedCallCount: 0 })).toEqual({
      text: "$0.042",
    });
    expect(runCostLabel({ totalCostUsd: 0 })).toEqual({ text: "$0.000" });
  });

  it("never shows $0.000 for a run whose calls had no price", () => {
    expect(runCostLabel({ totalCostUsd: 0, unpricedCallCount: 6 })).toEqual({
      text: "Cost not recorded",
      explanation:
        "6 model calls have no recorded price, from a subscription session or a model without catalog rates.",
    });
  });

  it("marks a partly priced total as a lower bound", () => {
    expect(runCostLabel({ totalCostUsd: 0.0125, unpricedCallCount: 1 })).toEqual({
      text: "$0.013+",
      explanation:
        "1 model call has no recorded price, from a subscription session or a model without catalog rates. The total is a lower bound.",
    });
  });
});
