import {
  type ApplicationService,
  runUsage,
  summarizeUsage,
  type UsageLine,
  type UsageSummary,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface UsageRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The tenant's completed calls in a `YYYY-MM` month, grouped by company, model and route. */
  readonly monthUsage: (month: string) => Promise<readonly UsageLine[]>;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier.");
const runParams = z.strictObject({ workspaceId: identifierSchema, runId: identifierSchema });
const monthQuery = z.strictObject({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/u, "Expected a month as YYYY-MM.")
    .describe("The UTC month, as YYYY-MM; calls count in the month they completed in."),
});

const usageAmounts = {
  calls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  estimatedUsd: z.number().describe("The priced calls' estimated cost, in US dollars."),
  unpricedCalls: z
    .number()
    .int()
    .describe("Calls whose cost could not be estimated; they add nothing to estimatedUsd."),
};

const usageLineSchema = z
  .object({
    company: z.string(),
    model: z.string(),
    route: z.string().nullable().describe("Null for calls recorded before routes were."),
    ...usageAmounts,
  })
  .meta({ id: "UsageLine" });

const usageSchema = z
  .object({ ...usageAmounts, lines: z.array(usageLineSchema) })
  .describe("Content-free: ids, counts and amounts only.");

const runUsageSchema = usageSchema
  .extend({ runId: z.string(), workspaceId: z.string() })
  .meta({ id: "RunUsage" });
const monthUsageSchema = usageSchema.extend({ month: z.string() }).meta({ id: "MonthUsage" });

/** Copies only the schema's fields, so a storage row's extra columns never reach a response. */
const usageView = (summary: UsageSummary) => ({
  calls: summary.calls,
  inputTokens: summary.inputTokens,
  outputTokens: summary.outputTokens,
  estimatedUsd: summary.estimatedUsd,
  unpricedCalls: summary.unpricedCalls,
  lines: summary.lines.map((line) => ({
    company: line.company,
    model: line.model,
    route: line.route,
    calls: line.calls,
    inputTokens: line.inputTokens,
    outputTokens: line.outputTokens,
    estimatedUsd: line.estimatedUsd,
    unpricedCalls: line.unpricedCalls,
  })),
});

/** What hosted runs used and cost, per run and per tenant month (ADR 0011, D5 metering). */
export function registerUsageRoutes(parent: FastifyInstance, options: UsageRoutesOptions): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, monthUsage } = options;

  app.get(
    "/v1/workspaces/:workspaceId/runs/:runId/usage",
    {
      schema: {
        summary: "Read what a run used and cost, by company, model and route",
        params: runParams,
        response: { 200: runUsageSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, runId } = request.params;
      const snapshot = await service.status({ root: workspaceRoot(workspaceId), runId });
      if (snapshot === undefined) {
        return reply.code(404).send(apiError("not_found", "No such run."));
      }
      return { runId, workspaceId, ...usageView(runUsage(snapshot)) };
    },
  );

  app.get(
    "/v1/usage",
    {
      schema: {
        summary: "Read the tenant's usage and estimated cost for a month",
        querystring: monthQuery,
        response: { 200: monthUsageSchema, 400: apiErrorSchema },
      },
    },
    async (request) => {
      const { month } = request.query;
      return { month, ...usageView(summarizeUsage(await monthUsage(month))) };
    },
  );
}
