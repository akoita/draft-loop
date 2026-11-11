import { entitlementFeatures } from "@draft-loop/domain/entitlements";
import { describe, expect, it } from "vitest";
import {
  entitlementOverridesSchema,
  entitlementsSchema,
  planCatalog,
  planCatalogSchema,
  planCatalogVersion,
  planIdSchema,
  planIds,
  resolveEntitlements,
} from "./entitlements.js";

describe("plan catalog", () => {
  it("parses and covers every plan id at the current version", () => {
    expect(planCatalogSchema.safeParse(planCatalog).success).toBe(true);
    expect(planCatalog.version).toBe(planCatalogVersion);
    expect(planCatalogVersion).toBe(2);
    expect(Object.keys(planCatalog.plans).sort()).toEqual([...planIds].sort());
    for (const plan of Object.values(planCatalog.plans)) {
      expect(entitlementsSchema.safeParse(plan.entitlements).success).toBe(true);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(planCatalog.plans.pro.entitlements.features)).toBe(true);
  });

  it("rejects an unknown version, a missing plan and extra keys", () => {
    expect(planCatalogSchema.safeParse({ ...planCatalog, version: 1 }).success).toBe(false);
    const { pro: _pro, ...withoutPro } = planCatalog.plans;
    expect(planCatalogSchema.safeParse({ ...planCatalog, plans: withoutPro }).success).toBe(false);
    expect(planCatalogSchema.safeParse({ ...planCatalog, extra: true }).success).toBe(false);
  });

  it("gives Free one welcome application on the standard pair and 20 light calls a day", () => {
    expect(resolveEntitlements("free")).toEqual({
      creditsPerPeriod: 1,
      creditPeriodMonths: 36,
      modelTiers: ["standard", "economy"],
      seats: 1,
      candidateRecords: 1,
      runsPerDay: 2,
      concurrentRuns: 1,
      modelCallsPerDay: 20,
      features: {
        provenanceReport: false,
        runComparison: false,
        byok: false,
        sso: false,
        retentionControls: false,
      },
    });
  });

  it("sells credit packs of 1 for €5 and 5 for €22, valid 12 months", () => {
    expect(planCatalog.creditPacks).toEqual([
      { id: "pack-1", label: "1 application", credits: 1, priceEurCents: 500, validMonths: 12 },
      { id: "pack-5", label: "5 applications", credits: 5, priceEurCents: 2200, validMonths: 12 },
    ]);
    const [first] = planCatalog.creditPacks;
    expect(
      planCatalogSchema.safeParse({ ...planCatalog, creditPacks: [first, first] }).success,
    ).toBe(false);
  });

  it("holds the D13 working defaults", () => {
    const resolve = (id: string, seats?: number) =>
      resolveEntitlements(id, {}, seats === undefined ? {} : { seats });
    expect(resolve("beta")).toMatchObject({
      creditsPerPeriod: 3,
      creditPeriodMonths: 3,
      modelTiers: ["economy"],
      seats: 1,
      candidateRecords: 1,
      runsPerDay: 2,
      concurrentRuns: 1,
    });
    expect(resolve("individual")).toMatchObject({
      creditsPerPeriod: 5,
      creditPeriodMonths: 1,
      modelTiers: ["economy"],
      seats: 1,
      candidateRecords: 1,
    });
    expect(resolve("job-search-pass")).toMatchObject({
      creditsPerPeriod: 12,
      creditPeriodMonths: 3,
      modelTiers: ["economy"],
      seats: 1,
      candidateRecords: 1,
    });
    expect(resolve("pro")).toMatchObject({
      creditsPerPeriod: 8,
      creditPeriodMonths: 1,
      modelTiers: ["premium", "standard", "economy"],
      seats: 1,
      candidateRecords: 3,
    });
    expect(resolve("team", 2).modelTiers).toEqual(["premium", "standard", "economy"]);
    expect(resolve("business").creditsPerPeriod).toBe(0);
    expect(resolve("internal")).toMatchObject({
      creditsPerPeriod: null,
      seats: null,
      candidateRecords: null,
      runsPerDay: null,
      concurrentRuns: null,
    });
    expect(resolve("internal").modelTiers).toEqual(["premium", "standard", "economy"]);
  });

  it("switches on only provenance report and run comparison, from Pro upwards", () => {
    const on: string[] = [];
    for (const id of planIds) {
      const entitlements = resolveEntitlements(id, {}, { seats: 2 });
      for (const feature of entitlementFeatures) {
        if (entitlements.features[feature]) on.push(`${id}:${feature}`);
      }
    }
    expect(on.sort()).toEqual(
      ["pro", "team", "business", "internal"]
        .flatMap((id) => [`${id}:provenanceReport`, `${id}:runComparison`])
        .sort(),
    );
  });

  it("caps every plan except internal on runs per day and concurrency", () => {
    for (const id of planIds) {
      const entitlements = resolveEntitlements(id, {}, { seats: 1 });
      if (id === "internal") continue;
      expect(entitlements.runsPerDay).not.toBeNull();
      expect(entitlements.concurrentRuns).not.toBeNull();
    }
  });
});

