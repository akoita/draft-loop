import { type ApplicationService, CliUserError } from "@draft-loop/application";
import type { UrlFetcher } from "@draft-loop/ingestion";
import {
  applicationIdSchema,
  applicationPastedJobMaxLength,
} from "@draft-loop/schemas/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { applicationJob, applicationJobSchema } from "./application-lifecycle-routes.js";
import { apiError, apiErrorSchema } from "./errors.js";
import { fetchApprovedJobPage, jobPageFetch, keepJobPage } from "./job-page-brief.js";

export interface ApplicationJobCopyRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly jobPageFetcher?: UrlFetcher;
  readonly now?: () => Date;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const applicationParams = z.strictObject({
  workspaceId: identifierSchema,
  applicationId: applicationIdSchema,
});

const errorResponses = { 400: apiErrorSchema, 404: apiErrorSchema, 422: apiErrorSchema };

const saveCopyBody = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .max(applicationPastedJobMaxLength)
    .optional()
    .describe("The job description the person pasted; absent reads the approved page once now."),
});

/**
 * Saves a copy of an application's job page (#2593): read once more from the address approved
 * with the application, or pasted by the person when the page has expired. A copy that differs
 * from the first one is added beside it; the first copy is never replaced.
 */
export function registerApplicationJobCopyRoutes(
  parent: FastifyInstance,
  options: ApplicationJobCopyRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, jobPageFetcher } = options;
  const now = options.now ?? (() => new Date());

  app.post(
    "/v1/workspaces/:workspaceId/applications/:applicationId/job/copy",
    {
      schema: {
        summary: "Save a copy of a job application's job page",
        description:
          "Without text, reads the job page approved with the application once, through the page fetcher, and keeps its text. With text, keeps the job description the person pasted, for a page that can no longer be read. Only an application added from a job page has a copy; its first copy is never replaced.",
        params: applicationParams,
        body: saveCopyBody,
        response: { 200: applicationJobSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const root = workspaceRoot(workspaceId);
      const view = await service.getApplication({ root, applicationId });
      if (view === undefined) {
        return reply.code(404).send(apiError("not_found", "No such application."));
      }
      const job = view.jobSource;
      if (job.kind !== "approved-url") {
        throw new CliUserError("Only an application added from a job page keeps a copy of it.");
      }
      const { text } = request.body;
      if (text === undefined) {
        const pageFetch = jobPageFetch(jobPageFetcher);
        const source = {
          id: "job-page",
          kind: "approved-url",
          url: job.url,
          classification: "job-posting",
          approved: true,
        } as const;
        await fetchApprovedJobPage(pageFetch, [source], request.log);
        const page = pageFetch.page();
        if (page !== undefined) await keepJobPage(service, { root, applicationId, page });
      } else {
        const page = {
          text,
          finalUrl: job.url,
          fetchedAt: now().toISOString(),
          pasted: true as const,
        };
        await keepJobPage(service, { root, applicationId, page });
      }
      const saved = await service.getApplication({ root, applicationId });
      return applicationJob(saved ?? view);
    },
  );
}
