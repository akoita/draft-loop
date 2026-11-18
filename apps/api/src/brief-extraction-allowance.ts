import type { FastifyRequest } from "fastify";

import { ApiConfigError } from "./config.js";
import type { TenantEntitlementsFor } from "./entitlement-gate.js";

/** The daily ceiling on job-ad reading for a plan whose model calls are unlimited. */
export const defaultBriefExtractionsPerDay = 50;

export interface BriefExtractionAllowance {
  /** Takes one reading from the day's allowance; false leaves the brief for the person. */
  readonly take: (request: FastifyRequest) => Promise<boolean>;
  /** Whether the day's allowance is spent, without taking from it: why a brief stayed empty. */
  readonly spent: (request: FastifyRequest) => Promise<boolean>;
}

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
  /** The member's organisation, its meter and its limit; undefined when nothing is counted. */
  const counted = async (request: FastifyRequest) => {
    const caller = request.caller;
    if (caller?.kind !== "member") return undefined;
    const tenant = options.entitlementsFor(caller.tenantId);
    if (tenant.modelCalls === undefined) return undefined;
    const entitlements = await tenant.entitlements();
    if (entitlements === undefined) return undefined;
    const limit = entitlements.modelCallsPerDay ?? ceiling;
    return { caller, meter: tenant.modelCalls, entitlements, limit };
  };
  const spent: BriefExtractionAllowance["spent"] = async (request) => {
    const count = await counted(request);
    if (count?.meter.used === undefined) return false;
    return (await count.meter.used(now())) >= count.limit;
  };
  const take: BriefExtractionAllowance["take"] = async (request) => {
    const count = await counted(request);
    if (count === undefined) return true;
    const { caller, meter, entitlements, limit } = count;
    const taken = await meter.take({ limit, now: now() });
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
  return { take, spent };
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