describe("plan ids", () => {
  it("refuses unknown ids", () => {
    expect(planIdSchema.safeParse("enterprise").success).toBe(false);
    expect(() => resolveEntitlements("enterprise")).toThrow("unknown plan id");
    expect(() => resolveEntitlements("PRO")).toThrow("unknown plan id");
    expect(() => resolveEntitlements("")).toThrow("unknown plan id");
  });
});

describe("team credits", () => {
  it("scale with seats and pool across them", () => {
    expect(resolveEntitlements("team", {}, { seats: 1 })).toMatchObject({
      creditsPerPeriod: 30,
      seats: 1,
    });
    expect(resolveEntitlements("team", {}, { seats: 5 })).toMatchObject({
      creditsPerPeriod: 150,
      seats: 5,
    });
  });

  it("need a valid seat count", () => {
    expect(() => resolveEntitlements("team")).toThrow("seats");
    expect(() => resolveEntitlements("team", {}, { seats: 0 })).toThrow("seats");
    expect(() => resolveEntitlements("team", {}, { seats: 1.5 })).toThrow("seats");
  });

  it("ignore the seat count on plans that are not seat-priced", () => {
    expect(resolveEntitlements("pro", {}, { seats: 9 })).toMatchObject({
      creditsPerPeriod: 8,
      seats: 1,
    });
  });

  it("treat a credit override as the pooled total", () => {
    expect(
      resolveEntitlements("team", { creditsPerPeriod: 100 }, { seats: 5 }).creditsPerPeriod,
    ).toBe(100);
  });
});

describe("overrides", () => {
  it("merge over the plan without widening what they do not name", () => {
    const base = resolveEntitlements("individual");
    const merged = resolveEntitlements("individual", { creditsPerPeriod: 10 });
    expect(merged).toEqual({ ...base, creditsPerPeriod: 10 });
    expect(merged.modelTiers).toEqual(["economy"]);
    expect(merged.seats).toBe(1);
    expect(merged.runsPerDay).toBe(base.runsPerDay);
  });

  it("merge feature flags one key at a time", () => {
    const merged = resolveEntitlements("pro", { features: { sso: true, runComparison: false } });
    expect(merged.features).toEqual({
      provenanceReport: true,
      runComparison: false,
      byok: false,
      sso: true,
      retentionControls: false,
    });
  });

  it("let a business organisation be configured entirely by overrides", () => {
    const merged = resolveEntitlements("business", {
      creditsPerPeriod: 500,
      seats: 40,
      candidateRecords: null,
      runsPerDay: 200,
      concurrentRuns: 10,
      features: { byok: true, sso: true, retentionControls: true },
    });
    expect(merged).toMatchObject({
      creditsPerPeriod: 500,
      seats: 40,
      candidateRecords: null,
      runsPerDay: 200,
      concurrentRuns: 10,
    });
    expect(merged.features).toMatchObject({ byok: true, sso: true, retentionControls: true });
  });

  it("let null mean unlimited and 0 mean none", () => {
    expect(resolveEntitlements("pro", { runsPerDay: null }).runsPerDay).toBeNull();
    expect(resolveEntitlements("pro", { concurrentRuns: 0 }).concurrentRuns).toBe(0);
  });

  it("can narrow tiers", () => {
    expect(resolveEntitlements("pro", { modelTiers: ["economy"] }).modelTiers).toEqual(["economy"]);
  });

  it("refuse unknown keys, bad values and unknown tiers without echoing them", () => {
    for (const bad of [
      { plan: "pro" },
      { creditsPerPeriod: -1 },
      { creditsPerPeriod: 1.5 },
      { seats: 0 },
      { modelTiers: [] },
      { modelTiers: ["economy", "economy"] },
      { modelTiers: ["ultra"] },
      { creditPeriodMonths: 0 },
      { features: { telepathy: true } },
      { features: { byok: "yes" } },
    ]) {
      expect(entitlementOverridesSchema.safeParse(bad).success).toBe(false);
      expect(() => resolveEntitlements("pro", bad)).toThrow("invalid entitlement overrides");
    }
  });

  it("do not mutate the catalog or share arrays with it", () => {
    const first = resolveEntitlements("pro", { features: { byok: true } });
    const second = resolveEntitlements("pro");
    expect(second.features.byok).toBe(false);
    expect(first.modelTiers).not.toBe(planCatalog.plans.pro.entitlements.modelTiers);
  });
});
