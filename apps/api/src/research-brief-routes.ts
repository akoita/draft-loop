import type { ApplicationService } from "@draft-loop/application";
import { type ResearchState, researchOutcomes } from "@draft-loop/run-queue";
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
import type { ResearchRuns } from "./research-runs.js";

/**
 * Research briefs kept with an application (#2542): list, read and delete, for the person only.
 * The candidate starts a run with an explicit approval (#2560); the worker searches and adds the
 * brief, and nothing is searched before that approval.
 */
export interface ResearchBriefRoutesOptions {
  readonly service: Pick<ApplicationService, "getApplication">;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly briefs: ResearchBriefStore;
  /** The worker's research runs; without them a start answers 503. */
  readonly runs?: ResearchRuns;
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

const researchStart = z
  .strictObject({
    approved: z
      .literal(true)
      .describe("The candidate's approval to search the web about the employer; required."),
    window_months: z
      .number()
      .int()
      .min(1)
      .max(36)
      .optional()
      .describe("How many months back a source may date. Defaults to 12."),
  })
  .meta({ id: "ResearchStart" });

const researchView = z
  .strictObject({
    status: z
      .enum(["none", "pending", "done", "failed"])
      .describe(
        "`pending` while the worker researches; `done` once the run ended; `failed` when it failed its retry and saved nothing; `none` when no run was queued.",
      ),
    outcome: z
      .enum(researchOutcomes)
      .optional()
      .describe(
        "How a `done` run ended: `researched` saved a brief; `no-employer`, `consent-required`, `unavailable` and the rest ended before any search.",
      ),
    brief_id: researchBriefIdSchema.optional().describe("The brief a `researched` run saved."),
  })
  .meta({ id: "ResearchRunState" });

function stateView(state: ResearchState | undefined): z.infer<typeof researchView> {
  if (state === undefined) return { status: "none" };
  if (state.status !== "done") return { status: state.status };
  return {
    status: "done",
    outcome: state.outcome,
    ...(state.briefId === undefined ? {} : { brief_id: state.briefId }),
  };
}

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
  const runRoute = "/v1/workspaces/:workspaceId/applications/:applicationId/research";

  app.post(
    runRoute,
    {
      schema: {
        summary: "Research an application's employer, with the candidate's approval",
        description:
          "Queues one research run on the worker: a few web searches about the employer and role, each source screened for prompt injection, sources older than the window dropped, and short findings that cite the kept sources. It reads nothing about the candidate and costs at most US$0.20. `approved` must be `true`. Answers the run's state; a run already waiting is not queued twice. 404 when there is no such application; 503 when this deployment researches nothing.",
        params,
        body: researchStart,
        response: { 202: researchView, 404: apiErrorSchema, 503: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const root = workspaceRoot(workspaceId);
      if ((await service.getApplication({ root, applicationId })) === undefined) {
        return reply.code(404).send(apiError("not_found", "There is no such application."));
      }
      const address = { workspaceId, applicationId };
      const windowMonths = request.body.window_months;
      const queued =
        options.runs === undefined
          ? "unavailable"
          : await options.runs.queue({
              ...address,
              ...(windowMonths === undefined ? {} : { windowMonths }),
            });
      if (queued === "unavailable") {
        return reply
          .code(503)
          .send(apiError("research_unavailable", "This server does not research applications."));
      }
      const state = await options.runs?.state(address);
      return reply.code(202).send(stateView(state ?? { status: "pending" }));
    },
  );

  app.get(
    runRoute,
    {
      schema: {
        summary: "Read where an application's research run stands",
        description:
          "The newest run's state, as the Prepare panel polls it; `brief_id` names the saved brief once it is `done` with `researched`. 404 when there is no such application.",
        params,
        response: { 200: researchView, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const root = workspaceRoot(workspaceId);
      if ((await service.getApplication({ root, applicationId })) === undefined) {
        return reply.code(404).send(apiError("not_found", "There is no such application."));
      }
      return reply.send(stateView(await options.runs?.state({ workspaceId, applicationId })));
    },
  );

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
