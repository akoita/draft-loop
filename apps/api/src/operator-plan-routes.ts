import {
  entitlementOverridesSchema,
  entitlementsSchema,
  planIds,
  resolveEntitlements,
} from "@draft-loop/schemas/entitlements";
import {
  type CreditBalance,
  type CreditLedger,
  CreditLedgerError,
  type OrganisationPlans,
  type PlanAssignment,
  PlanAssignmentError,
} from "@draft-loop/storage-postgres";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";

/** What the operator reaches in one organisation: its plan, its ledger and its idempotency keys. */
export interface OperatorTenant {
  readonly plans: Pick<OrganisationPlans, "assignPlan" | "currentPlanAssignment">;
  readonly ledger: Pick<CreditLedger, "balance" | "grant">;
  /** The organisation's own keys, so one organisation's key never replays another's grant. */
  readonly idempotency: IdempotencyStore;
}

/** One organisation's operator view, by organisation id; the organisation may not exist. */
export type OperatorTenantFor = (organisationId: string) => OperatorTenant;

export interface OperatorPlanRoutesOptions {
  readonly operatorFor: OperatorTenantFor;
  /** The clock for the assignment time, the default credit period start and the balance. */
  readonly now?: () => Date;
}

/** The most credits one grant adds; a larger grant is several grants, each with its own reason. */
export const maximumGrantCredits = 1_000_000;

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier.");

const organisationParams = z.strictObject({ organisationId: identifierSchema });

const idempotencyHeaders = z.object({
  "idempotency-key": z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,128}$/u, "must be 8 to 128 safe characters"),
});

const planBody = z.strictObject({
  planId: z
    .string()
    .max(64)
    .describe(`The plan's id in catalog v1: ${planIds.join(", ")}. Anything else answers 422.`),
  overrides: entitlementOverridesSchema
    .optional()
    .describe("Per-organisation entitlement overrides, merged over the plan."),
  seats: z
    .number()
    .int()
    .positive()
    .safe()
    .optional()
    .describe("Seats held; required for a seat-priced plan (team, business), ignored otherwise."),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected a UTC date, YYYY-MM-DD.")
    .optional()
    .describe("The UTC date the credit period starts; today's date when omitted."),
});

const grantBody = z.strictObject({
  credits: z
    .number()
    .int()
    .min(1)
    .max(maximumGrantCredits)
    .describe("Credits to add; they expire 12 months after the grant."),
  reason: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9._-]{0,63}$/u,
      "Expected a short code of a-z, 0-9, dot, underscore, hyphen.",
    )
    .describe(
      "A short content-free code such as `goodwill` or `support.2026-10`, never free text.",
    ),
});

const assignmentSchema = z
  .object({
    planId: z.string(),
    catalogVersion: z.number().int(),
    overrides: entitlementOverridesSchema,
    seats: z
      .number()
      .int()
      .nullable()
      .describe("Seats held, or null for a plan not priced by seat."),
    periodStart: z.string().describe("The UTC date the credit period starts, YYYY-MM-DD."),
    assignedAt: z.string(),
  })
  .meta({ id: "PlanAssignment" });

const balanceSchema = z
  .object({
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable().describe("Exclusive."),
    allowance: z.number().int(),
    allowanceUsed: z.number().int(),
    reserved: z.number().int(),
    grantsRemaining: z.number().int(),
    remaining: z.number().int(),
    unlimited: z.boolean(),
  })
  .meta({ id: "CreditBalance" });

const assignedPlanSchema = z
  .object({ assignment: assignmentSchema, entitlements: entitlementsSchema })
  .meta({ id: "AssignedPlan" });

const grantedCreditsSchema = z
  .object({
    grant: z.object({
      sequence: z.number().int(),
      credits: z.number().int(),
      reason: z.string(),
      expiresAt: z.string(),
    }),
    balance: balanceSchema,
  })
  .meta({ id: "GrantedCredits" });

const organisationCreditsSchema = z
  .object({
    organisationId: z.string(),
    assignment: assignmentSchema.nullable().describe("Null while no plan is assigned."),
    entitlements: entitlementsSchema.nullable(),
    balance: balanceSchema,
  })
  .meta({ id: "OrganisationCredits" });

const errorResponses = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  422: apiErrorSchema,
};

const organisationNotFound = apiError("organisation_not_found", "No such organisation.");

function assignmentView(assignment: PlanAssignment) {
  return {
    planId: assignment.planId,
    catalogVersion: assignment.catalogVersion,
    overrides: assignment.overrides,
    seats: assignment.seats,
    periodStart: assignment.periodStart,
    assignedAt: assignment.assignedAt,
  };
}

function entitlementsOf(assignment: PlanAssignment) {
  return resolveEntitlements(assignment.planId, assignment.overrides, {
    seats: assignment.seats ?? undefined,
  });
}

function balanceView(balance: CreditBalance) {
  return {
    periodStart: balance.periodStart,
    periodEnd: balance.periodEnd,
    allowance: balance.allowance,
    allowanceUsed: balance.allowanceUsed,
    reserved: balance.reserved,
    grantsRemaining: balance.grantsRemaining,
    remaining: balance.remaining,
    unlimited: balance.unlimited,
  };
}

/**
 * Answers a store's refusal of the operator's input; anything else is not the operator's doing and
 * goes on to the error handler. The stores' messages are fixed and never quote the rejected values.
 */
