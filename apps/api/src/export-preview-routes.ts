import type { ApplicationService } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiErrorSchema } from "./errors.js";

export interface ExportPreviewRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const runParams = z.strictObject({ workspaceId: identifierSchema, runId: identifierSchema });

const previewBody = z.strictObject({
  format: z.enum(["markdown", "docx", "pdf"]),
  templateId: identifierSchema
    .optional()
    .describe("A built-in rendering template, such as classic, modern or compact."),
});

const errorResponses = {
  400: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  422: apiErrorSchema,
};

/**
 * The preview of an approved run's export (#2497): the same document an export of the same
 * choices would save, rendered on request and stored nowhere. The run stays as it was.
 */
export function registerExportPreviewRoutes(
  parent: FastifyInstance,
  options: ExportPreviewRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot } = options;

  app.post(
    "/v1/workspaces/:workspaceId/runs/:runId/export-preview",
    {
      schema: {
        summary: "Preview the approved draft's export without saving it",
        description:
          "Answers the document an export with the same format and template would save, inline, with its page count for a PDF in X-Page-Count and the template's page target in X-Target-Page-Count. Nothing is stored, no export is recorded and the run's state does not change. A run not yet approved answers 409.",
        params: runParams,
        body: previewBody,
        response: {
          200: z.any().describe("The document's bytes, in its media type."),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, runId } = request.params;
      if (service.previewExport === undefined)
        throw new Error("The hosted service cannot preview exports.");
      const preview = await service.previewExport({
        root: workspaceRoot(workspaceId),
        runId,
        format: request.body.format,
        ...(request.body.templateId === undefined ? {} : { templateId: request.body.templateId }),
      });
      reply
        .code(200)
        .header("content-type", preview.mimeType)
        .header("content-disposition", "inline")
        .header("cache-control", "private, no-store")
        .header("x-template-id", preview.templateId)
        .header("x-target-page-count", String(preview.targetPageCount));
      if (preview.pageCount !== null) reply.header("x-page-count", String(preview.pageCount));
      return reply.send(Buffer.from(preview.content));
    },
  );
}
