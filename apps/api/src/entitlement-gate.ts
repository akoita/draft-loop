import { randomUUID } from "node:crypto";
import type {
  ApplicationService,
  ModelProfileReferences,
  WorkspaceDescriptor,
} from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { CreditLedger, OrganisationPlans } from "@draft-loop/storage-postgres";
import type { FastifyBaseLogger } from "fastify";

import { logCreditCrossings } from "./credit-usage.js";
import { priceRun } from "./run-pricing.js";

/**
 * What the run-start gate reaches in one organisation: the entitlements of its current plan and
 * its credit ledger. `undefined` entitlements mean the organisation has no plan yet.
 */
export interface TenantEntitlements {
  readonly entitlements: OrganisationPlans["currentEntitlements"];
  /** The plan assignment, whose plan id a member's credit view names. */
  readonly assignment: OrganisationPlans["currentPlanAssignment"];
  readonly ledger: Pick<CreditLedger, "reserve" | "refund" | "balance">;
}

/** One organisation's entitlements and ledger, by organisation id. */
export type TenantEntitlementsFor = (tenantId: string) => TenantEntitlements;

/** Why the gate refused a run. Each carries only codes, a role, a tier and numbers. */
export type EntitlementRefusal =
  | { readonly code: "plan_required" }
  | { readonly code: "model_tier_unknown"; readonly role: "author" | "critic" }
  | {
      readonly code: "model_tier_not_in_plan";
      readonly role: "author" | "critic";
      readonly tier: string;
    }
  | {
      readonly code: "run_cap_reached";
      readonly cap: "concurrent" | "per_day";
      readonly limit: number;
    }
  | {
      readonly code: "credits_insufficient";
      readonly estimate: number;
      readonly remaining: number;
    }
  | {
      readonly code: "plan_limit_reached";
      readonly limit: "seats" | "candidateRecords";
      readonly value: number;
    };

/** The HTTP status each refusal answers with. */
export const entitlementRefusalStatus: Readonly<Record<EntitlementRefusal["code"], number>> = {
  plan_required: 403,
  model_tier_unknown: 422,
  model_tier_not_in_plan: 403,
  run_cap_reached: 429,
  credits_insufficient: 402,
  plan_limit_reached: 409,
};

/** A run start the organisation's plan or credit balance does not allow. */
export class EntitlementRefusedError extends Error {
  override readonly name = "EntitlementRefusedError";
  readonly refusal: EntitlementRefusal;

  constructor(refusal: EntitlementRefusal) {
    super(refusalMessage(refusal));
    this.refusal = refusal;
  }
}

function refusalMessage(refusal: EntitlementRefusal): string {
  switch (refusal.code) {
    case "plan_required":
      return "The organisation has no plan yet; the operator assigns one.";
    case "model_tier_unknown":
      return `The ${refusal.role} model's tier cannot be determined, so the run cannot be priced.`;
    case "model_tier_not_in_plan":
      return `The organisation's plan does not include the ${refusal.tier} tier for the ${refusal.role}.`;
    case "run_cap_reached":
      return refusal.cap === "concurrent"
        ? `The organisation already has ${refusal.limit} runs in flight, the most its plan allows.`
        : `The organisation has started ${refusal.limit} runs today, the most its plan allows per day.`;
    case "credits_insufficient":
      return `The run needs up to ${refusal.estimate} credits and the organisation has ${refusal.remaining} left.`;
    case "plan_limit_reached":
      return refusal.limit === "seats"
        ? `The organisation already has ${refusal.value} members, the most its plan allows.`
        : `The organisation already has ${refusal.value} candidate records, the most its plan allows.`;
  }
}

export interface RunStartRequest {
  /** The organisation the run belongs to: the signed-in member's. */
  readonly tenantId: string;
  /** The driver's reference for the workspace, as the route resolved it. */
  readonly root: string;
  readonly workspace: WorkspaceDescriptor;
  readonly applicationId?: string | undefined;
  /** The begin request's own model profile pair, if it named one. */
  readonly modelProfiles?: ModelProfileReferences | undefined;
}

