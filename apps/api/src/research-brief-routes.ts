import type { ApplicationService } from "@draft-loop/application";
import { applicationIdSchema } from "@draft-loop/schemas/application";
import {
  type ResearchBrief,
  researchBriefIdSchema,
  researchFindingSchema,
  researchSourceSchema,
} from "@draft-loop/schemas/research-brief";
import {
  type ResearchBriefStore,
  researchBriefListLimit,
} from "@draft-loop/storage/research-briefs";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

/**
 * Research briefs kept with an application (#2542): list, read and delete. A research run adds
 * briefs on the worker (#2543); these routes only read and remove them, for the person only.
 */
export interface ResearchBriefRoutesOptions {
  readonly service: Pick<ApplicationService, "getApplication">;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly briefs: ResearchBriefStore;
}

const params = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
  applicationId: applicationIdSchema,
});

const briefParams = params.extend({ briefId: researchBriefIdSchema });

const briefView = z
  .object({
    id: researchBriefIdSchema,
    application_id: z.string(),
    queries: z.array(z.string()).describe("What the run searched for."),
    from_date: z.string().describe("The oldest publication date the run kept, `YYYY-MM-DD`."),
    sources: z
      .array(researchSourceSchema)
      .describe(
        "The public sources the run kept. A source without `published_on` is undated; its excerpt is third-party text.",
      ),
    findings: z
      .array(researchFindingSchema)
      .describe("Short facts about the employer, each citing the sources it rests on."),
    dropped: z
      .object({ flagged: z.number().int(), outdated: z.number().int() })
      .describe("Sources the run dropped: flagged by screening, or older than `from_date`."),
    search_provider: z.string(),
    model: z.object({ provider: z.string(), model: z.string() }),
    cost_usd: z.number().describe("What the run's searches and model calls cost."),
    created_at: z.string(),
  })
  .meta({ id: "ResearchBrief" });

const briefList = z
  .strictObject({
    briefs: z
      .array(briefView)
      .describe(
        `The application's research briefs, newest first, at most ${researchBriefListLimit}.`,
      ),
  })
  .meta({ id: "ResearchBriefList" });

function viewOf(brief: ResearchBrief): z.infer<typeof briefView> {
  const { workspace_id: _workspace, ...view } = brief;
  return view;
}

export function registerResearchBriefRoutes(
  parent: FastifyInstance,
  options: ResearchBriefRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, briefs } = options;
  const route = "/v1/workspaces/:workspaceId/applications/:applicationId/research-briefs";

  app.get(
    route,
    {
      schema: {
        summary: "List an application's research briefs",
        description:
          "Returns the application's research briefs, newest first, each with its sources, findings and cost. 404 when there is no such application.",
        params,
        response: { 200: briefList, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const root = workspaceRoot(workspaceId);
      if ((await service.getApplication({ root, applicationId })) === undefined) {
        return reply.code(404).send(apiError("not_found", "There is no such application."));
      }
      const kept = await briefs.list(workspaceId, applicationId);
      return reply.send({ briefs: kept.map(viewOf) });
    },
  );

  app.get(
    `${route}/:briefId`,
    {
      schema: {
        summary: "Read one research brief",
        description:
          "Returns one brief of the application. 404 when the application has no such brief.",
        params: briefParams,
        response: { 200: briefView, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId, briefId } = request.params;
      const brief = await briefs.get(workspaceId, briefId);
      if (brief === undefined || brief.application_id !== applicationId) {
        return reply.code(404).send(apiError("not_found", "There is no such research brief."));
      }
      return reply.send(viewOf(brief));
    },
  );

  app.delete(
    `${route}/:briefId`,
    {
      schema: {
        summary: "Delete one research brief",
        description:
          "Deletes one brief of the application for good. 404 when the application has no such brief.",
        params: briefParams,
        response: { 204: z.null(), 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId, briefId } = request.params;
      const brief = await briefs.get(workspaceId, briefId);
      if (brief === undefined || brief.application_id !== applicationId) {
        return reply.code(404).send(apiError("not_found", "There is no such research brief."));
      }
      await briefs.delete(workspaceId, briefId);
      request.log.info({ workspaceId, applicationId, briefId }, "research brief deleted");
      return reply.code(204).send(null);
    },
  );
}
