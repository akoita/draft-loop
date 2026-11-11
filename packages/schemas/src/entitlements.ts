/**
 * Plans as data (ADR 0011, D13): the Zod schemas for entitlements, the
 * per-organisation overrides, the versioned plan catalog, and the pure
 * `resolveEntitlements`. Services read the resolved `Entitlements`, never a
 * plan name.
 *
 * The numbers in `planCatalog` are working defaults from D13 and the daily
 * and concurrency caps below are conservative starting values. Change them
 * here, as data, and bump the catalog version when the catalog's shape changes.
 * A plan assignment stored under an earlier version still resolves: versions
 * only ever add plans and fields.
 */

import type {
  EntitlementFeature,
  EntitlementFeatureFlags,
  EntitlementLimit,
  Entitlements,
} from "@draft-loop/domain/entitlements";
import { allEntitlementModelTiers, entitlementFeatures } from "@draft-loop/domain/entitlements";
import { modelProfileTiers } from "@draft-loop/domain/model-profile";
import { z } from "zod";

export const planIds = [
  "free",
  "beta",
  "individual",
  "job-search-pass",
  "pro",
  "team",
  "business",
  "internal",
] as const;

export type PlanId = (typeof planIds)[number];

export const planIdSchema = z.enum(planIds);

export const maximumCreditPeriodMonths = 36;

const limitSchema = z.number().int().nonnegative().safe().nullable();
const seatLimitSchema = z.number().int().positive().safe().nullable();

const featureFlagsSchema: z.ZodType<EntitlementFeatureFlags> = z.strictObject({
  provenanceReport: z.boolean(),
  runComparison: z.boolean(),
  byok: z.boolean(),
  sso: z.boolean(),
  retentionControls: z.boolean(),
});

const modelTiersSchema = z
  .array(z.enum(modelProfileTiers))
  .min(1)
  .refine((tiers) => new Set(tiers).size === tiers.length, "model tiers must be unique");

const creditPeriodMonthsSchema = z.number().int().positive().max(maximumCreditPeriodMonths);

export const entitlementsSchema: z.ZodType<Entitlements> = z.strictObject({
  creditsPerPeriod: limitSchema,
  creditPeriodMonths: creditPeriodMonthsSchema,
  modelTiers: modelTiersSchema,
  seats: seatLimitSchema,
  candidateRecords: limitSchema,
  runsPerDay: limitSchema,
  concurrentRuns: limitSchema,
  modelCallsPerDay: limitSchema,
  features: featureFlagsSchema,
});

/**
 * Per-organisation overrides: every field optional, strict, and merged over
 * the plan. A field an override does not name keeps the plan's value, so an
 * override can never widen anything by omission.
 */
export const entitlementOverridesSchema = z.strictObject({
  creditsPerPeriod: limitSchema.optional(),
  creditPeriodMonths: creditPeriodMonthsSchema.optional(),
  modelTiers: modelTiersSchema.optional(),
  seats: seatLimitSchema.optional(),
  candidateRecords: limitSchema.optional(),
  runsPerDay: limitSchema.optional(),
  concurrentRuns: limitSchema.optional(),
  modelCallsPerDay: limitSchema.optional(),
  features: z
    .strictObject({
      provenanceReport: z.boolean().optional(),
      runComparison: z.boolean().optional(),
      byok: z.boolean().optional(),
      sso: z.boolean().optional(),
      retentionControls: z.boolean().optional(),
    })
    .optional(),
});

export type EntitlementOverrides = z.infer<typeof entitlementOverridesSchema>;

/**
 * A plan in the catalog. `seatPriced` plans sell credits per seat: the
 * template's `creditsPerPeriod` is the amount for one seat, and resolution
 * multiplies it by the seats the organisation holds. The template's `seats`
 * is then replaced by that purchased count.
 */
export const planDefinitionSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  seatPriced: z.boolean(),
  entitlements: entitlementsSchema,
});

export type PlanDefinition = z.infer<typeof planDefinitionSchema>;

export const creditPackIds = ["pack-1", "pack-5"] as const;

export type CreditPackId = (typeof creditPackIds)[number];

/**
 * A prepaid pack of credits bought once, with no subscription (D13). The price is in euro cents;
 * the credits expire `validMonths` after the purchase.
 */
