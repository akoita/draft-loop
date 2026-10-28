import type { ApplicationService } from "@draft-loop/application";
import type { RunCreditEstimateInput } from "@draft-loop/application/run-credit-estimate";
import { resolveEntitlements } from "@draft-loop/schemas/entitlements";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { creditUsage, creditWarningPercent } from "./credit-usage.js";
import { EntitlementRefusedError, type TenantEntitlementsFor } from "./entitlement-gate.js";
import { apiError, apiErrorSchema } from "./errors.js";
import { priceRun } from "./run-pricing.js";

/** The model tiers, as the credit estimate prices them. */
const modelTiers = [
  "premium",
  "standard",
  "economy",
] as const satisfies readonly RunCreditEstimateInput["authorTier"][];
const tierSchema = z.enum(modelTiers);

const memberCreditsSchema = z
  .object({
    organisationId: z.string(),
    planId: z.string(),
    entitlements: z
      .object({
        modelTiers: z.array(tierSchema).describe("The model tiers a run may use."),
        runsPerDay: z.number().int().nullable().describe("Runs per UTC day; null is unlimited."),
        concurrentRuns: z.number().int().nullable().describe("Runs in flight; null is unlimited."),
        seats: z
          .number()
          .int()
          .nullable()
          .describe("Members, invited and active; null is unlimited."),
        candidateRecords: z.number().int().nullable().describe("Records; null is unlimited."),
      })
      .describe("What a member needs of the plan; a null limit is unlimited."),
    periodStart: z
      .string()
      .nullable()
      .describe("The UTC date the credit period began, YYYY-MM-DD."),
    periodEnd: z.string().nullable().describe("The UTC date the period ends, exclusive."),
    unlimited: z.boolean().describe("An unlimited plan: nothing is refused for credits."),
    allowance: z.number().int().nullable().describe("The period's credits; null when unlimited."),
    used: z
      .number()
      .int()
      .describe(
        "Credits of the period's allowance that finished runs settled plus the part of `reserved` taken from it. Operator grants are not counted.",
      ),
    reserved: z
      .number()
      .int()
      .describe("Credits held by runs in flight, from the allowance and from grants."),
    grantsRemaining: z.number().int().describe("Credits left in operator grants."),
    remaining: z
      .number()
      .int()
      .nullable()
      .describe("What a new run can still draw on, allowance and grants; null when unlimited."),
    warning: z
      .boolean()
      .describe(`True once \`used\` is at least ${creditWarningPercent}% of \`allowance\`.`),
  })
  .meta({ id: "MemberCredits" });

const estimateQuery = z.strictObject({
  applicationId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier")
    .optional()
    .describe("Price a run on this application, whose own model pair applies."),
});

const estimateParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const runEstimateSchema = z
  .object({
    credits: z.number().int().describe("The most credits a run can need; reserved when it starts."),
    estimateVersion: z.number().int().describe("The version of the estimate rule."),
    basis: z.object({
      base: z.number().int(),
      premium: z.boolean(),
      highReasoning: z
        .boolean()
        .describe("Whether a role runs at a high, extra high or max reasoning level (rule v2)."),
      roundBlocks: z.number().int(),
    }),
    maxRounds: z.number().int().describe("The workspace's round limit the estimate assumes."),
    authorTier: tierSchema,
    criticTier: tierSchema,
    plan: z
      .object({
        allowed: z.boolean(),
        code: z
          .enum(["plan_required", "model_tier_not_in_plan"])
          .nullable()
          .describe("The refusal the run start would answer for the plan, else null."),
        role: z.enum(["author", "critic"]).optional(),
        tier: tierSchema.optional(),
      })
      .optional()
      .describe("Sign-in mode, for a member: whether the plan allows these tiers."),
    balance: z
      .object({
        unlimited: z.boolean(),
        remaining: z.number().int().nullable(),
        sufficient: z
          .boolean()
          .describe("Whether `remaining` covers `credits`; false answers 402 at run start."),
      })
      .optional()
      .describe("Sign-in mode, for a member."),
  })
  .meta({ id: "RunEstimate" });

export interface MemberCreditsRoutesOptions {
  readonly entitlementsFor: TenantEntitlementsFor;
  /** Sign-in mode. Owner-token mode has no organisation to hold a plan: the route answers 404. */
  readonly signIn: boolean;
  readonly now?: () => Date;
}

/**
 * A member reads the organisation's plan, limits and credits (ADR 0011, D13). Sign-in mode only:
 * in owner-token mode the route is documented but answers 404, like any route that is not served,
 * since its tenant has no organisation to hold a plan. Any role may read it.
 */
