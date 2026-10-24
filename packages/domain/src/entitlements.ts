/**
 * Entitlements: the capability set a hosted plan grants (ADR 0011, D13).
 *
 * Plans are data. Services read an `Entitlements` value and never a plan
 * name, so a plan can change without a code change. This module is pure and
 * framework free; the plan catalog and the Zod schemas live in
 * `@draft-loop/schemas/entitlements`.
 */

import type { ModelProfileTier } from "./model-profile.js";
import { modelProfileTiers } from "./model-profile.js";

/** Features a plan can switch on. All are off unless a plan or an override enables them. */
export const entitlementFeatures = [
  "provenanceReport",
  "runComparison",
  "byok",
  "sso",
  "retentionControls",
] as const;

export type EntitlementFeature = (typeof entitlementFeatures)[number];

export type EntitlementFeatureFlags = Readonly<Record<EntitlementFeature, boolean>>;

/** A numeric limit; `null` means unlimited. */
export type EntitlementLimit = number | null;

export interface Entitlements {
  /** Credits granted for each credit period, or `null` for unlimited credits. */
  readonly creditsPerPeriod: EntitlementLimit;
  /** Length of the credit period in calendar months: 1 for a monthly plan, 3 for the job-search pass. */
  readonly creditPeriodMonths: number;
  /** Model tiers a run may use. */
  readonly modelTiers: readonly ModelProfileTier[];
  readonly seats: EntitlementLimit;
  readonly candidateRecords: EntitlementLimit;
  /** Runs an organisation may start per UTC day. */
  readonly runsPerDay: EntitlementLimit;
  /** Runs an organisation may have in flight at once. */
  readonly concurrentRuns: EntitlementLimit;
  readonly features: EntitlementFeatureFlags;
}

/** Every model tier, for plans that allow all of them. */
export const allEntitlementModelTiers: readonly ModelProfileTier[] = Object.freeze([
  ...modelProfileTiers,
]);

/** Whether the entitlements let a run use a model of this tier. */
export function allowsModelTier(entitlements: Entitlements, tier: ModelProfileTier): boolean {
  return entitlements.modelTiers.includes(tier);
}

/** Whether a feature is switched on. */
export function hasEntitlementFeature(
  entitlements: Entitlements,
  feature: EntitlementFeature,
): boolean {
  return entitlements.features[feature] === true;
}

/** Whether a count stays within a limit; `null` is unlimited. Pass the count after the change. */
export function limitAllows(limit: EntitlementLimit, count: number): boolean {
  return limit === null || count <= limit;
}

/** Whether one more item fits when `current` already exist; `null` is unlimited. */
export function limitHasRoom(limit: EntitlementLimit, current: number): boolean {
  return limitAllows(limit, current + 1);
}
