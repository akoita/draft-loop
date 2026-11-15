import type { ApplicationService } from "@draft-loop/application";
import { runSpanAttributeNames, runSpanNames } from "@draft-loop/domain/run-span";
import type { RunSpanRecord, RunSpanStore } from "@draft-loop/storage/run-spans";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";

/** The run spans of the tenant a request acts in; none when it has no tenant. */
export type RunSpansFor = (request: FastifyRequest) => Pick<RunSpanStore, "list"> | undefined;

export interface RunTraceRoutesOptions {
  readonly service: Pick<ApplicationService, "readWorkspace">;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly spansFor: RunSpansFor;
}

const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const params = z.strictObject({ workspaceId: identifier, runId: identifier });

const spanSchema = z
  .object({
    span_id: z.string(),
    parent_span_id: z
      .string()
      .nullable()
      .describe("The span this one ran inside; null for a root."),
    name: z.enum(runSpanNames),
    started_at: z.string(),
    ended_at: z.string().nullable().describe("Null when the step never finished."),
    status: z.enum(["ok", "error"]).nullable(),
    attributes: z
      .partialRecord(z.enum(runSpanAttributeNames), z.union([z.string(), z.number(), z.boolean()]))
      .describe("Numbers, booleans and short identifiers only. Never candidate material."),
  })
  .meta({ id: "RunSpan" });

function view(span: RunSpanRecord) {
  return {
    span_id: span.spanId,
    parent_span_id: span.parentSpanId,
    name: span.name,
    started_at: span.startedAt,
    ended_at: span.endedAt,
    status: span.status,
    attributes: span.attributes,
  };
}

/**
 * A run's trace (#1103): the content-free spans the worker recorded while it executed the run, so
 * the person who owns the workspace can see which step failed, on which model and at what cost.
 * The workspace access hooks apply as on every workspace route, so a trace is read by whoever can
 * already read the run. A span holds counts, costs and identifiers, never material, so the trace
 * shows nothing the run's own review does not. An agent's token or grant never reaches this route.
 */
export function registerRunTraceRoutes(
  parent: FastifyInstance,
  options: RunTraceRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/v1/workspaces/:workspaceId/runs/:runId/trace",
    {
      schema: {
        summary: "Read a run's trace",
        description:
          "The steps the worker executed for the run, in start order: each advance, each author, critic or revision attempt, and each evidence retrieval, with its timing, status, model, token counts and estimated cost. Content-free: no prompt, draft or candidate material. Empty for a run no worker has executed since traces were recorded.",
        params,
        response: {
          200: z.object({ spans: z.array(spanSchema) }),
          400: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { workspaceId, runId } = request.params;
      // Refuses a workspace that is not the caller's before any span is read.
      await options.service.readWorkspace(options.workspaceRoot(workspaceId));
      const spans = options.spansFor(request);
      if (spans === undefined) throw new Error("The request has no tenant to read a trace for.");
      return { spans: (await spans.list(workspaceId, runId)).map(view) };
    },
  );
}
