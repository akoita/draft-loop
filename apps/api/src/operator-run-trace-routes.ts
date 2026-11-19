import type { RunSpanStore } from "@draft-loop/storage/run-spans";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { writeAuditLine } from "./audit-line.js";
import { apiError, apiErrorSchema } from "./errors.js";
import { runSpanSchema, runSpanView } from "./run-trace-routes.js";

export interface OperatorRunTraceOptions {
  /** One organisation's run spans; an unknown organisation has none. */
  readonly runSpansFor: (organisationId: string) => Pick<RunSpanStore, "listRun">;
}

const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const params = z.strictObject({ organisationId: identifier, runId: identifier });

const traceSchema = z
  .object({
    organisation_id: z.string(),
    run_id: z.string(),
    workspace_id: z.string().describe("The workspace the run belongs to."),
    request_id: z
      .string()
      .nullable()
      .describe("The API request that last queued the run, when its spans carry one."),
    spans: z.array(runSpanSchema),
  })
  .meta({ id: "OperatorRunTrace" });

/**
 * The operator's view of one member's run (#3111): its content-free span tree, found by the
 * organisation and run id a feedback note gives, without the workspace or any candidate material.
 * Only the owner token or a member with the operator role and a second factor reaches
 * `/v1/operator/*` (request-auth.ts), and each read writes an audit line.
 */
export function registerOperatorRunTraceRoutes(
  parent: FastifyInstance,
  options: OperatorRunTraceOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/v1/operator/organisations/:organisationId/runs/:runId/trace",
    {
      schema: {
        summary: "Read a member's run trace as the operator",
        description:
          "Operator only. The run's spans in start order: each advance, each author, critic or revision attempt and each retrieval, with timing, status, model, provider error class, tokens, estimated cost and the request id. Content-free. Answers 404 `trace_not_found` when the organisation has no spans for the run.",
        params,
        response: {
          200: traceSchema,
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.caller?.kind !== "owner") {
        return reply.code(403).send(apiError("forbidden", "Only the operator reads run traces."));
      }
      const { organisationId, runId } = request.params;
      const spans = await options.runSpansFor(organisationId).listRun(runId);
      writeAuditLine(request, "run_trace_read", { organisationId, runId, spans: spans.length });
      const first = spans[0];
      if (first === undefined) {
        return reply
          .code(404)
          .send(apiError("trace_not_found", "This organisation has no trace for that run."));
      }
      const requestId = spans
        .map((span) => span.attributes["draftloop.request.id"])
        .findLast((value) => typeof value === "string");
      return {
        organisation_id: organisationId,
        run_id: runId,
        workspace_id: first.workspaceId,
        request_id: typeof requestId === "string" ? requestId : null,
        spans: spans.map(runSpanView),
      };
    },
  );
}
