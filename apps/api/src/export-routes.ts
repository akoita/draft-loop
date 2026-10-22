import type { ApplicationService, RunExport } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";

export interface ExportRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly idempotency: IdempotencyStore;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const runParams = z.strictObject({ workspaceId: identifierSchema, runId: identifierSchema });

const idempotencyHeaders = z.object({
  "idempotency-key": z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,128}$/u, "must be 8 to 128 safe characters"),
});

const createExportBody = z.strictObject({
  format: z.enum(["markdown", "docx", "pdf"]),
  templateId: identifierSchema
    .optional()
    .describe("A built-in rendering template, such as classic, modern or compact."),
});

export const runExportSchema = z
  .object({
    id: z.string(),
    runId: z.string(),
    format: z.string(),
    mimeType: z.string(),
    createdAt: z.string(),
    checksum: z.string().describe("Lowercase hex SHA-256 of the document."),
    sizeBytes: z.number().int(),
    artifactVersion: z.number().int().optional(),
    templateId: z.string().optional(),
  })
  .describe("Where the document is stored is never shown.")
  .meta({ id: "RunExport" });

/** The client's view of an export: everything but where the service stored it. */
export function runExportView(entry: RunExport): z.infer<typeof runExportSchema> {
  const { location: _location, ...view } = entry;
  return view;
}

const errorResponses = {
  400: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  422: apiErrorSchema,
};

/**
 * Exports of an approved hosted run (ADR 0011, D3): the service renders and stores the document
 * under the tenant's blobs, and these routes only validate, address the run and project it.
 */
export function registerExportRoutes(parent: FastifyInstance, options: ExportRoutesOptions): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, idempotency } = options;

  app.post(
    "/v1/workspaces/:workspaceId/runs/:runId/exports",
    {
      schema: {
        summary: "Export the approved draft as Markdown, DOCX or PDF",
        description:
          "Renders the approved draft, checks it, and stores the document with its checksum; the run becomes exported. A run not yet approved answers 409. PDFs come from the built-in writer. A retry with the same Idempotency-Key answers the same export.",
        params: runParams,
        headers: idempotencyHeaders,
        body: createExportBody,
        response: { 201: runExportSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, runId } = request.params;
      const root = workspaceRoot(workspaceId);
      const created = await idempotency.once(
        `exports:${workspaceId}:${runId}`,
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const location = await service.export({
            root,
            runId,
            format: request.body.format,
            ...(request.body.templateId === undefined
              ? {}
              : { templateId: request.body.templateId }),
          });
          const exports = (await service.listRunExports?.({ root, runId })) ?? [];
          const entry = exports.find((candidate) => candidate.location === location);
          if (entry === undefined) throw new Error("The new export's record could not be read.");
          return runExportView(entry);
        },
      );
      return reply.code(201).send(created);
    },
  );
}