export interface EntitlementGateOptions {
  readonly service: Pick<ApplicationService, "getApplication">;
  readonly entitlementsFor: TenantEntitlementsFor;
  readonly now?: () => Date;
}

export interface EntitlementGate {
  /**
   * Checks the plan and reserves the run's credits, then runs `begin` with the run id the
   * reservation is for. A refusal throws `EntitlementRefusedError` before `begin` runs. If
   * `begin` throws, the reservation is refunded and the error is rethrown.
   *
   * Reserve-before-begin is the order on purpose. Credits and the plan's run caps are checked
   * and taken in one locked ledger transaction, so concurrent starts cannot overspend. Reserving
   * after `begin` would leave a saved run behind every refusal, which a client could resume or
   * which clutters its history; reserving first means a refusal saves nothing, and the only
   * reservation without a saved run is one whose `begin` failed, which is refunded here. The id
   * is chosen here (the application's `begin` takes it as `runId`) so the reservation is for the
   * run that is saved. A process that dies between the reservation and the save leaves one open
   * reservation that nothing here releases; a reconciliation sweep of open reservations with no
   * saved run is the remedy, not part of this gate.
   */
  readonly begin: <Result extends Pick<RunSnapshot, "runId">>(
    request: RunStartRequest,
    log: FastifyBaseLogger,
    begin: (runId: string) => Promise<Result>,
  ) => Promise<Result>;
}

/** Same shape as the run ids the application service picks itself. */
function newRunId(): string {
  return `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * The sign-in mode gate on starting a run (ADR 0011, D13): the plan must allow the run's model
 * tiers and caps, and the organisation's credit balance must cover the run's estimate, which is
 * reserved for the run. Owner-token mode does not build this gate: the deployment's tenant has no
 * organisation row, which the plan assignment and the credit ledger both reference, so nothing
 * there is metered and nothing is refused, the same as the `internal` plan.
 */
export function createEntitlementGate(options: EntitlementGateOptions): EntitlementGate {
  const { service, entitlementsFor } = options;
  const now = options.now ?? (() => new Date());

  return {
    begin: async (request, log, begin) => {
      const tenant = entitlementsFor(request.tenantId);
      const entitlements = await tenant.entitlements();
      if (entitlements === undefined) throw new EntitlementRefusedError({ code: "plan_required" });

      const pricing = await priceRun(service, request);
      if (pricing.status === "tier_unknown") {
        throw new EntitlementRefusedError({ code: "model_tier_unknown", role: pricing.role });
      }
      for (const [role, tier] of [
        ["author", pricing.authorTier],
        ["critic", pricing.criticTier],
      ] as const) {
        if (!entitlements.modelTiers.includes(tier)) {
          throw new EntitlementRefusedError({ code: "model_tier_not_in_plan", role, tier });
        }
      }

      const { estimate } = pricing;
      const runId = newRunId();
      const reserved = await tenant.ledger.reserve({
        runId,
        credits: estimate.credits,
        estimateVersion: estimate.version,
        now: now(),
        caps: { maxConcurrent: entitlements.concurrentRuns, maxPerDay: entitlements.runsPerDay },
      });
      if (reserved.refused === "run_cap") {
        throw new EntitlementRefusedError({
          code: "run_cap_reached",
          cap: reserved.cap,
          limit: reserved.limit,
        });
      }
      if (reserved.refused === "insufficient") {
        throw new EntitlementRefusedError({
          code: "credits_insufficient",
          estimate: estimate.credits,
          remaining: reserved.balance.remaining,
        });
      }

      const result = await begin(runId).catch(async (error: unknown) => {
        // The run was never saved, so nothing may keep its credits or its concurrency slot.
        try {
          await tenant.ledger.refund({ runId, now: now() });
        } catch (refundError) {
          log.error(
            { runId, err: { type: (refundError as Error).name } },
            "credit refund failed after a run could not begin",
          );
        }
        throw error;
      });
      // Once the run is saved, so a reservation refunded for a failed begin alerts on nothing. The
      // ledger read both balances under its lock, so racing starts cross a threshold once.
      if (reserved.created) {
        logCreditCrossings(log, request.tenantId, reserved.balanceBefore, reserved.balanceAfter);
      }
      return result;
    },
  };
}
