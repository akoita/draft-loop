import type { FastifyRequest } from "fastify";

import { ApiConfigError } from "./config.js";
import type { TenantEntitlementsFor } from "./entitlement-gate.js";

/** The daily ceiling on job-ad reading for a plan whose model calls are unlimited. */
export const defaultBriefExtractionsPerDay = 50;

/** Whether this request's brief may be read by the model now; false leaves it for the person. */
export type BriefExtractionAllowance = (request: FastifyRequest) => Promise<boolean>;

export interface BriefExtractionAllowanceOptions {
  readonly entitlementsFor: TenantEntitlementsFor;
  /** The ceiling for unlimited plans; the operator lowers one organisation's with a plan override. */
  readonly unlimitedPlanPerDay?: number;
  readonly now?: () => Date;
}

/**
 * Counts each automatic reading of a job ad (the worker's brief extraction) as one model call
 * outside a run. A plan with a daily limit counts it there, against the same `modelCallsPerDay` as
 * Prepare and the interviewer; an unlimited plan counts it against a deployment ceiling instead.
 * Past either, the brief is saved without extraction and the person fills it in: a brief is never
 * refused, since a run needs one. The owner token and organisations with no plan are not counted.
 */
export function createBriefExtractionAllowance(
  options: BriefExtractionAllowanceOptions,
): BriefExtractionAllowance {
  const now = options.now ?? (() => new Date());
  const ceiling = options.unlimitedPlanPerDay ?? defaultBriefExtractionsPerDay;
  return async (request) => {
    const caller = request.caller;
    if (caller?.kind !== "member") return true;
    const tenant = options.entitlementsFor(caller.tenantId);
    if (tenant.modelCalls === undefined) return true;
    const entitlements = await tenant.entitlements();
    if (entitlements === undefined) return true;
    const limit = entitlements.modelCallsPerDay ?? ceiling;
    const taken = await tenant.modelCalls.take({ limit, now: now() });
    if (taken.allowed) return true;
    // Ids and numbers only: never the job ad.
    request.log.warn(
      {
        event: "brief_extraction_limited",
        organisationId: caller.tenantId,
        memberId: caller.memberId,
        limit,
        plan: entitlements.modelCallsPerDay === null ? "unlimited" : "limited",
      },
      "brief extraction limit reached",
    );
    return false;
  };
}

/** Reads `DRAFT_LOOP_BRIEF_EXTRACTIONS_PER_DAY`; unset keeps the default ceiling. */
export function readBriefExtractionsPerDay(env: NodeJS.ProcessEnv): number | undefined {
  const value = env.DRAFT_LOOP_BRIEF_EXTRACTIONS_PER_DAY?.trim() ?? "";
  if (value === "") return undefined;
  if (!/^\d+$/u.test(value) || Number(value) < 1) {
    throw new ApiConfigError(
      "DRAFT_LOOP_BRIEF_EXTRACTIONS_PER_DAY must be a whole number of at least 1.",
    );
  }
  return Number(value);
}