export function registerMemberCreditsRoute(
  parent: FastifyInstance,
  options: MemberCreditsRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const now = options.now ?? (() => new Date());

  app.get(
    "/v1/organisation/credits",
    {
      schema: {
        summary: "Read the organisation's plan, limits and credit balance",
        description: `Any signed-in member may read it. \`used\` counts the period's allowance that finished runs settled and the part of \`reserved\` taken from it, so a started run counts at once. \`warning\` is true once \`used\` is at least ${creditWarningPercent}% of \`allowance\`; it is never true on an unlimited plan or a zero allowance. An organisation with no plan answers 403 \`plan_required\`. Owner-token mode has no organisations: the route answers 404 there.`,
        response: { 200: memberCreditsSchema, 403: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      if (!options.signIn || caller?.kind !== "member") {
        return reply.code(404).send(apiError("not_found", "No such route."));
      }
      const tenant = options.entitlementsFor(caller.tenantId);
      const assignment = await tenant.assignment();
      if (assignment === undefined) {
        return reply
          .code(403)
          .send(
            apiError(
              "plan_required",
              "The organisation has no plan yet; the operator assigns one.",
            ),
          );
      }
      const entitlements = resolveEntitlements(assignment.planId, assignment.overrides, {
        seats: assignment.seats ?? undefined,
      });
      const balance = await tenant.ledger.balance(now());
      const { used, warning } = creditUsage(balance);
      return {
        organisationId: caller.tenantId,
        planId: assignment.planId,
        entitlements: {
          modelTiers: [...entitlements.modelTiers],
          runsPerDay: entitlements.runsPerDay,
          concurrentRuns: entitlements.concurrentRuns,
          seats: entitlements.seats,
          candidateRecords: entitlements.candidateRecords,
        },
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
        unlimited: balance.unlimited,
        allowance: balance.unlimited ? null : balance.allowance,
        used,
        reserved: balance.reserved,
        grantsRemaining: balance.grantsRemaining,
        remaining: balance.unlimited ? null : balance.remaining,
        warning,
      };
    },
  );
}

export interface RunEstimateRoutesOptions {
  readonly service: Pick<ApplicationService, "readWorkspace" | "getApplication">;
  readonly workspaceRoot: (workspaceId: string) => string;
  /** Sign-in mode only: adds the plan and balance fields for a member. */
  readonly entitlementsFor?: TenantEntitlementsFor;
  readonly now?: () => Date;
}

/**
 * The credits a run on the workspace's current settings would reserve, priced by the same
 * function as the run-start gate (`priceRun`). The estimate is pure, so it is served in both
 * authentication modes; only a signed-in member also gets the plan and balance fields.
 */
export function registerRunEstimateRoute(
  parent: FastifyInstance,
  options: RunEstimateRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, entitlementsFor } = options;
  const now = options.now ?? (() => new Date());

  app.get(
    "/v1/workspaces/:workspaceId/runs/estimate",
    {
      schema: {
        summary: "Estimate the credits a run on the workspace's settings would reserve",
        description:
          "Prices the workspace as it is now, the way starting a run does: the application's own model pair when `applicationId` names one with a pair, otherwise the workspace's configured models, at its round limit. Refuses nothing. In sign-in mode a member also gets `plan` (whether the plan allows the tiers, with the code and the role and tier the run start would refuse with) and `balance` (whether `remaining` covers the estimate). A model whose tier cannot be determined cannot be priced and answers 422 `model_tier_unknown`.",
        params: estimateParams,
        querystring: estimateQuery,
        response: { 200: runEstimateSchema, 404: apiErrorSchema, 422: apiErrorSchema },
      },
    },
    async (request) => {
      const root = workspaceRoot(request.params.workspaceId);
      const workspace = await service.readWorkspace(root);
      const pricing = await priceRun(service, {
        root,
        workspace,
        applicationId: request.query.applicationId,
      });
      if (pricing.status === "tier_unknown") {
        throw new EntitlementRefusedError({ code: "model_tier_unknown", role: pricing.role });
      }
      const { estimate, authorTier, criticTier } = pricing;
      const view = {
        credits: estimate.credits,
        estimateVersion: estimate.version,
        basis: estimate.basis,
        maxRounds: workspace.maxRounds,
        authorTier,
        criticTier,
      };
      const { caller } = request;
      if (caller?.kind !== "member" || entitlementsFor === undefined) return view;

      const tenant = entitlementsFor(caller.tenantId);
      const entitlements = await tenant.entitlements();
      if (entitlements === undefined) {
        return { ...view, plan: { allowed: false, code: "plan_required" as const } };
      }
      const balance = await tenant.ledger.balance(now());
      const refused = (
        [
          ["author", authorTier],
          ["critic", criticTier],
        ] as const
      ).find(([, tier]) => !entitlements.modelTiers.includes(tier));
      return {
        ...view,
        plan:
          refused === undefined
            ? { allowed: true, code: null }
            : {
                allowed: false,
                code: "model_tier_not_in_plan" as const,
                role: refused[0],
                tier: refused[1],
              },
        balance: {
          unlimited: balance.unlimited,
          remaining: balance.unlimited ? null : balance.remaining,
          sufficient: balance.unlimited || balance.remaining >= estimate.credits,
        },
      };
    },
  );
}