export const creditPackSchema = z.strictObject({
  id: z.enum(creditPackIds),
  label: z.string().trim().min(1).max(80),
  credits: z.number().int().positive().safe(),
  priceEurCents: z.number().int().positive().safe(),
  validMonths: creditPeriodMonthsSchema,
});

export type CreditPack = z.infer<typeof creditPackSchema>;

/** The catalog version new plan assignments are stored under. */
export const planCatalogVersion = 2;

export const planCatalogSchema = z.strictObject({
  version: z.literal(planCatalogVersion),
  plans: z.strictObject({
    free: planDefinitionSchema,
    beta: planDefinitionSchema,
    individual: planDefinitionSchema,
    "job-search-pass": planDefinitionSchema,
    pro: planDefinitionSchema,
    team: planDefinitionSchema,
    business: planDefinitionSchema,
    internal: planDefinitionSchema,
  }),
  creditPacks: z
    .array(creditPackSchema)
    .refine(
      (packs) => new Set(packs.map(({ id }) => id)).size === packs.length,
      "credit pack ids must be unique",
    ),
});

export type PlanCatalog = z.infer<typeof planCatalogSchema>;

const noFeatures: EntitlementFeatureFlags = {
  provenanceReport: false,
  runComparison: false,
  byok: false,
  sso: false,
  retentionControls: false,
};

/** The professional features of D13 that Pro and every plan above it include. */
const professionalFeatures: EntitlementFeatureFlags = {
  ...noFeatures,
  provenanceReport: true,
  runComparison: true,
};

