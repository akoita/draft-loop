import { describe, expect, it } from "vitest";

import { supportsProtectedValueParaphrase } from "./protected-value-equivalence.js";

describe("bounded protected-value paraphrases", () => {
  it("accepts the frozen evidence-equivalent percent spelling", () => {
    expect(supportsProtectedValueParaphrase("Reduced processing time by 25 percent.", "25%")).toBe(
      true,
    );
  });

  it.each([
    ["Reduced processing time by 24 percent.", "25%"],
    ["Reduced processing time by 250 percent.", "25%"],
    ["Reduced processing time by 25 percentage points.", "25%"],
    ["Reduced processing time by 25 percent-point units.", "25%"],
    ["Reduced processing time by 25 percent.", "2025"],
    ["Staff Engineer at Example Systems.", "Senior Engineer"],
    ["Built TypeScript services.", "GraphQL"],
  ])("rejects changed or out-of-contract facts in %s", (evidence, protectedValue) => {
    expect(supportsProtectedValueParaphrase(evidence, protectedValue)).toBe(false);
  });
});
