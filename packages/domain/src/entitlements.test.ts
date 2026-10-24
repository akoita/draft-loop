import { describe, expect, it } from "vitest";
import {
  allEntitlementModelTiers,
  allowsModelTier,
  type Entitlements,
  hasEntitlementFeature,
  limitAllows,
  limitHasRoom,
} from "./entitlements.js";

const economyPlan: Entitlements = {
  creditsPerPeriod: 4,
  creditPeriodMonths: 1,
  modelTiers: ["economy"],
  seats: 1,
  candidateRecords: 1,
  runsPerDay: 5,
  concurrentRuns: 1,
  features: {
    provenanceReport: false,
    runComparison: true,
    byok: false,
    sso: false,
    retentionControls: false,
  },
};

describe("entitlement helpers", () => {
  it("allows only the tiers a plan names", () => {
    expect(allowsModelTier(economyPlan, "economy")).toBe(true);
    expect(allowsModelTier(economyPlan, "standard")).toBe(false);
    expect(allowsModelTier(economyPlan, "premium")).toBe(false);
    expect(allEntitlementModelTiers).toEqual(["premium", "standard", "economy"]);
  });

  it("reads feature flags", () => {
    expect(hasEntitlementFeature(economyPlan, "runComparison")).toBe(true);
    expect(hasEntitlementFeature(economyPlan, "byok")).toBe(false);
  });

  it("treats null as unlimited and counts against finite limits", () => {
    expect(limitAllows(null, 1_000_000)).toBe(true);
    expect(limitAllows(3, 3)).toBe(true);
    expect(limitAllows(3, 4)).toBe(false);
    expect(limitHasRoom(1, 0)).toBe(true);
    expect(limitHasRoom(1, 1)).toBe(false);
    expect(limitHasRoom(0, 0)).toBe(false);
    expect(limitHasRoom(null, 50)).toBe(true);
  });
});