const economyOnly = ["economy"] as const;
const standardAndEconomy = ["standard", "economy"] as const;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Plan catalog v2: D13 working defaults. Business starts with no credits until overrides set them.
 *
 * Free (#2677) is the first step of the pricing ladder: one welcome application on the standard
 * pair and 20 model calls a day outside runs, with no card. Its single credit is the allowance of
 * the longest period the catalog allows, so it does not come back each month.
 *
 * Beta is the free plan of the invite-only public test (#2456): three economy runs over three
 * months, two a day, one at a time, with no payment and no professional features. Its 20 model
 * calls a day outside runs (#2487) cover a short interview or a few drafts; paid plans have no cap.
 *
 * Credit packs let a person pay per application with no subscription.
 */
export const planCatalog: PlanCatalog = deepFreeze(
  planCatalogSchema.parse({
    version: planCatalogVersion,
    creditPacks: [
      { id: "pack-1", label: "1 application", credits: 1, priceEurCents: 500, validMonths: 12 },
      { id: "pack-5", label: "5 applications", credits: 5, priceEurCents: 2200, validMonths: 12 },
    ],
    plans: {
      free: {
        label: "Free",
        seatPriced: false,
        entitlements: {
          creditsPerPeriod: 1,
          creditPeriodMonths: maximumCreditPeriodMonths,
          modelTiers: standardAndEconomy,
          seats: 1,
          candidateRecords: 1,
          runsPerDay: 2,
          concurrentRuns: 1,
          modelCallsPerDay: 20,
          features: noFeatures,
        },
      },
      beta: {
        label: "Beta",
        seatPriced: false,
        entitlements: {
          creditsPerPeriod: 3,
          creditPeriodMonths: 3,
          modelTiers: economyOnly,
          seats: 1,
          candidateRecords: 1,
          runsPerDay: 2,
          concurrentRuns: 1,
          modelCallsPerDay: 20,
          features: noFeatures,
        },
      },
      individual: {
        label: "Individual",
        seatPriced: false,
        entitlements: {
          creditsPerPeriod: 5,
          creditPeriodMonths: 1,
          modelTiers: economyOnly,
          seats: 1,
          candidateRecords: 1,
          runsPerDay: 5,
          concurrentRuns: 1,
          modelCallsPerDay: null,
          features: noFeatures,
        },
      },
      "job-search-pass": {
        label: "Job-search pass",
        seatPriced: false,
        entitlements: {
          creditsPerPeriod: 12,
          creditPeriodMonths: 3,
          modelTiers: economyOnly,
          seats: 1,
          candidateRecords: 1,
          runsPerDay: 5,
          concurrentRuns: 1,
          modelCallsPerDay: null,
          features: noFeatures,
        },
      },
      pro: {
        label: "Pro",
        seatPriced: false,
        entitlements: {
          creditsPerPeriod: 8,
          creditPeriodMonths: 1,
          modelTiers: allEntitlementModelTiers,
          seats: 1,
          candidateRecords: 3,
          runsPerDay: 10,
          concurrentRuns: 2,
          modelCallsPerDay: null,
          features: professionalFeatures,
        },
      },
      team: {
        label: "Team",
        seatPriced: true,
        entitlements: {
          creditsPerPeriod: 30,
          creditPeriodMonths: 1,
          modelTiers: allEntitlementModelTiers,
          seats: null,
          candidateRecords: 25,
          runsPerDay: 50,
          concurrentRuns: 5,
          modelCallsPerDay: null,
          features: professionalFeatures,
        },
      },
      business: {
        label: "Business",
        seatPriced: false,
        entitlements: {
          creditsPerPeriod: 0,
          creditPeriodMonths: 1,
          modelTiers: allEntitlementModelTiers,
          seats: 1,
          candidateRecords: 1,
          runsPerDay: 5,
          concurrentRuns: 1,
          modelCallsPerDay: null,
          features: professionalFeatures,
        },
      },
      internal: {
        label: "Internal",
        seatPriced: false,
        entitlements: {
          creditsPerPeriod: null,
          creditPeriodMonths: 1,
          modelTiers: allEntitlementModelTiers,
          seats: null,
          candidateRecords: null,
          runsPerDay: null,
          concurrentRuns: null,
          modelCallsPerDay: null,
          features: professionalFeatures,
        },
      },
    },
  }),
);

export interface ResolveEntitlementsOptions {
  /** Seats the organisation holds. Required for seat-priced plans, ignored otherwise. */
  readonly seats?: number | undefined;
  readonly catalog?: PlanCatalog | undefined;
}

function mergeFeatures(
  base: EntitlementFeatureFlags,
  overrides: EntitlementOverrides["features"],
): EntitlementFeatureFlags {
  const merged: Record<EntitlementFeature, boolean> = { ...base };
  for (const feature of entitlementFeatures) {
    const value = overrides?.[feature];
    if (value !== undefined) merged[feature] = value;
  }
  return merged;
}

function seatsFor(options: ResolveEntitlementsOptions): number {
  const parsed = z.number().int().positive().safe().safeParse(options.seats);
  if (!parsed.success) throw new Error("seat-priced plan needs a positive whole number of seats");
  return parsed.data;
}

/**
 * Resolves the entitlements of a plan for one organisation: the plan from the
 * catalog, scaled by seats for seat-priced plans, then the organisation's
 * overrides. Override values are final for the organisation, so an override of
 * `creditsPerPeriod` on a seat-priced plan is the pooled total, not a per-seat
 * amount. Throws on an unknown plan id or invalid overrides; the message never
 * carries the rejected values.
 */
export function resolveEntitlements(
  planId: string,
  overrides: unknown = {},
  options: ResolveEntitlementsOptions = {},
): Entitlements {
  const id = planIdSchema.safeParse(planId);
  if (!id.success) throw new Error("unknown plan id");
  const parsedOverrides = entitlementOverridesSchema.safeParse(overrides);
  if (!parsedOverrides.success) throw new Error("invalid entitlement overrides");
  const override = parsedOverrides.data;
  const plan = (options.catalog ?? planCatalog).plans[id.data];
  const base = plan.entitlements;

  let creditsPerPeriod: EntitlementLimit = base.creditsPerPeriod;
  let seats: EntitlementLimit = base.seats;
  if (plan.seatPriced) {
    const held = seatsFor(options);
    seats = held;
    creditsPerPeriod = base.creditsPerPeriod === null ? null : base.creditsPerPeriod * held;
  }

  return deepFreeze({
    creditsPerPeriod:
      override.creditsPerPeriod !== undefined ? override.creditsPerPeriod : creditsPerPeriod,
    creditPeriodMonths: override.creditPeriodMonths ?? base.creditPeriodMonths,
    modelTiers: [...(override.modelTiers ?? base.modelTiers)],
    seats: override.seats !== undefined ? override.seats : seats,
    candidateRecords:
      override.candidateRecords !== undefined ? override.candidateRecords : base.candidateRecords,
    runsPerDay: override.runsPerDay !== undefined ? override.runsPerDay : base.runsPerDay,
    concurrentRuns:
      override.concurrentRuns !== undefined ? override.concurrentRuns : base.concurrentRuns,
    modelCallsPerDay:
      override.modelCallsPerDay !== undefined ? override.modelCallsPerDay : base.modelCallsPerDay,
    features: mergeFeatures(base.features, override.features),
  });
}