async function refuse(reply: FastifyReply, error: unknown): Promise<FastifyReply> {
  if (error instanceof PlanAssignmentError || error instanceof CreditLedgerError) {
    if (error.code === "organisation_not_found") return reply.code(404).send(organisationNotFound);
    if (error.code === "invalid_plan_assignment" || error.code === "invalid_credit_request") {
      return reply.code(422).send(apiError(error.code, error.message));
    }
  }
  throw error;
}

/** Fails closed in place, as the organisation creation route does: only the owner token passes. */
async function requireOperator(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (request.caller?.kind === "owner") return true;
  await reply
    .code(403)
    .send(apiError("forbidden", "Only the operator assigns plans and grants credits."));
  return false;
}

/**
 * Until a payment provider lands, the operator assigns an organisation's plan and grants it
 * credits (ADR 0011, D13). Operator routes take only the deployment's owner token, in both
 * authentication modes. Each write logs one content-free `audit` line (ids, plan id, numbers and
 * the reason code): an organisation's plan belongs to no workspace, so it has no hash-chained
 * trail, as for membership changes.
 */
export function registerOperatorPlanRoutes(
  parent: FastifyInstance,
  options: OperatorPlanRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { operatorFor } = options;
  const now = options.now ?? (() => new Date());

  app.put(
    "/v1/operator/organisations/:organisationId/plan",
    {
      schema: {
        summary: "Assign an organisation's plan",
        description:
          "Operator only: takes the deployment's owner token in both authentication modes. Replaces the organisation's plan assignment and appends it to its history. An unknown plan id, a seat-priced plan without seats, an invalid date or entitlements the plan cannot resolve answer 422 `invalid_plan_assignment`; an unknown organisation answers 404 `organisation_not_found`. Answers the assignment and the entitlements it resolves to.",
        params: organisationParams,
        body: planBody,
        response: { 200: assignedPlanSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      if (!(await requireOperator(request, reply))) return reply;
      const { organisationId } = request.params;
      const { planId, overrides, seats, periodStart } = request.body;
      const at = now();
      let assignment: PlanAssignment;
      try {
        assignment = await operatorFor(organisationId).plans.assignPlan({
          planId: planId as PlanAssignment["planId"],
          ...(overrides === undefined ? {} : { overrides }),
          ...(seats === undefined ? {} : { seats }),
          periodStart: periodStart ?? at.toISOString().slice(0, 10),
          assignedAt: at.toISOString(),
        });
      } catch (error) {
        return refuse(reply, error);
      }
      request.log.info(
        {
          audit: {
            action: "organisation_plan_assigned",
            organisationId,
            planId: assignment.planId,
            seats: assignment.seats,
            periodStart: assignment.periodStart,
          },
        },
        "organisation plan assigned",
      );
      return { assignment: assignmentView(assignment), entitlements: entitlementsOf(assignment) };
    },
  );

  app.post(
    "/v1/operator/organisations/:organisationId/credit-grants",
    {
      schema: {
        summary: "Grant an organisation credits",
        description:
          "Operator only: takes the deployment's owner token in both authentication modes. Adds credits that expire 12 months later and are spent after the plan's allowance. The reason is a short code, never free text. A retry with the same Idempotency-Key answers the first grant and balance without granting again; a key reused with another request answers 409 `idempotency_conflict`. An unknown organisation answers 404 `organisation_not_found`.",
        params: organisationParams,
        headers: idempotencyHeaders,
        body: grantBody,
        response: { 201: grantedCreditsSchema, ...errorResponses, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!(await requireOperator(request, reply))) return reply;
      const { organisationId } = request.params;
      const { credits, reason } = request.body;
      const tenant = operatorFor(organisationId);
      try {
        const granted = await tenant.idempotency.once(
          `operator:credit-grants:${organisationId}`,
          request.headers["idempotency-key"],
          request.body,
          async () => {
            const at = now();
            const grant = await tenant.ledger.grant({ credits, reason, now: at });
            const balance = await tenant.ledger.balance(at);
            // Inside the replay cache, so a retry does not log the grant again.
            request.log.info(
              {
                audit: {
                  action: "credits_granted",
                  organisationId,
                  credits: grant.credits,
                  reason: grant.reason,
                  sequence: grant.sequence,
                },
              },
              "credits granted",
            );
            return { grant, balance: balanceView(balance) };
          },
        );
        return await reply.code(201).send(granted);
      } catch (error) {
        return refuse(reply, error);
      }
    },
  );

  app.get(
    "/v1/operator/organisations/:organisationId/credits",
    {
      schema: {
        summary: "Read an organisation's plan, entitlements and credit balance",
        description:
          "Operator only: takes the deployment's owner token in both authentication modes. The assignment and entitlements are null while no plan is assigned. An unknown organisation answers 404 `organisation_not_found`.",
        params: organisationParams,
        response: { 200: organisationCreditsSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      if (!(await requireOperator(request, reply))) return reply;
      const { organisationId } = request.params;
      const tenant = operatorFor(organisationId);
      try {
        const assignment = await tenant.plans.currentPlanAssignment();
        const balance = await tenant.ledger.balance(now());
        return {
          organisationId,
          assignment: assignment === undefined ? null : assignmentView(assignment),
          entitlements: assignment === undefined ? null : entitlementsOf(assignment),
          balance: balanceView(balance),
        };
      } catch (error) {
        return refuse(reply, error);
      }
    },
  );
}
