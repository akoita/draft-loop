import type { CreditBalance } from "@draft-loop/storage-postgres";
import { describe, expect, it } from "vitest";

import { creditCrossings, creditUsage } from "./credit-usage.js";

function balance(allowance: number, used: number, overrides: Partial<CreditBalance> = {}) {
  return {
    periodStart: "2026-10-01",
    periodEnd: "2026-11-01",
    allowance,
    allowanceUsed: used,
    reserved: 0,
    grantsRemaining: 0,
    remaining: allowance - used,
    unlimited: false,
    ...overrides,
  } satisfies CreditBalance;
}

describe("the warning threshold", () => {
  it.each([
    // An allowance whose 80% is not a whole number warns at the next credit.
    [3, 2, false],
    [3, 3, true],
    [5, 3, false],
    [5, 4, true],
    [100, 79, false],
    [100, 80, true],
    [0, 0, false],
  ])("is %i credits with %i used: warning %s", (allowance, used, warning) => {
    expect(creditUsage(balance(allowance, used)).warning).toBe(warning);
  });

  it("crosses once, between the balance before and after", () => {
    expect(creditCrossings(balance(5, 3), balance(5, 4))).toEqual({
      warning: true,
      exhausted: false,
    });
    expect(creditCrossings(balance(5, 4), balance(5, 5))).toEqual({
      warning: false,
      exhausted: true,
    });
    expect(creditCrossings(balance(5, 5), balance(5, 5))).toEqual({
      warning: false,
      exhausted: false,
    });
  });
});
