import type { FactUsageService, FactUsageSettings } from "@draft-loop/application/fact-usage";

import {
  factUsageChangeSchema,
  factUsageKeySchema,
  factUsageLevelSchema,
  factUsageSectionSchema,
} from "@draft-loop/schemas/fact-usage";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";

export interface FactUsageRoutesOptions {
  readonly factUsage: FactUsageService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier.");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });

const factUsageViewSchema = z
  .object({
    sections: z
      .partialRecord(factUsageSectionSchema, factUsageLevelSchema)
      .describe("Levels set on a whole section, by fact category."),
    facts: z
      .record(factUsageKeySchema, factUsageLevelSchema)
      .describe("Levels set on one fact, by its usage key. A fact's own level wins."),
  })
  .meta({ id: "FactUsage" });

const view = (settings: FactUsageSettings) => ({
  usage: { sections: { ...settings.sections }, facts: { ...settings.facts } },
});

/**
 * Where each career fact may be used (#2259): on a CV, only in interview, or never. It is apart
 * from the sensitivity tier, which decides what may reach a provider. An unset level reads as cv.
 */
export function registerFactUsageRoutes(
  parent: FastifyInstance,
  options: FactUsageRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { factUsage, workspaceRoot } = options;

  app.get(
    "/v1/workspaces/:workspaceId/fact-usage",
    {
      schema: {
        summary: "Read where career facts may be used",
        description:
          "The usage levels set on sections and facts. A fact with no level of its own takes its section's, and otherwise may be used on a CV.",
        params: workspaceParams,
        response: {
          200: z.object({ usage: factUsageViewSchema }),
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request) => view(await factUsage.read(workspaceRoot(request.params.workspaceId))),
  );

  app.put(
    "/v1/workspaces/:workspaceId/fact-usage",
    {
      schema: {
        summary: "Set or clear one usage level",
        description:
          "Sets the level of one section or one fact, or clears it with `null`. Answers with every level after the change.",
        params: workspaceParams,
        body: factUsageChangeSchema,
        response: {
          200: z.object({ usage: factUsageViewSchema }),
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request) =>
      view(await factUsage.change(workspaceRoot(request.params.workspaceId), request.body)),
  );
}
