import {
  type ApplicationService,
  CliUserError,
  type ImportApplicationBundleResult,
} from "@draft-loop/application";
import { applicationBundleSchema } from "@draft-loop/schemas/application-bundle";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiErrorSchema } from "./errors.js";

/** The largest bundle one request takes: an application with many runs and their saved steps. */
export const applicationImportMaxBytes = 64 * 1024 * 1024;

export interface ApplicationImportRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  /** Injection screening of the imported job text against each imported brief. */
  readonly screening?: Pick<ContentScreeningHooks, "screenOpportunity">;
}

const workspaceParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const importResultSchema = z
  .object({
    applicationId: z.string(),
    name: z.string(),
    status: z
      .enum(["imported", "already-imported"])
      .describe("already-imported when an earlier import of the same application finished."),
    counts: z.object({
      runs: z.number().int(),
      briefs: z.number().int(),
      briefVersions: z.number().int(),
    }),
  })
  .meta({ id: "ApplicationImport" });

/**
 * The import of one desktop application into a workspace (ADR 0011, D12): the job, its job briefs
 * and its runs, as `draft-loop server import` sends them. Only owner-token mode offers it, where
 * the one owner is the person whose desktop history it is.
 */
export function registerApplicationImportRoutes(
  parent: FastifyInstance,
  options: ApplicationImportRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, screening } = options;

  app.post(
    "/v1/workspaces/:workspaceId/application-imports",
    {
      bodyLimit: applicationImportMaxBytes,
      schema: {
        summary: "Import one application from a desktop workspace",
        description:
          "Writes the bundle's application, job briefs and runs into the workspace, keeping their ids. A run or brief id the workspace already holds elsewhere refuses the whole import (422). The same bundle sent again answers already-imported, and a bundle sent after an interrupted import resumes it. Export files are not carried; export the imported runs again. After the import, the job text is screened against each imported brief, so a flagged job quarantines runs on that brief. Only owner-token mode offers this route.",
        params: workspaceParams,
        body: applicationBundleSchema,
        response: {
          200: importResultSchema,
          201: importResultSchema,
          400: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const root = workspaceRoot(request.params.workspaceId);
      if (service.importApplicationBundle === undefined) {
        throw new CliUserError("This server does not import applications.");
      }
      const result: ImportApplicationBundleResult = await service.importApplicationBundle({
        root,
        bundle: request.body,
      });
      if (result.status === "imported" && screening !== undefined) {
        // After the import, so the briefs exist; a screener's failure is the result's verdict.
        for (const { briefId } of request.body.briefs) {
          const record = await service.getOpportunity({ root, briefId });
          const source =
            record?.brief.sources.find(({ classification }) => classification === "job-posting") ??
            record?.brief.sources[0];
          if (record === undefined || source === undefined) continue;
          await screening.screenOpportunity(request, record, [
            {
              id: source.id,
              kind: "pasted-content",
              classification: "job-posting",
              content: request.body.jobText,
            },
          ]);
        }
      }
      return reply.code(result.status === "imported" ? 201 : 200).send(result);
    },
  );
}
