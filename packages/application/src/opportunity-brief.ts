import type { OpportunityBrief } from "@draft-loop/schemas";
import { opportunityBriefSchema } from "@draft-loop/schemas";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T;
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneAndFreeze(item);
    }
    return Object.freeze(clone) as T;
  }
  return value;
}

/** Validate and freeze a provider-independent opportunity brief locally. */
export function buildOpportunityBrief(input: unknown): OpportunityBrief {
  return cloneAndFreeze(opportunityBriefSchema.parse(input));
}
