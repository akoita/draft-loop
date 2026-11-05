import { describe, expect, it } from "vitest";

import { keepWithinFindingLimit, truncateFindingMessage } from "./critique-repair.js";

describe("critique repair (#2234)", () => {
  it("leaves a message within the limit unchanged", () => {
    expect(truncateFindingMessage("short message", 20)).toBe("short message");
  });

  it("cuts at a word boundary, or hard when the only space is too early", () => {
    expect(truncateFindingMessage("alpha beta gamma delta", 15)).toBe("alpha beta…");
    expect(truncateFindingMessage("a bcdefghijklmnopqrstuvwxyz", 10)).toBe("a bcdefgh…");
    expect(truncateFindingMessage("alpha beta gamma delta", 15).length).toBeLessThanOrEqual(15);
  });

  it("keeps errors before warnings, each in order, up to the limit", () => {
    const findings = [
      { id: "w1", severity: "warning" },
      { id: "e1", severity: "error" },
      { id: "w2", severity: "warning" },
      { id: "e2", severity: "error" },
    ];
    expect(keepWithinFindingLimit(findings, 3).map(({ id }) => id)).toEqual(["e1", "e2", "w1"]);
    expect(keepWithinFindingLimit(findings, 4)).toEqual(findings);
  });
});
