import {
  readUsageFunnel,
  type UsageFunnelSource,
  usageFunnelSteps,
} from "@draft-loop/application/usage-funnel";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { writeAuditLine } from "./audit-line.js";
import { apiErrorSchema } from "./errors.js";

export interface UsageFunnelRoutesOptions {
  readonly source: UsageFunnelSource;
  readonly now?: () => Date;
}

const stepSchema = z.enum(usageFunnelSteps);
const stepCounts = z.object(
  Object.fromEntries(usageFunnelSteps.map((step) => [step, z.number().int()])) as Record<
    (typeof usageFunnelSteps)[number],
    z.ZodNumber
  >,
);

const funnelSchema = z
  .object({
    weeks: z.array(
      z.object({
        weekStart: z.string().describe("Monday of the week, YYYY-MM-DD, UTC."),
        signUps: z.number().int().describe("Members who first signed in that week."),
        firsts: stepCounts.describe("Organisations that reached each step for the first time."),
        activeOrganisations: z.number().int(),
      }),
    ),
    cohort: z
      .array(
        z.object({
          step: stepSchema,
          reached: z.number().int(),
          fromPrevious: z
            .number()
            .nullable()
            .describe("Share of the previous step's organisations, 0 to 1; null for the first."),
        }),
      )
      .describe("Organisations first signed in during the window, and how far each got."),
    organisations: z.number().int(),
  })
  .meta({ id: "UsageFunnel" });

/**
 * The operator's content-free usage funnel (#2834): counts of organisations reaching each step,
 * week by week, read from existing records. No organisation, member or text appears in it; every
 * number adds organisations up. Only the operator reaches `/v1/operator/*` (request-auth.ts).
 */
export function registerUsageFunnelRoutes(
  parent: FastifyInstance,
  options: UsageFunnelRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const now = options.now ?? (() => new Date());
  app.get(
    "/v1/operator/usage-funnel",
    {
      schema: {
        summary: "Read the usage funnel as the operator",
        description:
          "Operator only. For each of the last `weeks` weeks (Monday to Sunday, UTC, the current one last): members who first signed in, organisations that first added career evidence, reviewed a job brief, finished a draft, approved one, exported one and saved a Prepare item, and organisations active that week; then the window's sign-in cohort and its drop-off between steps. Counts only: no organisation is named or shown alone, and no candidate material is read.",
        querystring: z.strictObject({
          weeks: z.coerce.number().int().min(1).max(26).default(8),
        }),
        response: {
          200: funnelSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const funnel = await readUsageFunnel(options.source, {
        now: now(),
        weeks: request.query.weeks,
      });
      writeAuditLine(request, "usage_funnel_read", { weeks: request.query.weeks });
      return {
        weeks: funnel.weeks.map((week) => ({ ...week, firsts: { ...week.firsts } })),
        cohort: funnel.cohort.map((step) => ({ ...step })),
        organisations: funnel.organisations,
      };
    },
  );
}
